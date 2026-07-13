use std::collections::{HashMap, HashSet};
use std::sync::Arc;
use std::time::Instant;
use rapier3d::prelude::RigidBodyHandle;
use tokio::sync::RwLock;
use crate::messages::{
    DicePresentationMetadata, DiceSnapshot, DiceState, DiceType, DieResult, RoomSettings,
    ServerMessage, SpawnDiceEntry, VelocityHistoryEntry,
};
use crate::player::Player;
use crate::physics::{
    PhysicsWorld, REST_DURATION_MS, MAX_DICE_VELOCITY,
    DRAG_FOLLOW_SPEED, DRAG_DISTANCE_BOOST, DRAG_DISTANCE_THRESHOLD,
    DRAG_ROLL_FACTOR, DRAG_SPIN_FACTOR,
    THROW_VELOCITY_SCALE, THROW_UPWARD_BOOST, MIN_THROW_SPEED, MAX_THROW_SPEED,
    ESCAPE_RESET_HALF_X, ESCAPE_RESET_HALF_Z, ESCAPE_RESET_MIN_Y, ESCAPE_RESET_MAX_Y,
};
use crate::dice::{create_dice_body, generate_roll_impulse, generate_roll_torque, generate_spawn_position};
use crate::face_detection::detect_face_value;
use log::warn;

/// A reference-counted, async-read/write-locked room handle.
pub type SharedRoom = Arc<RwLock<Room>>;

/// Typed error variants returned by Room methods.
/// Use `.code()` when the wire-protocol error code string is needed (e.g. sending to client).
#[derive(Debug, Clone, PartialEq)]
pub enum RoomError {
    RoomFull,
    InvalidName,
    DiceLimit,
    PlayerNotFound,
    DieNotFound,
    NotOwner,
    AlreadyDragged,
    NotDragger,
    NotDragging,
    DuplicateDiceId,
    DuplicateInventoryDie,
    NotHost,
}

impl RoomError {
    /// Returns the wire-protocol error code string for this error.
    /// These strings are sent to clients and must remain stable.
    #[must_use]
    pub fn code(&self) -> &'static str {
        match self {
            RoomError::RoomFull => "ROOM_FULL",
            RoomError::InvalidName => "INVALID_NAME",
            RoomError::DiceLimit => "DICE_LIMIT",
            RoomError::PlayerNotFound => "PLAYER_NOT_FOUND",
            RoomError::DieNotFound => "DIE_NOT_FOUND",
            RoomError::NotOwner => "NOT_OWNER",
            RoomError::AlreadyDragged => "ALREADY_DRAGGED",
            RoomError::NotDragger => "NOT_DRAGGER",
            RoomError::NotDragging => "NOT_DRAGGING",
            RoomError::DuplicateDiceId => "DUPLICATE_DICE_ID",
            RoomError::DuplicateInventoryDie => "DUPLICATE_INVENTORY_DIE",
            RoomError::NotHost => "NOT_HOST",
        }
    }
}

impl std::fmt::Display for RoomError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        let msg = match self {
            RoomError::RoomFull => "Room is full",
            RoomError::InvalidName => "Display name must be 1-20 characters",
            RoomError::DiceLimit => "Table is full (max 30 dice)",
            RoomError::PlayerNotFound => "Player not found",
            RoomError::DieNotFound => "Die not found",
            RoomError::NotOwner => "You don't own this die",
            RoomError::AlreadyDragged => "Die is already being dragged",
            RoomError::NotDragger => "You are not the one dragging this die",
            RoomError::NotDragging => "Die is not being dragged",
            RoomError::DuplicateDiceId => "Duplicate dice ID in spawn request",
            RoomError::DuplicateInventoryDie => "That inventory die is already on the table",
            RoomError::NotHost => "Only the host can change room settings",
        };
        write!(f, "{msg}")
    }
}

impl std::error::Error for RoomError {}

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
    pub presentation: Option<DicePresentationMetadata>,
    pub position: [f32; 3],
    pub rotation: [f32; 4], // quaternion [x, y, z, w]
    pub is_rolling: bool,
    pub face_value: Option<u32>,
    pub body_handle: Option<RigidBodyHandle>,
    pub rest_start_tick: Option<u64>,
    pub drag_state: Option<DragState>,
    pub last_snapshot_position: [f32; 3],
}

pub struct DiceSpawnRequest {
    pub id: String,
    pub dice_type: DiceType,
    pub presentation: Option<DicePresentationMetadata>,
}

impl From<SpawnDiceEntry> for DiceSpawnRequest {
    fn from(entry: SpawnDiceEntry) -> Self {
        Self {
            id: entry.id,
            dice_type: entry.dice_type,
            presentation: entry.presentation,
        }
    }
}

impl From<(String, DiceType)> for DiceSpawnRequest {
    fn from((id, dice_type): (String, DiceType)) -> Self {
        Self {
            id,
            dice_type,
            presentation: None,
        }
    }
}

fn is_outside_escape_bounds(position: [f32; 3]) -> bool {
    position[0].abs() > ESCAPE_RESET_HALF_X
        || position[2].abs() > ESCAPE_RESET_HALF_Z
        || position[1] < ESCAPE_RESET_MIN_Y
        || position[1] > ESCAPE_RESET_MAX_Y
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
    /// The current host (room creator, then oldest remaining player on transfer).
    /// `None` only when the room is empty.
    pub host_id: Option<String>,
    /// Host-controlled, versioned room settings (physics mode, theme, roller, ...).
    pub settings: RoomSettings,
    /// Monotonic counter used to assign `Player::join_order`.
    next_join_seq: u64,
}

impl Room {
    #[must_use]
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
            host_id: None,
            settings: RoomSettings::default(),
            next_join_seq: 0,
        }
    }

    /// Returns true if `player_id` is the current host of this room.
    #[must_use]
    pub fn is_host(&self, player_id: &str) -> bool {
        self.host_id.as_deref() == Some(player_id)
    }

    #[must_use]
    pub fn player_count(&self) -> usize {
        self.players.len()
    }

    #[must_use]
    pub fn dice_count(&self) -> usize {
        self.dice.len()
    }

    #[must_use]
    pub fn is_full(&self) -> bool {
        self.players.len() >= MAX_PLAYERS
    }

    #[must_use]
    pub fn is_empty(&self) -> bool {
        self.players.is_empty()
    }

    #[must_use]
    pub fn is_idle_expired(&self) -> bool {
        self.is_empty()
            && self.last_activity.elapsed().as_secs() > IDLE_TIMEOUT_SECS
    }

    pub fn touch(&mut self) {
        self.last_activity = Instant::now();
    }

    /// Add a player to the room. Returns error if room is full or name too long.
    ///
    /// # Errors
    ///
    /// Returns `Err(RoomError::RoomFull)` if the room is full, or `Err(RoomError::InvalidName)` if the name is invalid.
    pub fn add_player(&mut self, mut player: Player) -> Result<(), RoomError> {
        if self.is_full() {
            return Err(RoomError::RoomFull);
        }
        if player.display_name.is_empty() || player.display_name.len() > 20 {
            return Err(RoomError::InvalidName);
        }
        player.join_order = self.next_join_seq;
        self.next_join_seq += 1;
        // The first player to join is the room creator and becomes host.
        if self.host_id.is_none() {
            self.host_id = Some(player.id.clone());
        }
        self.touch();
        self.players.insert(player.id.clone(), player);
        Ok(())
    }

    /// Remove a player and all their dice. Returns the removed dice IDs.
    ///
    /// If the removed player was the host, host is transferred to the oldest
    /// remaining player (lowest `join_order`), or set to `None` if the room is
    /// now empty. Inspect `host_id` before and after to detect a transfer.
    pub fn remove_player(&mut self, player_id: &str) -> Vec<String> {
        self.players.remove(player_id);
        let removed_dice_ids: Vec<String> = self.dice.iter()
            .filter(|(_, d)| d.owner_id == player_id)
            .map(|(id, _)| id.clone())
            .collect();
        for id in &removed_dice_ids {
            if let Some(die) = self.dice.remove(id) {
                if let Some(handle) = die.body_handle {
                    self.physics.remove_body(handle);
                }
            }
        }
        // Transfer host if the departing player held it.
        if self.host_id.as_deref() == Some(player_id) {
            self.host_id = self.oldest_player_id();
        }
        self.touch();
        removed_dice_ids
    }

    /// Returns the id of the oldest remaining player (lowest `join_order`), or
    /// `None` if the room is empty.
    fn oldest_player_id(&self) -> Option<String> {
        self.players.values()
            .min_by_key(|p| p.join_order)
            .map(|p| p.id.clone())
    }

    /// Replace room settings. Only the current host may mutate settings.
    ///
    /// # Errors
    ///
    /// Returns `Err(RoomError::NotHost)` if `player_id` is not the host; room
    /// state is left unchanged in that case.
    pub fn update_settings(&mut self, player_id: &str, settings: RoomSettings) -> Result<(), RoomError> {
        if !self.is_host(player_id) {
            return Err(RoomError::NotHost);
        }
        self.settings = settings;
        self.touch();
        Ok(())
    }

    /// Remove specific dice. Returns IDs that were actually removed.
    pub fn remove_dice(&mut self, player_id: &str, dice_ids: &[String]) -> Vec<String> {
        let mut removed = Vec::new();
        for id in dice_ids {
            if let Some(die) = self.dice.get(id) {
                if die.owner_id == player_id {
                    let die = self.dice.remove(id).expect("die exists: just checked via get()");
                    if let Some(handle) = die.body_handle {
                        self.physics.remove_body(handle);
                    }
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
            let _ = player.send(msg);
        }
    }

    /// Broadcast a message to all players except one
    pub fn broadcast_except(&self, msg: &ServerMessage, exclude_id: &str) {
        for player in self.players.values() {
            if player.id != exclude_id {
                let _ = player.send(msg);
            }
        }
    }

    /// Spawn dice with physics bodies
    ///
    /// # Errors
    ///
    /// Returns `Err(RoomError::DiceLimit)` if max dice reached, or `Err(RoomError::PlayerNotFound)` if owner unknown.
    pub fn spawn_dice_with_physics<I, E>(&mut self, owner_id: &str, entries: I) -> Result<Vec<DiceState>, RoomError>
    where
        I: IntoIterator<Item = E>,
        E: Into<DiceSpawnRequest>,
    {
        let entries: Vec<DiceSpawnRequest> = entries.into_iter().map(Into::into).collect();
        if self.dice.len() + entries.len() > MAX_DICE {
            return Err(RoomError::DiceLimit);
        }
        if !self.players.contains_key(owner_id) {
            return Err(RoomError::PlayerNotFound);
        }
        self.validate_spawn_entries(owner_id, &entries)?;

        let mut spawned = Vec::new();
        for entry in entries {
            let position = generate_spawn_position();
            let body_handle = create_dice_body(entry.dice_type, position, &mut self.physics);
            let rotation = self.physics.get_rotation(body_handle).unwrap_or([0.0, 0.0, 0.0, 1.0]);

            let die = ServerDie {
                id: entry.id.clone(),
                owner_id: owner_id.to_string(),
                dice_type: entry.dice_type,
                presentation: entry.presentation.clone(),
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
                id: entry.id.clone(),
                owner_id: owner_id.to_string(),
                dice_type: entry.dice_type,
                position,
                rotation,
                presentation: entry.presentation,
            });
            if let Some(player) = self.players.get_mut(owner_id) {
                player.dice_ids.push(entry.id.clone());
            }
            self.dice.insert(entry.id, die);
        }

        self.touch();
        Ok(spawned)
    }

    fn validate_spawn_entries(&self, owner_id: &str, entries: &[DiceSpawnRequest]) -> Result<(), RoomError> {
        let mut request_ids = HashSet::new();
        let mut request_inventory_die_ids = HashSet::new();

        for entry in entries {
            if !request_ids.insert(entry.id.as_str()) || self.dice.contains_key(&entry.id) {
                return Err(RoomError::DuplicateDiceId);
            }

            let Some(inventory_die_id) = entry.presentation.as_ref()
                .and_then(|presentation| presentation.inventory_die_id.as_deref())
            else {
                continue;
            };

            if !request_inventory_die_ids.insert(inventory_die_id)
                || self.dice.values().any(|die| {
                    die.owner_id == owner_id
                        && die.presentation.as_ref()
                            .and_then(|presentation| presentation.inventory_die_id.as_deref())
                            == Some(inventory_die_id)
                })
            {
                return Err(RoomError::DuplicateInventoryDie);
            }
        }

        Ok(())
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
                    let impulse = generate_roll_impulse();
                    let torque = generate_roll_torque();
                    self.physics.apply_impulse(handle, [impulse.x, impulse.y, impulse.z]);
                    self.physics.apply_torque_impulse(handle, [torque.x, torque.y, torque.z]);
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
    /// Returns `(snapshot, newly_settled_dice)`. This is an ~20-line orchestrator;
    /// each phase is handled by a dedicated private helper.
    pub fn physics_tick(&mut self) -> (Option<ServerMessage>, Vec<(String, u32)>) {
        // 1. Apply drag forces to dice being dragged (before stepping physics)
        self.apply_drag_forces();

        // 2. Step physics
        self.physics.step();
        self.tick_count += 1;

        // 3. Clamp dice velocity (matching client MAX_DICE_VELOCITY)
        self.clamp_velocities();

        // 4. Recover any dice that escaped the arena despite colliders/velocity caps
        self.reset_escaped_dice();

        // 5. Update cached positions/rotations from physics
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

        // 6. Build snapshot (snapshots sent every tick at 60Hz)
        let snapshot = self.build_physics_snapshot();

        // 7. Check for newly settled dice
        let newly_settled = self.check_settled_dice();

        // Stop simulating if nothing is active
        let any_active = self.dice.values().any(|d| d.is_rolling || d.drag_state.is_some());
        if !any_active {
            self.is_simulating = false;
        }

        (snapshot, newly_settled)
    }

    /// Apply drag forces to all dice currently being dragged.
    /// Sets linear velocity toward the drag target and applies rotational torque.
    fn apply_drag_forces(&mut self) {
        let dragged_ids: Vec<String> = self.dice.iter()
            .filter(|(_, d)| d.drag_state.is_some() && d.body_handle.is_some())
            .map(|(id, _)| id.clone())
            .collect();

        for die_id in &dragged_ids {
            let die = &self.dice[die_id];
            let handle = die.body_handle.expect("body_handle is Some: filter on dragged_ids requires body_handle.is_some()");
            let drag = die.drag_state.as_ref().expect("drag_state is Some: filter on dragged_ids requires drag_state.is_some()");
            let target = drag.target_position;
            let last = drag.last_target_position;

            // Read current position via the PhysicsWorld API
            let current = match self.physics.get_position(handle) {
                Some(pos) => pos,
                None => {
                    warn!("Drag force: missing physics body for die {die_id}, skipping");
                    continue;
                }
            };

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
            self.physics.set_linear_velocity(handle, [dx * speed_mult, dy * speed_mult, dz * speed_mult]);

            // Apply rotational torque based on movement direction
            let delta_x = target[0] - last[0];
            let delta_z = target[2] - last[2];
            let move_speed = (delta_x * delta_x + delta_z * delta_z).sqrt();

            if move_speed > 0.001 {
                let dir_x = delta_x / move_speed;
                let dir_z = delta_z / move_speed;

                // Roll torque: perpendicular to movement (cross product with UP)
                let roll_x = -dir_z * move_speed * DRAG_ROLL_FACTOR;
                let roll_z = dir_x * move_speed * DRAG_ROLL_FACTOR;

                // Spin torque: along movement direction
                let spin_x = dir_x * move_speed * DRAG_SPIN_FACTOR;
                let spin_z = dir_z * move_speed * DRAG_SPIN_FACTOR;

                self.physics.apply_torque_impulse(handle, [roll_x + spin_x, 0.0, roll_z + spin_z]);
            }
        }
    }

    /// Clamp all dice linear velocities to `MAX_DICE_VELOCITY`.
    fn clamp_velocities(&mut self) {
        for die in self.dice.values() {
            if let Some(handle) = die.body_handle {
                self.physics.clamp_velocity(handle, MAX_DICE_VELOCITY);
            }
        }
    }

    /// Reset dice that tunnel far outside the arena back above the table.
    fn reset_escaped_dice(&mut self) {
        let escaped_ids: Vec<String> = self.dice.iter()
            .filter_map(|(id, die)| {
                let handle = die.body_handle?;
                let position = self.physics.get_position(handle)?;
                is_outside_escape_bounds(position).then(|| id.clone())
            })
            .collect();

        for die_id in escaped_ids {
            if let Some(die) = self.dice.get_mut(&die_id) {
                let Some(handle) = die.body_handle else { continue };
                let reset_position = generate_spawn_position();
                self.physics.reset_body_to_position(handle, reset_position);
                die.position = reset_position;
                die.rotation = [0.0, 0.0, 0.0, 1.0];
                die.face_value = None;
                die.rest_start_tick = None;
                die.drag_state = None;
                die.is_rolling = true;
                warn!("Reset escaped die {die_id} back into room {}", self.id);
            }
        }
    }

    /// Build a `PhysicsSnapshot` message for this tick.
    ///
    /// Includes dice that are rolling, being dragged, or have moved more than 1cm since the
    /// last snapshot. Updates `last_snapshot_position` for all included dice.
    /// Returns `None` if no dice qualify for the snapshot.
    fn build_physics_snapshot(&mut self) -> Option<ServerMessage> {
        // 1cm movement threshold for snapshot filtering
        const POSITION_DELTA_THRESHOLD: f32 = 0.01;

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

        if dice_snapshots.is_empty() {
            return None;
        }

        // Update last_snapshot_position for included dice
        let included_ids: Vec<String> = dice_snapshots.iter().map(|s| s.id.clone()).collect();
        for id in &included_ids {
            if let Some(die) = self.dice.get_mut(id) {
                die.last_snapshot_position = die.position;
            }
        }

        Some(ServerMessage::PhysicsSnapshot {
            tick: self.tick_count,
            dice: dice_snapshots,
        })
    }

    /// Check for newly settled dice (rolling dice at rest for `REST_DURATION_MS`).
    ///
    /// Updates `is_rolling`, `face_value`, and `rest_start_tick` in place.
    /// Returns a vec of `(dice_id, face_value)` for each die that settled this tick.
    ///
    /// # Panics
    ///
    /// Panics if a die disappears from `self.dice` between key collection and mutation
    /// (invariant violation — dice are only removed via `remove_player`/`remove_dice`).
    fn check_settled_dice(&mut self) -> Vec<(String, u32)> {
        // ~30 ticks; truncation and sign loss are expected here (REST_DURATION_MS > 0)
        #[allow(clippy::cast_possible_truncation, clippy::cast_sign_loss, clippy::cast_precision_loss)]
        let rest_ticks = (REST_DURATION_MS as f64 / (1000.0 / 60.0)) as u64;
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
                    let die = self.dice.get_mut(&dice_id).expect("die exists: dice_id was collected from self.dice.keys()");
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
                    let die = self.dice.get_mut(&dice_id).expect("die exists: dice_id was collected from self.dice.keys()");
                    die.rest_start_tick = None;
                }
            }
        }

        newly_settled
    }

    /// Check if the simulation loop needs to start, and start it if so.
    /// Must be called while holding the room lock.
    pub fn maybe_start_simulation(room_guard: &mut Room, room: SharedRoom) {
        if room_guard.is_simulating && !room_guard.is_sim_running {
            room_guard.is_sim_running = true;
            Room::start_simulation_loop(room);
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

    /// Check if a full roll is complete for a player (all their dice settled)
    #[must_use]
    pub fn is_player_roll_complete(&self, player_id: &str) -> bool {
        self.dice.iter()
            .filter(|(_, d)| d.owner_id == player_id)
            .all(|(_, d)| !d.is_rolling)
    }

    /// Get roll results for a player
    ///
    /// # Panics
    ///
    /// Panics if a die's `face_value` is `None` (invariant: only called after settlement).
    #[must_use]
    pub fn get_player_results(&self, player_id: &str) -> (Vec<DieResult>, u32) {
        let results: Vec<DieResult> = self.dice.iter()
            .filter(|(_, d)| d.owner_id == player_id && d.face_value.is_some())
            .map(|(_, d)| DieResult {
                dice_id: d.id.clone(),
                dice_type: d.dice_type,
                face_value: d.face_value.expect("face_value is Some: filter above requires face_value.is_some()"),
                presentation: d.presentation.clone(),
            })
            .collect();
        let total: u32 = results.iter().map(|r| r.face_value).sum();
        (results, total)
    }

    /// Start dragging a die. Only the owner can drag their own dice.
    ///
    /// # Errors
    ///
    /// Returns `Err` if die not found, player is not the owner, or die is already being dragged.
    ///
    /// # Panics
    ///
    /// Panics if the die is found in the initial check but disappears before mutation.
    pub fn start_drag(
        &mut self,
        player_id: &str,
        die_id: &str,
        grab_offset: [f32; 3],
        world_position: [f32; 3],
    ) -> Result<(), RoomError> {
        // Validate ownership and drag state before mutating
        {
            let die = self.dice.get(die_id).ok_or(RoomError::DieNotFound)?;
            if die.owner_id != player_id {
                return Err(RoomError::NotOwner);
            }
            if die.drag_state.is_some() {
                return Err(RoomError::AlreadyDragged);
            }
        }

        let die = self.dice.get_mut(die_id).expect("die exists: validated by ok_or(RoomError::DieNotFound) check above");
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
    ///
    /// # Errors
    ///
    /// Returns `Err` if die not found, player is not the dragger, or die is not being dragged.
    pub fn update_drag(
        &mut self,
        player_id: &str,
        die_id: &str,
        world_position: [f32; 3],
    ) -> Result<(), RoomError> {
        let die = self.dice.get_mut(die_id).ok_or(RoomError::DieNotFound)?;
        match &mut die.drag_state {
            Some(drag) if drag.dragger_id == player_id => {
                drag.last_target_position = drag.target_position;
                drag.target_position = world_position;
                Ok(())
            }
            Some(_) => Err(RoomError::NotDragger),
            None => Err(RoomError::NotDragging),
        }
    }

    /// End drag, optionally apply throw velocity from velocity history
    ///
    /// # Errors
    ///
    /// Returns `Err` if die not found, not being dragged, or player is not the owner.
    pub fn end_drag(
        &mut self,
        player_id: &str,
        die_id: &str,
        velocity_history: &[VelocityHistoryEntry],
    ) -> Result<(), RoomError> {
        let die = self.dice.get_mut(die_id).ok_or(RoomError::DieNotFound)?;
        let drag = die.drag_state.as_ref().ok_or(RoomError::NotDragging)?;
        if drag.dragger_id != player_id {
            return Err(RoomError::NotDragger);
        }

        die.drag_state = None;
        die.is_rolling = true;
        die.face_value = None;
        die.rest_start_tick = None;

        // Calculate and apply throw velocity
        if let Some(handle) = die.body_handle {
            if let Some(throw_vel) = calculate_throw_velocity(velocity_history) {
                self.physics.set_linear_velocity(handle, throw_vel);
                // Dampen angular velocity (same 0.75 factor as client)
                self.physics.scale_angular_velocity(handle, 0.75);
            }
        }

        self.touch();
        Ok(())
    }

    /// Build a full room state snapshot (sent to newly joined players)
    #[must_use]
    pub fn build_room_state(&self) -> ServerMessage {
        ServerMessage::RoomState {
            room_id: self.id.clone(),
            host_id: self.host_id.clone(),
            players: self.players.values().map(super::player::Player::to_info).collect(),
            dice: self.dice.values().map(|d| DiceState {
                id: d.id.clone(),
                owner_id: d.owner_id.clone(),
                dice_type: d.dice_type,
                position: d.position,
                rotation: d.rotation,
                presentation: d.presentation.clone(),
            }).collect(),
            settings: self.settings.clone(),
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

    // Average; usize->f32 precision loss is acceptable for averaging a small list
    #[allow(clippy::cast_precision_loss)]
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
    #[must_use]
    pub fn is_dice_full(&self) -> bool {
        self.dice.len() >= MAX_DICE
    }

    /// Spawn dice without physics bodies (test-only helper).
    /// Production code uses `spawn_dice_with_physics()` instead.
    ///
    /// # Errors
    ///
    /// Returns `Err(RoomError::DiceLimit)` if max dice reached, or `Err(RoomError::PlayerNotFound)` if owner unknown.
    pub fn spawn_dice<I, E>(&mut self, owner_id: &str, entries: I) -> Result<Vec<DiceState>, RoomError>
    where
        I: IntoIterator<Item = E>,
        E: Into<DiceSpawnRequest>,
    {
        let entries: Vec<DiceSpawnRequest> = entries.into_iter().map(Into::into).collect();
        if self.dice.len() + entries.len() > MAX_DICE {
            return Err(RoomError::DiceLimit);
        }
        if !self.players.contains_key(owner_id) {
            return Err(RoomError::PlayerNotFound);
        }
        self.validate_spawn_entries(owner_id, &entries)?;

        let mut spawned = Vec::new();
        for entry in entries {
            let position = [0.0, 2.0, 0.0];
            let rotation = [0.0, 0.0, 0.0, 1.0];
            let die = ServerDie {
                id: entry.id.clone(),
                owner_id: owner_id.to_string(),
                dice_type: entry.dice_type,
                presentation: entry.presentation.clone(),
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
                id: entry.id.clone(),
                owner_id: owner_id.to_string(),
                dice_type: entry.dice_type,
                position,
                rotation,
                presentation: entry.presentation,
            });
            self.dice.insert(entry.id, die);
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

    fn make_presentation(inventory_die_id: &str) -> DicePresentationMetadata {
        DicePresentationMetadata {
            inventory_die_id: Some(inventory_die_id.to_string()),
            display_name: Some("Lucky D20".to_string()),
            set_id: Some("starter".to_string()),
            rarity: Some("rare".to_string()),
            base_color: Some("#8b5cf6".to_string()),
            accent_color: Some("#ffffff".to_string()),
            material: Some("plastic".to_string()),
            custom_asset_id: None,
            custom_asset_name: None,
            unsupported_reason: None,
        }
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
        assert_eq!(room.add_player(extra).unwrap_err(), RoomError::RoomFull);
    }

    #[test]
    fn test_invalid_name() {
        let mut room = Room::new("test".to_string());
        let player = make_player("p1", "");
        assert_eq!(room.add_player(player).unwrap_err(), RoomError::InvalidName);

        let long_name = "A".repeat(21);
        let player = make_player("p2", &long_name);
        assert_eq!(room.add_player(player).unwrap_err(), RoomError::InvalidName);
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
        assert_eq!(room.spawn_dice("p1", one_more).unwrap_err(), RoomError::DiceLimit);
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
    fn test_spawn_dice_rejects_duplicate_dice_ids() {
        let mut room = Room::new("test".to_string());
        room.add_player(make_player("p1", "Gandalf")).unwrap();

        assert_eq!(room.spawn_dice("p1", vec![
            ("d1".to_string(), DiceType::D20),
            ("d1".to_string(), DiceType::D6),
        ]).unwrap_err(), RoomError::DuplicateDiceId);
    }

    #[test]
    fn test_spawn_dice_rejects_duplicate_owned_inventory_die() {
        let mut room = Room::new("test".to_string());
        room.add_player(make_player("p1", "Gandalf")).unwrap();

        room.spawn_dice("p1", vec![SpawnDiceEntry {
            id: "d1".to_string(),
            dice_type: DiceType::D20,
            presentation: Some(make_presentation("die_lucky_d20")),
        }]).unwrap();

        let duplicate = room.spawn_dice("p1", vec![SpawnDiceEntry {
            id: "d2".to_string(),
            dice_type: DiceType::D20,
            presentation: Some(make_presentation("die_lucky_d20")),
        }]);

        assert_eq!(duplicate.unwrap_err(), RoomError::DuplicateInventoryDie);
        assert_eq!(room.dice_count(), 1);
    }

    #[test]
    fn test_spawn_dice_preserves_presentation_metadata() {
        let mut room = Room::new("test".to_string());
        let player = make_player("p1", "Gandalf");
        room.add_player(player).unwrap();

        let presentation = make_presentation("die_lucky_d20");

        let spawned = room.spawn_dice("p1", vec![SpawnDiceEntry {
            id: "d1".to_string(),
            dice_type: DiceType::D20,
            presentation: Some(presentation.clone()),
        }]).unwrap();

        assert_eq!(spawned[0].presentation.as_ref(), Some(&presentation));
        assert_eq!(room.dice.get("d1").unwrap().presentation.as_ref(), Some(&presentation));
        match room.build_room_state() {
            ServerMessage::RoomState { dice, .. } => {
                assert_eq!(dice[0].presentation.as_ref(), Some(&presentation));
            }
            _ => panic!("Expected room state"),
        }
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

        // Snapshots are sent every tick at 60Hz
        let (snap1, _) = room.physics_tick();
        assert!(snap1.is_some(), "Every tick should produce a snapshot at 60Hz");
    }

    #[test]
    fn test_physics_tick_resets_escaped_die() {
        let mut room = Room::new("test".to_string());
        let player = make_player("p1", "Gandalf");
        room.add_player(player).unwrap();
        room.spawn_dice_with_physics("p1", vec![("d1".to_string(), DiceType::D6)]).unwrap();

        let handle = room.dice.get("d1").unwrap().body_handle.unwrap();
        room.physics.reset_body_to_position(handle, [ESCAPE_RESET_HALF_X + 1.0, 2.0, 0.0]);
        room.dice.get_mut("d1").unwrap().position = [ESCAPE_RESET_HALF_X + 1.0, 2.0, 0.0];

        let _ = room.physics_tick();

        let die = room.dice.get("d1").unwrap();
        assert!(
            !is_outside_escape_bounds(die.position),
            "Escaped die should be reset inside bounds, got {:?}",
            die.position
        );
        assert!(die.is_rolling, "Reset die should continue through normal settling flow");
        assert!(die.drag_state.is_none(), "Resetting an escaped die should cancel drag state");
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
        assert!((1..=6).contains(&value), "D6 should show 1-6, got {value}");
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
        assert_eq!(result.unwrap_err(), RoomError::NotOwner);
    }

    #[test]
    fn test_cannot_drag_already_dragged_die() {
        let mut room = Room::new("test".to_string());
        room.add_player(make_player("p1", "Gandalf")).unwrap();
        room.spawn_dice("p1", vec![("d1".to_string(), DiceType::D6)]).unwrap();

        room.start_drag("p1", "d1", [0.0; 3], [0.0; 3]).unwrap();
        let result = room.start_drag("p1", "d1", [0.0; 3], [0.0; 3]);
        assert!(result.is_err());
        assert_eq!(result.unwrap_err(), RoomError::AlreadyDragged);
    }

    #[test]
    #[allow(clippy::float_cmp)]
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

        let _ = room.end_drag("p1", "d1", &[]);
        assert!(room.dice.get("d1").unwrap().drag_state.is_none());
    }

    // ── RoomError enum tests ────────────────────────────────────────────────

    #[test]
    fn test_error_room_full_returns_correct_variant() {
        let mut room = Room::new("test".to_string());
        for i in 0..MAX_PLAYERS {
            room.add_player(make_player(&format!("p{i}"), &format!("P{i}"))).unwrap();
        }
        assert_eq!(
            room.add_player(make_player("extra", "Extra")).unwrap_err(),
            RoomError::RoomFull
        );
    }

    #[test]
    fn test_error_invalid_name_returns_correct_variant() {
        let mut room = Room::new("test".to_string());
        // Empty name
        assert_eq!(
            room.add_player(make_player("p1", "")).unwrap_err(),
            RoomError::InvalidName
        );
        // Name too long (21 chars)
        assert_eq!(
            room.add_player(make_player("p2", &"X".repeat(21))).unwrap_err(),
            RoomError::InvalidName
        );
    }

    #[test]
    fn test_error_dice_full_returns_correct_variant() {
        let mut room = Room::new("test".to_string());
        room.add_player(make_player("p1", "Alice")).unwrap();
        let many: Vec<(String, DiceType)> = (0..MAX_DICE)
            .map(|i| (format!("d{i}"), DiceType::D6))
            .collect();
        room.spawn_dice("p1", many).unwrap();
        assert_eq!(
            room.spawn_dice("p1", vec![("extra".to_string(), DiceType::D6)]).unwrap_err(),
            RoomError::DiceLimit
        );
    }

    #[test]
    fn test_error_die_not_found_start_drag() {
        let mut room = Room::new("test".to_string());
        room.add_player(make_player("p1", "Alice")).unwrap();
        assert_eq!(
            room.start_drag("p1", "nonexistent", [0.0; 3], [0.0; 3]).unwrap_err(),
            RoomError::DieNotFound
        );
    }

    #[test]
    fn test_error_not_owner_returns_correct_variant() {
        let mut room = Room::new("test".to_string());
        room.add_player(make_player("p1", "Alice")).unwrap();
        room.add_player(make_player("p2", "Bob")).unwrap();
        room.spawn_dice("p1", vec![("d1".to_string(), DiceType::D6)]).unwrap();
        assert_eq!(
            room.start_drag("p2", "d1", [0.0; 3], [0.0; 3]).unwrap_err(),
            RoomError::NotOwner
        );
    }

    #[test]
    fn test_error_already_dragged_returns_correct_variant() {
        let mut room = Room::new("test".to_string());
        room.add_player(make_player("p1", "Alice")).unwrap();
        room.spawn_dice("p1", vec![("d1".to_string(), DiceType::D6)]).unwrap();
        room.start_drag("p1", "d1", [0.0; 3], [0.0; 3]).unwrap();
        assert_eq!(
            room.start_drag("p1", "d1", [0.0; 3], [0.0; 3]).unwrap_err(),
            RoomError::AlreadyDragged
        );
    }

    #[test]
    fn test_error_not_dragger_returns_correct_variant() {
        let mut room = Room::new("test".to_string());
        room.add_player(make_player("p1", "Alice")).unwrap();
        room.add_player(make_player("p2", "Bob")).unwrap();
        room.spawn_dice("p1", vec![("d1".to_string(), DiceType::D6)]).unwrap();
        // p1 starts dragging
        room.start_drag("p1", "d1", [0.0; 3], [0.0; 3]).unwrap();
        // p2 tries to move it — not the dragger
        assert_eq!(
            room.update_drag("p2", "d1", [1.0, 0.0, 0.0]).unwrap_err(),
            RoomError::NotDragger
        );
    }

    #[test]
    fn test_error_not_dragging_update_drag() {
        let mut room = Room::new("test".to_string());
        room.add_player(make_player("p1", "Alice")).unwrap();
        room.spawn_dice("p1", vec![("d1".to_string(), DiceType::D6)]).unwrap();
        // Die exists but is not being dragged
        assert_eq!(
            room.update_drag("p1", "d1", [1.0, 0.0, 0.0]).unwrap_err(),
            RoomError::NotDragging
        );
    }

    #[test]
    fn test_error_not_dragging_end_drag() {
        let mut room = Room::new("test".to_string());
        room.add_player(make_player("p1", "Alice")).unwrap();
        room.spawn_dice("p1", vec![("d1".to_string(), DiceType::D6)]).unwrap();
        // Die exists but was never dragged
        assert_eq!(
            room.end_drag("p1", "d1", &[]).unwrap_err(),
            RoomError::NotDragging
        );
    }

    #[test]
    fn test_error_not_dragger_end_drag() {
        let mut room = Room::new("test".to_string());
        room.add_player(make_player("p1", "Alice")).unwrap();
        room.add_player(make_player("p2", "Bob")).unwrap();
        room.spawn_dice("p1", vec![("d1".to_string(), DiceType::D6)]).unwrap();
        // p1 starts dragging
        room.start_drag("p1", "d1", [0.0; 3], [0.0; 3]).unwrap();
        // p2 tries to end the drag — not the dragger
        assert_eq!(
            room.end_drag("p2", "d1", &[]).unwrap_err(),
            RoomError::NotDragger
        );
    }

    #[test]
    fn test_error_die_not_found_update_drag() {
        let mut room = Room::new("test".to_string());
        room.add_player(make_player("p1", "Alice")).unwrap();
        assert_eq!(
            room.update_drag("p1", "nonexistent", [0.0; 3]).unwrap_err(),
            RoomError::DieNotFound
        );
    }

    #[test]
    fn test_error_die_not_found_end_drag() {
        let mut room = Room::new("test".to_string());
        room.add_player(make_player("p1", "Alice")).unwrap();
        assert_eq!(
            room.end_drag("p1", "nonexistent", &[]).unwrap_err(),
            RoomError::DieNotFound
        );
    }

    #[test]
    fn test_error_codes_match_wire_protocol() {
        // Verify .code() returns the expected wire strings — these are sent to clients
        assert_eq!(RoomError::RoomFull.code(), "ROOM_FULL");
        assert_eq!(RoomError::InvalidName.code(), "INVALID_NAME");
        assert_eq!(RoomError::DiceLimit.code(), "DICE_LIMIT");
        assert_eq!(RoomError::PlayerNotFound.code(), "PLAYER_NOT_FOUND");
        assert_eq!(RoomError::DieNotFound.code(), "DIE_NOT_FOUND");
        assert_eq!(RoomError::NotOwner.code(), "NOT_OWNER");
        assert_eq!(RoomError::AlreadyDragged.code(), "ALREADY_DRAGGED");
        assert_eq!(RoomError::NotDragger.code(), "NOT_DRAGGER");
        assert_eq!(RoomError::NotDragging.code(), "NOT_DRAGGING");
        assert_eq!(RoomError::NotHost.code(), "NOT_HOST");
    }

    // ── Host role & room settings ────────────────────────────────────────────

    #[test]
    fn test_creator_is_host() {
        let mut room = Room::new("test".to_string());
        assert_eq!(room.host_id, None, "Empty room has no host");
        room.add_player(make_player("p1", "Creator")).unwrap();
        assert_eq!(room.host_id.as_deref(), Some("p1"));
        assert!(room.is_host("p1"));

        // A second joiner does not usurp the host.
        room.add_player(make_player("p2", "Joiner")).unwrap();
        assert_eq!(room.host_id.as_deref(), Some("p1"));
        assert!(!room.is_host("p2"));
    }

    #[test]
    fn test_solo_player_is_host() {
        // Solo loopback room: the single player is trivially host.
        let mut room = Room::new("test".to_string());
        room.add_player(make_player("solo", "Solo")).unwrap();
        assert!(room.is_host("solo"));
    }

    #[test]
    fn test_host_transfers_to_oldest_remaining_on_disconnect() {
        let mut room = Room::new("test".to_string());
        room.add_player(make_player("p1", "First")).unwrap();
        room.add_player(make_player("p2", "Second")).unwrap();
        room.add_player(make_player("p3", "Third")).unwrap();
        assert_eq!(room.host_id.as_deref(), Some("p1"));

        // Host leaves — oldest remaining (p2) becomes host.
        room.remove_player("p1");
        assert_eq!(room.host_id.as_deref(), Some("p2"), "Oldest remaining player becomes host");

        // p2 leaves — p3 is now oldest remaining.
        room.remove_player("p2");
        assert_eq!(room.host_id.as_deref(), Some("p3"));
    }

    #[test]
    fn test_non_host_disconnect_does_not_change_host() {
        let mut room = Room::new("test".to_string());
        room.add_player(make_player("p1", "First")).unwrap();
        room.add_player(make_player("p2", "Second")).unwrap();

        // A non-host leaving must not move the host.
        room.remove_player("p2");
        assert_eq!(room.host_id.as_deref(), Some("p1"));
    }

    #[test]
    fn test_host_cleared_when_room_empties() {
        let mut room = Room::new("test".to_string());
        room.add_player(make_player("p1", "Only")).unwrap();
        room.remove_player("p1");
        assert_eq!(room.host_id, None, "Empty room has no host");
    }

    #[test]
    fn test_host_can_update_settings() {
        let mut room = Room::new("test".to_string());
        room.add_player(make_player("p1", "Host")).unwrap();

        let mut settings = RoomSettings::default();
        settings.fields.insert("physicsMode".to_string(), serde_json::json!("arcade"));

        assert!(room.update_settings("p1", settings.clone()).is_ok());
        assert_eq!(room.settings, settings);
        assert_eq!(room.settings.fields.get("physicsMode").unwrap(), "arcade");
    }

    #[test]
    fn test_non_host_settings_mutation_rejected_and_unchanged() {
        let mut room = Room::new("test".to_string());
        room.add_player(make_player("p1", "Host")).unwrap();
        room.add_player(make_player("p2", "Guest")).unwrap();

        let original = room.settings.clone();
        let mut attempted = RoomSettings::default();
        attempted.fields.insert("physicsMode".to_string(), serde_json::json!("arcade"));

        // Non-host mutation must be rejected and leave settings untouched.
        assert_eq!(room.update_settings("p2", attempted).unwrap_err(), RoomError::NotHost);
        assert_eq!(room.settings, original);
    }

    #[test]
    fn test_room_state_carries_host_and_settings() {
        let mut room = Room::new("test".to_string());
        room.add_player(make_player("p1", "Host")).unwrap();
        let mut settings = RoomSettings::default();
        settings.fields.insert("theme".to_string(), serde_json::json!("neon"));
        room.update_settings("p1", settings).unwrap();

        match room.build_room_state() {
            ServerMessage::RoomState { host_id, settings, .. } => {
                assert_eq!(host_id.as_deref(), Some("p1"));
                assert_eq!(settings.version, crate::messages::ROOM_SETTINGS_VERSION);
                assert_eq!(settings.fields.get("theme").unwrap(), "neon");
            }
            _ => panic!("Expected room state"),
        }
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
            room.physics.set_linear_velocity(handle, [5.0, 0.0, 0.0]);
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

#[cfg(test)]
mod physics_cleanup_tests {
    use super::*;
    use tokio::sync::mpsc;

    fn make_player(id: &str, name: &str) -> Player {
        let (tx, _rx) = mpsc::unbounded_channel();
        Player::new(id.to_string(), name.to_string(), "#FFF".to_string(), tx)
    }

    #[test]
    fn test_remove_dice_removes_physics_body() {
        let mut room = Room::new("test".to_string());
        room.add_player(make_player("p1", "Gandalf")).unwrap();

        // PhysicsWorld starts with 6 fixed bodies (ground + ceiling + 4 walls)
        let baseline = room.physics.body_count();

        room.spawn_dice_with_physics("p1", vec![
            ("d1".to_string(), DiceType::D6),
            ("d2".to_string(), DiceType::D20),
        ]).unwrap();

        assert_eq!(room.physics.body_count(), baseline + 2, "Two physics bodies should be added on spawn");

        let removed = room.remove_dice("p1", &["d1".to_string(), "d2".to_string()]);
        assert_eq!(removed.len(), 2);
        assert_eq!(room.physics.body_count(), baseline, "Physics bodies should be removed when dice are removed");
    }

    #[test]
    fn test_remove_player_removes_physics_bodies() {
        let mut room = Room::new("test".to_string());
        room.add_player(make_player("p1", "Gandalf")).unwrap();
        room.add_player(make_player("p2", "Frodo")).unwrap();

        let baseline = room.physics.body_count();

        room.spawn_dice_with_physics("p1", vec![
            ("d1".to_string(), DiceType::D6),
            ("d2".to_string(), DiceType::D6),
        ]).unwrap();
        room.spawn_dice_with_physics("p2", vec![
            ("d3".to_string(), DiceType::D6),
        ]).unwrap();

        assert_eq!(room.physics.body_count(), baseline + 3, "Three physics bodies should be added on spawn");

        // Remove p1 — should remove only p1's 2 dice physics bodies
        let removed = room.remove_player("p1");
        assert_eq!(removed.len(), 2);
        assert_eq!(room.physics.body_count(), baseline + 1, "Only p1's physics bodies should be removed");

        // Remove p2 — should remove p2's 1 die physics body
        let removed = room.remove_player("p2");
        assert_eq!(removed.len(), 1);
        assert_eq!(room.physics.body_count(), baseline, "All player physics bodies should be removed");
    }

    #[test]
    fn test_remove_dice_no_body_handle_is_noop() {
        // Dice without physics bodies (body_handle: None) should not crash on remove
        let mut room = Room::new("test".to_string());
        room.add_player(make_player("p1", "Gandalf")).unwrap();

        let baseline = room.physics.body_count();

        // spawn_dice (not _with_physics) creates dice with body_handle: None
        room.spawn_dice("p1", vec![("d1".to_string(), DiceType::D6)]).unwrap();
        assert_eq!(room.physics.body_count(), baseline, "No physics body for dice without handles");

        let removed = room.remove_dice("p1", &["d1".to_string()]);
        assert_eq!(removed.len(), 1);
        assert_eq!(room.physics.body_count(), baseline, "Body count unchanged when removing physics-less die");
    }
}

/// Tests for the private physics_tick helpers: apply_drag_forces, clamp_velocities,
/// build_physics_snapshot, and check_settled_dice.
///
/// Private methods are tested through their observable effects since Rust does not allow
/// direct calls to private methods from external modules — but within the same crate's
/// `#[cfg(test)]` block, all items are accessible.
#[cfg(test)]
mod physics_tick_helper_tests {
    use super::*;
    use tokio::sync::mpsc;

    fn make_room_with_player_and_die(die_id: &str) -> Room {
        let (tx, _rx) = mpsc::unbounded_channel();
        let player = Player::new("p1".to_string(), "Test".to_string(), "#FFF".to_string(), tx);
        let mut room = Room::new("test".to_string());
        room.add_player(player).unwrap();
        room.spawn_dice_with_physics("p1", vec![(die_id.to_string(), DiceType::D6)]).unwrap();
        room
    }

    // ── apply_drag_forces ────────────────────────────────────────────────────

    /// Dragging a die should set a velocity toward the target position.
    #[test]
    fn test_apply_drag_forces_sets_velocity_toward_target() {
        let mut room = make_room_with_player_and_die("d1");
        let initial_pos = room.dice.get("d1").unwrap().position;
        let target = [initial_pos[0] + 5.0, initial_pos[1], initial_pos[2]];

        room.start_drag("p1", "d1", [0.0; 3], target).unwrap();
        room.apply_drag_forces();

        // Verify the physics body now has a nonzero linear velocity in +X direction
        let handle = room.dice.get("d1").unwrap().body_handle.unwrap();
        let speed = room.physics.get_linear_speed(handle);
        assert!(speed > 0.0, "Drag should set a nonzero velocity; got {speed}");
    }

    /// Die with no drag state should not acquire velocity from apply_drag_forces.
    #[test]
    fn test_apply_drag_forces_ignores_non_dragged_dice() {
        let mut room = make_room_with_player_and_die("d1");
        // Die is not being dragged — velocity should remain zero
        room.apply_drag_forces();

        let handle = room.dice.get("d1").unwrap().body_handle.unwrap();
        let speed = room.physics.get_linear_speed(handle);
        assert_eq!(speed, 0.0, "Non-dragged die should not get velocity from drag forces");
    }

    // ── clamp_velocities ─────────────────────────────────────────────────────

    /// A body exceeding MAX_DICE_VELOCITY should be clamped down to it.
    #[test]
    fn test_clamp_velocities_reduces_overspeeding_die() {
        let mut room = make_room_with_player_and_die("d1");
        let handle = room.dice.get("d1").unwrap().body_handle.unwrap();

        // Set velocity well above the cap
        let excessive = MAX_DICE_VELOCITY * 2.0;
        room.physics.set_linear_velocity(handle, [excessive, 0.0, 0.0]);

        room.clamp_velocities();

        let speed = room.physics.get_linear_speed(handle);
        assert!(
            speed <= MAX_DICE_VELOCITY + f32::EPSILON,
            "Velocity should be clamped to MAX_DICE_VELOCITY ({MAX_DICE_VELOCITY}), got {speed}"
        );
    }

    /// A body within velocity limits should not be modified by clamp_velocities.
    #[test]
    fn test_clamp_velocities_leaves_slow_die_unchanged() {
        let mut room = make_room_with_player_and_die("d1");
        let handle = room.dice.get("d1").unwrap().body_handle.unwrap();

        let slow_speed = MAX_DICE_VELOCITY * 0.5;
        room.physics.set_linear_velocity(handle, [slow_speed, 0.0, 0.0]);
        room.clamp_velocities();

        let speed = room.physics.get_linear_speed(handle);
        // Should be approximately the same (within floating-point tolerance)
        assert!(
            (speed - slow_speed).abs() < 0.01,
            "Slow die speed should be unchanged; expected ~{slow_speed}, got {speed}"
        );
    }

    // ── build_physics_snapshot ───────────────────────────────────────────────

    /// A rolling die should always appear in the snapshot.
    #[test]
    fn test_build_physics_snapshot_includes_rolling_die() {
        let mut room = make_room_with_player_and_die("d1");
        room.roll_player_dice("p1"); // marks die as is_rolling = true
        room.tick_count = 1;

        let snapshot = room.build_physics_snapshot();
        assert!(snapshot.is_some(), "Rolling die should produce a snapshot");
        if let Some(ServerMessage::PhysicsSnapshot { dice, tick }) = snapshot {
            assert_eq!(tick, 1);
            assert!(dice.iter().any(|d| d.id == "d1"), "Rolling die must be in snapshot");
        }
    }

    /// A die that has not moved should not appear in the snapshot (no wasted bandwidth).
    #[test]
    fn test_build_physics_snapshot_excludes_stationary_non_rolling_die() {
        let mut room = make_room_with_player_and_die("d1");
        // Die is not rolling, not dragged, and hasn't moved from its spawn position
        // (last_snapshot_position == position)
        let snapshot = room.build_physics_snapshot();
        assert!(
            snapshot.is_none(),
            "Stationary non-rolling die should not produce a snapshot"
        );
    }

    /// A displaced die (not rolling but moved > 1cm) should be included.
    #[test]
    fn test_build_physics_snapshot_includes_displaced_settled_die() {
        let mut room = make_room_with_player_and_die("d1");
        // Teleport the die's cached position away from last_snapshot_position
        let die = room.dice.get_mut("d1").unwrap();
        die.position = [die.last_snapshot_position[0] + 0.5, die.last_snapshot_position[1], die.last_snapshot_position[2]];

        let snapshot = room.build_physics_snapshot();
        assert!(snapshot.is_some(), "Displaced die should produce a snapshot");
    }

    // ── check_settled_dice ───────────────────────────────────────────────────

    /// A die that is not rolling should not be reported as newly settled.
    #[test]
    fn test_check_settled_dice_ignores_non_rolling_die() {
        let mut room = make_room_with_player_and_die("d1");
        // Die starts with is_rolling = false (just spawned, not rolled)
        let settled = room.check_settled_dice();
        assert!(settled.is_empty(), "Non-rolling die should not be reported as settled");
    }

    /// A rolling die that is still moving should not be settled, and its rest timer
    /// should be reset (None after check).
    #[test]
    fn test_check_settled_dice_resets_rest_timer_when_moving() {
        let mut room = make_room_with_player_and_die("d1");
        room.roll_player_dice("p1");

        // Give it a nonzero velocity so it is definitely not at rest
        let handle = room.dice.get("d1").unwrap().body_handle.unwrap();
        room.physics.set_linear_velocity(handle, [10.0, 5.0, 3.0]);

        // Manually set a stale rest_start_tick (as if it had been resting)
        room.dice.get_mut("d1").unwrap().rest_start_tick = Some(0);
        room.tick_count = 10;

        let settled = room.check_settled_dice();
        assert!(settled.is_empty(), "Moving die should not settle");
        assert!(
            room.dice.get("d1").unwrap().rest_start_tick.is_none(),
            "rest_start_tick should be cleared when die is moving"
        );
    }

    /// A die that has been at rest long enough should be reported as settled with a face value.
    /// This test drives the die to rest by running the full physics simulation until the die
    /// lands on the floor and its velocity drops to near zero.
    #[test]
    fn test_check_settled_dice_settles_die_after_rest_duration() {
        let mut room = make_room_with_player_and_die("d1");
        room.roll_player_dice("p1");

        // Run physics until the die is genuinely at rest on the ground
        let handle = room.dice.get("d1").unwrap().body_handle.unwrap();
        let mut at_rest = false;
        for _ in 0..600 {
            room.physics.step();
            if room.physics.is_at_rest(handle) {
                at_rest = true;
                break;
            }
        }
        assert!(at_rest, "Die should physically come to rest within 10 seconds");

        // First call to check_settled_dice: should record rest_start_tick
        room.tick_count = 100;
        let first_settled = room.check_settled_dice();
        assert!(first_settled.is_empty(), "First check should only record rest_start_tick, not settle yet");
        let start = room.dice.get("d1").unwrap().rest_start_tick;
        assert!(start.is_some(), "rest_start_tick should be recorded when die first comes to rest");

        // Advance tick_count past the rest threshold (~30 ticks for 500ms at 60Hz)
        #[allow(clippy::cast_possible_truncation, clippy::cast_sign_loss, clippy::cast_precision_loss)]
        let rest_ticks = (REST_DURATION_MS as f64 / (1000.0 / 60.0)) as u64 + 1;
        room.tick_count = 100 + rest_ticks;

        let settled = room.check_settled_dice();
        assert!(!settled.is_empty(), "Die should be reported settled after rest threshold");
        let (dice_id, face_value) = &settled[0];
        assert_eq!(dice_id, "d1");
        assert!((1..=6).contains(face_value), "D6 face value must be 1-6, got {face_value}");
        assert!(!room.dice.get("d1").unwrap().is_rolling, "Die should no longer be rolling");
        assert!(room.dice.get("d1").unwrap().face_value.is_some(), "Die should have a face value");
    }
}
