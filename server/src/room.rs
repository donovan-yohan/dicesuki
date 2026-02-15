use std::collections::HashMap;
use std::time::Instant;
use rapier3d::prelude::RigidBodyHandle;
use crate::messages::*;
use crate::player::Player;
use crate::physics::{PhysicsWorld, REST_DURATION_MS};
use crate::dice::{create_dice_body, generate_roll_impulse, generate_roll_torque, generate_spawn_position};
use crate::face_detection::detect_face_value;

pub const MAX_PLAYERS: usize = 8;
pub const MAX_DICE: usize = 30;
pub const IDLE_TIMEOUT_SECS: u64 = 1800; // 30 minutes

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
        self.physics.step();
        self.tick_count += 1;

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

        // Build snapshot every 3rd tick (20Hz)
        let snapshot = if self.tick_count % 3 == 0 {
            let dice_snapshots: Vec<DiceSnapshot> = self.dice.values()
                .filter(|d| d.is_rolling)
                .map(|d| DiceSnapshot {
                    id: d.id.clone(),
                    position: d.position,
                    rotation: d.rotation,
                })
                .collect();

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

        // Check if all dice are settled
        let any_rolling = self.dice.values().any(|d| d.is_rolling);
        if !any_rolling {
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

        // Tick 3 times to get a snapshot (every 3rd tick)
        let (snap1, _) = room.physics_tick();
        let (snap2, _) = room.physics_tick();
        let (snap3, _) = room.physics_tick();

        assert!(snap1.is_none() || snap2.is_none()); // Not every tick
        assert!(snap3.is_some()); // 3rd tick should have snapshot
    }

    #[test]
    fn test_dice_eventually_settle() {
        let mut room = Room::new("test".to_string());
        let player = make_player("p1", "Test");
        room.add_player(player).unwrap();
        room.spawn_dice_with_physics("p1", vec![("d1".to_string(), DiceType::D6)]).unwrap();
        room.roll_player_dice("p1");

        // Run simulation for up to 10 seconds (600 ticks)
        let mut settled = false;
        for _ in 0..600 {
            let (_, newly_settled) = room.physics_tick();
            if !newly_settled.is_empty() {
                settled = true;
                break;
            }
        }

        assert!(settled, "Dice should settle within 10 seconds");
        assert!(!room.is_simulating, "Room should stop simulating after all dice settle");

        let die = room.dice.get("d1").unwrap();
        assert!(die.face_value.is_some(), "Settled die should have a face value");
        let value = die.face_value.unwrap();
        assert!(value >= 1 && value <= 6, "D6 should show 1-6, got {}", value);
    }
}
