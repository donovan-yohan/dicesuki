pub mod dice;
pub mod face_detection;
pub mod messages;
pub mod physics;
pub mod player;
pub mod room;
pub mod room_manager;
pub mod ws_handler;

use std::sync::{Arc, LazyLock};
use tokio::sync::RwLock;

use axum::{
    extract::{Path, Request, State},
    http::StatusCode,
    middleware::Next,
    response::IntoResponse,
    routing::{get, post},
    Json, Router,
};
use axum::http::{HeaderValue, Method};
use tower_http::cors::CorsLayer;
use log::info;

pub use room_manager::RoomManager;

pub type SharedRoomManager = Arc<RwLock<RoomManager>>;

/// Unique instance ID generated at startup — used to detect multiple instances
pub static INSTANCE_ID: LazyLock<String> = LazyLock::new(|| nanoid::nanoid!(8));

/// Middleware that logs every incoming request and its response status.
async fn log_requests(req: Request, next: Next) -> impl IntoResponse {
    let method = req.method().clone();
    let uri = req.uri().clone();
    let version = req.version();
    let upgrade_header = req.headers().get("upgrade").map(|v| v.to_str().unwrap_or("?").to_string());

    // Log extra headers for WebSocket requests to diagnose proxy issues
    if uri.path().starts_with("/ws/") {
        let connection = req.headers().get("connection").map(|v| v.to_str().unwrap_or("?").to_string());
        let ws_version = req.headers().get("sec-websocket-version").map(|v| v.to_str().unwrap_or("?").to_string());
        let ws_key = req.headers().get("sec-websocket-key").is_some();
        info!(
            "[{}] --> {:?} {} {} (upgrade: {:?}, connection: {:?}, sec-ws-version: {:?}, sec-ws-key: {})",
            *INSTANCE_ID, version, method, uri, upgrade_header, connection, ws_version, ws_key
        );
    } else {
        info!("[{}] --> {:?} {} {} (upgrade: {:?})", *INSTANCE_ID, version, method, uri, upgrade_header);
    }

    let response = next.run(req).await;
    info!("[{}] <-- {} {} => {}", *INSTANCE_ID, method, uri, response.status());
    response
}

fn build_cors_layer() -> CorsLayer {
    match std::env::var("CORS_ORIGIN") {
        Ok(origin) => {
            info!("CORS restricted to: {}", origin);
            CorsLayer::new()
                .allow_origin(origin.parse::<HeaderValue>().expect("Invalid CORS_ORIGIN"))
                .allow_methods([Method::GET, Method::POST, Method::OPTIONS])
                .allow_headers(tower_http::cors::Any)
        }
        Err(_) => {
            info!("CORS_ORIGIN not set, allowing all origins (dev mode)");
            CorsLayer::permissive()
        }
    }
}

async fn health() -> impl IntoResponse {
    Json(serde_json::json!({
        "status": "ok",
        "instanceId": *INSTANCE_ID,
    }))
}

async fn create_room(State(mgr): State<SharedRoomManager>) -> impl IntoResponse {
    let mut mgr = mgr.write().await;
    let (room_id, _) = mgr.create_room();
    info!("[{}] Room created via API: {} (total: {})", *INSTANCE_ID, room_id, mgr.room_count());
    (
        StatusCode::CREATED,
        Json(serde_json::json!({"roomId": room_id, "instanceId": *INSTANCE_ID})),
    )
}

async fn get_room_info(
    State(mgr): State<SharedRoomManager>,
    Path(room_id): Path<String>,
) -> impl IntoResponse {
    let mgr = mgr.read().await;
    info!("[{}] GET /api/rooms/{} (total rooms: {})", *INSTANCE_ID, room_id, mgr.room_count());
    match mgr.get_room(&room_id) {
        Some(room) => {
            let room = room.read().await;
            Json(serde_json::json!({
                "roomId": room.id,
                "playerCount": room.player_count(),
                "diceCount": room.dice_count(),
                "instanceId": *INSTANCE_ID,
            }))
            .into_response()
        }
        None => (
            StatusCode::NOT_FOUND,
            Json(serde_json::json!({"error": "ROOM_NOT_FOUND", "instanceId": *INSTANCE_ID, "roomCount": mgr.room_count()})),
        )
            .into_response(),
    }
}

/// Fallback handler — logs requests that don't match any route.
async fn fallback(req: Request) -> impl IntoResponse {
    info!(
        "[{}] FALLBACK (no route matched): {:?} {} {}",
        *INSTANCE_ID,
        req.version(),
        req.method(),
        req.uri()
    );
    StatusCode::NOT_FOUND
}

async fn ws_upgrade(
    State(mgr): State<SharedRoomManager>,
    Path(room_id): Path<String>,
    ws: Option<axum::extract::ws::WebSocketUpgrade>,
) -> impl IntoResponse {
    info!(
        "[{}] WS handler entered for room: {} (extractor: {})",
        *INSTANCE_ID,
        room_id,
        if ws.is_some() { "OK" } else { "FAILED" }
    );

    match ws {
        Some(ws) => {
            let mgr_read = mgr.read().await;
            match mgr_read.get_room(&room_id) {
                Some(room) => {
                    info!("[{}] Room {} found, upgrading WebSocket", *INSTANCE_ID, room_id);
                    drop(mgr_read);
                    ws.on_upgrade(move |socket| ws_handler::handle_ws_connection(socket, room))
                }
                None => {
                    info!(
                        "[{}] WS upgrade failed: room {} not found (total: {})",
                        *INSTANCE_ID,
                        room_id,
                        mgr_read.room_count()
                    );
                    StatusCode::NOT_FOUND.into_response()
                }
            }
        }
        None => {
            info!(
                "[{}] WebSocket extractor FAILED for room: {} — upgrade headers missing or connection not upgradable",
                *INSTANCE_ID, room_id
            );
            (StatusCode::BAD_REQUEST, "WebSocket upgrade required").into_response()
        }
    }
}

/// Build the axum application with all routes and middleware.
pub fn build_app(room_manager: SharedRoomManager) -> Router {
    Router::new()
        .route("/health", get(health))
        .route("/api/rooms", post(create_room))
        .route("/api/rooms/:room_id", get(get_room_info))
        .route("/ws/:room_id", get(ws_upgrade))
        .fallback(fallback)
        .layer(build_cors_layer())
        .layer(axum::middleware::from_fn(log_requests))
        .with_state(room_manager)
}
