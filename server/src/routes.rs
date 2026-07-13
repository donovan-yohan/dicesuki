use axum::{
    extract::{Path, Query, Request, State},
    http::StatusCode,
    middleware::Next,
    response::IntoResponse,
    Json,
};
use axum::http::{HeaderValue, Method};
use serde::Deserialize;
use tower_http::cors::CorsLayer;
use log::info;

use crate::room::RoomListing;
use crate::{SharedRoomManager, INSTANCE_ID};

/// Default page size for the public room listing when the client omits one.
const DEFAULT_PAGE_SIZE: usize = 20;
/// Hard ceiling on `pageSize` so a single request can never demand an unbounded
/// number of rooms.
const MAX_PAGE_SIZE: usize = 100;

/// Query parameters for the paginated public room listing (`GET /api/rooms`).
#[derive(Debug, Deserialize)]
pub struct ListRoomsQuery {
    /// Zero-based page index. Defaults to 0.
    pub page: Option<usize>,
    /// Rooms per page. Defaults to [`DEFAULT_PAGE_SIZE`], clamped to
    /// `1..=MAX_PAGE_SIZE`.
    #[serde(rename = "pageSize")]
    pub page_size: Option<usize>,
}

/// Apply pagination to an already-filtered, sorted list of public rooms.
/// Returns the requested page slice alongside the effective (clamped) page and
/// page size and the total number of public rooms. Kept pure so the
/// slice/clamp arithmetic is unit-testable without a running server.
#[must_use]
pub fn paginate_listings(
    mut listings: Vec<RoomListing>,
    page: Option<usize>,
    page_size: Option<usize>,
) -> (Vec<RoomListing>, usize, usize, usize) {
    // Deterministic ordering so pagination is stable across requests.
    listings.sort_by(|a, b| a.room_id.cmp(&b.room_id));
    let total = listings.len();
    let page = page.unwrap_or(0);
    let page_size = page_size.unwrap_or(DEFAULT_PAGE_SIZE).clamp(1, MAX_PAGE_SIZE);
    let start = page.saturating_mul(page_size);
    let paged = listings
        .into_iter()
        .skip(start)
        .take(page_size)
        .collect::<Vec<_>>();
    (paged, page, page_size, total)
}

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

/// `GET /api/rooms` — the public room browser listing (#79). Returns only rooms
/// the host has marked `visibility = "public"`, each with its id, optional name,
/// current player count, and optional theme id, paginated. Unlisted rooms (the
/// default) never appear.
pub async fn list_rooms(
    State(mgr): State<SharedRoomManager>,
    Query(query): Query<ListRoomsQuery>,
) -> impl IntoResponse {
    // Snapshot the room handles, then release the manager lock before taking any
    // per-room read lock (avoids holding both locks at once).
    let rooms = {
        let mgr = mgr.read().await;
        mgr.rooms_snapshot()
    };

    let mut listings = Vec::new();
    for room in &rooms {
        if let Some(listing) = room.read().await.public_listing() {
            listings.push(listing);
        }
    }

    let (paged, page, page_size, total) =
        paginate_listings(listings, query.page, query.page_size);

    info!(
        "[{}] GET /api/rooms (public: {}, page: {}, pageSize: {})",
        *INSTANCE_ID, total, page, page_size
    );

    Json(serde_json::json!({
        "rooms": paged,
        "page": page,
        "pageSize": page_size,
        "total": total,
        "instanceId": *INSTANCE_ID,
    }))
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

#[cfg(test)]
mod tests {
    use super::*;
    use crate::room::RoomListing;

    fn listing(id: &str) -> RoomListing {
        RoomListing {
            room_id: id.to_string(),
            name: None,
            player_count: 0,
            theme_id: None,
        }
    }

    #[test]
    fn paginate_defaults_to_page_zero_size_twenty() {
        let listings: Vec<RoomListing> = (0..5).map(|i| listing(&format!("r{i}"))).collect();
        let (paged, page, page_size, total) = paginate_listings(listings, None, None);
        assert_eq!(page, 0);
        assert_eq!(page_size, DEFAULT_PAGE_SIZE);
        assert_eq!(total, 5);
        assert_eq!(paged.len(), 5);
    }

    #[test]
    fn paginate_slices_requested_page() {
        let listings: Vec<RoomListing> = (0..10).map(|i| listing(&format!("r{i:02}"))).collect();
        let (paged, page, page_size, total) = paginate_listings(listings, Some(1), Some(3));
        assert_eq!((page, page_size, total), (1, 3, 10));
        // Sorted ascending, page 1 of size 3 => r03, r04, r05.
        let ids: Vec<&str> = paged.iter().map(|l| l.room_id.as_str()).collect();
        assert_eq!(ids, ["r03", "r04", "r05"]);
    }

    #[test]
    fn paginate_clamps_page_size_to_max() {
        let listings: Vec<RoomListing> = (0..3).map(|i| listing(&format!("r{i}"))).collect();
        let (_, _, page_size, _) = paginate_listings(listings, None, Some(9999));
        assert_eq!(page_size, MAX_PAGE_SIZE);
    }

    #[test]
    fn paginate_page_size_never_zero() {
        let (_, _, page_size, _) = paginate_listings(vec![], None, Some(0));
        assert_eq!(page_size, 1, "pageSize is clamped to at least 1");
    }

    #[test]
    fn paginate_page_past_end_is_empty() {
        let listings: Vec<RoomListing> = (0..3).map(|i| listing(&format!("r{i}"))).collect();
        let (paged, _, _, total) = paginate_listings(listings, Some(50), Some(10));
        assert!(paged.is_empty());
        assert_eq!(total, 3, "Total still reflects all public rooms");
    }

    #[test]
    fn paginate_sorts_deterministically() {
        let listings = vec![listing("zeta"), listing("alpha"), listing("mike")];
        let (paged, _, _, _) = paginate_listings(listings, None, None);
        let ids: Vec<&str> = paged.iter().map(|l| l.room_id.as_str()).collect();
        assert_eq!(ids, ["alpha", "mike", "zeta"]);
    }
}
