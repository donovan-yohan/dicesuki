//! The tokio-driven physics tick loop.
//!
//! This is the runtime host for `dicesuki_core::room::Room`: it owns the wall
//! clock (`tokio::time::sleep`), the async lock (`Arc<RwLock<Room>>`), and the
//! task spawn. All game logic lives in core; this module only drives it and
//! fans out the broadcasts core produces. A future wasm room worker (issue #113)
//! is the equivalent host for the same `Room`, driven by a `postMessage` timer.

use crate::messages::ServerMessage;
use crate::room::Room;
use crate::room_manager::SharedRoom;

/// Check if the simulation loop needs to start, and start it if so.
/// Must be called while holding the room lock.
pub fn maybe_start_simulation(room_guard: &mut Room, room: SharedRoom) {
    if room_guard.is_simulating && !room_guard.is_sim_running {
        room_guard.is_sim_running = true;
        start_simulation_loop(room);
    }
}

/// Start the physics simulation loop for a room.
/// Runs at 60Hz, broadcasts snapshots at 60Hz, detects settlements.
pub fn start_simulation_loop(room: SharedRoom) {
    tokio::spawn(async move {
        let tick_duration = std::time::Duration::from_micros(16_667); // ~60Hz

        loop {
            tokio::time::sleep(tick_duration).await;

            let mut room_guard = room.write().await;

            if !room_guard.is_simulating {
                room_guard.is_sim_running = false;
                break;
            }

            let (snapshot, newly_settled, knocked) = room_guard.physics_tick();

            // Broadcast physics snapshot
            if let Some(snap) = snapshot {
                room_guard.broadcast(&snap);
            }

            // Broadcast a collision signal for each settled die knocked back into
            // motion this tick, so clients can fire haptics/SFX at the impact site.
            for (dice_id, impact_speed) in &knocked {
                if let Some(die) = room_guard.dice.get(dice_id) {
                    room_guard.broadcast(&ServerMessage::DiceKnocked {
                        dice_id: dice_id.clone(),
                        position: die.position,
                        impact_speed: *impact_speed,
                    });
                }
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
