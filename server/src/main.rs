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

    // axum::serve uses hyper's ALPN to auto-negotiate HTTP/1.1 vs HTTP/2.
    // WebSocket upgrades themselves always use HTTP/1.1 with an Upgrade header, which hyper handles automatically.
    axum::serve(listener, app)
        .await
        .expect("Server exited unexpectedly");
}
