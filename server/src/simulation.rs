//! The tokio-driven physics tick loop.
//!
//! This is the runtime host for `dicesuki_core::room::Room`: it owns the wall
//! clock (`tokio::time::sleep`), the async lock (`Arc<RwLock<Room>>`), and the
//! task spawn. All game logic lives in core; this module only drives it and
//! fans out the broadcasts core produces. A future wasm room worker (issue #113)
//! is the equivalent host for the same `Room`, driven by a `postMessage` timer.

use crate::messages::ServerMessage;
use crate::roll_reporting::RollReporter;
use crate::room::Room;
use crate::room_manager::SharedRoom;

/// Check if the simulation loop needs to start, and start it if so.
/// Must be called while holding the room lock.
pub fn maybe_start_simulation(room_guard: &mut Room, room: SharedRoom, reporter: RollReporter) {
    if room_guard.is_simulating && !room_guard.is_sim_running {
        room_guard.is_sim_running = true;
        start_simulation_loop(room, reporter);
    }
}

/// Start the physics simulation loop for a room.
/// Runs at 60Hz, broadcasts snapshots at 60Hz, detects settlements.
pub fn start_simulation_loop(room: SharedRoom, reporter: RollReporter) {
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

            // Consume only explicit `Roll` lifecycles. Core removes each pending
            // generation as it completes, so later knocks/re-settles cannot
            // rebroadcast the same result and spawn/drag/motion-only activity has
            // no completion to consume.
            let completed_rolls = room_guard.take_completed_rolls();
            for completed in &completed_rolls {
                room_guard.broadcast(&ServerMessage::RollComplete {
                    player_id: completed.player_id.clone(),
                    results: completed.results.clone(),
                    total: completed.total,
                });
            }

            // Queueing may apply backpressure, so it must happen after releasing
            // the room lock. The immutable completion owns the initiation user,
            // generation, and results needed for stable retries.
            let room_id = room_guard.id.clone();
            drop(room_guard);
            for completed in completed_rolls {
                reporter
                    .enqueue_completion(room_id.clone(), completed)
                    .await;
            }
        }
    });
}
