use axum::extract::ws::{Message, WebSocket};
use futures_util::{SinkExt, StreamExt};
use log::{error, info, warn};
use tokio::sync::mpsc;
use uuid::Uuid;

const WS_PING_INTERVAL: std::time::Duration = std::time::Duration::from_secs(20);
const WS_SILENT_TIMEOUT: std::time::Duration = std::time::Duration::from_secs(60);

/// Pure timing seam for the liveness policy. The async handler supplies elapsed
/// wall time; tests exercise the threshold without sleeping for a minute.
fn connection_is_silent(elapsed: std::time::Duration) -> bool {
    elapsed >= WS_SILENT_TIMEOUT
}

use crate::messages::{ClientMessage, PlayerInfo, ServerMessage};
use crate::roll_reporting::RollReporter;
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

/// Privacy-safe authentication context for connection lifecycle logs. The raw
/// Supabase subject remains in room state for authorization/reward reporting,
/// but must never be interpolated into logs.
fn auth_log_marker(user_id: Option<&str>) -> &'static str {
    if user_id.is_some() {
        "[authenticated]"
    } else {
        "[guest]"
    }
}

/// Handle a single WebSocket connection for a room
#[allow(clippy::too_many_lines)]
pub async fn handle_ws_connection(socket: WebSocket, room: SharedRoom, reporter: RollReporter) {
    let (mut ws_sender, mut ws_receiver) = socket.split();

    // Channel for sending messages to this client
    let (tx, mut rx) = mpsc::unbounded_channel::<ServerMessage>();

    // Spawn write loop: forward messages from channel to WebSocket
    let write_task = tokio::spawn(async move {
        let start = tokio::time::Instant::now() + WS_PING_INTERVAL;
        let mut ping = tokio::time::interval_at(start, WS_PING_INTERVAL);
        loop {
            tokio::select! {
                maybe_msg = rx.recv() => {
                    let Some(msg) = maybe_msg else { break };
                    match serde_json::to_string(&msg) {
                        Ok(json) => {
                            if ws_sender.send(Message::Text(json)).await.is_err() {
                                break;
                            }
                        }
                        Err(e) => error!("Failed to serialize message: {e}"),
                    }
                }
                _ = ping.tick() => {
                    if ws_sender.send(Message::Ping(Vec::new())).await.is_err() {
                        break;
                    }
                }
            }
        }
    });

    // Candidate id for a fresh seat; on graceful rejoin the room hands back the
    // reclaimed player's existing id, which we adopt for the rest of the loop.
    let mut player_id = Uuid::new_v4().to_string();
    let mut is_joined = false;
    let mut intentional_leave = false;

    // Read loop: process incoming messages
    loop {
        let wait_started = tokio::time::Instant::now();
        let msg_result = match tokio::time::timeout(WS_SILENT_TIMEOUT, ws_receiver.next()).await {
            Ok(Some(result)) => result,
            Ok(None) => break,
            Err(_) if connection_is_silent(wait_started.elapsed()) => {
                warn!("WebSocket from {player_id} silent for 60s; disconnecting");
                break;
            }
            Err(_) => continue,
        };
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
                                "Player '{}' ({}) rejoined room {} within grace window {}",
                                display_name,
                                player_id,
                                room_guard.id,
                                auth_log_marker(user_id.as_deref())
                            );
                        } else {
                            info!(
                                "Player '{}' ({}) joined room {} {}",
                                display_name,
                                player_id,
                                room_guard.id,
                                auth_log_marker(user_id.as_deref())
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
                                        connected: true,
                                    },
                                },
                                &player_id,
                            );
                        } else {
                            room_guard.broadcast_except(
                                &ServerMessage::PlayerPresenceChanged {
                                    player_id: player_id.clone(),
                                    connected: true,
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
                            RoomError::DiceLimit => {
                                format!("Table is full ({}/30 dice)", room_guard.dice_count())
                            }
                            RoomError::InvalidDiceId => {
                                "Dice ID is invalid".to_string()
                            }
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
                    room_guard.broadcast(&ServerMessage::DiceRemoved { dice_ids: removed });
                }
            }

            ClientMessage::Roll if is_joined => {
                let mut room_guard = room.write().await;
                if let Some(started) = room_guard.roll_player_dice(&player_id) {
                    room_guard.broadcast(&ServerMessage::RollStarted {
                        player_id: player_id.clone(),
                        dice_ids: started.dice_ids,
                    });

                    crate::simulation::maybe_start_simulation(
                        &mut room_guard,
                        room.clone(),
                        reporter.clone(),
                    );
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

            ClientMessage::DragStart {
                die_id,
                grab_offset,
                world_position,
            } if is_joined => {
                let mut room_guard = room.write().await;
                match room_guard.start_drag(&player_id, &die_id, grab_offset, world_position) {
                    Ok(()) => {
                        crate::simulation::maybe_start_simulation(
                            &mut room_guard,
                            room.clone(),
                            reporter.clone(),
                        );
                    }
                    Err(err) => {
                        let message = match err {
                            RoomError::NotOwner => "Can only drag your own dice".to_string(),
                            RoomError::AlreadyDragged => "Die is already being dragged".to_string(),
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

            ClientMessage::DragMove {
                die_id,
                world_position,
            } if is_joined => {
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

            ClientMessage::DragEnd {
                die_id,
                velocity_history,
            } if is_joined => {
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

            ClientMessage::SetArena { aspect } if is_joined => {
                let mut room_guard = room.write().await;
                match room_guard.set_arena(&player_id, aspect) {
                    Ok(config) => {
                        room_guard.broadcast(&ServerMessage::ArenaChanged { config });
                        // Moved dice (if any) re-settle via the sim loop; start it if
                        // the resize woke the room.
                        crate::simulation::maybe_start_simulation(
                            &mut room_guard,
                            room.clone(),
                            reporter.clone(),
                        );
                    }
                    Err(err) => {
                        let message = match err {
                            RoomError::NotHost => "Only the host can resize the arena".to_string(),
                            _ => format!("Failed to resize arena: {}", err.code()),
                        };
                        let _ = tx.send(ServerMessage::Error {
                            code: err.code().to_string(),
                            message,
                        });
                    }
                }
            }

            ClientMessage::MotionField {
                field,
                angular_accel,
            } if is_joined => {
                let mut room_guard = room.write().await;
                match room_guard.set_motion_field_with_angular(&player_id, field, angular_accel) {
                    Ok(()) => {
                        // A live field wakes the room; make sure the physics loop is
                        // running so the movement (and eventual re-settle) broadcasts.
                        // `set_motion_field` only sets `is_simulating` for a non-zero
                        // field, so a closing zero won't needlessly restart the loop.
                        crate::simulation::maybe_start_simulation(
                            &mut room_guard,
                            room.clone(),
                            reporter.clone(),
                        );
                    }
                    // Motion disabled for this room, or unknown player: silently
                    // ignore. Motion is high-frequency; surfacing an error per dropped
                    // field would spam the client, and `motionControl` state is already
                    // visible to every client via `settings_updated`.
                    Err(_) => {}
                }
            }

            ClientMessage::Leave if is_joined => {
                intentional_leave = true;
                break;
            }

            ClientMessage::RemovePlayer {
                player_id: target_id,
            } if is_joined => {
                let mut room_guard = room.write().await;
                let previous_host = room_guard.host_id.clone();
                if room_guard.is_host(&player_id) && player_id != target_id {
                    if let Some(target) = room_guard.players.get(&target_id) {
                        let _ = target.send(&ServerMessage::RemovedFromRoom {
                            reason: "The host removed you from the room.".to_string(),
                        });
                    }
                }
                match room_guard.remove_player_by_host(&player_id, &target_id) {
                    Ok(removed_dice) => {
                        if !removed_dice.is_empty() {
                            room_guard.broadcast(&ServerMessage::DiceRemoved {
                                dice_ids: removed_dice,
                            });
                        }
                        room_guard.broadcast(&ServerMessage::PlayerLeft {
                            player_id: target_id,
                        });
                        if room_guard.host_id != previous_host {
                            if let Some(host_id) = room_guard.host_id.clone() {
                                room_guard.broadcast(&ServerMessage::HostChanged { host_id });
                            }
                        }
                    }
                    Err(err) => {
                        let _ = tx.send(ServerMessage::Error {
                            code: err.code().to_string(),
                            message: err.to_string(),
                        });
                    }
                }
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

        // A host may already have removed this connection's seat. If the
        // removed client now closes (normally after `removed_from_room`), do not
        // emit a contradictory presence-false event after the final player_left.
        if !room_guard.players.contains_key(&player_id) {
            drop(room_guard);
            write_task.abort();
            return;
        }

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
                player_id,
                room_guard.id,
                crate::room::RECONNECT_GRACE_SECS
            );
            if let Some(host_id) = outcome.new_host {
                info!("Host of room {} transferred to {}", room_guard.id, host_id);
                room_guard.broadcast(&ServerMessage::HostChanged { host_id });
            }
            room_guard.broadcast_except(
                &ServerMessage::PlayerPresenceChanged {
                    player_id: player_id.clone(),
                    connected: false,
                },
                &player_id,
            );
        }
    }

    write_task.abort();
}

#[cfg(test)]
mod tests {
    use super::{auth_log_marker, connection_is_silent, is_valid_hex_color};

    #[test]
    fn auth_log_marker_never_contains_supabase_user_id() {
        let user_id = "51111111-1111-4111-8111-111111111111";
        let marker = auth_log_marker(Some(user_id));
        assert_eq!(marker, "[authenticated]");
        assert!(!marker.contains(user_id));
        assert_eq!(auth_log_marker(None), "[guest]");
    }

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
    fn liveness_threshold_is_inclusive_without_sleeping() {
        assert!(!connection_is_silent(std::time::Duration::from_secs(59)));
        assert!(connection_is_silent(std::time::Duration::from_secs(60)));
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
