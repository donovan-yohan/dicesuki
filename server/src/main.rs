use std::net::SocketAddr;
use std::sync::Arc;
use tokio::sync::RwLock;
use log::info;

use dicesuki_server::{build_app, RoomManager, SharedRoomManager, INSTANCE_ID};

#[tokio::main]
async fn main() {
    env_logger::Builder::from_env(env_logger::Env::default().default_filter_or("info")).init();
    info!("Instance ID: {}", *INSTANCE_ID);

    let room_manager: SharedRoomManager = Arc::new(RwLock::new(RoomManager::new()));
    let app = build_app(room_manager.clone());

    // Rooms registry heartbeat (ADR 006): upsert this server's row into the
    // Supabase `rooms` table every N seconds so it appears in the public room
    // browser. No-op unless SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY + PUBLIC_URL
    // are set — the server otherwise runs exactly as before.
    dicesuki_server::registry::spawn_if_enabled(room_manager.clone());

    // Spawn periodic room maintenance task (every 60s): expires reconnect grace
    // windows and cleans up stale empty rooms. A 60s cadence keeps grace expiry
    // (120s window) responsive without excessive lock churn.
    let cleanup_mgr = room_manager.clone();
    tokio::spawn(async move {
        loop {
            tokio::time::sleep(std::time::Duration::from_secs(60)).await;
            cleanup_mgr.write().await.run_maintenance().await;
        }
    });

    let port: u16 = if let Ok(val) = std::env::var("PORT") {
        if let Ok(p) = val.parse() {
            info!("Using PORT from environment: {p}");
            p
        } else {
            info!("Invalid PORT '{val}', using default: 8080");
            8080
        }
    } else {
        info!("PORT not set, using default: 8080");
        8080
    };
    let addr = SocketAddr::from(([0, 0, 0, 0], port));
    info!("Dicesuki server listening on {addr}");
    let listener = tokio::net::TcpListener::bind(addr)
        .await
        .expect("Failed to bind — is the port already in use?");

    // axum::serve uses hyper's ALPN to auto-negotiate HTTP/1.1 vs HTTP/2.
    // WebSocket upgrades themselves always use HTTP/1.1 with an Upgrade header, which hyper handles automatically.
    axum::serve(listener, app)
        .await
        .expect("Server exited unexpectedly");
}
