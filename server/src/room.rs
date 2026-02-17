use std::collections::HashMap;
use std::time::Instant;
use rapier3d::prelude::RigidBodyHandle;
use crate::messages::*;
use crate::player::Player;
use crate::physics::{
    PhysicsWorld, REST_DURATION_MS, MAX_DICE_VELOCITY,
    DRAG_FOLLOW_SPEED, DRAG_DISTANCE_BOOST, DRAG_DISTANCE_THRESHOLD,
    DRAG_ROLL_FACTOR, DRAG_SPIN_FACTOR,
    THROW_VELOCITY_SCALE, THROW_UPWARD_BOOST, MIN_THROW_SPEED, MAX_THROW_SPEED,
};
use crate::dice::{create_dice_body, generate_roll_impulse, generate_roll_torque, generate_spawn_position};
use crate::face_detection::detect_face_value;

pub const MAX_PLAYERS: usize = 8;
pub const MAX_DICE: usize = 30;
pub const IDLE_TIMEOUT_SECS: u64 = 1800; // 30 minutes
pub const SNAPSHOT_DIVISOR: u64 = 1; // 1 = every tick (60Hz), 2 = 30Hz, 3 = 20Hz

pub struct DragState {
    pub dragger_id: String,
    pub grab_offset: [f32; 3],
    pub target_position: [f32; 3],
    pub last_target_position: [f32; 3],
}

pub struct ServerDie {
    pub id: String,
    pub owner_id: String,
    pub dice_type: DiceType,
    pub position: [f32; 3],
    pub rotation: [f32; 4], // quaternion [x, y, z, w]
    pub is_rolling: bool,
    pub face_value: Option<u32>,
    pub body_handle: Option<RigidBodyHandle>,
    pub rest_start_tick: Option<u64>,
    pub drag_state: Option<DragState>,
    pub last_snapshot_position: [f32; 3],
}

pub struct Room {
    pub id: String,
    pub players: HashMap<String, Player>,
    pub dice: HashMap<String, ServerDie>,
    pub last_activity: Instant,
    pub is_simulating: bool,
    pub is_sim_running: bool,
    pub tick_count: u64,
    pub physics: PhysicsWorld,
}

impl Room {
    pub fn new(id: String) -> Self {
        Self {
            id,
            players: HashMap::new(),
            dice: HashMap::new(),
            last_activity: Instant::now(),
            is_simulating: false,
            is_sim_running: false,
            tick_count: 0,
            physics: PhysicsWorld::new(),
        }
    }

    pub fn player_count(&self) -> usize {
        self.players.len()
    }

    pub fn dice_count(&self) -> usize {
        self.dice.len()
    }

    pub fn is_full(&self) -> bool {
        self.players.len() >= MAX_PLAYERS
    }

    pub fn is_empty(&self) -> bool {
        self.players.is_empty()
    }

    pub fn is_idle_expired(&self) -> bool {
        self.is_empty()
            && self.last_activity.elapsed().as_secs() > IDLE_TIMEOUT_SECS
    }

    pub fn touch(&mut self) {
        self.last_activity = Instant::now();
    }

    /// Add a player to the room. Returns error string if room is full or name too long.
    pub fn add_player(&mut self, player: Player) -> Result<(), String> {
        if self.is_full() {
            return Err("ROOM_FULL".to_string());
        }
        if player.display_name.is_empty() || player.display_name.len() > 20 {
            return Err("INVALID_NAME".to_string());
        }
        self.touch();
        self.players.insert(player.id.clone(), player);
        Ok(())
    }

    /// Remove a player and all their dice. Returns the removed dice IDs.
    pub fn remove_player(&mut self, player_id: &str) -> Vec<String> {
        self.players.remove(player_id);
        let removed_dice_ids: Vec<String> = self.dice.iter()
            .filter(|(_, d)| d.owner_id == player_id)
            .map(|(id, _)| id.clone())
            .collect();
        for id in &removed_dice_ids {
            self.dice.remove(id);
        }
        self.touch();
        removed_dice_ids
    }

    /// Remove specific dice. Returns IDs that were actually removed.
    pub fn remove_dice(&mut self, player_id: &str, dice_ids: &[String]) -> Vec<String> {
        let mut removed = Vec::new();
        for id in dice_ids {
            if let Some(die) = self.dice.get(id) {
                if die.owner_id == player_id {
                    self.dice.remove(id);
                    removed.push(id.clone());
                }
            }
        }
        // Clean up player's dice_ids list
        if let Some(player) = self.players.get_mut(player_id) {
            player.dice_ids.retain(|id| !removed.contains(id));
        }
        self.touch();
        removed
    }

    /// Broadcast a message to all players in the room
    pub fn broadcast(&self, msg: &ServerMessage) {
        for player in self.players.values() {
            player.send(msg);
        }
    }

    /// Broadcast a message to all players except one
    pub fn broadcast_except(&self, msg: &ServerMessage, exclude_id: &str) {
        for player in self.players.values() {
            if player.id != exclude_id {
                player.send(msg);
            }
        }
    }

    /// Spawn dice with physics bodies
    pub fn spawn_dice_with_physics(&mut self, owner_id: &str, entries: Vec<(String, DiceType)>) -> Result<Vec<DiceState>, String> {
        if self.dice.len() + entries.len() > MAX_DICE {
            return Err("DICE_LIMIT".to_string());
        }
        if !self.players.contains_key(owner_id) {
            return Err("PLAYER_NOT_FOUND".to_string());
        }

        let mut spawned = Vec::new();
        for (id, dice_type) in entries {
            let position = generate_spawn_position();
            let body_handle = create_dice_body(
                dice_type,
                position,
                &mut self.physics.rigid_body_set,
                &mut self.physics.collider_set,
            );
            let rotation = self.physics.get_rotation(body_handle).unwrap_or([0.0, 0.0, 0.0, 1.0]);

            let die = ServerDie {
                id: id.clone(),
                owner_id: owner_id.to_string(),
                dice_type,
                position,
                rotation,
                is_rolling: false,
                face_value: None,
                body_handle: Some(body_handle),
                rest_start_tick: None,
                drag_state: None,
                last_snapshot_position: position,
            };
            spawned.push(DiceState {
                id: id.clone(),
                owner_id: owner_id.to_string(),
                dice_type,
                position,
                rotation,
            });
            if let Some(player) = self.players.get_mut(owner_id) {
                player.dice_ids.push(id.clone());
            }
            self.dice.insert(id, die);
        }

        self.touch();
        Ok(spawned)
    }

    /// Apply roll impulse to all of a player's dice
    pub fn roll_player_dice(&mut self, player_id: &str) -> Vec<String> {
        let dice_ids: Vec<String> = self.dice.iter()
            .filter(|(_, d)| d.owner_id == player_id)
            .map(|(id, _)| id.clone())
            .collect();

        for dice_id in &dice_ids {
            if let Some(die) = self.dice.get_mut(dice_id) {
                if let Some(handle) = die.body_handle {
                    if let Some(rb) = self.physics.rigid_body_set.get_mut(handle) {
                        let impulse = generate_roll_impulse();
                        let torque = generate_roll_torque();
                        rb.apply_impulse(impulse, true);
                        rb.apply_torque_impulse(torque, true);
                    }
                    die.is_rolling = true;
                    die.face_value = None;
                    die.rest_start_tick = None;
                }
            }
        }

        self.is_simulating = true;
        self.touch();
        dice_ids
    }

    /// Step physics and check for settled dice.
    /// Returns (snapshot, newly_settled_dice) tuple.
    pub fn physics_tick(&mut self) -> (Option<ServerMessage>, Vec<(String, u32)>) {
        // 1. Apply drag forces to dice being dragged (before stepping physics)
        let dragged_ids: Vec<String> = self.dice.iter()
            .filter(|(_, d)| d.drag_state.is_some() && d.body_handle.is_some())
            .map(|(id, _)| id.clone())
            .collect();

        for die_id in &dragged_ids {
            let die = &self.dice[die_id];
            let handle = die.body_handle.unwrap();
            let drag = die.drag_state.as_ref().unwrap();
            let target = drag.target_position;
            let last = drag.last_target_position;

            if let Some(rb) = self.physics.rigid_body_set.get_mut(handle) {
                let pos = rb.translation();
                let current = [pos.x, pos.y, pos.z];

                // Displacement to target
                let dx = target[0] - current[0];
                let dy = target[1] - current[1];
                let dz = target[2] - current[2];
                let distance = (dx * dx + dy * dy + dz * dz).sqrt();

                // Speed multiplier with distance boost (matching client)
                let speed_mult = if distance > DRAG_DISTANCE_THRESHOLD {
                    let factor = ((distance - DRAG_DISTANCE_THRESHOLD) / DRAG_DISTANCE_THRESHOLD).min(1.0);
                    DRAG_FOLLOW_SPEED + DRAG_DISTANCE_BOOST * factor
                } else {
                    DRAG_FOLLOW_SPEED
                };

                // Set linear velocity toward target
                let vx = dx * speed_mult;
                let vy = dy * speed_mult;
                let vz = dz * speed_mult;
                rb.set_linvel(rapier3d::prelude::vector![vx, vy, vz], true);

                // Apply rotational torque based on movement direction
                let move_dx = target[0] - last[0];
                let move_dz = target[2] - last[2];
                let move_speed = (move_dx * move_dx + move_dz * move_dz).sqrt();

                if move_speed > 0.001 {
                    let dir_x = move_dx / move_speed;
                    let dir_z = move_dz / move_speed;

                    // Roll torque: perpendicular to movement (cross product with UP)
                    let roll_x = -dir_z * move_speed * DRAG_ROLL_FACTOR;
                    let roll_z = dir_x * move_speed * DRAG_ROLL_FACTOR;

                    // Spin torque: along movement direction
                    let spin_x = dir_x * move_speed * DRAG_SPIN_FACTOR;
                    let spin_z = dir_z * move_speed * DRAG_SPIN_FACTOR;

                    rb.apply_torque_impulse(
                        rapier3d::prelude::vector![roll_x + spin_x, 0.0, roll_z + spin_z],
                        true,
                    );
                }
            }
        }

        // 2. Step physics
        self.physics.step();
        self.tick_count += 1;

        // 3. Clamp dice velocity (matching client MAX_DICE_VELOCITY)
        for die in self.dice.values() {
            if let Some(handle) = die.body_handle {
                if let Some(rb) = self.physics.rigid_body_set.get_mut(handle) {
                    let vel = *rb.linvel();
                    let speed = vel.magnitude();
                    if speed > MAX_DICE_VELOCITY {
                        rb.set_linvel(vel * (MAX_DICE_VELOCITY / speed), true);
                    }
                }
            }
        }

        // Update positions from physics
        for die in self.dice.values_mut() {
            if let Some(handle) = die.body_handle {
                if let Some(pos) = self.physics.get_position(handle) {
                    die.position = pos;
                }
                if let Some(rot) = self.physics.get_rotation(handle) {
                    die.rotation = rot;
                }
            }
        }

        // Build snapshot based on SNAPSHOT_DIVISOR (1 = 60Hz, 2 = 30Hz, 3 = 20Hz)
        const POSITION_DELTA_THRESHOLD: f32 = 0.01; // 1cm movement threshold
        let snapshot = if self.tick_count % SNAPSHOT_DIVISOR == 0 {
            let dice_snapshots: Vec<DiceSnapshot> = self.dice.values()
                .filter(|d| {
                    d.is_rolling || d.drag_state.is_some() || {
                        let dx = d.position[0] - d.last_snapshot_position[0];
                        let dy = d.position[1] - d.last_snapshot_position[1];
                        let dz = d.position[2] - d.last_snapshot_position[2];
                        (dx * dx + dy * dy + dz * dz) > POSITION_DELTA_THRESHOLD * POSITION_DELTA_THRESHOLD
                    }
                })
                .map(|d| DiceSnapshot {
                    id: d.id.clone(),
                    position: d.position,
                    rotation: d.rotation,
                })
                .collect();

            // Update last_snapshot_position for included dice
            let included_ids: Vec<String> = dice_snapshots.iter().map(|s| s.id.clone()).collect();
            for id in &included_ids {
                if let Some(die) = self.dice.get_mut(id) {
                    die.last_snapshot_position = die.position;
                }
            }

            if !dice_snapshots.is_empty() {
                Some(ServerMessage::PhysicsSnapshot {
                    tick: self.tick_count,
                    dice: dice_snapshots,
                })
            } else {
                None
            }
        } else {
            None
        };

        // Check for newly settled dice
        let rest_ticks = (REST_DURATION_MS as f64 / (1000.0 / 60.0)) as u64; // ~30 ticks
        let mut newly_settled = Vec::new();

        let dice_ids: Vec<String> = self.dice.keys().cloned().collect();
        for dice_id in dice_ids {
            let (is_rolling, handle, rest_start, dice_type, rotation) = {
                let die = &self.dice[&dice_id];
                (die.is_rolling, die.body_handle, die.rest_start_tick, die.dice_type, die.rotation)
            };

            if !is_rolling {
                continue;
            }

            if let Some(handle) = handle {
                if self.physics.is_at_rest(handle) {
                    let die = self.dice.get_mut(&dice_id).unwrap();
                    match rest_start {
                        None => {
                            die.rest_start_tick = Some(self.tick_count);
                        }
                        Some(start) if self.tick_count - start >= rest_ticks => {
                            let face_value = detect_face_value(rotation, dice_type);
                            die.is_rolling = false;
                            die.face_value = Some(face_value);
                            newly_settled.push((dice_id.clone(), face_value));
                        }
                        _ => {}
                    }
                } else {
                    // Reset rest timer if dice starts moving again
                    let die = self.dice.get_mut(&dice_id).unwrap();
                    die.rest_start_tick = None;
                }
            }
        }

        // Check if all dice are settled (including dragged dice as active)
        let any_active = self.dice.values().any(|d| d.is_rolling || d.drag_state.is_some());
        if !any_active {
            self.is_simulating = false;
        }

        (snapshot, newly_settled)
    }

    /// Check if a full roll is complete for a player (all their dice settled)
    pub fn is_player_roll_complete(&self, player_id: &str) -> bool {
        self.dice.iter()
            .filter(|(_, d)| d.owner_id == player_id)
            .all(|(_, d)| !d.is_rolling)
    }

    /// Get roll results for a player
    pub fn get_player_results(&self, player_id: &str) -> (Vec<DieResult>, u32) {
        let results: Vec<DieResult> = self.dice.iter()
            .filter(|(_, d)| d.owner_id == player_id && d.face_value.is_some())
            .map(|(_, d)| DieResult {
                dice_id: d.id.clone(),
                dice_type: d.dice_type,
                face_value: d.face_value.unwrap(),
            })
            .collect();
        let total: u32 = results.iter().map(|r| r.face_value).sum();
        (results, total)
    }

    /// Start dragging a die. Only the owner can drag their own dice.
    pub fn start_drag(
        &mut self,
        player_id: &str,
        die_id: &str,
        grab_offset: [f32; 3],
        world_position: [f32; 3],
    ) -> Result<(), String> {
        // Validate ownership and drag state before mutating
        {
            let die = self.dice.get(die_id).ok_or("DIE_NOT_FOUND")?;
            if die.owner_id != player_id {
                return Err("NOT_OWNER".to_string());
            }
            if die.drag_state.is_some() {
                return Err("ALREADY_DRAGGED".to_string());
            }
        }

        let die = self.dice.get_mut(die_id).unwrap();
        die.drag_state = Some(DragState {
            dragger_id: player_id.to_string(),
            grab_offset,
            target_position: world_position,
            last_target_position: world_position,
        });
        // Clear rolling state — dragging takes precedence
        die.is_rolling = false;
        die.face_value = None;
        die.rest_start_tick = None;

        self.is_simulating = true;
        self.touch();
        Ok(())
    }

    /// Update drag target position
    pub fn update_drag(
        &mut self,
        player_id: &str,
        die_id: &str,
        world_position: [f32; 3],
    ) -> Result<(), String> {
        let die = self.dice.get_mut(die_id).ok_or("DIE_NOT_FOUND")?;
        match &mut die.drag_state {
            Some(drag) if drag.dragger_id == player_id => {
                drag.last_target_position = drag.target_position;
                drag.target_position = world_position;
                Ok(())
            }
            Some(_) => Err("NOT_DRAGGER".to_string()),
            None => Err("NOT_DRAGGING".to_string()),
        }
    }

    /// End drag, optionally apply throw velocity from velocity history
    pub fn end_drag(
        &mut self,
        player_id: &str,
        die_id: &str,
        velocity_history: &[VelocityHistoryEntry],
    ) {
        let Some(die) = self.dice.get_mut(die_id) else { return };
        let Some(drag) = &die.drag_state else { return };
        if drag.dragger_id != player_id {
            return;
        }

        die.drag_state = None;
        die.is_rolling = true;
        die.face_value = None;
        die.rest_start_tick = None;

        // Calculate and apply throw velocity
        if let Some(handle) = die.body_handle {
            if let Some(throw_vel) = calculate_throw_velocity(velocity_history) {
                if let Some(rb) = self.physics.rigid_body_set.get_mut(handle) {
                    rb.set_linvel(
                        rapier3d::prelude::vector![throw_vel[0], throw_vel[1], throw_vel[2]],
                        true,
                    );
                    // Dampen angular velocity (same 0.75 factor as client)
                    let ang = *rb.angvel();
                    rb.set_angvel(ang * 0.75, true);
                }
            }
        }

        self.touch();
    }

    /// Build a full room state snapshot (sent to newly joined players)
    pub fn build_room_state(&self) -> ServerMessage {
        ServerMessage::RoomState {
            room_id: self.id.clone(),
            players: self.players.values().map(|p| p.to_info()).collect(),
            dice: self.dice.values().map(|d| DiceState {
                id: d.id.clone(),
                owner_id: d.owner_id.clone(),
                dice_type: d.dice_type,
                position: d.position,
                rotation: d.rotation,
            }).collect(),
        }
    }
}

fn calculate_throw_velocity(history: &[VelocityHistoryEntry]) -> Option<[f32; 3]> {
    if history.len() < 2 {
        return None;
    }

    // Use last 3 entries
    let start = if history.len() > 3 { history.len() - 3 } else { 0 };
    let recent = &history[start..];

    let mut velocities: Vec<[f32; 3]> = Vec::new();
    for i in 1..recent.len() {
        let dt = (recent[i].time - recent[i - 1].time) / 1000.0; // ms to seconds
        if dt > 0.0 {
            let vx = (recent[i].position[0] - recent[i - 1].position[0]) / dt;
            let vy = (recent[i].position[1] - recent[i - 1].position[1]) / dt;
            let vz = (recent[i].position[2] - recent[i - 1].position[2]) / dt;
            velocities.push([vx, vy, vz]);
        }
    }

    if velocities.is_empty() {
        return None;
    }

    // Average
    let n = velocities.len() as f32;
    let mut avg = [0.0f32; 3];
    for v in &velocities {
        avg[0] += v[0] / n;
        avg[1] += v[1] / n;
        avg[2] += v[2] / n;
    }

    let speed = (avg[0] * avg[0] + avg[1] * avg[1] + avg[2] * avg[2]).sqrt();
    if speed < MIN_THROW_SPEED {
        return None;
    }

    // Scale and clamp
    let clamped_speed = (speed * THROW_VELOCITY_SCALE).min(MAX_THROW_SPEED);
    let scale = clamped_speed / speed;
    avg[0] *= scale;
    avg[1] *= scale;
    avg[2] *= scale;

    // Add upward boost
    avg[1] += THROW_UPWARD_BOOST;

    Some(avg)
}

#[cfg(test)]
impl Room {
    /// Check if dice limit is reached (test-only helper)
    pub fn is_dice_full(&self) -> bool {
        self.dice.len() >= MAX_DICE
    }

    /// Spawn dice without physics bodies (test-only helper).
    /// Production code uses `spawn_dice_with_physics()` instead.
    pub fn spawn_dice(&mut self, owner_id: &str, entries: Vec<(String, DiceType)>) -> Result<Vec<DiceState>, String> {
        if self.dice.len() + entries.len() > MAX_DICE {
            return Err("DICE_LIMIT".to_string());
        }
        if !self.players.contains_key(owner_id) {
            return Err("PLAYER_NOT_FOUND".to_string());
        }

        let mut spawned = Vec::new();
        for (id, dice_type) in entries {
            let position = [0.0, 2.0, 0.0];
            let rotation = [0.0, 0.0, 0.0, 1.0];
            let die = ServerDie {
                id: id.clone(),
                owner_id: owner_id.to_string(),
                dice_type,
                position,
                rotation,
                is_rolling: false,
                face_value: None,
                body_handle: None,
                rest_start_tick: None,
                drag_state: None,
                last_snapshot_position: position,
            };
            spawned.push(DiceState {
                id: id.clone(),
                owner_id: owner_id.to_string(),
                dice_type,
                position,
                rotation,
            });
            self.dice.insert(id, die);
        }

        if let Some(player) = self.players.get_mut(owner_id) {
            for d in &spawned {
                player.dice_ids.push(d.id.clone());
            }
        }

        self.touch();
        Ok(spawned)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use tokio::sync::mpsc;

    fn make_player(id: &str, name: &str) -> Player {
        let (tx, _rx) = mpsc::unbounded_channel();
        Player::new(id.to_string(), name.to_string(), "#FFF".to_string(), tx)
    }

    #[test]
    fn test_room_creation() {
        let room = Room::new("test".to_string());
        assert_eq!(room.id, "test");
        assert!(room.is_empty());
        assert!(!room.is_full());
        assert_eq!(room.player_count(), 0);
        assert_eq!(room.dice_count(), 0);
    }

    #[test]
    fn test_add_player() {
        let mut room = Room::new("test".to_string());
        let player = make_player("p1", "Gandalf");
        assert!(room.add_player(player).is_ok());
        assert_eq!(room.player_count(), 1);
        assert!(!room.is_empty());
    }

    #[test]
    fn test_room_full() {
        let mut room = Room::new("test".to_string());
        for i in 0..MAX_PLAYERS {
            let player = make_player(&format!("p{i}"), &format!("Player{i}"));
            assert!(room.add_player(player).is_ok());
        }
        assert!(room.is_full());
        let extra = make_player("extra", "Extra");
        assert_eq!(room.add_player(extra).unwrap_err(), "ROOM_FULL");
    }

    #[test]
    fn test_invalid_name() {
        let mut room = Room::new("test".to_string());
        let player = make_player("p1", "");
        assert_eq!(room.add_player(player).unwrap_err(), "INVALID_NAME");

        let long_name = "A".repeat(21);
        let player = make_player("p2", &long_name);
        assert_eq!(room.add_player(player).unwrap_err(), "INVALID_NAME");
    }

    #[test]
    fn test_remove_player_removes_dice() {
        let mut room = Room::new("test".to_string());
        let player = make_player("p1", "Gandalf");
        room.add_player(player).unwrap();
        room.spawn_dice("p1", vec![
            ("d1".to_string(), DiceType::D20),
            ("d2".to_string(), DiceType::D6),
        ]).unwrap();
        assert_eq!(room.dice_count(), 2);

        let removed = room.remove_player("p1");
        assert_eq!(removed.len(), 2);
        assert_eq!(room.dice_count(), 0);
        assert!(room.is_empty());
    }

    #[test]
    fn test_spawn_dice() {
        let mut room = Room::new("test".to_string());
        let player = make_player("p1", "Gandalf");
        room.add_player(player).unwrap();

        let result = room.spawn_dice("p1", vec![
            ("d1".to_string(), DiceType::D20),
        ]);
        assert!(result.is_ok());
        assert_eq!(room.dice_count(), 1);
    }

    #[test]
    fn test_dice_limit() {
        let mut room = Room::new("test".to_string());
        let player = make_player("p1", "Gandalf");
        room.add_player(player).unwrap();

        let many_dice: Vec<(String, DiceType)> = (0..MAX_DICE)
            .map(|i| (format!("d{i}"), DiceType::D6))
            .collect();
        assert!(room.spawn_dice("p1", many_dice).is_ok());
        assert!(room.is_dice_full());

        let one_more = vec![("extra".to_string(), DiceType::D6)];
        assert_eq!(room.spawn_dice("p1", one_more).unwrap_err(), "DICE_LIMIT");
    }

    #[test]
    fn test_remove_dice_only_own() {
        let mut room = Room::new("test".to_string());
        let p1 = make_player("p1", "Gandalf");
        let p2 = make_player("p2", "Frodo");
        room.add_player(p1).unwrap();
        room.add_player(p2).unwrap();
        room.spawn_dice("p1", vec![("d1".to_string(), DiceType::D20)]).unwrap();
        room.spawn_dice("p2", vec![("d2".to_string(), DiceType::D6)]).unwrap();

        // p2 tries to remove p1's die — should fail silently
        let removed = room.remove_dice("p2", &["d1".to_string()]);
        assert!(removed.is_empty());
        assert_eq!(room.dice_count(), 2);

        // p1 removes own die — should succeed
        let removed = room.remove_dice("p1", &["d1".to_string()]);
        assert_eq!(removed.len(), 1);
        assert_eq!(room.dice_count(), 1);
    }

    #[test]
    fn test_broadcast() {
        let mut room = Room::new("test".to_string());
        let (tx1, mut rx1) = mpsc::unbounded_channel();
        let (tx2, mut rx2) = mpsc::unbounded_channel();

        let p1 = Player::new("p1".to_string(), "A".to_string(), "#F00".to_string(), tx1);
        let p2 = Player::new("p2".to_string(), "B".to_string(), "#0F0".to_string(), tx2);
        room.add_player(p1).unwrap();
        room.add_player(p2).unwrap();

        let msg = ServerMessage::Error {
            code: "TEST".to_string(),
            message: "test".to_string(),
        };
        room.broadcast(&msg);

        assert!(rx1.try_recv().is_ok());
        assert!(rx2.try_recv().is_ok());
    }

    #[test]
    fn test_broadcast_except() {
        let mut room = Room::new("test".to_string());
        let (tx1, mut rx1) = mpsc::unbounded_channel();
        let (tx2, mut rx2) = mpsc::unbounded_channel();

        let p1 = Player::new("p1".to_string(), "A".to_string(), "#F00".to_string(), tx1);
        let p2 = Player::new("p2".to_string(), "B".to_string(), "#0F0".to_string(), tx2);
        room.add_player(p1).unwrap();
        room.add_player(p2).unwrap();

        let msg = ServerMessage::Error {
            code: "TEST".to_string(),
            message: "test".to_string(),
        };
        room.broadcast_except(&msg, "p1");

        assert!(rx1.try_recv().is_err()); // p1 should NOT receive
        assert!(rx2.try_recv().is_ok());  // p2 should receive
    }

    #[test]
    fn test_spawn_dice_with_physics() {
        let mut room = Room::new("test".to_string());
        let player = make_player("p1", "Gandalf");
        room.add_player(player).unwrap();

        let result = room.spawn_dice_with_physics("p1", vec![
            ("d1".to_string(), DiceType::D6),
        ]);
        assert!(result.is_ok());
        assert_eq!(room.dice_count(), 1);
        assert!(room.dice.get("d1").unwrap().body_handle.is_some());
    }

    #[test]
    fn test_roll_marks_dice_as_rolling() {
        let mut room = Room::new("test".to_string());
        let player = make_player("p1", "Gandalf");
        room.add_player(player).unwrap();
        room.spawn_dice_with_physics("p1", vec![("d1".to_string(), DiceType::D6)]).unwrap();

        let rolled = room.roll_player_dice("p1");
        assert_eq!(rolled.len(), 1);
        assert!(room.dice.get("d1").unwrap().is_rolling);
        assert!(room.is_simulating);
    }

    #[test]
    fn test_physics_tick_produces_snapshots() {
        let mut room = Room::new("test".to_string());
        let player = make_player("p1", "Gandalf");
        room.add_player(player).unwrap();
        room.spawn_dice_with_physics("p1", vec![("d1".to_string(), DiceType::D6)]).unwrap();
        room.roll_player_dice("p1");

        // With SNAPSHOT_DIVISOR=1, every tick should produce a snapshot
        let (snap1, _) = room.physics_tick();
        assert!(snap1.is_some(), "Every tick should produce a snapshot with divisor=1");
    }

    #[test]
    fn test_dice_eventually_settle() {
        let mut room = Room::new("test".to_string());
        let player = make_player("p1", "Test");
        room.add_player(player).unwrap();
        room.spawn_dice_with_physics("p1", vec![("d1".to_string(), DiceType::D6)]).unwrap();
        room.roll_player_dice("p1");

        // Run simulation for up to 20 seconds (1200 ticks)
        // Narrower 9:16 arena causes more wall bounces, needs more settling time
        let mut settled = false;
        for _ in 0..1200 {
            let (_, newly_settled) = room.physics_tick();
            if !newly_settled.is_empty() {
                settled = true;
                break;
            }
        }

        assert!(settled, "Dice should settle within 20 seconds");
        assert!(!room.is_simulating, "Room should stop simulating after all dice settle");

        let die = room.dice.get("d1").unwrap();
        assert!(die.face_value.is_some(), "Settled die should have a face value");
        let value = die.face_value.unwrap();
        assert!(value >= 1 && value <= 6, "D6 should show 1-6, got {}", value);
    }

    #[test]
    fn test_start_drag_own_die() {
        let mut room = Room::new("test".to_string());
        let player = make_player("p1", "Gandalf");
        room.add_player(player).unwrap();
        room.spawn_dice("p1", vec![("d1".to_string(), DiceType::D6)]).unwrap();

        let result = room.start_drag("p1", "d1", [0.1, 0.0, -0.2], [1.0, 2.0, 3.0]);
        assert!(result.is_ok());
        assert!(room.dice.get("d1").unwrap().drag_state.is_some());
    }

    #[test]
    fn test_cannot_drag_other_players_die() {
        let mut room = Room::new("test".to_string());
        room.add_player(make_player("p1", "Gandalf")).unwrap();
        room.add_player(make_player("p2", "Frodo")).unwrap();
        room.spawn_dice("p1", vec![("d1".to_string(), DiceType::D6)]).unwrap();

        let result = room.start_drag("p2", "d1", [0.0; 3], [0.0; 3]);
        assert!(result.is_err());
        assert_eq!(result.unwrap_err(), "NOT_OWNER");
    }

    #[test]
    fn test_cannot_drag_already_dragged_die() {
        let mut room = Room::new("test".to_string());
        room.add_player(make_player("p1", "Gandalf")).unwrap();
        room.spawn_dice("p1", vec![("d1".to_string(), DiceType::D6)]).unwrap();

        room.start_drag("p1", "d1", [0.0; 3], [0.0; 3]).unwrap();
        let result = room.start_drag("p1", "d1", [0.0; 3], [0.0; 3]);
        assert!(result.is_err());
        assert_eq!(result.unwrap_err(), "ALREADY_DRAGGED");
    }

    #[test]
    fn test_update_drag_target() {
        let mut room = Room::new("test".to_string());
        room.add_player(make_player("p1", "Gandalf")).unwrap();
        room.spawn_dice("p1", vec![("d1".to_string(), DiceType::D6)]).unwrap();
        room.start_drag("p1", "d1", [0.0; 3], [1.0, 2.0, 3.0]).unwrap();

        let result = room.update_drag("p1", "d1", [2.0, 2.0, 4.0]);
        assert!(result.is_ok());
        let drag = room.dice.get("d1").unwrap().drag_state.as_ref().unwrap();
        assert_eq!(drag.target_position, [2.0, 2.0, 4.0]);
    }

    #[test]
    fn test_end_drag_clears_state() {
        let mut room = Room::new("test".to_string());
        room.add_player(make_player("p1", "Gandalf")).unwrap();
        room.spawn_dice("p1", vec![("d1".to_string(), DiceType::D6)]).unwrap();
        room.start_drag("p1", "d1", [0.0; 3], [0.0; 3]).unwrap();

        room.end_drag("p1", "d1", &[]);
        assert!(room.dice.get("d1").unwrap().drag_state.is_none());
    }

    #[test]
    fn test_settled_die_included_in_snapshot_after_displacement() {
        let mut room = Room::new("test".to_string());
        let p1 = make_player("p1", "Alice");
        let p2 = make_player("p2", "Bob");
        room.add_player(p1).unwrap();
        room.add_player(p2).unwrap();

        // Spawn p2's die with physics (starts settled)
        room.spawn_dice_with_physics("p2", vec![("d2".to_string(), DiceType::D6)]).unwrap();

        // Manually apply velocity to d2's rigid body to simulate collision displacement
        if let Some(handle) = room.dice.get("d2").unwrap().body_handle {
            if let Some(rb) = room.physics.rigid_body_set.get_mut(handle) {
                rb.set_linvel(rapier3d::prelude::vector![5.0, 0.0, 0.0], true);
            }
        }

        // Step physics so position updates
        let (snapshot, _) = room.physics_tick();

        // d2 should be in the snapshot even though it's not rolling (it moved)
        assert!(snapshot.is_some(), "Snapshot should be generated for displaced die");
        if let Some(ServerMessage::PhysicsSnapshot { dice, .. }) = snapshot {
            let d2_in_snapshot = dice.iter().any(|d| d.id == "d2");
            assert!(d2_in_snapshot, "Displaced settled die should be in snapshot");
        }
    }

    #[test]
    fn test_drag_moves_die_toward_target() {
        let mut room = Room::new("test".to_string());
        room.add_player(make_player("p1", "Test")).unwrap();
        room.spawn_dice_with_physics("p1", vec![("d1".to_string(), DiceType::D6)]).unwrap();

        let initial_pos = room.dice.get("d1").unwrap().position;
        let target = [initial_pos[0] + 3.0, 2.0, initial_pos[2]];

        room.start_drag("p1", "d1", [0.0; 3], target).unwrap();

        // Run a few physics ticks
        for _ in 0..10 {
            room.physics_tick();
        }

        let new_pos = room.dice.get("d1").unwrap().position;
        // Die should have moved toward the target (X increased)
        assert!(new_pos[0] > initial_pos[0], "Die should move toward drag target");
    }
}
