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
    start_server_with_manager().await.0
}

/// Start a test server while retaining the manager for handler-to-core assertions.
async fn start_server_with_manager() -> (SocketAddr, SharedRoomManager) {
    let room_manager: SharedRoomManager = Arc::new(RwLock::new(RoomManager::new()));
    let app = build_app(room_manager.clone());
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let addr = listener.local_addr().unwrap();
    tokio::spawn(async move {
        axum::serve(listener, app).await.unwrap();
    });
    (addr, room_manager)
}

/// Create a room via the REST API and return its ID.
async fn api_create_room(addr: &SocketAddr) -> String {
    let resp = reqwest::Client::new()
        .post(format!("http://{addr}/api/rooms"))
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
        other => panic!("Expected Text message, got {other:?}"),
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
    let resp = reqwest::get(format!("http://{addr}/health"))
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

    let resp = reqwest::get(format!("http://{addr}/api/rooms/{room_id}"))
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
    let resp = reqwest::get(format!("http://{addr}/api/rooms/NOPE99"))
        .await
        .unwrap();

    assert_eq!(resp.status(), 404);
    let body: Value = resp.json().await.unwrap();
    assert_eq!(body["error"], "ROOM_NOT_FOUND");
}

#[tokio::test]
async fn unknown_route_returns_404() {
    let addr = start_server().await;
    let resp = reqwest::get(format!("http://{addr}/nonexistent/path"))
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
    let url = format!("ws://{addr}/ws/{room_id}");

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
    let url = format!("ws://{addr}/ws/FAKEID");

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
    let url = format!("ws://{addr}/ws/{room_id}");

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
async fn native_motion_field_angular_accel_reaches_authoritative_room() {
    let (addr, room_manager) = start_server_with_manager().await;
    let (room_id, room) = room_manager.write().await.create_room();
    let url = format!("ws://{addr}/ws/{room_id}");
    let (mut ws, _) = connect_async(&url).await.expect("Failed to connect");

    ws.send(Message::Text(json!({
        "type": "join",
        "roomId": room_id,
        "displayName": "Spinner",
        "color": "#FF0000"
    }).to_string())).await.unwrap();
    let state = recv_json(&mut ws).await;
    let player_id = state["localPlayerId"].as_str().unwrap().to_string();

    ws.send(Message::Text(json!({
        "type": "motion_field",
        "field": [0, 0, 0],
        "angularAccel": [360, 0, 0]
    }).to_string())).await.unwrap();

    timeout(TEST_TIMEOUT, async {
        loop {
            let angular = room.read().await.players[&player_id].motion_angular_accel;
            if angular != [0.0, 0.0, 0.0] {
                assert_eq!(
                    angular,
                    [dicesuki_server::physics::MOTION_FIELD_MAX_ANGULAR_ACCEL, 0.0, 0.0],
                    "native WS dispatch must reach core's authoritative angular clamp"
                );
                break;
            }
            tokio::task::yield_now().await;
        }
    }).await.expect("motion field did not reach the room");
}

#[tokio::test]
async fn actions_before_join_return_not_joined_error() {
    let addr = start_server().await;
    let room_id = api_create_room(&addr).await;
    let url = format!("ws://{addr}/ws/{room_id}");

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
    let url = format!("ws://{addr}/ws/{room_id}");

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
    let url = format!("ws://{addr}/ws/{room_id}");

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
        "dice": [{
            "id": "die-1",
            "diceType": "d20",
            "presentation": {
                "inventoryDieId": "die_lucky_d20",
                "displayName": "Lucky D20",
                "setId": "starter",
                "rarity": "rare",
                "baseColor": "#8b5cf6"
            }
        }]
    });
    ws.send(Message::Text(spawn_msg.to_string())).await.unwrap();

    let body = recv_json(&mut ws).await;
    assert_eq!(body["type"], "dice_spawned");
    let dice = body["dice"].as_array().unwrap();
    assert_eq!(dice.len(), 1);
    assert_eq!(dice[0]["id"], "die-1");
    assert_eq!(dice[0]["diceType"], "d20");
    assert_eq!(dice[0]["presentation"]["inventoryDieId"], "die_lucky_d20");
    assert_eq!(dice[0]["presentation"]["displayName"], "Lucky D20");
}

#[tokio::test]
async fn duplicate_inventory_die_spawn_is_rejected() {
    let addr = start_server().await;
    let room_id = api_create_room(&addr).await;
    let url = format!("ws://{}/ws/{}", addr, room_id);

    let (mut ws, _) = connect_async(&url).await.expect("Failed to connect");

    ws.send(Message::Text(json!({
        "type": "join",
        "roomId": room_id,
        "displayName": "Player1",
        "color": "#FF0000"
    }).to_string())).await.unwrap();
    let _ = recv_json(&mut ws).await;

    let spawn_msg = json!({
        "type": "spawn_dice",
        "dice": [{
            "id": "die-1",
            "diceType": "d20",
            "presentation": { "inventoryDieId": "die_lucky_d20" }
        }]
    });
    ws.send(Message::Text(spawn_msg.to_string())).await.unwrap();
    let spawned = recv_json(&mut ws).await;
    assert_eq!(spawned["type"], "dice_spawned");

    let duplicate_spawn = json!({
        "type": "spawn_dice",
        "dice": [{
            "id": "die-2",
            "diceType": "d20",
            "presentation": { "inventoryDieId": "die_lucky_d20" }
        }]
    });
    ws.send(Message::Text(duplicate_spawn.to_string())).await.unwrap();

    let body = recv_json(&mut ws).await;
    assert_eq!(body["type"], "error");
    assert_eq!(body["code"], "DUPLICATE_INVENTORY_DIE");
}

#[tokio::test]
async fn remove_dice_after_spawn() {
    let addr = start_server().await;
    let room_id = api_create_room(&addr).await;
    let url = format!("ws://{addr}/ws/{room_id}");

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
    let url = format!("ws://{addr}/ws/{room_id}");

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
    let url = format!("ws://{addr}/ws/{room_id}");

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

    // Player 2 leaves intentionally (explicit `leave` frees the seat at once).
    ws2.send(Message::Text(json!({ "type": "leave" }).to_string()))
        .await
        .unwrap();

    // Player 1 should receive player_left
    let msg = recv_json(&mut ws1).await;
    assert_eq!(msg["type"], "player_left");
}

#[tokio::test]
async fn dropped_connection_holds_seat_and_rejoin_reclaims_identity() {
    let addr = start_server().await;
    let room_id = api_create_room(&addr).await;
    let url = format!("ws://{addr}/ws/{room_id}");

    // Player 1 (host) joins and stays connected as an observer.
    let (mut ws1, _) = connect_async(&url).await.unwrap();
    ws1.send(Message::Text(
        json!({ "type": "join", "roomId": room_id, "displayName": "Alice", "color": "#FF0000" })
            .to_string(),
    ))
    .await
    .unwrap();
    let _ = recv_json(&mut ws1).await; // room_state

    // Player 2 joins with a reconnect token.
    let (mut ws2, _) = connect_async(&url).await.unwrap();
    ws2.send(Message::Text(
        json!({ "type": "join", "roomId": room_id, "displayName": "Bob", "color": "#0000FF",
                "reconnectToken": "tok-bob" })
            .to_string(),
    ))
    .await
    .unwrap();
    let joined = recv_json(&mut ws1).await; // player_joined (Bob)
    assert_eq!(joined["type"], "player_joined");
    let state2 = recv_json(&mut ws2).await; // room_state
    let bob_id = state2["localPlayerId"].as_str().unwrap().to_string();

    // Player 2's connection drops (raw close, no `leave`). Seat is held.
    ws2.close(None).await.unwrap();

    // Player 1 sees a temporary presence change, not a final leave.
    let disconnected = recv_json(&mut ws1).await;
    assert_eq!(disconnected["type"], "player_presence_changed");
    assert_eq!(disconnected["playerId"], bob_id);
    assert_eq!(disconnected["connected"], false);

    // Player 2 rejoins within grace using the same token.
    let (mut ws2b, _) = connect_async(&url).await.unwrap();
    ws2b.send(Message::Text(
        json!({ "type": "join", "roomId": room_id, "displayName": "Bob", "color": "#0000FF",
                "reconnectToken": "tok-bob" })
            .to_string(),
    ))
    .await
    .unwrap();
    let rejoin_state = recv_json(&mut ws2b).await; // room_state
    // Identity reclaimed: same player id as before the drop.
    assert_eq!(rejoin_state["localPlayerId"].as_str(), Some(bob_id.as_str()));
    // No duplicate seat — still just Alice + Bob.
    assert_eq!(rejoin_state["players"].as_array().unwrap().len(), 2);

    // Reclaim updates presence without creating a duplicate player_joined.
    let reconnected = recv_json(&mut ws1).await;
    assert_eq!(reconnected["type"], "player_presence_changed");
    assert_eq!(reconnected["playerId"], bob_id);
    assert_eq!(reconnected["connected"], true);
}

#[tokio::test]
async fn host_can_remove_guest_and_guest_cannot_reuse_held_seat() {
    let addr = start_server().await;
    let room_id = api_create_room(&addr).await;
    let url = format!("ws://{addr}/ws/{room_id}");

    let (mut host, _) = connect_async(&url).await.unwrap();
    host.send(Message::Text(json!({
        "type": "join", "roomId": room_id, "displayName": "Host", "color": "#FF0000"
    }).to_string())).await.unwrap();
    let _ = recv_json(&mut host).await;

    let (mut guest, _) = connect_async(&url).await.unwrap();
    guest.send(Message::Text(json!({
        "type": "join", "roomId": room_id, "displayName": "Guest", "color": "#0000FF",
        "reconnectToken": "guest-secret"
    }).to_string())).await.unwrap();
    let joined = recv_json(&mut host).await;
    let guest_state = recv_json(&mut guest).await;
    let guest_id = guest_state["localPlayerId"].as_str().unwrap().to_string();
    assert_eq!(joined["player"]["id"], guest_id);

    host.send(Message::Text(json!({
        "type": "remove_player", "playerId": guest_id
    }).to_string())).await.unwrap();
    let removed = recv_json(&mut guest).await;
    assert_eq!(removed["type"], "removed_from_room");
    let left = recv_json(&mut host).await;
    assert_eq!(left["type"], "player_left");
    assert_eq!(left["playerId"], guest_id);

    // The same bearer can join only as a fresh seat; the removed identity is gone.
    let (mut retry, _) = connect_async(&url).await.unwrap();
    retry.send(Message::Text(json!({
        "type": "join", "roomId": room_id, "displayName": "Guest", "color": "#0000FF",
        "reconnectToken": "guest-secret"
    }).to_string())).await.unwrap();
    let retry_state = recv_json(&mut retry).await;
    assert_ne!(retry_state["localPlayerId"], guest_id);
}

#[tokio::test]
async fn dice_spawn_broadcast_to_all_players() {
    let addr = start_server().await;
    let room_id = api_create_room(&addr).await;
    let url = format!("ws://{addr}/ws/{room_id}");

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
    let url = format!("ws://{addr}/ws/{room_id}");

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
    let url = format!("ws://{addr}/ws/{room_id}");

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
    let url = format!("ws://{addr}/ws/{room_id}");

    // Verify empty room
    let resp = reqwest::get(format!("http://{addr}/api/rooms/{room_id}"))
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
    let resp = reqwest::get(format!("http://{addr}/api/rooms/{room_id}"))
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
    let url = format!("ws://{addr}/ws/{room_id}");

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
            Some(_) => {} // Keep draining snapshots etc.
            None => {
                tokio::time::sleep(Duration::from_millis(50)).await;
            }
        }
    }
    assert!(found_settled, "Die should settle after drag throw");
}

// ─── get_room_info lock-release tests ────────────────────────────

/// Verifies that get_room_info returns the correct fields for an existing room
/// and that the manager lock is released before reading the room (no nested lock
/// deadlock). We confirm this by firing concurrent requests while the room exists.
#[tokio::test]
async fn get_room_info_returns_correct_data_for_existing_room() {
    let addr = start_server().await;
    let room_id = api_create_room(&addr).await;

    let resp = reqwest::get(format!("http://{addr}/api/rooms/{room_id}"))
        .await
        .unwrap();

    assert_eq!(resp.status(), 200);
    let body: Value = resp.json().await.unwrap();
    assert_eq!(body["roomId"], room_id, "roomId should match the created room");
    assert_eq!(body["playerCount"], 0, "fresh room has no players");
    assert_eq!(body["diceCount"], 0, "fresh room has no dice");
    assert!(body["instanceId"].is_string(), "instanceId should be present");
}

/// Fires multiple concurrent get_room_info requests to verify the manager lock
/// is not held across the nested room read, which would cause a deadlock.
#[tokio::test]
async fn get_room_info_concurrent_requests_do_not_deadlock() {
    let addr = start_server().await;
    let room_id = api_create_room(&addr).await;

    // Issue 10 concurrent GET /api/rooms/{room_id} requests.
    // If the manager lock were held across room.read().await, these requests
    // would queue behind each other on the single-threaded tokio scheduler
    // and could deadlock. With the fix (lock released before room.read()),
    // all requests complete independently.
    let handles: Vec<_> = (0..10)
        .map(|_| {
            let url = format!("http://{addr}/api/rooms/{room_id}");
            tokio::spawn(async move {
                reqwest::get(&url).await.unwrap()
            })
        })
        .collect();

    for handle in handles {
        let resp = handle.await.unwrap();
        assert_eq!(resp.status(), 200);
        let body: Value = resp.json().await.unwrap();
        assert_eq!(body["roomId"], room_id);
    }
}

// ─── Host Role & Room Settings Tests ─────────────────────────────

#[tokio::test]
async fn room_state_includes_host_and_settings() {
    let addr = start_server().await;
    let room_id = api_create_room(&addr).await;
    let url = format!("ws://{addr}/ws/{room_id}");

    let (mut ws, _) = connect_async(&url).await.expect("Failed to connect");
    ws.send(Message::Text(
        json!({"type": "join", "roomId": room_id, "displayName": "Host", "color": "#FF0000"})
            .to_string(),
    ))
    .await
    .unwrap();

    let body = recv_json(&mut ws).await;
    assert_eq!(body["type"], "room_state");
    // The creator is host, so hostId equals the single player's id.
    let players = body["players"].as_array().unwrap();
    let host_id = body["hostId"].as_str().expect("hostId present");
    assert_eq!(host_id, players[0]["id"].as_str().unwrap());
    // Versioned settings object present.
    assert_eq!(body["settings"]["version"], 1);
}

#[tokio::test]
async fn host_can_update_settings_and_broadcast_reaches_all() {
    let addr = start_server().await;
    let room_id = api_create_room(&addr).await;
    let url = format!("ws://{addr}/ws/{room_id}");

    // Host joins
    let (mut ws1, _) = connect_async(&url).await.unwrap();
    ws1.send(Message::Text(
        json!({"type": "join", "roomId": room_id, "displayName": "Host", "color": "#FF0000"})
            .to_string(),
    ))
    .await
    .unwrap();
    let _ = recv_json(&mut ws1).await; // room_state

    // Guest joins
    let (mut ws2, _) = connect_async(&url).await.unwrap();
    ws2.send(Message::Text(
        json!({"type": "join", "roomId": room_id, "displayName": "Guest", "color": "#0000FF"})
            .to_string(),
    ))
    .await
    .unwrap();
    let _ = recv_json(&mut ws1).await; // player_joined
    let _ = recv_json(&mut ws2).await; // room_state

    // Host updates settings
    ws1.send(Message::Text(
        json!({"type": "update_settings", "settings": {"version": 1, "physicsMode": "arcade"}})
            .to_string(),
    ))
    .await
    .unwrap();

    // Both host and guest receive settings_updated with the new field
    let m1 = recv_json(&mut ws1).await;
    assert_eq!(m1["type"], "settings_updated");
    assert_eq!(m1["settings"]["physicsMode"], "arcade");
    let m2 = recv_json(&mut ws2).await;
    assert_eq!(m2["type"], "settings_updated");
    assert_eq!(m2["settings"]["physicsMode"], "arcade");
}

#[tokio::test]
async fn non_host_settings_mutation_rejected() {
    let addr = start_server().await;
    let room_id = api_create_room(&addr).await;
    let url = format!("ws://{addr}/ws/{room_id}");

    // Host joins
    let (mut ws1, _) = connect_async(&url).await.unwrap();
    ws1.send(Message::Text(
        json!({"type": "join", "roomId": room_id, "displayName": "Host", "color": "#FF0000"})
            .to_string(),
    ))
    .await
    .unwrap();
    let _ = recv_json(&mut ws1).await; // room_state

    // Guest joins
    let (mut ws2, _) = connect_async(&url).await.unwrap();
    ws2.send(Message::Text(
        json!({"type": "join", "roomId": room_id, "displayName": "Guest", "color": "#0000FF"})
            .to_string(),
    ))
    .await
    .unwrap();
    let _ = recv_json(&mut ws1).await; // player_joined
    let _ = recv_json(&mut ws2).await; // room_state

    // Guest (non-host) attempts to update settings
    ws2.send(Message::Text(
        json!({"type": "update_settings", "settings": {"version": 1, "physicsMode": "arcade"}})
            .to_string(),
    ))
    .await
    .unwrap();

    // Guest gets a NOT_HOST error, and no settings_updated is broadcast
    let err = recv_json(&mut ws2).await;
    assert_eq!(err["type"], "error");
    assert_eq!(err["code"], "NOT_HOST");
}

// ─── Public Room Browser Listing (#79) ───────────────────────────

type TestWs = tokio_tungstenite::WebSocketStream<
    tokio_tungstenite::MaybeTlsStream<tokio::net::TcpStream>,
>;

/// Join a room as host over WS and mark it public, with an optional display name
/// and theme. Returns the open socket so the caller keeps the host connected
/// (and the room's player count non-zero) for the duration of the assertions.
async fn make_room_public(
    addr: &SocketAddr,
    room_id: &str,
    name: Option<&str>,
    theme: Option<&str>,
) -> TestWs {
    let url = format!("ws://{addr}/ws/{room_id}");
    let (mut ws, _) = connect_async(&url).await.unwrap();
    ws.send(Message::Text(
        json!({"type": "join", "roomId": room_id, "displayName": "Host", "color": "#FF0000"})
            .to_string(),
    ))
    .await
    .unwrap();
    let _ = recv_json(&mut ws).await; // room_state

    let mut settings = json!({"version": 1, "visibility": "public"});
    if let Some(n) = name {
        settings["roomName"] = json!(n);
    }
    if let Some(t) = theme {
        settings["themeId"] = json!(t);
    }
    ws.send(Message::Text(
        json!({"type": "update_settings", "settings": settings}).to_string(),
    ))
    .await
    .unwrap();
    let _ = recv_json(&mut ws).await; // settings_updated
    ws
}

#[tokio::test]
async fn list_rooms_excludes_unlisted_and_reports_state() {
    let addr = start_server().await;
    // One room stays unlisted (the default); one is marked public.
    let _unlisted = api_create_room(&addr).await;
    let public_id = api_create_room(&addr).await;
    let _ws = make_room_public(&addr, &public_id, Some("Poker Night"), Some("neon")).await;

    let resp = reqwest::get(format!("http://{addr}/api/rooms"))
        .await
        .unwrap();
    assert_eq!(resp.status(), 200);
    let body: Value = resp.json().await.unwrap();

    let rooms = body["rooms"].as_array().unwrap();
    assert_eq!(rooms.len(), 1, "Only the public room is listed");
    assert_eq!(body["total"], 1);
    assert_eq!(rooms[0]["roomId"], public_id);
    assert_eq!(rooms[0]["name"], "Poker Night");
    assert_eq!(rooms[0]["themeId"], "neon");
    assert_eq!(rooms[0]["playerCount"], 1, "Count reflects the connected host");
}

#[tokio::test]
async fn list_rooms_empty_when_no_public_rooms() {
    let addr = start_server().await;
    let _ = api_create_room(&addr).await; // unlisted by default

    let resp = reqwest::get(format!("http://{addr}/api/rooms"))
        .await
        .unwrap();
    let body: Value = resp.json().await.unwrap();
    assert_eq!(body["total"], 0);
    assert!(body["rooms"].as_array().unwrap().is_empty());
}

#[tokio::test]
async fn list_rooms_paginates() {
    let addr = start_server().await;
    let mut sockets = Vec::new();
    for i in 0..3 {
        let id = api_create_room(&addr).await;
        sockets.push(make_room_public(&addr, &id, Some(&format!("Room {i}")), None).await);
    }

    // Page 0, size 2 => 2 of the 3 public rooms.
    let resp = reqwest::get(format!("http://{addr}/api/rooms?page=0&pageSize=2"))
        .await
        .unwrap();
    let body: Value = resp.json().await.unwrap();
    assert_eq!(body["total"], 3);
    assert_eq!(body["pageSize"], 2);
    assert_eq!(body["page"], 0);
    assert_eq!(body["rooms"].as_array().unwrap().len(), 2);

    // Page 1, size 2 => the remaining 1.
    let resp = reqwest::get(format!("http://{addr}/api/rooms?page=1&pageSize=2"))
        .await
        .unwrap();
    let body: Value = resp.json().await.unwrap();
    assert_eq!(body["rooms"].as_array().unwrap().len(), 1);
}

#[tokio::test]
async fn host_transfers_to_next_player_on_disconnect() {
    let addr = start_server().await;
    let room_id = api_create_room(&addr).await;
    let url = format!("ws://{addr}/ws/{room_id}");

    // Host joins
    let (mut ws1, _) = connect_async(&url).await.unwrap();
    ws1.send(Message::Text(
        json!({"type": "join", "roomId": room_id, "displayName": "Host", "color": "#FF0000"})
            .to_string(),
    ))
    .await
    .unwrap();
    let _ = recv_json(&mut ws1).await; // room_state

    // Guest joins and captures its own player id from room_state (last player)
    let (mut ws2, _) = connect_async(&url).await.unwrap();
    ws2.send(Message::Text(
        json!({"type": "join", "roomId": room_id, "displayName": "Guest", "color": "#0000FF"})
            .to_string(),
    ))
    .await
    .unwrap();
    let _ = recv_json(&mut ws1).await; // player_joined
    let guest_state = recv_json(&mut ws2).await; // room_state
    // Use the server-echoed localPlayerId: the players array is unordered, so
    // deriving self-identity from `.last()` is non-deterministic.
    let guest_id = guest_state["localPlayerId"].as_str().unwrap().to_string();

    // Host disconnects
    ws1.close(None).await.unwrap();

    // Guest receives host_changed naming itself as the new host. (A raw drop now
    // holds the host's seat for the grace window, so no player_left is emitted.)
    let mut saw_host_changed = false;
    for _ in 0..3 {
        let msg = recv_json(&mut ws2).await;
        if msg["type"] == "host_changed" {
            assert_eq!(msg["hostId"], guest_id);
            saw_host_changed = true;
            break;
        }
    }
    assert!(saw_host_changed, "Remaining player should be notified it became host");
}
