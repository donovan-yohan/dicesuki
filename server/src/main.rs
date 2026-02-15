mod dice;
mod face_detection;
mod messages;
mod physics;
mod player;
mod room;
mod room_manager;
mod ws_handler;

use std::net::SocketAddr;
use std::sync::{Arc, LazyLock};
use tokio::sync::RwLock;

/// Unique instance ID generated at startup — used to detect multiple instances
static INSTANCE_ID: LazyLock<String> = LazyLock::new(|| nanoid::nanoid!(8));

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

use room_manager::RoomManager;

type SharedRoomManager = Arc<RwLock<RoomManager>>;

/// Middleware that logs every incoming request and its response status.
async fn log_requests(req: Request, next: Next) -> impl IntoResponse {
    let method = req.method().clone();
    let uri = req.uri().clone();
    let upgrade_header = req.headers().get("upgrade").map(|v| v.to_str().unwrap_or("?").to_string());
    info!("[{}] --> {} {} (upgrade: {:?})", *INSTANCE_ID, method, uri, upgrade_header);
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

async fn ws_upgrade(
    State(mgr): State<SharedRoomManager>,
    Path(room_id): Path<String>,
    ws: axum::extract::ws::WebSocketUpgrade,
) -> impl IntoResponse {
    info!("[{}] WS upgrade handler entered for room: {}", *INSTANCE_ID, room_id);
    let mgr_read = mgr.read().await;
    match mgr_read.get_room(&room_id) {
        Some(room) => {
            info!("[{}] Room {} found, upgrading WebSocket", *INSTANCE_ID, room_id);
            drop(mgr_read);
            ws.on_upgrade(move |socket| ws_handler::handle_ws_connection(socket, room))
        }
        None => {
            info!("[{}] WS upgrade failed: room {} not found (total: {})", *INSTANCE_ID, room_id, mgr_read.room_count());
            StatusCode::NOT_FOUND.into_response()
        }
    }
}

#[tokio::main]
async fn main() {
    env_logger::Builder::from_env(env_logger::Env::default().default_filter_or("info")).init();
    info!("Instance ID: {}", *INSTANCE_ID);

    let room_manager: SharedRoomManager = Arc::new(RwLock::new(RoomManager::new()));

    let app = Router::new()
        .route("/health", get(health))
        .route("/api/rooms", post(create_room))
        .route("/api/rooms/{room_id}", get(get_room_info))
        .route("/ws/{room_id}", get(ws_upgrade))
        .layer(build_cors_layer())
        .layer(axum::middleware::from_fn(log_requests))
        .with_state(room_manager.clone());

    // Spawn stale room cleanup task (every 5 minutes)
    let cleanup_mgr = room_manager.clone();
    tokio::spawn(async move {
        loop {
            tokio::time::sleep(std::time::Duration::from_secs(300)).await;
            cleanup_mgr.write().await.cleanup_stale_rooms().await;
        }
    });

    let port: u16 = match std::env::var("PORT") {
        Ok(val) => match val.parse() {
            Ok(p) => {
                info!("Using PORT from environment: {}", p);
                p
            }
            Err(_) => {
                info!("Invalid PORT '{}', using default: 8080", val);
                8080
            }
        },
        Err(_) => {
            info!("PORT not set, using default: 8080");
            8080
        }
    };
    let addr = SocketAddr::from(([0, 0, 0, 0], port));
    info!("Dicesuki server listening on {}", addr);
    let listener = tokio::net::TcpListener::bind(addr)
        .await
        .expect("Failed to bind — is the port already in use?");
    axum::serve(listener, app)
        .await
        .expect("Server exited unexpectedly");
}
