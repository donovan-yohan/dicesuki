// Pure game engine (physics, dice, room simulation, protocol, face detection)
// now lives in the `dicesuki-core` crate (issue #112). Re-exported so existing
// `crate::messages::*`, `crate::room::*`, etc. paths across the server keep
// resolving unchanged.
pub use dicesuki_core::{dice, face_detection, messages, physics, player, room, sink};

pub mod auth;
pub mod discord;
pub mod registry;
pub mod roll_reporting;
pub mod room_manager;
pub mod routes;
pub mod simulation;
pub mod supabase;
pub mod ws_handler;

use std::sync::{Arc, LazyLock};
use tokio::sync::RwLock;

use axum::{
    extract::FromRef,
    routing::{get, post},
    Router,
};

pub use roll_reporting::RollReporter;
pub use room_manager::RoomManager;

pub type SharedRoomManager = Arc<RwLock<RoomManager>>;

/// Runtime dependencies injected into HTTP/WebSocket handlers. Keeping the
/// reporter here avoids globals and lets existing tests select disabled mode.
#[derive(Clone)]
pub struct AppState {
    pub room_manager: SharedRoomManager,
    pub roll_reporter: RollReporter,
}

impl FromRef<AppState> for SharedRoomManager {
    fn from_ref(state: &AppState) -> Self {
        state.room_manager.clone()
    }
}

/// Unique instance ID generated at startup — used to detect multiple instances
pub static INSTANCE_ID: LazyLock<String> = LazyLock::new(|| nanoid::nanoid!(8));

/// Build the axum application in reporter-disabled mode. This compatibility
/// entrypoint keeps local/integration harnesses network-free.
pub fn build_app(room_manager: SharedRoomManager) -> Router {
    build_app_with_reporter(room_manager, RollReporter::disabled())
}

/// Build the runtime application with an explicitly injected roll reporter.
pub fn build_app_with_reporter(
    room_manager: SharedRoomManager,
    roll_reporter: RollReporter,
) -> Router {
    Router::new()
        .route("/health", get(routes::health))
        .route("/api/rooms", post(routes::create_room).get(routes::list_rooms))
        .route("/api/rooms/:room_id", get(routes::get_room_info))
        .route("/ws/:room_id", get(routes::ws_upgrade))
        .fallback(routes::fallback)
        .layer(routes::build_cors_layer())
        .layer(axum::middleware::from_fn(routes::log_requests))
        .with_state(AppState {
            room_manager,
            roll_reporter,
        })
}
