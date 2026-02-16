use std::net::SocketAddr;
use std::sync::Arc;
use tokio::net::TcpListener;
use tokio::sync::RwLock;
use tokio::time::{timeout, Duration};

use futures_util::{SinkExt, StreamExt};
use serde_json::{json, Value};
use tokio_tungstenite::connect_async;
use tokio_tungstenite::tungstenite::Message;

use dicesuki_server::{build_app, RoomManager, SharedRoomManager};

// ─── Test Helpers ────────────────────────────────────────────────

const TEST_TIMEOUT: Duration = Duration::from_secs(5);

/// Start a test server on a random port and return its address.
async fn start_server() -> SocketAddr {
    let room_manager: SharedRoomManager = Arc::new(RwLock::new(RoomManager::new()));
    let app = build_app(room_manager);
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let addr = listener.local_addr().unwrap();
    tokio::spawn(async move {
        axum::serve(listener, app).await.unwrap();
    });
    addr
}

/// Create a room via the REST API and return its ID.
async fn api_create_room(addr: &SocketAddr) -> String {
    let resp = reqwest::Client::new()
        .post(format!("http://{}/api/rooms", addr))
        .send()
        .await
        .unwrap();
    assert_eq!(resp.status(), 201);
    let body: Value = resp.json().await.unwrap();
    body["roomId"].as_str().unwrap().to_string()
}

/// Read the next text message from a WebSocket, with timeout.
async fn recv_json(
    ws: &mut tokio_tungstenite::WebSocketStream<
        tokio_tungstenite::MaybeTlsStream<tokio::net::TcpStream>,
    >,
) -> Value {
    let msg = timeout(TEST_TIMEOUT, ws.next())
        .await
        .expect("Timed out waiting for WebSocket message")
        .expect("WebSocket stream ended unexpectedly")
        .expect("WebSocket read error");

    match msg {
        Message::Text(text) => serde_json::from_str(&text).expect("Invalid JSON from server"),
        other => panic!("Expected Text message, got {:?}", other),
    }
}

/// Try to read a JSON message with a short timeout; returns None if no message.
async fn try_recv_json(
    ws: &mut tokio_tungstenite::WebSocketStream<
        tokio_tungstenite::MaybeTlsStream<tokio::net::TcpStream>,
    >,
) -> Option<Value> {
    let short_timeout = Duration::from_millis(100);
    match timeout(short_timeout, ws.next()).await {
        Ok(Some(Ok(Message::Text(text)))) => serde_json::from_str(&text).ok(),
        _ => None,
    }
}

// ─── HTTP Route Tests ────────────────────────────────────────────

#[tokio::test]
async fn health_endpoint_returns_ok() {
    let addr = start_server().await;
    let resp = reqwest::get(format!("http://{}/health", addr))
        .await
        .unwrap();

    assert_eq!(resp.status(), 200);
    let body: Value = resp.json().await.unwrap();
    assert_eq!(body["status"], "ok");
    assert!(body["instanceId"].is_string());
}

#[tokio::test]
async fn create_room_returns_201_with_room_id() {
    let addr = start_server().await;
    let room_id = api_create_room(&addr).await;

    assert_eq!(room_id.len(), 6, "Room ID should be 6 characters (nanoid)");
}

#[tokio::test]
async fn get_room_info_for_existing_room() {
    let addr = start_server().await;
    let room_id = api_create_room(&addr).await;

    let resp = reqwest::get(format!("http://{}/api/rooms/{}", addr, room_id))
        .await
        .unwrap();

    assert_eq!(resp.status(), 200);
    let body: Value = resp.json().await.unwrap();
    assert_eq!(body["roomId"], room_id);
    assert_eq!(body["playerCount"], 0);
    assert_eq!(body["diceCount"], 0);
}

#[tokio::test]
async fn get_nonexistent_room_returns_404() {
    let addr = start_server().await;
    let resp = reqwest::get(format!("http://{}/api/rooms/NOPE99", addr))
        .await
        .unwrap();

    assert_eq!(resp.status(), 404);
    let body: Value = resp.json().await.unwrap();
    assert_eq!(body["error"], "ROOM_NOT_FOUND");
}

#[tokio::test]
async fn unknown_route_returns_404() {
    let addr = start_server().await;
    let resp = reqwest::get(format!("http://{}/nonexistent/path", addr))
        .await
        .unwrap();

    assert_eq!(resp.status(), 404);
}

// ─── WebSocket Upgrade Tests ─────────────────────────────────────

#[tokio::test]
async fn websocket_upgrade_succeeds() {
    // This is THE critical test. In production on Render, GET /ws/{room_id}
    // hits the fallback handler (404) instead of the ws_upgrade handler.
    // If this test passes locally, the server code is correct and the
    // issue is Render's proxy environment.
    let addr = start_server().await;
    let room_id = api_create_room(&addr).await;
    let url = format!("ws://{}/ws/{}", addr, room_id);

    let result = timeout(TEST_TIMEOUT, connect_async(&url)).await;
    assert!(result.is_ok(), "WebSocket connection timed out");

    let (_, response) = result
        .unwrap()
        .expect("WebSocket upgrade FAILED — the /ws/{{room_id}} route did not match");

    assert_eq!(
        response.status(),
        101,
        "Expected 101 Switching Protocols, got {}",
        response.status()
    );
}

#[tokio::test]
async fn websocket_to_nonexistent_room_rejects() {
    let addr = start_server().await;
    let url = format!("ws://{}/ws/FAKEID", addr);

    let result = connect_async(&url).await;
    assert!(
        result.is_err(),
        "WebSocket to nonexistent room should fail (server returns 404 before upgrading)"
    );
}

// ─── WebSocket Message Flow Tests ────────────────────────────────

#[tokio::test]
async fn join_receives_room_state() {
    let addr = start_server().await;
    let room_id = api_create_room(&addr).await;
    let url = format!("ws://{}/ws/{}", addr, room_id);

    let (mut ws, _) = connect_async(&url).await.expect("Failed to connect");

    // Send join
    let join_msg = json!({
        "type": "join",
        "roomId": room_id,
        "displayName": "TestPlayer",
        "color": "#FF0000"
    });
    ws.send(Message::Text(join_msg.to_string())).await.unwrap();

    // Should receive room_state
    let body = recv_json(&mut ws).await;
    assert_eq!(body["type"], "room_state");
    assert_eq!(body["roomId"], room_id);
    let players = body["players"].as_array().unwrap();
    assert_eq!(players.len(), 1);
    assert_eq!(players[0]["displayName"], "TestPlayer");
}

#[tokio::test]
async fn actions_before_join_return_not_joined_error() {
    let addr = start_server().await;
    let room_id = api_create_room(&addr).await;
    let url = format!("ws://{}/ws/{}", addr, room_id);

    let (mut ws, _) = connect_async(&url).await.expect("Failed to connect");

    // Try spawning dice without joining first
    let spawn_msg = json!({
        "type": "spawn_dice",
        "dice": [{"id": "d1", "diceType": "d6"}]
    });
    ws.send(Message::Text(spawn_msg.to_string())).await.unwrap();

    let body = recv_json(&mut ws).await;
    assert_eq!(body["type"], "error");
    assert_eq!(body["code"], "NOT_JOINED");
}

#[tokio::test]
async fn double_join_returns_error() {
    let addr = start_server().await;
    let room_id = api_create_room(&addr).await;
    let url = format!("ws://{}/ws/{}", addr, room_id);

    let (mut ws, _) = connect_async(&url).await.expect("Failed to connect");

    let join_msg = json!({
        "type": "join",
        "roomId": room_id,
        "displayName": "Player1",
        "color": "#FF0000"
    });

    // First join
    ws.send(Message::Text(join_msg.to_string())).await.unwrap();
    let body = recv_json(&mut ws).await;
    assert_eq!(body["type"], "room_state");

    // Second join
    ws.send(Message::Text(join_msg.to_string())).await.unwrap();
    let body = recv_json(&mut ws).await;
    assert_eq!(body["type"], "error");
    assert_eq!(body["code"], "ALREADY_JOINED");
}

#[tokio::test]
async fn spawn_dice_after_join() {
    let addr = start_server().await;
    let room_id = api_create_room(&addr).await;
    let url = format!("ws://{}/ws/{}", addr, room_id);

    let (mut ws, _) = connect_async(&url).await.expect("Failed to connect");

    // Join
    let join_msg = json!({
        "type": "join",
        "roomId": room_id,
        "displayName": "Player1",
        "color": "#FF0000"
    });
    ws.send(Message::Text(join_msg.to_string())).await.unwrap();
    let _ = recv_json(&mut ws).await; // consume room_state

    // Spawn a d20
    let spawn_msg = json!({
        "type": "spawn_dice",
        "dice": [{"id": "die-1", "diceType": "d20"}]
    });
    ws.send(Message::Text(spawn_msg.to_string())).await.unwrap();

    let body = recv_json(&mut ws).await;
    assert_eq!(body["type"], "dice_spawned");
    let dice = body["dice"].as_array().unwrap();
    assert_eq!(dice.len(), 1);
    assert_eq!(dice[0]["id"], "die-1");
    assert_eq!(dice[0]["diceType"], "d20");
}

#[tokio::test]
async fn remove_dice_after_spawn() {
    let addr = start_server().await;
    let room_id = api_create_room(&addr).await;
    let url = format!("ws://{}/ws/{}", addr, room_id);

    let (mut ws, _) = connect_async(&url).await.expect("Failed to connect");

    // Join
    let join_msg = json!({
        "type": "join",
        "roomId": room_id,
        "displayName": "Player1",
        "color": "#FF0000"
    });
    ws.send(Message::Text(join_msg.to_string())).await.unwrap();
    let _ = recv_json(&mut ws).await; // room_state

    // Spawn
    let spawn_msg = json!({
        "type": "spawn_dice",
        "dice": [{"id": "die-1", "diceType": "d6"}]
    });
    ws.send(Message::Text(spawn_msg.to_string())).await.unwrap();
    let _ = recv_json(&mut ws).await; // dice_spawned

    // Remove
    let remove_msg = json!({
        "type": "remove_dice",
        "diceIds": ["die-1"]
    });
    ws.send(Message::Text(remove_msg.to_string())).await.unwrap();

    let body = recv_json(&mut ws).await;
    assert_eq!(body["type"], "dice_removed");
    let removed = body["diceIds"].as_array().unwrap();
    assert_eq!(removed.len(), 1);
    assert_eq!(removed[0], "die-1");
}

// ─── Multiplayer Flow Tests ──────────────────────────────────────

#[tokio::test]
async fn two_players_see_each_other_join() {
    let addr = start_server().await;
    let room_id = api_create_room(&addr).await;
    let url = format!("ws://{}/ws/{}", addr, room_id);

    // Player 1 connects and joins
    let (mut ws1, _) = connect_async(&url).await.expect("P1 failed to connect");
    let join1 = json!({
        "type": "join",
        "roomId": room_id,
        "displayName": "Alice",
        "color": "#FF0000"
    });
    ws1.send(Message::Text(join1.to_string())).await.unwrap();
    let state1 = recv_json(&mut ws1).await;
    assert_eq!(state1["type"], "room_state");

    // Player 2 connects and joins
    let (mut ws2, _) = connect_async(&url).await.expect("P2 failed to connect");
    let join2 = json!({
        "type": "join",
        "roomId": room_id,
        "displayName": "Bob",
        "color": "#0000FF"
    });
    ws2.send(Message::Text(join2.to_string())).await.unwrap();

    // Player 1 should receive player_joined notification for Bob
    let p1_msg = recv_json(&mut ws1).await;
    assert_eq!(p1_msg["type"], "player_joined");
    assert_eq!(p1_msg["player"]["displayName"], "Bob");

    // Player 2 should receive room_state with both players
    let state2 = recv_json(&mut ws2).await;
    assert_eq!(state2["type"], "room_state");
    let players = state2["players"].as_array().unwrap();
    assert_eq!(players.len(), 2, "Room state should include both players");
}

#[tokio::test]
async fn player_disconnect_notifies_others() {
    let addr = start_server().await;
    let room_id = api_create_room(&addr).await;
    let url = format!("ws://{}/ws/{}", addr, room_id);

    // Player 1 joins
    let (mut ws1, _) = connect_async(&url).await.unwrap();
    let join1 = json!({
        "type": "join",
        "roomId": room_id,
        "displayName": "Alice",
        "color": "#FF0000"
    });
    ws1.send(Message::Text(join1.to_string())).await.unwrap();
    let _ = recv_json(&mut ws1).await; // room_state

    // Player 2 joins
    let (mut ws2, _) = connect_async(&url).await.unwrap();
    let join2 = json!({
        "type": "join",
        "roomId": room_id,
        "displayName": "Bob",
        "color": "#0000FF"
    });
    ws2.send(Message::Text(join2.to_string())).await.unwrap();
    let _ = recv_json(&mut ws1).await; // player_joined (Bob)
    let _ = recv_json(&mut ws2).await; // room_state

    // Player 2 disconnects
    ws2.close(None).await.unwrap();

    // Player 1 should receive player_left
    let msg = recv_json(&mut ws1).await;
    assert_eq!(msg["type"], "player_left");
}

#[tokio::test]
async fn dice_spawn_broadcast_to_all_players() {
    let addr = start_server().await;
    let room_id = api_create_room(&addr).await;
    let url = format!("ws://{}/ws/{}", addr, room_id);

    // Player 1 joins
    let (mut ws1, _) = connect_async(&url).await.unwrap();
    ws1.send(Message::Text(
        json!({
            "type": "join",
            "roomId": room_id,
            "displayName": "Alice",
            "color": "#FF0000"
        })
        .to_string(),
    ))
    .await
    .unwrap();
    let _ = recv_json(&mut ws1).await; // room_state

    // Player 2 joins
    let (mut ws2, _) = connect_async(&url).await.unwrap();
    ws2.send(Message::Text(
        json!({
            "type": "join",
            "roomId": room_id,
            "displayName": "Bob",
            "color": "#0000FF"
        })
        .to_string(),
    ))
    .await
    .unwrap();
    let _ = recv_json(&mut ws1).await; // player_joined (Bob)
    let _ = recv_json(&mut ws2).await; // room_state

    // Player 1 spawns dice
    let spawn_msg = json!({
        "type": "spawn_dice",
        "dice": [
            {"id": "d1", "diceType": "d6"},
            {"id": "d2", "diceType": "d20"}
        ]
    });
    ws1.send(Message::Text(spawn_msg.to_string())).await.unwrap();

    // Both players should receive dice_spawned
    let msg1 = recv_json(&mut ws1).await;
    assert_eq!(msg1["type"], "dice_spawned");
    assert_eq!(msg1["dice"].as_array().unwrap().len(), 2);

    let msg2 = recv_json(&mut ws2).await;
    assert_eq!(msg2["type"], "dice_spawned");
    assert_eq!(msg2["dice"].as_array().unwrap().len(), 2);
}

#[tokio::test]
async fn invalid_json_returns_error() {
    let addr = start_server().await;
    let room_id = api_create_room(&addr).await;
    let url = format!("ws://{}/ws/{}", addr, room_id);

    let (mut ws, _) = connect_async(&url).await.expect("Failed to connect");

    // Send garbage
    ws.send(Message::Text("not valid json".to_string()))
        .await
        .unwrap();

    let body = recv_json(&mut ws).await;
    assert_eq!(body["type"], "error");
    assert_eq!(body["code"], "INVALID_MESSAGE");
}

#[tokio::test]
async fn invalid_name_rejected() {
    let addr = start_server().await;
    let room_id = api_create_room(&addr).await;
    let url = format!("ws://{}/ws/{}", addr, room_id);

    let (mut ws, _) = connect_async(&url).await.expect("Failed to connect");

    // Empty name
    let join_msg = json!({
        "type": "join",
        "roomId": room_id,
        "displayName": "",
        "color": "#FF0000"
    });
    ws.send(Message::Text(join_msg.to_string())).await.unwrap();

    let body = recv_json(&mut ws).await;
    assert_eq!(body["type"], "error");
    assert_eq!(body["code"], "INVALID_NAME");
}

// ─── Room Info After Player Actions ──────────────────────────────

#[tokio::test]
async fn room_info_reflects_player_count() {
    let addr = start_server().await;
    let room_id = api_create_room(&addr).await;
    let url = format!("ws://{}/ws/{}", addr, room_id);

    // Verify empty room
    let resp = reqwest::get(format!("http://{}/api/rooms/{}", addr, room_id))
        .await
        .unwrap();
    let body: Value = resp.json().await.unwrap();
    assert_eq!(body["playerCount"], 0);

    // Player joins
    let (mut ws, _) = connect_async(&url).await.unwrap();
    ws.send(Message::Text(
        json!({
            "type": "join",
            "roomId": room_id,
            "displayName": "Alice",
            "color": "#FF0000"
        })
        .to_string(),
    ))
    .await
    .unwrap();
    let _ = recv_json(&mut ws).await; // room_state

    // Verify player count via REST API
    let resp = reqwest::get(format!("http://{}/api/rooms/{}", addr, room_id))
        .await
        .unwrap();
    let body: Value = resp.json().await.unwrap();
    assert_eq!(body["playerCount"], 1);
}

// ─── Drag Flow Tests ────────────────────────────────────────────

#[tokio::test]
async fn test_drag_flow() {
    let addr = start_server().await;
    let room_id = api_create_room(&addr).await;
    let url = format!("ws://{}/ws/{}", addr, room_id);

    let (mut ws, _) = connect_async(&url).await.expect("Failed to connect");

    // Join
    ws.send(Message::Text(
        json!({
            "type": "join",
            "roomId": room_id,
            "displayName": "Dragger",
            "color": "#FF0000"
        })
        .to_string(),
    ))
    .await
    .unwrap();

    let room_state = recv_json(&mut ws).await;
    assert_eq!(room_state["type"], "room_state");

    // Spawn a die
    ws.send(Message::Text(
        json!({
            "type": "spawn_dice",
            "dice": [{"id": "d1", "diceType": "d6"}]
        })
        .to_string(),
    ))
    .await
    .unwrap();

    let spawned = recv_json(&mut ws).await;
    assert_eq!(spawned["type"], "dice_spawned");

    // Start drag
    ws.send(Message::Text(
        json!({
            "type": "drag_start",
            "dieId": "d1",
            "grabOffset": [0.0, 0.0, 0.0],
            "worldPosition": [2.0, 2.0, 0.0]
        })
        .to_string(),
    ))
    .await
    .unwrap();

    // Small delay to let physics tick
    tokio::time::sleep(Duration::from_millis(100)).await;

    // Move drag
    ws.send(Message::Text(
        json!({
            "type": "drag_move",
            "dieId": "d1",
            "worldPosition": [3.0, 2.0, 1.0]
        })
        .to_string(),
    ))
    .await
    .unwrap();

    // Should receive physics snapshots
    tokio::time::sleep(Duration::from_millis(100)).await;

    // End drag with velocity history (throw)
    ws.send(Message::Text(
        json!({
            "type": "drag_end",
            "dieId": "d1",
            "velocityHistory": [
                {"position": [2.0, 2.0, 0.0], "time": 0.0},
                {"position": [3.0, 2.0, 1.0], "time": 16.7},
                {"position": [4.0, 2.0, 2.0], "time": 33.4}
            ]
        })
        .to_string(),
    ))
    .await
    .unwrap();

    // Drain messages — should eventually get die_settled
    // Read all available messages each iteration to keep up with 60Hz snapshots
    let mut found_settled = false;
    let deadline = tokio::time::Instant::now() + Duration::from_secs(15);
    while tokio::time::Instant::now() < deadline {
        match try_recv_json(&mut ws).await {
            Some(msg) if msg["type"] == "die_settled" => {
                found_settled = true;
                assert!(msg["faceValue"].as_u64().unwrap() >= 1);
                assert!(msg["faceValue"].as_u64().unwrap() <= 6);
                break;
            }
            Some(_) => continue, // Keep draining snapshots etc.
            None => {
                tokio::time::sleep(Duration::from_millis(50)).await;
            }
        }
    }
    assert!(found_settled, "Die should settle after drag throw");
}
