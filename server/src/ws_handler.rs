use axum::extract::ws::{Message, WebSocket};
use futures_util::{SinkExt, StreamExt};
use log::{error, info, warn};
use tokio::sync::mpsc;
use uuid::Uuid;

use crate::messages::*;
use crate::player::Player;
use crate::room_manager::SharedRoom;

/// Handle a single WebSocket connection for a room
pub async fn handle_ws_connection(socket: WebSocket, room: SharedRoom) {
    let (mut ws_sender, mut ws_receiver) = socket.split();

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
        let text = match msg_result {
            Ok(Message::Text(t)) => t,
            Ok(Message::Close(_)) => break,
            Ok(_) => continue, // Ignore binary, ping, pong
            Err(e) => {
                warn!("WebSocket error: {}", e);
                break;
            }
        };

        let client_msg: ClientMessage = match serde_json::from_str(&text) {
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
            ClientMessage::Join {
                display_name,
                color,
                ..
            } => {
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
                        info!(
                            "Player '{}' ({}) joined room {}",
                            display_name, player_id, room_guard.id
                        );

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
                            "INVALID_NAME" => {
                                "Display name must be 1-20 characters".to_string()
                            }
                            _ => format!("Failed to join: {}", code),
                        };
                        let _ = tx.send(ServerMessage::Error { code, message });
                    }
                }
            }

            ClientMessage::SpawnDice { dice } if is_joined => {
                let entries: Vec<(String, DiceType)> =
                    dice.into_iter().map(|d| (d.id, d.dice_type)).collect();

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
                            "DICE_LIMIT" => format!(
                                "Table is full ({}/30 dice)",
                                room_guard.dice_count()
                            ),
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

                    // Start simulation loop if not already running (atomic check-and-set under lock)
                    let should_start = room_guard.is_simulating && !room_guard.is_sim_running;
                    if should_start {
                        room_guard.is_sim_running = true;
                    }
                    let sim_room = room.clone();
                    drop(room_guard); // Release lock before spawning task
                    if should_start {
                        start_simulation_loop(sim_room);
                    }
                }
            }

            ClientMessage::UpdateColor { color } if is_joined => {
                let mut room_guard = room.write().await;
                if let Some(player) = room_guard.players.get_mut(&player_id) {
                    player.color = color;
                }
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

    // Player disconnected - clean up
    if is_joined {
        let mut room_guard = room.write().await;
        let removed_dice = room_guard.remove_player(&player_id);
        info!(
            "Player {} left room {} (removed {} dice)",
            player_id,
            room_guard.id,
            removed_dice.len()
        );

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
fn start_simulation_loop(room: SharedRoom) {
    tokio::spawn(async move {
        let tick_duration = std::time::Duration::from_micros(16_667); // ~60Hz

        loop {
            tokio::time::sleep(tick_duration).await;

            let mut room_guard = room.write().await;

            if !room_guard.is_simulating {
                room_guard.is_sim_running = false;
                break;
            }

            let (snapshot, newly_settled) = room_guard.physics_tick();

            // Broadcast physics snapshot
            if let Some(snap) = snapshot {
                room_guard.broadcast(&snap);
            }

            // Handle newly settled dice
            for (dice_id, face_value) in &newly_settled {
                if let Some(die) = room_guard.dice.get(dice_id) {
                    room_guard.broadcast(&ServerMessage::DieSettled {
                        dice_id: dice_id.clone(),
                        face_value: *face_value,
                        position: die.position,
                        rotation: die.rotation,
                    });
                }
            }

            // Check if any player's full roll is complete
            if !newly_settled.is_empty() {
                let player_ids: Vec<String> = room_guard.players.keys().cloned().collect();
                for pid in player_ids {
                    let player_has_dice = room_guard.dice.values().any(|d| d.owner_id == pid);
                    if player_has_dice && room_guard.is_player_roll_complete(&pid) {
                        let (results, total) = room_guard.get_player_results(&pid);
                        if !results.is_empty() {
                            let has_new = results
                                .iter()
                                .any(|r| newly_settled.iter().any(|(id, _)| *id == r.dice_id));
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
        }
    });
}
