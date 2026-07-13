pub mod dice;
pub mod face_detection;
pub mod messages;
pub mod physics;
pub mod player;
pub mod room;
pub mod room_manager;
pub mod routes;
pub mod ws_handler;

use std::sync::{Arc, LazyLock};
use tokio::sync::RwLock;

use axum::{routing::{get, post}, Router};

pub use room_manager::RoomManager;

pub type SharedRoomManager = Arc<RwLock<RoomManager>>;

/// Unique instance ID generated at startup — used to detect multiple instances
pub static INSTANCE_ID: LazyLock<String> = LazyLock::new(|| nanoid::nanoid!(8));

/// Build the axum application with all routes and middleware.
pub fn build_app(room_manager: SharedRoomManager) -> Router {
    Router::new()
        .route("/health", get(routes::health))
        .route("/api/rooms", post(routes::create_room).get(routes::list_rooms))
        .route("/api/rooms/:room_id", get(routes::get_room_info))
        .route("/ws/:room_id", get(routes::ws_upgrade))
        .fallback(routes::fallback)
        .layer(routes::build_cors_layer())
        .layer(axum::middleware::from_fn(routes::log_requests))
        .with_state(room_manager)
}
