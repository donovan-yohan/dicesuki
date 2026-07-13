use axum::extract::ws::{Message, WebSocket};
use futures_util::{SinkExt, StreamExt};
use log::{error, info, warn};
use tokio::sync::mpsc;
use uuid::Uuid;

use crate::messages::{ClientMessage, PlayerInfo, ServerMessage};
use crate::room::RoomError;
use crate::room_manager::SharedRoom;
use crate::sink::MessageSink;

/// Adapts this connection's tokio mpsc sender to the core [`MessageSink`] seam,
/// so `dicesuki-core` can push protocol messages to the client without knowing
/// about tokio. An orphan-rule-safe newtype (the trait and the mpsc type are
/// both foreign to core, so the impl must live here on a local type).
struct MpscSink(mpsc::UnboundedSender<ServerMessage>);

impl MessageSink for MpscSink {
    fn send(&self, msg: &ServerMessage) -> bool {
        self.0.send(msg.clone()).is_ok()
    }
}

/// Returns true if `color` is a valid hex color string (#RGB or #RRGGBB).
fn is_valid_hex_color(color: &str) -> bool {
    (color.len() == 4 || color.len() == 7)
        && color.starts_with('#')
        && color[1..].chars().all(|c| c.is_ascii_hexdigit())
}

/// Handle a single WebSocket connection for a room
#[allow(clippy::too_many_lines)]
pub async fn handle_ws_connection(socket: WebSocket, room: SharedRoom) {
    let (mut ws_sender, mut ws_receiver) = socket.split();

    // Channel for sending messages to this client
    let (tx, mut rx) = mpsc::unbounded_channel::<ServerMessage>();

    // Spawn write loop: forward messages from channel to WebSocket
    let write_task = tokio::spawn(async move {
        while let Some(msg) = rx.recv().await {
            match serde_json::to_string(&msg) {
                Ok(json) => {
                    if ws_sender.send(Message::Text(json)).await.is_err() {
                        break;
                    }
                }
                Err(e) => error!("Failed to serialize message: {e}"),
            }
        }
    });

    // Candidate id for a fresh seat; on graceful rejoin the room hands back the
    // reclaimed player's existing id, which we adopt for the rest of the loop.
    let mut player_id = Uuid::new_v4().to_string();
    let mut is_joined = false;
    let mut intentional_leave = false;

    // Read loop: process incoming messages
    while let Some(msg_result) = ws_receiver.next().await {
        let text = match msg_result {
            Ok(Message::Text(t)) => t,
            Ok(Message::Close(_)) => break,
            Ok(_) => continue, // Ignore binary, ping, pong
            Err(e) => {
                warn!("WebSocket error: {e}");
                break;
            }
        };

        let client_msg: ClientMessage = match serde_json::from_str(&text) {
            Ok(m) => m,
            Err(e) => {
                warn!("Invalid message from {player_id}: {e}");
                let _ = tx.send(ServerMessage::Error {
                    code: "INVALID_MESSAGE".to_string(),
                    message: format!("Failed to parse message: {e}"),
                });
                continue;
            }
        };

        match client_msg {
            ClientMessage::Join {
                display_name,
                color,
                reconnect_token,
                auth_token,
                ..
            } => {
                if is_joined {
                    let _ = tx.send(ServerMessage::Error {
                        code: "ALREADY_JOINED".to_string(),
                        message: "Already joined this room".to_string(),
                    });
                    continue;
                }

                if !is_valid_hex_color(&color) {
                    let _ = tx.send(ServerMessage::Error {
                        code: "INVALID_COLOR".to_string(),
                        message: "Color must be a valid hex color (#RGB or #RRGGBB)".to_string(),
                    });
                    continue;
                }

                // Optional Supabase auth (ADR 006): absent → guest; valid →
                // bind to the Supabase user id; invalid/expired → reject so a
                // stale token fails loudly rather than silently downgrading.
                let user_id = match crate::auth::verifier()
                    .authenticate(auth_token.as_deref())
                    .await
                {
                    Ok(crate::auth::AuthOutcome::Guest) => None,
                    Ok(crate::auth::AuthOutcome::Authenticated { user_id }) => Some(user_id),
                    Err(err) => {
                        let _ = tx.send(ServerMessage::Error {
                            code: err.code().to_string(),
                            message: err.message(),
                        });
                        continue;
                    }
                };

                let mut room_guard = room.write().await;

                match room_guard.join(
                    player_id.clone(),
                    display_name.clone(),
                    color.clone(),
                    MpscSink(tx.clone()),
                    reconnect_token.as_deref(),
                    user_id.clone(),
                ) {
                    Ok(result) => {
                        is_joined = true;
                        // Adopt the effective id (reclaimed id on rejoin).
                        player_id = result.player_id.clone();
                        if result.reconnected {
                            info!(
                                "Player '{}' ({}) rejoined room {} within grace window{}",
                                display_name, player_id, room_guard.id,
                                match &user_id {
                                    Some(uid) => format!(" [auth user {uid}]"),
                                    None => " [guest]".to_string(),
                                }
                            );
                        } else {
                            info!(
                                "Player '{}' ({}) joined room {}{}",
                                display_name, player_id, room_guard.id,
                                match &user_id {
                                    Some(uid) => format!(" [auth user {uid}]"),
                                    None => " [guest]".to_string(),
                                }
                            );
                        }

                        // Send full room state to this player (echoes their id).
                        let room_state = room_guard.build_room_state(&player_id);
                        let _ = tx.send(room_state);

                        // A reclaimed seat is already known to other clients, so
                        // only announce genuinely new players.
                        if !result.reconnected {
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
                    }
                    Err(err) => {
                        let message = match err {
                            RoomError::RoomFull => "Room is full (8/8 players)".to_string(),
                            RoomError::InvalidName => {
                                "Display name must be 1-20 characters".to_string()
                            }
                            _ => format!("Failed to join: {}", err.code()),
                        };
                        let _ = tx.send(ServerMessage::Error {
                            code: err.code().to_string(),
                            message,
                        });
                    }
                }
            }

            ClientMessage::SpawnDice { dice } if is_joined => {
                let mut room_guard = room.write().await;
                match room_guard.spawn_dice_with_physics(&player_id, dice) {
                    Ok(spawned) => {
                        room_guard.broadcast(&ServerMessage::DiceSpawned {
                            owner_id: player_id.clone(),
                            dice: spawned,
                        });
                    }
                    Err(err) => {
                        let message = match err {
                            RoomError::DiceLimit => format!(
                                "Table is full ({}/30 dice)",
                                room_guard.dice_count()
                            ),
                            RoomError::DuplicateDiceId => {
                                "Duplicate dice ID in spawn request".to_string()
                            }
                            RoomError::DuplicateInventoryDie => {
                                "That inventory die is already on the table".to_string()
                            }
                            _ => format!("Failed to spawn dice: {}", err.code()),
                        };
                        let _ = tx.send(ServerMessage::Error {
                            code: err.code().to_string(),
                            message,
                        });
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

                    crate::simulation::maybe_start_simulation(&mut room_guard, room.clone());
                }
            }

            ClientMessage::UpdateColor { color } if is_joined => {
                // Validate: must be a hex color (#RGB or #RRGGBB)
                if !is_valid_hex_color(&color) {
                    let _ = tx.send(ServerMessage::Error {
                        code: "INVALID_COLOR".to_string(),
                        message: "Color must be a valid hex color (#RGB or #RRGGBB)".to_string(),
                    });
                    continue;
                }
                let mut room_guard = room.write().await;
                if let Some(player) = room_guard.players.get_mut(&player_id) {
                    player.color = color;
                }
            }

            ClientMessage::DragStart { die_id, grab_offset, world_position } if is_joined => {
                let mut room_guard = room.write().await;
                match room_guard.start_drag(&player_id, &die_id, grab_offset, world_position) {
                    Ok(()) => {
                        crate::simulation::maybe_start_simulation(&mut room_guard, room.clone());
                    }
                    Err(err) => {
                        let message = match err {
                            RoomError::NotOwner => "Can only drag your own dice".to_string(),
                            RoomError::AlreadyDragged => {
                                "Die is already being dragged".to_string()
                            }
                            RoomError::DieNotFound => "Die not found".to_string(),
                            _ => format!("Drag failed: {}", err.code()),
                        };
                        let _ = tx.send(ServerMessage::Error {
                            code: err.code().to_string(),
                            message,
                        });
                    }
                }
            }

            ClientMessage::DragMove { die_id, world_position } if is_joined => {
                let mut room_guard = room.write().await;
                if let Err(err) = room_guard.update_drag(&player_id, &die_id, world_position) {
                    let message = match err {
                        RoomError::DieNotFound => "Die not found".to_string(),
                        RoomError::NotDragger => "Can only move drag on your own dice".to_string(),
                        RoomError::NotDragging => "Die is not being dragged".to_string(),
                        _ => format!("Drag move failed: {}", err.code()),
                    };
                    let _ = tx.send(ServerMessage::Error {
                        code: err.code().to_string(),
                        message,
                    });
                }
            }

            ClientMessage::DragEnd { die_id, velocity_history } if is_joined => {
                let mut room_guard = room.write().await;
                if let Err(err) = room_guard.end_drag(&player_id, &die_id, &velocity_history) {
                    let message = match err {
                        RoomError::DieNotFound => "Die not found".to_string(),
                        RoomError::NotDragger => "Can only end drag on your own dice".to_string(),
                        RoomError::NotDragging => "Die is not being dragged".to_string(),
                        _ => format!("Drag end failed: {}", err.code()),
                    };
                    let _ = tx.send(ServerMessage::Error {
                        code: err.code().to_string(),
                        message,
                    });
                }
            }

            ClientMessage::UpdateSettings { settings } if is_joined => {
                let mut room_guard = room.write().await;
                match room_guard.update_settings(&player_id, settings) {
                    Ok(()) => {
                        room_guard.broadcast(&ServerMessage::SettingsUpdated {
                            settings: room_guard.settings.clone(),
                        });
                    }
                    Err(err) => {
                        let message = match err {
                            RoomError::NotHost => {
                                "Only the host can change room settings".to_string()
                            }
                            _ => format!("Failed to update settings: {}", err.code()),
                        };
                        let _ = tx.send(ServerMessage::Error {
                            code: err.code().to_string(),
                            message,
                        });
                    }
                }
            }

            ClientMessage::MotionImpulse { impulse } if is_joined => {
                let mut room_guard = room.write().await;
                match room_guard.apply_motion_impulse(&player_id, impulse) {
                    Ok(affected) if !affected.is_empty() => {
                        // Dice were nudged — make sure the physics loop is running so
                        // the movement (and eventual re-settle) is broadcast.
                        crate::simulation::maybe_start_simulation(&mut room_guard, room.clone());
                    }
                    // No dice affected (sender owns none), or rate-limited / disabled:
                    // silently ignore. Motion is high-frequency; surfacing an error per
                    // dropped impulse would spam the client. `motionControl` state is
                    // already visible to every client via `settings_updated`.
                    Ok(_) | Err(_) => {}
                }
            }

            ClientMessage::Leave if is_joined => {
                intentional_leave = true;
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

    // Connection ended. An explicit Leave frees the seat immediately; an
    // unexpected drop (socket close/error) holds the seat and dice for the
    // reconnect grace window so the player can rejoin with the same identity.
    if is_joined {
        let mut room_guard = room.write().await;

        if intentional_leave {
            let previous_host = room_guard.host_id.clone();
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

            // If the departing host handed off, notify everyone so clients can
            // re-gate host UI. (Dedicated message, not a full room_state, to
            // avoid clobbering each client's derived localPlayerId.)
            let new_host = room_guard.host_id.clone();
            if new_host != previous_host {
                if let Some(host_id) = new_host {
                    info!("Host of room {} transferred to {}", room_guard.id, host_id);
                    room_guard.broadcast(&ServerMessage::HostChanged { host_id });
                }
            }
        } else {
            // Hold the seat during the grace window. Dice and identity persist;
            // only host may transfer (to an oldest connected player).
            let outcome = room_guard.mark_disconnected(&player_id);
            info!(
                "Player {} disconnected from room {} (seat held for {}s grace)",
                player_id, room_guard.id, crate::room::RECONNECT_GRACE_SECS
            );
            if let Some(host_id) = outcome.new_host {
                info!("Host of room {} transferred to {}", room_guard.id, host_id);
                room_guard.broadcast(&ServerMessage::HostChanged { host_id });
            }
        }
    }

    write_task.abort();
}

#[cfg(test)]
mod tests {
    use super::is_valid_hex_color;

    #[test]
    fn test_valid_hex_color_rrggbb() {
        assert!(is_valid_hex_color("#1A2B3C"));
        assert!(is_valid_hex_color("#FFFFFF"));
        assert!(is_valid_hex_color("#000000"));
        assert!(is_valid_hex_color("#aabbcc"));
    }

    #[test]
    fn test_valid_hex_color_rgb() {
        assert!(is_valid_hex_color("#ABC"));
        assert!(is_valid_hex_color("#fff"));
        assert!(is_valid_hex_color("#000"));
        assert!(is_valid_hex_color("#1aF"));
    }

    #[test]
    fn test_invalid_hex_color_missing_hash() {
        assert!(!is_valid_hex_color("AABBCC"));
        assert!(!is_valid_hex_color("ABC"));
        assert!(!is_valid_hex_color("ffffff"));
    }

    #[test]
    fn test_invalid_hex_color_non_hex_chars() {
        assert!(!is_valid_hex_color("#GGHHII"));
        assert!(!is_valid_hex_color("#XYZ"));
        assert!(!is_valid_hex_color("#12345G"));
    }

    #[test]
    fn test_invalid_hex_color_empty_string() {
        assert!(!is_valid_hex_color(""));
    }

    #[test]
    fn test_invalid_hex_color_wrong_length() {
        // Too short (2 chars after #)
        assert!(!is_valid_hex_color("#AB"));
        // 5 chars after #
        assert!(!is_valid_hex_color("#ABCDE"));
        // 8 chars after # (too long)
        assert!(!is_valid_hex_color("#AABBCCDD"));
        // Just the hash
        assert!(!is_valid_hex_color("#"));
    }
}
