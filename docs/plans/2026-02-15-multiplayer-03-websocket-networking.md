# Multiplayer 03: WebSocket & Networking

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Wire up the HTTP server (room creation API) and WebSocket handler (real-time communication) that ties together rooms, players, and physics.

**Architecture:** hyper HTTP server on port 8080. Two endpoints: `POST /api/rooms` creates a room, `GET /ws/{roomId}` upgrades to WebSocket. Each WebSocket connection spawns two tokio tasks (read loop + write loop). Physics simulation runs as a separate tokio task per active room.

**Tech Stack:** hyper, tokio-tungstenite, futures-util

**Depends on:** Plan 01 (Server Core), Plan 02 (Server Physics)

---

## Task 1: HTTP Server & Room Creation API

**Files:**
- Modify: `server/src/main.rs`

**Step 1: Implement HTTP server with room creation endpoint**

Replace `server/src/main.rs`:

```rust
mod messages;
mod player;
mod room;
mod room_manager;
mod physics;
mod dice;
mod face_detection;

use std::net::SocketAddr;
use std::sync::Arc;
use tokio::sync::RwLock;
use hyper::{body::Incoming, server::conn::http1, service::service_fn, Request, Response, StatusCode, Method};
use hyper_util::rt::TokioIo;
use http_body_util::Full;
use hyper::body::Bytes;
use tokio::net::TcpListener;
use log::info;

use room_manager::RoomManager;

type SharedRoomManager = Arc<RwLock<RoomManager>>;

async fn handle_request(
    req: Request<Incoming>,
    room_manager: SharedRoomManager,
) -> Result<Response<Full<Bytes>>, hyper::Error> {
    // CORS headers for all responses
    let cors_headers = |builder: hyper::http::response::Builder| {
        builder
            .header("Access-Control-Allow-Origin", "*")
            .header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
            .header("Access-Control-Allow-Headers", "Content-Type")
    };

    match (req.method(), req.uri().path()) {
        // CORS preflight
        (&Method::OPTIONS, _) => {
            Ok(cors_headers(Response::builder())
                .status(StatusCode::NO_CONTENT)
                .body(Full::new(Bytes::new()))
                .unwrap())
        }

        // Health check
        (&Method::GET, "/health") => {
            Ok(cors_headers(Response::builder())
                .status(StatusCode::OK)
                .body(Full::new(Bytes::from(r#"{"status":"ok"}"#)))
                .unwrap())
        }

        // Create room
        (&Method::POST, "/api/rooms") => {
            let mut mgr = room_manager.write().await;
            let (room_id, _) = mgr.create_room();
            let body = format!(r#"{{"roomId":"{}"}}"#, room_id);
            info!("Room created via API: {}", room_id);
            Ok(cors_headers(Response::builder())
                .status(StatusCode::CREATED)
                .header("Content-Type", "application/json")
                .body(Full::new(Bytes::from(body)))
                .unwrap())
        }

        // Room info (check if room exists)
        (&Method::GET, path) if path.starts_with("/api/rooms/") => {
            let room_id = &path["/api/rooms/".len()..];
            let mgr = room_manager.read().await;
            match mgr.get_room(room_id) {
                Some(room) => {
                    let room = room.read().await;
                    let body = format!(
                        r#"{{"roomId":"{}","playerCount":{},"diceCount":{}}}"#,
                        room.id, room.player_count(), room.dice_count()
                    );
                    Ok(cors_headers(Response::builder())
                        .status(StatusCode::OK)
                        .header("Content-Type", "application/json")
                        .body(Full::new(Bytes::from(body)))
                        .unwrap())
                }
                None => {
                    Ok(cors_headers(Response::builder())
                        .status(StatusCode::NOT_FOUND)
                        .header("Content-Type", "application/json")
                        .body(Full::new(Bytes::from(r#"{"error":"ROOM_NOT_FOUND"}"#)))
                        .unwrap())
                }
            }
        }

        // Everything else -> 404
        _ => {
            Ok(cors_headers(Response::builder())
                .status(StatusCode::NOT_FOUND)
                .body(Full::new(Bytes::from(r#"{"error":"NOT_FOUND"}"#)))
                .unwrap())
        }
    }
}

#[tokio::main]
async fn main() {
    env_logger::Builder::from_env(env_logger::Env::default().default_filter_or("info")).init();

    let room_manager: SharedRoomManager = Arc::new(RwLock::new(RoomManager::new()));

    // Spawn stale room cleanup task (every 5 minutes)
    let cleanup_mgr = room_manager.clone();
    tokio::spawn(async move {
        loop {
            tokio::time::sleep(std::time::Duration::from_secs(300)).await;
            let mut mgr = cleanup_mgr.write().await;
            mgr.cleanup_stale_rooms().await;
        }
    });

    let addr = SocketAddr::from(([0, 0, 0, 0], 8080));
    let listener = TcpListener::bind(addr).await.unwrap();
    info!("Daisu server listening on {}", addr);

    loop {
        let (stream, _) = listener.accept().await.unwrap();
        let io = TokioIo::new(stream);
        let mgr = room_manager.clone();

        tokio::spawn(async move {
            let service = service_fn(move |req| {
                let mgr = mgr.clone();
                async move { handle_request(req, mgr).await }
            });
            if let Err(e) = http1::Builder::new()
                .serve_connection(io, service)
                .await
            {
                if !e.is_incomplete_message() {
                    log::error!("HTTP error: {}", e);
                }
            }
        });
    }
}
```

**Step 2: Test manually**

```bash
cd server && cargo run &
# In another terminal:
curl -X POST http://localhost:8080/api/rooms
# Expected: {"roomId":"a3x9kf"} (6 random chars)

curl http://localhost:8080/health
# Expected: {"status":"ok"}

curl http://localhost:8080/api/rooms/nonexistent
# Expected: {"error":"ROOM_NOT_FOUND"} with 404

# Kill the server
kill %1
```

**Step 3: Commit**

```bash
git add server/src/main.rs
git commit -m "feat(server): add HTTP server with room creation API and health endpoint"
```

---

## Task 2: WebSocket Handler

**Files:**
- Create: `server/src/ws_handler.rs`
- Modify: `server/src/main.rs`

**Step 1: Write WebSocket connection handler**

Create `server/src/ws_handler.rs`:

```rust
use std::sync::Arc;
use tokio::sync::{mpsc, RwLock};
use tokio_tungstenite::tungstenite::Message;
use futures_util::{StreamExt, SinkExt};
use log::{info, warn, error};
use uuid::Uuid;

use crate::messages::*;
use crate::player::Player;
use crate::room::Room;
use crate::room_manager::SharedRoom;

/// Handle a single WebSocket connection for a room
pub async fn handle_ws_connection(
    ws_stream: tokio_tungstenite::WebSocketStream<hyper_util::rt::TokioIo<tokio::net::TcpStream>>,
    room: SharedRoom,
) {
    let (mut ws_sender, mut ws_receiver) = ws_stream.split();

    // Channel for sending messages to this client
    let (tx, mut rx) = mpsc::unbounded_channel::<ServerMessage>();

    // Spawn write loop: forward messages from channel to WebSocket
    let write_task = tokio::spawn(async move {
        while let Some(msg) = rx.recv().await {
            match serde_json::to_string(&msg) {
                Ok(json) => {
                    if ws_sender.send(Message::Text(json.into())).await.is_err() {
                        break;
                    }
                }
                Err(e) => error!("Failed to serialize message: {}", e),
            }
        }
    });

    let player_id = Uuid::new_v4().to_string();
    let mut is_joined = false;

    // Read loop: process incoming messages
    while let Some(msg_result) = ws_receiver.next().await {
        let msg = match msg_result {
            Ok(Message::Text(text)) => text,
            Ok(Message::Close(_)) => break,
            Ok(_) => continue, // Ignore binary, ping, pong
            Err(e) => {
                warn!("WebSocket error: {}", e);
                break;
            }
        };

        let client_msg: ClientMessage = match serde_json::from_str(&msg) {
            Ok(m) => m,
            Err(e) => {
                warn!("Invalid message from {}: {}", player_id, e);
                let _ = tx.send(ServerMessage::Error {
                    code: "INVALID_MESSAGE".to_string(),
                    message: format!("Failed to parse message: {}", e),
                });
                continue;
            }
        };

        match client_msg {
            ClientMessage::Join { display_name, color, .. } => {
                if is_joined {
                    let _ = tx.send(ServerMessage::Error {
                        code: "ALREADY_JOINED".to_string(),
                        message: "Already joined this room".to_string(),
                    });
                    continue;
                }

                let player = Player::new(
                    player_id.clone(),
                    display_name.clone(),
                    color.clone(),
                    tx.clone(),
                );

                let mut room_guard = room.write().await;

                match room_guard.add_player(player) {
                    Ok(()) => {
                        is_joined = true;
                        info!("Player '{}' ({}) joined room {}", display_name, player_id, room_guard.id);

                        // Send full room state to the new player
                        let room_state = room_guard.build_room_state();
                        let _ = tx.send(room_state);

                        // Notify other players
                        room_guard.broadcast_except(
                            &ServerMessage::PlayerJoined {
                                player: PlayerInfo {
                                    id: player_id.clone(),
                                    display_name,
                                    color,
                                },
                            },
                            &player_id,
                        );
                    }
                    Err(code) => {
                        let message = match code.as_str() {
                            "ROOM_FULL" => "Room is full (8/8 players)".to_string(),
                            "INVALID_NAME" => "Display name must be 1-20 characters".to_string(),
                            _ => format!("Failed to join: {}", code),
                        };
                        let _ = tx.send(ServerMessage::Error { code, message });
                    }
                }
            }

            ClientMessage::SpawnDice { dice } if is_joined => {
                let entries: Vec<(String, DiceType)> = dice.into_iter()
                    .map(|d| (d.id, d.dice_type))
                    .collect();

                let mut room_guard = room.write().await;
                match room_guard.spawn_dice_with_physics(&player_id, entries) {
                    Ok(spawned) => {
                        room_guard.broadcast(&ServerMessage::DiceSpawned {
                            owner_id: player_id.clone(),
                            dice: spawned,
                        });
                    }
                    Err(code) => {
                        let message = match code.as_str() {
                            "DICE_LIMIT" => format!("Table is full ({}/30 dice)", room_guard.dice_count()),
                            _ => format!("Failed to spawn dice: {}", code),
                        };
                        let _ = tx.send(ServerMessage::Error { code, message });
                    }
                }
            }

            ClientMessage::RemoveDice { dice_ids } if is_joined => {
                let mut room_guard = room.write().await;
                let removed = room_guard.remove_dice(&player_id, &dice_ids);
                if !removed.is_empty() {
                    room_guard.broadcast(&ServerMessage::DiceRemoved {
                        dice_ids: removed,
                    });
                }
            }

            ClientMessage::Roll if is_joined => {
                let mut room_guard = room.write().await;
                let dice_ids = room_guard.roll_player_dice(&player_id);

                if !dice_ids.is_empty() {
                    room_guard.broadcast(&ServerMessage::RollStarted {
                        player_id: player_id.clone(),
                        dice_ids,
                    });

                    // Start simulation loop if not already running
                    if room_guard.is_simulating {
                        let sim_room = room.clone();
                        let sim_player_id = player_id.clone();
                        drop(room_guard); // Release lock before spawning task
                        start_simulation_loop(sim_room).await;
                    }
                }
            }

            ClientMessage::UpdateColor { color } if is_joined => {
                let mut room_guard = room.write().await;
                if let Some(player) = room_guard.players.get_mut(&player_id) {
                    player.color = color;
                }
                // Could broadcast color change to other players
            }

            ClientMessage::Leave if is_joined => {
                break;
            }

            _ => {
                let _ = tx.send(ServerMessage::Error {
                    code: "NOT_JOINED".to_string(),
                    message: "Must join the room first".to_string(),
                });
            }
        }
    }

    // Player disconnected — clean up
    if is_joined {
        let mut room_guard = room.write().await;
        let removed_dice = room_guard.remove_player(&player_id);
        info!("Player {} left room {} (removed {} dice)", player_id, room_guard.id, removed_dice.len());

        if !removed_dice.is_empty() {
            room_guard.broadcast(&ServerMessage::DiceRemoved {
                dice_ids: removed_dice,
            });
        }
        room_guard.broadcast(&ServerMessage::PlayerLeft {
            player_id: player_id.clone(),
        });
    }

    write_task.abort();
}

/// Start the physics simulation loop for a room.
/// Runs at 60Hz, broadcasts snapshots at 20Hz, detects settlements.
async fn start_simulation_loop(room: SharedRoom) {
    tokio::spawn(async move {
        let tick_duration = std::time::Duration::from_micros(16_667); // ~60Hz

        loop {
            tokio::time::sleep(tick_duration).await;

            let mut room_guard = room.write().await;

            if !room_guard.is_simulating {
                break;
            }

            let (snapshot, newly_settled) = room_guard.physics_tick();

            // Broadcast physics snapshot
            if let Some(snap) = snapshot {
                room_guard.broadcast(&snap);
            }

            // Handle newly settled dice
            for (dice_id, face_value) in &newly_settled {
                let die = &room_guard.dice[dice_id];
                room_guard.broadcast(&ServerMessage::DieSettled {
                    dice_id: dice_id.clone(),
                    face_value: *face_value,
                    position: die.position,
                    rotation: die.rotation,
                });
            }

            // Check if any player's full roll is complete
            let player_ids: Vec<String> = room_guard.players.keys().cloned().collect();
            for pid in player_ids {
                // Check if this player had rolling dice that are now all settled
                let player_has_dice = room_guard.dice.values()
                    .any(|d| d.owner_id == pid);
                if player_has_dice && room_guard.is_player_roll_complete(&pid) {
                    let (results, total) = room_guard.get_player_results(&pid);
                    if !results.is_empty() {
                        // Only send if results contain newly settled dice
                        let has_new = results.iter().any(|r| {
                            newly_settled.iter().any(|(id, _)| *id == r.dice_id)
                        });
                        if has_new {
                            room_guard.broadcast(&ServerMessage::RollComplete {
                                player_id: pid,
                                results,
                                total,
                            });
                        }
                    }
                }
            }
        }
    });
}
```

**Step 2: Integrate WebSocket upgrade into main.rs**

This requires modifying the HTTP handler to detect WebSocket upgrade requests for `/ws/{roomId}` paths. Update `main.rs` to handle the upgrade:

Add to imports in `main.rs`:
```rust
mod ws_handler;

use tokio_tungstenite::tungstenite::handshake::server::{Request as WsRequest, Response as WsResponse};
```

Update the TCP listener loop in `main()` to handle both HTTP and WebSocket:

```rust
// Replace the connection handling in the main loop with:
loop {
    let (stream, addr) = listener.accept().await.unwrap();
    let mgr = room_manager.clone();

    tokio::spawn(async move {
        // Peek at the first bytes to determine if this is a WebSocket upgrade
        let io = TokioIo::new(stream);

        let service = service_fn(move |req: Request<Incoming>| {
            let mgr = mgr.clone();
            async move {
                // Check if this is a WebSocket upgrade request for /ws/{roomId}
                if req.uri().path().starts_with("/ws/") {
                    let room_id = req.uri().path()[4..].to_string();

                    let room = {
                        let mgr_guard = mgr.read().await;
                        mgr_guard.get_room(&room_id)
                    };

                    match room {
                        Some(room) => {
                            // WebSocket upgrade will be handled separately
                            // For now, return a response indicating WS is needed
                            // The actual upgrade requires raw TCP access
                            Ok::<_, hyper::Error>(
                                Response::builder()
                                    .status(StatusCode::SWITCHING_PROTOCOLS)
                                    .body(Full::new(Bytes::new()))
                                    .unwrap()
                            )
                        }
                        None => {
                            Ok(Response::builder()
                                .status(StatusCode::NOT_FOUND)
                                .body(Full::new(Bytes::from(r#"{"error":"ROOM_NOT_FOUND"}"#)))
                                .unwrap())
                        }
                    }
                } else {
                    handle_request(req, mgr).await
                }
            }
        });

        if let Err(e) = http1::Builder::new()
            .serve_connection(io, service)
            .await
        {
            if !e.is_incomplete_message() {
                log::error!("Connection error from {}: {}", addr, e);
            }
        }
    });
}
```

**Important Note:** The WebSocket upgrade with hyper 1.x requires careful handling. The recommended approach is to use `hyper::upgrade::on()` or switch to using `tokio-tungstenite::accept_async` directly on the TCP stream. The exact implementation may need adjustment during execution based on the specific versions of hyper and tokio-tungstenite being used. The key pattern is:

1. TCP stream arrives
2. Check if path starts with `/ws/`
3. If yes, upgrade to WebSocket using `tokio_tungstenite::accept_async(stream)`
4. Pass the WebSocket stream to `handle_ws_connection()`
5. If no, handle as normal HTTP

An alternative (and simpler) approach is to use a two-port setup:
- Port 8080: HTTP API (hyper)
- Port 8081: WebSocket (raw tokio-tungstenite accept)

Or use a lightweight framework like `axum` which handles WebSocket upgrades natively. **If hyper's WebSocket upgrade proves too complex, switching to axum is the recommended fallback** — it's built on hyper and tokio but provides a cleaner WebSocket API.

**Step 3: Run and test**

```bash
cd server && cargo build
```

Expected: Compiles. Full integration testing will happen in Plan 07.

**Step 4: Commit**

```bash
git add server/src/ws_handler.rs server/src/main.rs
git commit -m "feat(server): add WebSocket handler with room join/roll/spawn message routing"
```

---

## Task 3: Consider Axum Migration (Optional)

If the hyper WebSocket upgrade in Task 2 proves unwieldy, migrate to axum which provides first-class WebSocket support:

**Replace Cargo.toml dependencies:**
```toml
# Remove hyper, hyper-util, http-body-util
# Add:
axum = { version = "0.7", features = ["ws"] }
tower = "0.5"
tower-http = { version = "0.6", features = ["cors"] }
```

**Axum route setup (main.rs):**
```rust
use axum::{
    extract::{Path, State, WebSocketUpgrade, ws::WebSocket},
    response::IntoResponse,
    routing::{get, post},
    Json, Router,
};
use tower_http::cors::CorsLayer;

#[tokio::main]
async fn main() {
    env_logger::Builder::from_env(env_logger::Env::default().default_filter_or("info")).init();

    let room_manager: SharedRoomManager = Arc::new(RwLock::new(RoomManager::new()));

    let app = Router::new()
        .route("/health", get(health))
        .route("/api/rooms", post(create_room))
        .route("/api/rooms/{room_id}", get(get_room_info))
        .route("/ws/{room_id}", get(ws_upgrade))
        .layer(CorsLayer::permissive())
        .with_state(room_manager.clone());

    // Spawn cleanup task
    let cleanup_mgr = room_manager.clone();
    tokio::spawn(async move {
        loop {
            tokio::time::sleep(std::time::Duration::from_secs(300)).await;
            cleanup_mgr.write().await.cleanup_stale_rooms().await;
        }
    });

    let addr = SocketAddr::from(([0, 0, 0, 0], 8080));
    info!("Daisu server listening on {}", addr);
    let listener = tokio::net::TcpListener::bind(addr).await.unwrap();
    axum::serve(listener, app).await.unwrap();
}

async fn health() -> &'static str {
    r#"{"status":"ok"}"#
}

async fn create_room(State(mgr): State<SharedRoomManager>) -> impl IntoResponse {
    let mut mgr = mgr.write().await;
    let (room_id, _) = mgr.create_room();
    (StatusCode::CREATED, Json(serde_json::json!({"roomId": room_id})))
}

async fn get_room_info(
    State(mgr): State<SharedRoomManager>,
    Path(room_id): Path<String>,
) -> impl IntoResponse {
    let mgr = mgr.read().await;
    match mgr.get_room(&room_id) {
        Some(room) => {
            let room = room.read().await;
            Json(serde_json::json!({
                "roomId": room.id,
                "playerCount": room.player_count(),
                "diceCount": room.dice_count(),
            })).into_response()
        }
        None => (StatusCode::NOT_FOUND, Json(serde_json::json!({"error": "ROOM_NOT_FOUND"}))).into_response()
    }
}

async fn ws_upgrade(
    State(mgr): State<SharedRoomManager>,
    Path(room_id): Path<String>,
    ws: WebSocketUpgrade,
) -> impl IntoResponse {
    let mgr_read = mgr.read().await;
    match mgr_read.get_room(&room_id) {
        Some(room) => {
            drop(mgr_read);
            ws.on_upgrade(move |socket| handle_ws(socket, room))
        }
        None => {
            // Return error — axum handles the response
            // Note: WebSocketUpgrade must be consumed, so return 404 differently
            (StatusCode::NOT_FOUND).into_response()
        }
    }
}

async fn handle_ws(socket: WebSocket, room: SharedRoom) {
    // Convert axum WebSocket to tokio-tungstenite compatible stream
    // and delegate to ws_handler::handle_ws_connection
    // (ws_handler will need to be adapted for axum's WebSocket type)
}
```

This approach is **recommended if hyper proves difficult**. Axum's WebSocket handling is much cleaner.

**Step 1: If migrating, update Cargo.toml**

**Step 2: Rewrite main.rs with axum routes**

**Step 3: Adapt ws_handler.rs for axum's WebSocket type**

**Step 4: Run and test all endpoints**

```bash
cd server && cargo run &
curl -X POST http://localhost:8080/api/rooms
curl http://localhost:8080/health
```

**Step 5: Commit**

```bash
git add server/
git commit -m "refactor(server): migrate from hyper to axum for cleaner WebSocket support"
```

---

## Implementation Notes

### WebSocket Message Flow Summary

```
Client connects to wss://server/ws/{roomId}
  │
  ├─→ Client sends: { type: "join", displayName: "...", color: "..." }
  │   Server: add player, send room_state, broadcast player_joined
  │
  ├─→ Client sends: { type: "spawn_dice", dice: [...] }
  │   Server: create physics bodies, broadcast dice_spawned
  │
  ├─→ Client sends: { type: "roll" }
  │   Server: apply impulses, broadcast roll_started
  │   Server: start 60Hz simulation loop
  │     ├─→ Every 3rd tick: broadcast physics_snapshot
  │     ├─→ On die settle: broadcast die_settled
  │     └─→ On all player dice settle: broadcast roll_complete
  │
  ├─→ Client sends: { type: "remove_dice", diceIds: [...] }
  │   Server: remove from physics, broadcast dice_removed
  │
  └─→ Client disconnects (or sends "leave")
      Server: remove player + dice, broadcast player_left + dice_removed
```

### Concurrency Model

```
Main tokio runtime
  ├── TCP listener (accepts connections)
  ├── Per-connection task
  │   ├── Read loop: parse JSON → route to room
  │   └── Write loop: channel rx → WebSocket send
  ├── Per-room simulation task (only while is_simulating)
  │   └── 60Hz: step physics, build snapshots, detect settlements
  └── Cleanup task (every 5 min)
```

### Lock Ordering

Room is behind `Arc<RwLock<Room>>`. The simulation loop and message handlers both need write access. The simulation loop should hold the lock briefly per tick (step + broadcast), then release. Message handlers acquire the lock for their operation duration.

**Deadlock prevention:** Never hold two room locks simultaneously. Room manager lock is always acquired before room lock.
