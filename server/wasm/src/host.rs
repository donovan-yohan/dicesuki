//! `RoomHost` — the platform-independent orchestration that drives a
//! `dicesuki_core::room::Room` for a single solo player.
//!
//! This is the wasm worker's Rust half. It is the exact analogue of the native
//! server's [`ws_handler`] + [`simulation`] loop: it never contains physics,
//! dice, face-detection, or room-state *game logic* (all of that lives in
//! `dicesuki-core`) — it only decodes inbound protocol JSON, calls the matching
//! `Room` method, and fans out the `ServerMessage`s the room produces. Keeping
//! this orchestration in **Rust** (not JS/TS) is what upholds the epic #111
//! anti-drift guardrail: the JS worker shim is a pure pipe, and there is no
//! second engine.
//!
//! It compiles on the native target (no `wasm-bindgen`), so its behaviour is
//! covered by ordinary `cargo test`.
//!
//! [`ws_handler`]: https://github.com/donovan-yohan/dicesuki/blob/main/server/src/ws_handler.rs
//! [`simulation`]: https://github.com/donovan-yohan/dicesuki/blob/main/server/src/simulation.rs

use std::collections::VecDeque;
use std::sync::{Arc, Mutex};

use dicesuki_core::messages::{ClientMessage, ServerMessage};
use dicesuki_core::physics::ArenaBounds;
use dicesuki_core::room::{Room, RoomError};
use dicesuki_core::sink::MessageSink;

/// The fixed player id for the single solo occupant. A worker hosts exactly one
/// room with one player, so a stable id is sufficient (and keeps tests
/// deterministic). Mirrors the server's per-connection uuid, minus the need for
/// uniqueness across connections.
pub const SOLO_PLAYER_ID: &str = "solo-player";

/// Outbound buffer shared between the room's player [`MessageSink`] and the
/// host. Everything the room broadcasts, plus host-directed replies, lands here
/// in emission order and is drained after each inbound call / tick.
type Outbound = Arc<Mutex<VecDeque<ServerMessage>>>;

/// A [`MessageSink`] that appends to the shared outbound buffer. The solo
/// player is joined with one of these, so `Room::broadcast` routes through the
/// normal sink path exactly as it does on the server — no special-casing.
#[derive(Clone)]
struct QueueSink(Outbound);

impl MessageSink for QueueSink {
    fn send(&self, msg: &ServerMessage) -> bool {
        self.0
            .lock()
            .expect("outbound buffer poisoned")
            .push_back(msg.clone());
        true
    }
}

/// Returns true if `color` is a valid hex color string (#RGB or #RRGGBB).
/// Mirrors the server's `ws_handler::is_valid_hex_color` so solo join
/// validation matches multiplayer.
fn is_valid_hex_color(color: &str) -> bool {
    (color.len() == 4 || color.len() == 7)
        && color.starts_with('#')
        && color[1..].chars().all(|c| c.is_ascii_hexdigit())
}

/// Drives one `Room` for one solo player. Platform-independent so it is unit
/// tested natively; the `wasm-bindgen` `WasmRoom` is a thin wrapper over it.
pub struct RoomHost {
    room: Room,
    outbound: Outbound,
    joined: bool,
}

impl RoomHost {
    /// Create a host owning a fresh, empty room with the given id and arena
    /// `bounds`. Solo passes an aspect-fitted footprint ([`ArenaBounds::from_aspect`]);
    /// the default keeps the fixed 9:16 arena.
    #[must_use]
    pub fn new(room_id: String, bounds: ArenaBounds) -> Self {
        Self {
            room: Room::new(room_id, bounds),
            outbound: Arc::new(Mutex::new(VecDeque::new())),
            joined: false,
        }
    }

    /// Push a message directly to this client (the analogue of the server's
    /// per-connection `tx.send`).
    fn send(&self, msg: ServerMessage) {
        self.outbound
            .lock()
            .expect("outbound buffer poisoned")
            .push_back(msg);
    }

    fn send_error(&self, code: &str, message: &str) {
        self.send(ServerMessage::Error {
            code: code.to_string(),
            message: message.to_string(),
        });
    }

    /// Whether the room's simulation loop wants ticks right now. The worker may
    /// use this to pause its timer when nothing is moving.
    #[must_use]
    pub fn is_simulating(&self) -> bool {
        self.room.is_simulating
    }

    /// Decode and dispatch one inbound protocol JSON message, mutating the room
    /// and enqueuing any resulting `ServerMessage`s. Mirrors the native
    /// `ws_handler` match arms (minus auth / reconnect-grace, which are
    /// meaningless for an offline solo room).
    pub fn handle_message(&mut self, json: &str) {
        let client_msg: ClientMessage = match serde_json::from_str(json) {
            Ok(m) => m,
            Err(e) => {
                self.send_error("INVALID_MESSAGE", &format!("Failed to parse message: {e}"));
                return;
            }
        };

        match client_msg {
            ClientMessage::Join {
                display_name,
                color,
                ..
            } => self.handle_join(display_name, color),

            ClientMessage::SpawnDice { dice } if self.joined => {
                match self.room.spawn_dice_with_physics(SOLO_PLAYER_ID, dice) {
                    Ok(spawned) => self.room.broadcast(&ServerMessage::DiceSpawned {
                        owner_id: SOLO_PLAYER_ID.to_string(),
                        dice: spawned,
                    }),
                    Err(err) => self.send_error(err.code(), &err.to_string()),
                }
            }

            ClientMessage::RemoveDice { dice_ids } if self.joined => {
                let removed = self.room.remove_dice(SOLO_PLAYER_ID, &dice_ids);
                if !removed.is_empty() {
                    self.room
                        .broadcast(&ServerMessage::DiceRemoved { dice_ids: removed });
                }
            }

            ClientMessage::Roll if self.joined => {
                let dice_ids = self.room.roll_player_dice(SOLO_PLAYER_ID);
                if !dice_ids.is_empty() {
                    self.room.broadcast(&ServerMessage::RollStarted {
                        player_id: SOLO_PLAYER_ID.to_string(),
                        dice_ids,
                    });
                }
            }

            ClientMessage::UpdateColor { color } if self.joined => {
                if !is_valid_hex_color(&color) {
                    self.send_error(
                        "INVALID_COLOR",
                        "Color must be a valid hex color (#RGB or #RRGGBB)",
                    );
                    return;
                }
                if let Some(player) = self.room.players.get_mut(SOLO_PLAYER_ID) {
                    player.color = color;
                }
            }

            ClientMessage::DragStart {
                die_id,
                grab_offset,
                world_position,
            } if self.joined => {
                if let Err(err) =
                    self.room
                        .start_drag(SOLO_PLAYER_ID, &die_id, grab_offset, world_position)
                {
                    self.send_error(err.code(), &err.to_string());
                }
            }

            ClientMessage::DragMove {
                die_id,
                world_position,
            } if self.joined => {
                if let Err(err) = self.room.update_drag(SOLO_PLAYER_ID, &die_id, world_position) {
                    self.send_error(err.code(), &err.to_string());
                }
            }

            ClientMessage::DragEnd {
                die_id,
                velocity_history,
            } if self.joined => {
                if let Err(err) = self.room.end_drag(SOLO_PLAYER_ID, &die_id, &velocity_history) {
                    self.send_error(err.code(), &err.to_string());
                }
            }

            ClientMessage::UpdateSettings { settings } if self.joined => {
                match self.room.update_settings(SOLO_PLAYER_ID, settings) {
                    Ok(()) => self.room.broadcast(&ServerMessage::SettingsUpdated {
                        settings: self.room.settings.clone(),
                    }),
                    Err(err) => self.send_error(err.code(), &err.to_string()),
                }
            }

            ClientMessage::MotionImpulse { impulse } if self.joined => {
                // Motion is high-frequency; a dropped/rate-limited impulse is
                // silently ignored, matching the server.
                let _ = self.room.apply_motion_impulse(SOLO_PLAYER_ID, impulse);
            }

            ClientMessage::Leave if self.joined => {
                // Solo has no seat to free for anyone else; the worker is torn
                // down by the host. Nothing to broadcast.
            }

            _ => self.send_error("NOT_JOINED", "Must join the room first"),
        }
    }

    fn handle_join(&mut self, display_name: String, color: String) {
        if self.joined {
            self.send_error("ALREADY_JOINED", "Already joined this room");
            return;
        }
        if !is_valid_hex_color(&color) {
            self.send_error(
                "INVALID_COLOR",
                "Color must be a valid hex color (#RGB or #RRGGBB)",
            );
            return;
        }

        let sink = QueueSink(Arc::clone(&self.outbound));
        // Solo joins through the exact same `Room::join` path as a multiplayer
        // client (no auth token, no reconnect token — offline single player).
        match self.room.join(
            SOLO_PLAYER_ID.to_string(),
            display_name,
            color,
            sink,
            None,
            None,
        ) {
            Ok(result) => {
                self.joined = true;
                let room_state = self.room.build_room_state(&result.player_id);
                self.send(room_state);
            }
            Err(RoomError::InvalidName) => {
                self.send_error("INVALID_NAME", "Display name must be 1-20 characters");
            }
            Err(err) => self.send_error(err.code(), &err.to_string()),
        }
    }

    /// Advance the simulation one 60Hz step and enqueue the snapshot / settle /
    /// knock / roll-complete messages it produces. `_dt_ms` is accepted for API
    /// symmetry with a wall-clock driver but ignored: `dicesuki-core` steps
    /// physics at a fixed timestep so solo and multiplayer integrate
    /// identically. A no-op while the room is idle (`is_simulating == false`),
    /// mirroring the server loop that only runs while dice are active.
    #[allow(clippy::needless_pass_by_value, unused_variables)]
    pub fn tick(&mut self, dt_ms: f64) {
        if !self.room.is_simulating {
            return;
        }

        let (snapshot, newly_settled, knocked) = self.room.physics_tick();

        if let Some(snap) = snapshot {
            self.room.broadcast(&snap);
        }

        for (dice_id, impact_speed) in &knocked {
            if let Some(die) = self.room.dice.get(dice_id) {
                self.room.broadcast(&ServerMessage::DiceKnocked {
                    dice_id: dice_id.clone(),
                    position: die.position,
                    impact_speed: *impact_speed,
                });
            }
        }

        for (dice_id, face_value) in &newly_settled {
            if let Some(die) = self.room.dice.get(dice_id) {
                self.room.broadcast(&ServerMessage::DieSettled {
                    dice_id: dice_id.clone(),
                    face_value: *face_value,
                    position: die.position,
                    rotation: die.rotation,
                });
            }
        }

        // A player's full roll completing fires exactly once (only when a die
        // settled this tick), same guard as the server loop.
        if !newly_settled.is_empty() {
            let player_ids: Vec<String> = self.room.players.keys().cloned().collect();
            for pid in player_ids {
                let player_has_dice = self.room.dice.values().any(|d| d.owner_id == pid);
                if player_has_dice && self.room.is_player_roll_complete(&pid) {
                    let (results, total) = self.room.get_player_results(&pid);
                    if !results.is_empty() {
                        let has_new = results
                            .iter()
                            .any(|r| newly_settled.iter().any(|(id, _)| *id == r.dice_id));
                        if has_new {
                            self.room.broadcast(&ServerMessage::RollComplete {
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

    /// Drain every queued `ServerMessage` as protocol JSON, in emission order.
    #[must_use]
    pub fn drain_json(&mut self) -> Vec<String> {
        let mut buf = self.outbound.lock().expect("outbound buffer poisoned");
        buf.drain(..)
            .map(|msg| serde_json::to_string(&msg).expect("ServerMessage serializes"))
            .collect()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn join(host: &mut RoomHost) -> Vec<String> {
        host.handle_message(r##"{"type":"join","roomId":"solo","displayName":"Solo","color":"#8B5CF6"}"##);
        host.drain_json()
    }

    #[test]
    fn join_round_trips_to_room_state() {
        let mut host = RoomHost::new("solo".to_string(), ArenaBounds::default());
        let out = join(&mut host);
        assert_eq!(out.len(), 1);
        assert!(out[0].contains("\"type\":\"room_state\""));
        assert!(out[0].contains("\"localPlayerId\":\"solo-player\""));
    }

    #[test]
    fn spawn_before_join_is_rejected() {
        let mut host = RoomHost::new("solo".to_string(), ArenaBounds::default());
        host.handle_message(r#"{"type":"spawn_dice","dice":[{"id":"d1","diceType":"d6"}]}"#);
        let out = host.drain_json();
        assert_eq!(out.len(), 1);
        assert!(out[0].contains("NOT_JOINED"));
    }

    #[test]
    fn invalid_color_join_is_rejected() {
        let mut host = RoomHost::new("solo".to_string(), ArenaBounds::default());
        host.handle_message(r#"{"type":"join","roomId":"solo","displayName":"Solo","color":"purple"}"#);
        let out = host.drain_json();
        assert!(out[0].contains("INVALID_COLOR"));
    }

    #[test]
    fn spawn_emits_dice_spawned() {
        let mut host = RoomHost::new("solo".to_string(), ArenaBounds::default());
        let _ = join(&mut host);
        host.handle_message(r#"{"type":"spawn_dice","dice":[{"id":"d1","diceType":"d6"}]}"#);
        let out = host.drain_json();
        assert_eq!(out.len(), 1);
        assert!(out[0].contains("\"type\":\"dice_spawned\""));
        assert!(out[0].contains("\"d1\""));
    }

    #[test]
    fn idle_tick_is_a_noop() {
        let mut host = RoomHost::new("solo".to_string(), ArenaBounds::default());
        let _ = join(&mut host);
        assert!(!host.is_simulating());
        host.tick(16.667);
        assert!(host.drain_json().is_empty());
    }

    #[test]
    fn roll_drives_ticks_to_a_settled_face() {
        let mut host = RoomHost::new("solo".to_string(), ArenaBounds::default());
        let _ = join(&mut host);
        host.handle_message(r#"{"type":"spawn_dice","dice":[{"id":"d1","diceType":"d6"}]}"#);
        let _ = host.drain_json();

        host.handle_message(r#"{"type":"roll"}"#);
        let roll_out = host.drain_json();
        assert!(roll_out.iter().any(|m| m.contains("\"type\":\"roll_started\"")));
        assert!(host.is_simulating(), "a roll must start the simulation");

        // Drive the fixed-step loop long enough for the die to settle
        // (rest detection needs ~30 consecutive at-rest ticks).
        let mut settled = false;
        let mut roll_complete = false;
        for _ in 0..2000 {
            host.tick(16.667);
            for m in host.drain_json() {
                if m.contains("\"type\":\"die_settled\"") {
                    settled = true;
                }
                if m.contains("\"type\":\"roll_complete\"") {
                    roll_complete = true;
                }
            }
            if settled && roll_complete {
                break;
            }
        }
        assert!(settled, "die must emit die_settled with an authoritative face");
        assert!(roll_complete, "a completed solo roll must emit roll_complete");
        assert!(!host.is_simulating(), "simulation stops once dice are at rest");
    }

    #[test]
    fn double_join_is_rejected() {
        let mut host = RoomHost::new("solo".to_string(), ArenaBounds::default());
        let _ = join(&mut host);
        let out = join(&mut host);
        assert!(out[0].contains("ALREADY_JOINED"));
    }
}
