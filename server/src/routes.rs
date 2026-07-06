use axum::{
    extract::{Path, Request, State},
    http::StatusCode,
    middleware::Next,
    response::IntoResponse,
    Json,
};
use axum::http::{HeaderValue, Method};
use tower_http::cors::CorsLayer;
use log::info;

use crate::{SharedRoomManager, INSTANCE_ID};

/// Middleware that logs every incoming request and its response status.
pub async fn log_requests(req: Request, next: Next) -> impl IntoResponse {
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

pub fn build_cors_layer() -> CorsLayer {
    if let Ok(origin) = std::env::var("CORS_ORIGIN") {
        info!("CORS restricted to: {origin}");
        CorsLayer::new()
            .allow_origin(origin.parse::<HeaderValue>().expect("Invalid CORS_ORIGIN"))
            .allow_methods([Method::GET, Method::POST, Method::OPTIONS])
            .allow_headers(tower_http::cors::Any)
    } else {
        info!("CORS_ORIGIN not set, allowing all origins (dev mode)");
        CorsLayer::permissive()
    }
}

pub async fn health() -> impl IntoResponse {
    Json(serde_json::json!({
        "status": "ok",
        "instanceId": *INSTANCE_ID,
    }))
}

pub async fn create_room(State(mgr): State<SharedRoomManager>) -> impl IntoResponse {
    let mut mgr = mgr.write().await;
    let (room_id, _) = mgr.create_room();
    info!("[{}] Room created via API: {} (total: {})", *INSTANCE_ID, room_id, mgr.room_count());
    (
        StatusCode::CREATED,
        Json(serde_json::json!({"roomId": room_id, "instanceId": *INSTANCE_ID})),
    )
}

pub async fn get_room_info(
    State(mgr): State<SharedRoomManager>,
    Path(room_id): Path<String>,
) -> impl IntoResponse {
    // Clone the Arc before releasing the manager lock to avoid holding
    // the manager read lock across a nested room read lock acquisition.
    let maybe_room = {
        let mgr = mgr.read().await;
        info!("[{}] GET /api/rooms/{} (total rooms: {})", *INSTANCE_ID, room_id, mgr.room_count());
        mgr.get_room(&room_id)
    };
    // Manager lock is released here.
    match maybe_room {
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
            Json(serde_json::json!({"error": "ROOM_NOT_FOUND", "instanceId": *INSTANCE_ID})),
        )
            .into_response(),
    }
}

/// Fallback handler — logs requests that don't match any route.
pub async fn fallback(req: Request) -> impl IntoResponse {
    info!(
        "[{}] FALLBACK (no route matched): {:?} {} {}",
        *INSTANCE_ID,
        req.version(),
        req.method(),
        req.uri()
    );
    StatusCode::NOT_FOUND
}

pub async fn ws_upgrade(
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

    if let Some(ws) = ws {
        let mgr_read = mgr.read().await;
        if let Some(room) = mgr_read.get_room(&room_id) {
            info!("[{}] Room {} found, upgrading WebSocket", *INSTANCE_ID, room_id);
            drop(mgr_read);
            ws.on_upgrade(move |socket| crate::ws_handler::handle_ws_connection(socket, room))
        } else {
            info!(
                "[{}] WS upgrade failed: room {} not found (total: {})",
                *INSTANCE_ID,
                room_id,
                mgr_read.room_count()
            );
            StatusCode::NOT_FOUND.into_response()
        }
    } else {
        info!(
            "[{}] WebSocket extractor FAILED for room: {} — upgrade headers missing or connection not upgradable",
            *INSTANCE_ID, room_id
        );
        (StatusCode::BAD_REQUEST, "WebSocket upgrade required").into_response()
    }
}
