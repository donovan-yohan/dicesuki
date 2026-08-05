// Pure game engine (physics, dice, room simulation, protocol, face detection)
// now lives in the `dicesuki-core` crate (issue #112). Re-exported so existing
// `crate::messages::*`, `crate::room::*`, etc. paths across the server keep
// resolving unchanged.
pub use dicesuki_core::{dice, face_detection, messages, physics, player, room, sink};

pub mod auth;
pub mod discord;
pub mod discord_api;
pub mod discord_targets;
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
    /// Discord integration (issue #246), `None` when the bot is not configured.
    /// Shared with the background advert sync loop so a host post registered by
    /// an HTTP handler is picked up by the next reconcile pass.
    pub discord: Option<Arc<discord::DiscordService>>,
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

/// Build the runtime application with an explicitly injected roll reporter and
/// no Discord integration.
pub fn build_app_with_reporter(
    room_manager: SharedRoomManager,
    roll_reporter: RollReporter,
) -> Router {
    build_app_with_state(AppState {
        room_manager,
        roll_reporter,
        discord: None,
    })
}

/// Build the runtime application over a fully-constructed [`AppState`].
pub fn build_app_with_state(state: AppState) -> Router {
    Router::new()
        .route("/health", get(routes::health))
        .route("/api/rooms", post(routes::create_room).get(routes::list_rooms))
        .route("/api/rooms/:room_id", get(routes::get_room_info))
        // Host-initiated Discord posting (#246). axum 0.7 path syntax (`:param`).
        .route(
            "/api/rooms/:room_id/advertise",
            post(routes::advertise_room),
        )
        .route("/api/discord/targets", get(routes::discord_targets))
        .route("/ws/:room_id", get(routes::ws_upgrade))
        .fallback(routes::fallback)
        .layer(routes::build_cors_layer())
        .layer(axum::middleware::from_fn(routes::log_requests))
        .with_state(state)
}
