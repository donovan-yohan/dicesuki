# Multiplayer Drag Physics & Cross-Player Collisions

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Enable cross-player dice collisions and drag-to-throw interaction in multiplayer, with a 9:16 portrait-first arena that adapts to all screen sizes.

**Architecture:** Server-authoritative velocity-based drag. Client sends drag position updates; server sets die velocity toward target (same mechanic as single-player's `DRAG_FOLLOW_SPEED`), applies torque impulses, and the die naturally collides with all other dice. Client renders optimistic local position for the dragged die, while other clients see it via normal snapshot interpolation.

**Tech Stack:** Rust/Axum/Rapier3D (server), React/Three.js/Zustand (client), WebSocket JSON protocol

---

## Task 1: Update Server Arena to 9:16 Portrait

**Files:**
- Modify: `server/src/physics.rs:19-24` (arena constants)
- Test: `server/src/physics.rs` (existing tests)

**Step 1: Update arena constants**

In `server/src/physics.rs`, change the arena dimensions from landscape 16x10 to portrait 9x16:

```rust
// server/src/physics.rs lines 19-24
pub const GROUND_Y: f32 = -0.5;
pub const CEILING_Y: f32 = 15.0;
pub const WALL_HALF_X: f32 = 4.5;   // was 8.0 → 9 units wide total
pub const WALL_HALF_Z: f32 = 8.0;   // was 5.0 → 16 units deep total
pub const WALL_HEIGHT: f32 = 8.0;
pub const WALL_THICKNESS: f32 = 0.5;
```

**Step 2: Run server tests to verify arena still works**

Run: `~/.cargo/bin/cargo test -p daisu-server`
Expected: All existing tests pass (arena shape change doesn't break physics logic)

**Step 3: Commit**

```bash
git add server/src/physics.rs
git commit -m "feat(server): resize multiplayer arena to 9:16 portrait (9x16 world units)"
```

---

## Task 2: Add Drag Constants to Server Physics

**Files:**
- Modify: `server/src/physics.rs` (add constants after line 14)

**Step 1: Add drag physics constants matching client physicsConfig.ts**

Add after the existing constants in `server/src/physics.rs`:

```rust
// Drag interaction constants (matching client physicsConfig.ts)
pub const DRAG_FOLLOW_SPEED: f32 = 12.0;
pub const DRAG_DISTANCE_BOOST: f32 = 2.5;
pub const DRAG_DISTANCE_THRESHOLD: f32 = 3.0;
pub const DRAG_SPIN_FACTOR: f32 = 0.33;
pub const DRAG_ROLL_FACTOR: f32 = 0.5;
pub const DRAG_PLANE_HEIGHT: f32 = 2.0;

// Throw mechanics (matching client physicsConfig.ts)
pub const THROW_VELOCITY_SCALE: f32 = 0.8;
pub const THROW_UPWARD_BOOST: f32 = 3.0;
pub const MIN_THROW_SPEED: f32 = 2.0;
pub const MAX_THROW_SPEED: f32 = 20.0;
pub const MAX_DICE_VELOCITY: f32 = 25.0;
```

**Step 2: Run tests**

Run: `~/.cargo/bin/cargo test -p daisu-server`
Expected: All tests pass (constants are unused so far)

**Step 3: Commit**

```bash
git add server/src/physics.rs
git commit -m "feat(server): add drag and throw physics constants matching client config"
```

---

## Task 3: Add Drag Messages to Server Protocol

**Files:**
- Modify: `server/src/messages.rs:7-27` (ClientMessage enum)
- Test: `server/src/messages.rs` (add deserialization tests)

**Step 1: Write failing tests for new message types**

Add to the `#[cfg(test)] mod tests` in `server/src/messages.rs`:

```rust
#[test]
fn test_deserialize_drag_start() {
    let json = r#"{"type":"drag_start","dieId":"d1","grabOffset":[0.1,0.0,-0.2],"worldPosition":[1.0,2.0,3.0]}"#;
    let msg: ClientMessage = serde_json::from_str(json).unwrap();
    match msg {
        ClientMessage::DragStart { die_id, grab_offset, world_position } => {
            assert_eq!(die_id, "d1");
            assert_eq!(grab_offset, [0.1, 0.0, -0.2]);
            assert_eq!(world_position, [1.0, 2.0, 3.0]);
        }
        _ => panic!("Expected DragStart message"),
    }
}

#[test]
fn test_deserialize_drag_move() {
    let json = r#"{"type":"drag_move","dieId":"d1","worldPosition":[2.0,2.0,4.0]}"#;
    let msg: ClientMessage = serde_json::from_str(json).unwrap();
    match msg {
        ClientMessage::DragMove { die_id, world_position } => {
            assert_eq!(die_id, "d1");
            assert_eq!(world_position, [2.0, 2.0, 4.0]);
        }
        _ => panic!("Expected DragMove message"),
    }
}

#[test]
fn test_deserialize_drag_end() {
    let json = r#"{"type":"drag_end","dieId":"d1","velocityHistory":[{"position":[1.0,2.0,3.0],"time":0.0},{"position":[2.0,2.0,4.0],"time":16.7}]}"#;
    let msg: ClientMessage = serde_json::from_str(json).unwrap();
    match msg {
        ClientMessage::DragEnd { die_id, velocity_history } => {
            assert_eq!(die_id, "d1");
            assert_eq!(velocity_history.len(), 2);
            assert_eq!(velocity_history[0].position, [1.0, 2.0, 3.0]);
        }
        _ => panic!("Expected DragEnd message"),
    }
}
```

**Step 2: Run tests to verify they fail**

Run: `~/.cargo/bin/cargo test -p daisu-server test_deserialize_drag`
Expected: FAIL — `DragStart`, `DragMove`, `DragEnd` variants don't exist yet

**Step 3: Add the message types**

Add to `ClientMessage` enum in `server/src/messages.rs` (before the closing `}`):

```rust
    DragStart {
        #[serde(rename = "dieId")]
        die_id: String,
        #[serde(rename = "grabOffset")]
        grab_offset: [f32; 3],
        #[serde(rename = "worldPosition")]
        world_position: [f32; 3],
    },
    DragMove {
        #[serde(rename = "dieId")]
        die_id: String,
        #[serde(rename = "worldPosition")]
        world_position: [f32; 3],
    },
    DragEnd {
        #[serde(rename = "dieId")]
        die_id: String,
        #[serde(rename = "velocityHistory")]
        velocity_history: Vec<VelocityHistoryEntry>,
    },
```

Add the `VelocityHistoryEntry` struct (after `SpawnDiceEntry`):

```rust
#[derive(Debug, Deserialize)]
pub struct VelocityHistoryEntry {
    pub position: [f32; 3],
    pub time: f32, // relative milliseconds
}
```

**Step 4: Run tests to verify they pass**

Run: `~/.cargo/bin/cargo test -p daisu-server`
Expected: All tests pass including the 3 new drag message tests

**Step 5: Commit**

```bash
git add server/src/messages.rs
git commit -m "feat(server): add drag_start, drag_move, drag_end client message types"
```

---

## Task 4: Add Drag State to ServerDie and Room Logic

**Files:**
- Modify: `server/src/room.rs:15-25` (ServerDie struct)
- Modify: `server/src/room.rs` (add drag handling methods)
- Test: `server/src/room.rs` (add drag unit tests)

**Step 1: Write failing tests for drag state management**

Add to `#[cfg(test)] mod tests` in `server/src/room.rs`:

```rust
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
```

**Step 2: Run tests to verify they fail**

Run: `~/.cargo/bin/cargo test -p daisu-server test_start_drag test_cannot_drag test_update_drag test_end_drag`
Expected: FAIL — `drag_state` field and methods don't exist

**Step 3: Add DragState and update ServerDie**

In `server/src/room.rs`, add the `DragState` struct and update `ServerDie`:

```rust
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
    pub rotation: [f32; 4],
    pub is_rolling: bool,
    pub face_value: Option<u32>,
    pub body_handle: Option<RigidBodyHandle>,
    pub rest_start_tick: Option<u64>,
    pub drag_state: Option<DragState>,
}
```

Update all places that create `ServerDie` to include `drag_state: None`.

**Step 4: Add drag methods to Room impl**

```rust
/// Start dragging a die. Only the owner can drag their own dice.
pub fn start_drag(
    &mut self,
    player_id: &str,
    die_id: &str,
    grab_offset: [f32; 3],
    world_position: [f32; 3],
) -> Result<(), String> {
    let die = self.dice.get(die_id).ok_or("DIE_NOT_FOUND")?;
    if die.owner_id != player_id {
        return Err("NOT_OWNER".to_string());
    }
    if die.drag_state.is_some() {
        return Err("ALREADY_DRAGGED".to_string());
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
    if let Some(die) = self.dice.get_mut(die_id) {
        if let Some(drag) = &die.drag_state {
            if drag.dragger_id != player_id {
                return;
            }
        } else {
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
                    let ang = rb.angvel().clone();
                    rb.set_angvel(ang * 0.75, true);
                }
            }
        }
    }

    self.touch();
}
```

**Step 5: Add throw velocity calculation**

Add as a free function in `room.rs`:

```rust
use crate::messages::VelocityHistoryEntry;
use crate::physics::{THROW_VELOCITY_SCALE, THROW_UPWARD_BOOST, MIN_THROW_SPEED, MAX_THROW_SPEED};

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
```

**Step 6: Run tests**

Run: `~/.cargo/bin/cargo test -p daisu-server`
Expected: All tests pass including the 5 new drag tests

**Step 7: Commit**

```bash
git add server/src/room.rs
git commit -m "feat(server): add drag state management and throw velocity calculation"
```

---

## Task 5: Apply Drag Forces in Physics Tick

**Files:**
- Modify: `server/src/room.rs:217-301` (physics_tick method)
- Test: `server/src/room.rs` (add physics drag test)

**Step 1: Write failing test for drag physics**

```rust
#[test]
fn test_drag_moves_die_toward_target() {
    let mut room = Room::new("test".to_string());
    room.add_player(make_player("p1", "Test")).unwrap();
    room.spawn_dice_with_physics("p1", vec![("d1".to_string(), DiceType::D6)]).unwrap();

    let initial_pos = room.dice.get("d1").unwrap().position;
    let target = [initial_pos[0] + 3.0, 2.0, initial_pos[2]]; // 3 units to the right

    room.start_drag("p1", "d1", [0.0; 3], target).unwrap();

    // Run a few physics ticks
    for _ in 0..10 {
        room.physics_tick();
    }

    let new_pos = room.dice.get("d1").unwrap().position;
    // Die should have moved toward the target (X increased)
    assert!(new_pos[0] > initial_pos[0], "Die should move toward drag target");
}
```

**Step 2: Run test to verify it fails**

Run: `~/.cargo/bin/cargo test -p daisu-server test_drag_moves`
Expected: FAIL — physics_tick doesn't apply drag forces yet

**Step 3: Add drag force application to physics_tick**

In `room.rs` `physics_tick()`, add drag force logic **before** the existing position update loop. Insert after `self.physics.step();` and `self.tick_count += 1;`:

```rust
// Apply drag forces BEFORE stepping (so they take effect this tick)
// Actually, we need to apply forces BEFORE step. Restructure:
// 1. Apply drag forces
// 2. Step physics
// 3. Read positions

// Move self.physics.step() AFTER drag force application:
```

Restructure `physics_tick()`:

```rust
pub fn physics_tick(&mut self) -> (Option<ServerMessage>, Vec<(String, u32)>) {
    // 1. Apply drag forces to dice being dragged
    let dragged_ids: Vec<String> = self.dice.iter()
        .filter(|(_, d)| d.drag_state.is_some() && d.body_handle.is_some())
        .map(|(id, _)| id.clone())
        .collect();

    for die_id in &dragged_ids {
        let die = &self.dice[die_id];
        let handle = die.body_handle.unwrap();
        let drag = die.drag_state.as_ref().unwrap();

        if let Some(rb) = self.physics.rigid_body_set.get_mut(handle) {
            let pos = rb.translation();
            let current = [pos.x, pos.y, pos.z];
            let target = drag.target_position;

            // Displacement to target
            let dx = target[0] - current[0];
            let dy = target[1] - current[1];
            let dz = target[2] - current[2];
            let distance = (dx * dx + dy * dy + dz * dz).sqrt();

            // Speed multiplier with distance boost (matching client)
            use crate::physics::{DRAG_FOLLOW_SPEED, DRAG_DISTANCE_BOOST, DRAG_DISTANCE_THRESHOLD};
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
            let last = drag.last_target_position;
            let move_dx = target[0] - last[0];
            let move_dz = target[2] - last[2];
            let move_speed = (move_dx * move_dx + move_dz * move_dz).sqrt();

            if move_speed > 0.001 {
                let dir_x = move_dx / move_speed;
                let dir_z = move_dz / move_speed;

                use crate::physics::{DRAG_ROLL_FACTOR, DRAG_SPIN_FACTOR};

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

    // ... rest of existing physics_tick (position update, snapshots, settlement) ...
```

Also update the snapshot generation to include dragged dice (they're not `is_rolling` but should still be in snapshots):

```rust
let dice_snapshots: Vec<DiceSnapshot> = self.dice.values()
    .filter(|d| d.is_rolling || d.drag_state.is_some())
    .map(|d| DiceSnapshot { ... })
    .collect();
```

And update the `is_simulating` check:

```rust
let any_active = self.dice.values().any(|d| d.is_rolling || d.drag_state.is_some());
if !any_active {
    self.is_simulating = false;
}
```

**Step 4: Run tests**

Run: `~/.cargo/bin/cargo test -p daisu-server`
Expected: All tests pass including the new drag physics test

**Step 5: Commit**

```bash
git add server/src/room.rs
git commit -m "feat(server): apply drag forces in physics tick with torque and velocity following"
```

---

## Task 6: Wire Drag Messages in WebSocket Handler

**Files:**
- Modify: `server/src/ws_handler.rs:59-194` (match on ClientMessage)

**Step 1: Add drag message handlers**

In `server/src/ws_handler.rs`, add these arms to the `match client_msg` block (before the `_ =>` catch-all):

```rust
ClientMessage::DragStart { die_id, grab_offset, world_position } if is_joined => {
    let mut room_guard = room.write().await;
    match room_guard.start_drag(&player_id, &die_id, grab_offset, world_position) {
        Ok(()) => {
            // Start simulation loop if not already running
            let should_start = room_guard.is_simulating && !room_guard.is_sim_running;
            if should_start {
                room_guard.is_sim_running = true;
            }
            let sim_room = room.clone();
            drop(room_guard);
            if should_start {
                start_simulation_loop(sim_room);
            }
        }
        Err(code) => {
            let message = match code.as_str() {
                "NOT_OWNER" => "Can only drag your own dice".to_string(),
                "ALREADY_DRAGGED" => "Die is already being dragged".to_string(),
                "DIE_NOT_FOUND" => "Die not found".to_string(),
                _ => format!("Drag failed: {}", code),
            };
            let _ = tx.send(ServerMessage::Error { code, message });
        }
    }
}

ClientMessage::DragMove { die_id, world_position } if is_joined => {
    let mut room_guard = room.write().await;
    if let Err(code) = room_guard.update_drag(&player_id, &die_id, world_position) {
        let _ = tx.send(ServerMessage::Error {
            code: code.clone(),
            message: format!("Drag move failed: {}", code),
        });
    }
}

ClientMessage::DragEnd { die_id, velocity_history } if is_joined => {
    let mut room_guard = room.write().await;
    room_guard.end_drag(&player_id, &die_id, &velocity_history);
}
```

**Step 2: Run full test suite**

Run: `~/.cargo/bin/cargo test -p daisu-server`
Expected: All tests pass

**Step 3: Commit**

```bash
git add server/src/ws_handler.rs
git commit -m "feat(server): wire drag_start/drag_move/drag_end in WebSocket handler"
```

---

## Task 7: Add Client-Side Drag Message Types

**Files:**
- Modify: `src/lib/multiplayerMessages.ts`

**Step 1: Add new message interfaces**

Add to the client message section of `src/lib/multiplayerMessages.ts`:

```typescript
export interface DragStartMessage {
  type: 'drag_start'
  dieId: string
  grabOffset: [number, number, number]
  worldPosition: [number, number, number]
}

export interface DragMoveMessage {
  type: 'drag_move'
  dieId: string
  worldPosition: [number, number, number]
}

export interface DragEndMessage {
  type: 'drag_end'
  dieId: string
  velocityHistory: { position: [number, number, number]; time: number }[]
}
```

Update the `ClientMessage` union type:

```typescript
export type ClientMessage =
  | JoinMessage
  | SpawnDiceMessage
  | RemoveDiceMessage
  | RollMessage
  | UpdateColorMessage
  | LeaveMessage
  | DragStartMessage
  | DragMoveMessage
  | DragEndMessage
```

**Step 2: Verify build**

Run: `npm run build`
Expected: Build succeeds (new types are additive)

**Step 3: Commit**

```bash
git add src/lib/multiplayerMessages.ts
git commit -m "feat(client): add drag_start, drag_move, drag_end message types"
```

---

## Task 8: Add Multiplayer Arena Constants to Client Config

**Files:**
- Modify: `src/config/physicsConfig.ts`

**Step 1: Add multiplayer arena constants**

Add a new section to `src/config/physicsConfig.ts`:

```typescript
// ============================================================================
// MULTIPLAYER ARENA (Fixed 9:16 portrait)
// ============================================================================

/**
 * Multiplayer arena half-width (X axis, world units)
 * - Total width: 9 units (MULTIPLAYER_ARENA_HALF_X * 2)
 * - Must match server/src/physics.rs WALL_HALF_X
 */
export const MULTIPLAYER_ARENA_HALF_X = 4.5

/**
 * Multiplayer arena half-depth (Z axis, world units)
 * - Total depth: 16 units (MULTIPLAYER_ARENA_HALF_Z * 2)
 * - Must match server/src/physics.rs WALL_HALF_Z
 */
export const MULTIPLAYER_ARENA_HALF_Z = 8.0

/**
 * Multiplayer drag message throttle interval (ms)
 * - How often to send drag_move messages to server
 * - 33ms ≈ 30Hz — balances responsiveness and bandwidth
 */
export const MULTIPLAYER_DRAG_THROTTLE_MS = 33
```

**Step 2: Verify build**

Run: `npm run build`
Expected: Build succeeds

**Step 3: Commit**

```bash
git add src/config/physicsConfig.ts
git commit -m "feat(client): add multiplayer arena and drag throttle constants"
```

---

## Task 9: Add Drag State to MultiplayerStore

**Files:**
- Modify: `src/store/useMultiplayerStore.ts`

**Step 1: Add drag state and actions to the store**

Add to the `MultiplayerDie` interface:

```typescript
export interface MultiplayerDie {
  // ... existing fields ...
  // Drag state (local optimistic)
  isLocallyDragged: boolean
  localDragPosition: [number, number, number] | null
}
```

Update `diceStateToMultiplayerDie` to include the new fields:

```typescript
function diceStateToMultiplayerDie(d: DiceState): MultiplayerDie {
  return {
    // ... existing fields ...
    isLocallyDragged: false,
    localDragPosition: null,
  }
}
```

Add drag actions to the store interface and implementation:

```typescript
// In the interface:
startDrag: (dieId: string, grabOffset: [number, number, number], worldPosition: [number, number, number]) => void
moveDrag: (dieId: string, worldPosition: [number, number, number]) => void
endDrag: (dieId: string, velocityHistory: { position: [number, number, number]; time: number }[]) => void
setLocalDragPosition: (dieId: string, position: [number, number, number] | null) => void

// In the implementation:
startDrag: (dieId, grabOffset, worldPosition) => {
  const { dice } = get()
  const newDice = new Map(dice)
  const die = newDice.get(dieId)
  if (die) {
    newDice.set(dieId, { ...die, isLocallyDragged: true, localDragPosition: worldPosition })
  }
  set({ dice: newDice })
  get().sendMessage({ type: 'drag_start', dieId, grabOffset, worldPosition })
},

moveDrag: (dieId, worldPosition) => {
  // Update local optimistic position (no Map clone for perf — use direct mutation)
  const die = get().dice.get(dieId)
  if (die) {
    die.localDragPosition = worldPosition
  }
  get().sendMessage({ type: 'drag_move', dieId, worldPosition })
},

endDrag: (dieId, velocityHistory) => {
  const { dice } = get()
  const newDice = new Map(dice)
  const die = newDice.get(dieId)
  if (die) {
    newDice.set(dieId, { ...die, isLocallyDragged: false, localDragPosition: null })
  }
  set({ dice: newDice })
  get().sendMessage({ type: 'drag_end', dieId, velocityHistory })
},

setLocalDragPosition: (dieId, position) => {
  const die = get().dice.get(dieId)
  if (die) {
    die.localDragPosition = position
  }
},
```

Update the `physics_snapshot` handler to skip locally dragged dice:

```typescript
case 'physics_snapshot': {
  const { dice } = get()
  const newDice = new Map(dice)
  const now = performance.now()
  for (const snap of msg.dice) {
    const die = newDice.get(snap.id)
    if (die && !die.isLocallyDragged) {  // <-- Skip locally dragged dice
      newDice.set(snap.id, {
        ...die,
        prevPosition: die.targetPosition,
        prevRotation: die.targetRotation,
        targetPosition: snap.p,
        targetRotation: snap.r,
      })
    }
  }
  set({ dice: newDice, lastSnapshotTime: now })
  break
}
```

**Step 2: Verify build**

Run: `npm run build`
Expected: Build succeeds

**Step 3: Commit**

```bash
git add src/store/useMultiplayerStore.ts
git commit -m "feat(client): add drag state and actions to multiplayer store"
```

---

## Task 10: Create Multiplayer Drag Hook

**Files:**
- Create: `src/hooks/useMultiplayerDrag.ts`

**Step 1: Create the hook**

This hook mirrors `useDiceInteraction.ts` but sends WebSocket messages instead of manipulating a local rigid body.

```typescript
import { useCallback, useRef } from 'react'
import { useThree } from '@react-three/fiber'
import * as THREE from 'three'
import type { ThreeEvent } from '@react-three/fiber'
import {
  DRAG_PLANE_HEIGHT,
  VELOCITY_HISTORY_SIZE,
  MULTIPLAYER_DRAG_THROTTLE_MS,
} from '../config/physicsConfig'
import { useMultiplayerStore } from '../store/useMultiplayerStore'
import { useDragStore } from '../store/useDragStore'

interface VelocityHistoryEntry {
  position: [number, number, number]
  time: number
}

export function useMultiplayerDrag() {
  const { camera, gl, size } = useThree()
  const localPlayerId = useMultiplayerStore((s) => s.localPlayerId)
  const dice = useMultiplayerStore((s) => s.dice)
  const startDrag = useMultiplayerStore((s) => s.startDrag)
  const moveDrag = useMultiplayerStore((s) => s.moveDrag)
  const endDrag = useMultiplayerStore((s) => s.endDrag)
  const setLocalDragPosition = useMultiplayerStore((s) => s.setLocalDragPosition)
  const setDraggedDiceId = useDragStore((s) => s.setDraggedDiceId)

  const isDraggingRef = useRef(false)
  const currentDieIdRef = useRef<string | null>(null)
  const currentPointerIdRef = useRef<number | null>(null)
  const dragOffsetRef = useRef<THREE.Vector3 | null>(null)
  const capturedElementRef = useRef<HTMLElement | null>(null)
  const velocityHistoryRef = useRef<VelocityHistoryEntry[]>([])
  const lastSendTimeRef = useRef(0)

  const raycaster = useRef(new THREE.Raycaster())
  const dragPlane = useRef(new THREE.Plane(new THREE.Vector3(0, 1, 0), -DRAG_PLANE_HEIGHT))

  const getPointerWorldPosition = useCallback((clientX: number, clientY: number): THREE.Vector3 | null => {
    const rect = gl.domElement.getBoundingClientRect()
    const x = ((clientX - rect.left) / size.width) * 2 - 1
    const y = -((clientY - rect.top) / size.height) * 2 + 1
    raycaster.current.setFromCamera(new THREE.Vector2(x, y), camera)
    const intersection = new THREE.Vector3()
    const didIntersect = raycaster.current.ray.intersectPlane(dragPlane.current, intersection)
    return didIntersect ? intersection : null
  }, [camera, gl.domElement, size.width, size.height])

  const onPointerDown = useCallback((event: ThreeEvent<PointerEvent>, dieId: string) => {
    // Check ownership
    const die = dice.get(dieId)
    if (!die || die.ownerId !== localPlayerId) return

    event.stopPropagation()
    currentPointerIdRef.current = event.pointerId
    currentDieIdRef.current = dieId
    setDraggedDiceId(dieId)

    if (event.nativeEvent.target instanceof HTMLElement) {
      event.nativeEvent.target.setPointerCapture(event.pointerId)
      capturedElementRef.current = event.nativeEvent.target
    }

    const worldPos = getPointerWorldPosition(event.nativeEvent.clientX, event.nativeEvent.clientY)
    if (!worldPos) return

    // Calculate grab offset from die center
    const dieCenter = new THREE.Vector3()
    event.object.getWorldPosition(dieCenter)
    const offset = new THREE.Vector3().subVectors(dieCenter, worldPos)
    dragOffsetRef.current = offset

    const targetPos = worldPos.add(offset)
    const pos: [number, number, number] = [targetPos.x, targetPos.y, targetPos.z]
    const grabOff: [number, number, number] = [offset.x, offset.y, offset.z]

    isDraggingRef.current = true
    velocityHistoryRef.current = [{ position: pos, time: 0 }]
    lastSendTimeRef.current = performance.now()

    startDrag(dieId, grabOff, pos)
    setLocalDragPosition(dieId, pos)
  }, [dice, localPlayerId, getPointerWorldPosition, startDrag, setLocalDragPosition, setDraggedDiceId])

  const onPointerMove = useCallback((event: PointerEvent) => {
    if (!isDraggingRef.current || event.pointerId !== currentPointerIdRef.current) return
    const dieId = currentDieIdRef.current
    if (!dieId) return

    const worldPos = getPointerWorldPosition(event.clientX, event.clientY)
    if (!worldPos) return

    if (dragOffsetRef.current) {
      worldPos.add(dragOffsetRef.current)
    }

    const pos: [number, number, number] = [worldPos.x, worldPos.y, worldPos.z]

    // Always update local visual position (every frame)
    setLocalDragPosition(dieId, pos)

    // Track velocity history
    const now = performance.now()
    const baseTime = velocityHistoryRef.current.length > 0 ? 0 : 0
    const relativeTime = now - lastSendTimeRef.current + (velocityHistoryRef.current[velocityHistoryRef.current.length - 1]?.time || 0)
    velocityHistoryRef.current.push({ position: pos, time: relativeTime })
    if (velocityHistoryRef.current.length > VELOCITY_HISTORY_SIZE) {
      velocityHistoryRef.current.shift()
    }

    // Throttle server messages
    if (now - lastSendTimeRef.current >= MULTIPLAYER_DRAG_THROTTLE_MS) {
      lastSendTimeRef.current = now
      moveDrag(dieId, pos)
    }
  }, [getPointerWorldPosition, setLocalDragPosition, moveDrag])

  const endDragHandler = useCallback((pointerEvent?: PointerEvent) => {
    if (!isDraggingRef.current) return
    const dieId = currentDieIdRef.current
    if (!dieId) return

    endDrag(dieId, velocityHistoryRef.current)
    setDraggedDiceId(null)

    // Release pointer capture
    if (capturedElementRef.current && currentPointerIdRef.current !== null) {
      try {
        capturedElementRef.current.releasePointerCapture(currentPointerIdRef.current)
      } catch { /* ignore */ }
    }

    // Clear refs
    isDraggingRef.current = false
    currentDieIdRef.current = null
    currentPointerIdRef.current = null
    dragOffsetRef.current = null
    capturedElementRef.current = null
    velocityHistoryRef.current = []
  }, [endDrag, setDraggedDiceId])

  const onPointerUp = useCallback((event: PointerEvent) => {
    if (!isDraggingRef.current || event.pointerId !== currentPointerIdRef.current) return
    endDragHandler(event)
  }, [endDragHandler])

  const onPointerCancel = useCallback((event: PointerEvent) => {
    if (!isDraggingRef.current || event.pointerId !== currentPointerIdRef.current) return
    velocityHistoryRef.current = [] // No throw on cancel
    endDragHandler(event)
  }, [endDragHandler])

  // Return the pointer handlers for use in Scene
  return {
    onPointerDown,
    onPointerMove,
    onPointerUp,
    onPointerCancel,
  }
}
```

**Step 2: Verify build**

Run: `npm run build`
Expected: Build succeeds

**Step 3: Commit**

```bash
git add src/hooks/useMultiplayerDrag.ts
git commit -m "feat(client): create useMultiplayerDrag hook for server-authoritative drag"
```

---

## Task 11: Create MultiplayerArena Component

**Files:**
- Create: `src/components/multiplayer/MultiplayerArena.tsx`
- Modify: `src/components/Scene.tsx` (replace `<VisualGround />` with `<MultiplayerArena />`)

**Step 1: Create the visual arena component**

This component renders the same themed walls/floor/ceiling as `ViewportBoundaries` but with fixed 9:16 dimensions and no physics colliders (server handles collisions).

```typescript
import { useMemo } from 'react'
import { Box } from '@react-three/drei'
import { useTheme } from '../../contexts/ThemeContext'
import {
  MULTIPLAYER_ARENA_HALF_X,
  MULTIPLAYER_ARENA_HALF_Z,
} from '../../config/physicsConfig'

const WALL_HEIGHT = 6
const WALL_THICKNESS = 0.5
const GROUND_Y = -0.5
const CEILING_Y = 6

/**
 * Fixed 9:16 visual arena for multiplayer.
 * No physics colliders — server Rapier handles all collisions.
 * Matches the themed appearance of single-player ViewportBoundaries.
 */
export function MultiplayerArena() {
  const { currentTheme } = useTheme()
  const env = currentTheme.environment

  const halfX = MULTIPLAYER_ARENA_HALF_X
  const halfZ = MULTIPLAYER_ARENA_HALF_Z

  const walls = useMemo(() => [
    // East wall (+X)
    { position: [halfX + WALL_THICKNESS / 2, WALL_HEIGHT / 2, 0] as [number, number, number],
      size: [WALL_THICKNESS, WALL_HEIGHT, halfZ * 2 + WALL_THICKNESS * 2] as [number, number, number] },
    // West wall (-X)
    { position: [-(halfX + WALL_THICKNESS / 2), WALL_HEIGHT / 2, 0] as [number, number, number],
      size: [WALL_THICKNESS, WALL_HEIGHT, halfZ * 2 + WALL_THICKNESS * 2] as [number, number, number] },
    // North wall (+Z)
    { position: [0, WALL_HEIGHT / 2, halfZ + WALL_THICKNESS / 2] as [number, number, number],
      size: [halfX * 2 + WALL_THICKNESS * 2, WALL_HEIGHT, WALL_THICKNESS] as [number, number, number] },
    // South wall (-Z)
    { position: [0, WALL_HEIGHT / 2, -(halfZ + WALL_THICKNESS / 2)] as [number, number, number],
      size: [halfX * 2 + WALL_THICKNESS * 2, WALL_HEIGHT, WALL_THICKNESS] as [number, number, number] },
  ], [halfX, halfZ])

  return (
    <>
      {/* Ground */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, GROUND_Y, 0]} receiveShadow>
        <planeGeometry args={[halfX * 2 + 2, halfZ * 2 + 2]} />
        <meshStandardMaterial
          color={env.floor.color}
          roughness={env.floor.material.roughness}
          metalness={env.floor.material.metalness}
        />
      </mesh>

      {/* Walls */}
      {walls.map((wall, i) => (
        <Box key={i} args={wall.size} position={wall.position}>
          <meshStandardMaterial
            color={env.wall.color}
            roughness={env.wall.material.roughness}
            metalness={env.wall.material.metalness}
          />
        </Box>
      ))}

      {/* Ceiling */}
      <Box args={[halfX * 2 + 2, 0.5, halfZ * 2 + 2]} position={[0, CEILING_Y, 0]}>
        <meshStandardMaterial
          color={env.ceiling?.color || env.wall.color}
          transparent
          opacity={env.ceiling?.color ? 1 : 0}
        />
      </Box>
    </>
  )
}
```

**Step 2: Replace VisualGround in Scene.tsx**

In `src/components/Scene.tsx`, update the multiplayer rendering branch:

```typescript
// Replace:
{isMultiplayer ? (
  <>
    <VisualGround />
    <MultiplayerDiceRenderer />
  </>
)

// With:
{isMultiplayer ? (
  <>
    <MultiplayerArena />
    <MultiplayerDiceRenderer />
  </>
)
```

Add the import at top of Scene.tsx:

```typescript
import { MultiplayerArena } from './multiplayer/MultiplayerArena'
```

**Step 3: Verify build**

Run: `npm run build`
Expected: Build succeeds

**Step 4: Commit**

```bash
git add src/components/multiplayer/MultiplayerArena.tsx src/components/Scene.tsx
git commit -m "feat(client): add MultiplayerArena with fixed 9:16 themed walls"
```

---

## Task 12: Wire Drag Interaction into MultiplayerDie

**Files:**
- Modify: `src/components/multiplayer/MultiplayerDie.tsx`
- Modify: `src/components/Scene.tsx` (MultiplayerDiceRenderer)

**Step 1: Update MultiplayerDie to accept pointer events and show optimistic position**

The `MultiplayerDie` component needs to:
1. Accept an `onPointerDown` handler for drag initiation
2. Show `localDragPosition` when being dragged by the local player
3. Otherwise show interpolated server position

Update `MultiplayerDie.tsx` to accept new props:

```typescript
interface MultiplayerDieProps {
  dieId: string
  diceType: DiceShape
  color: string
  targetPosition: [number, number, number]
  targetRotation: [number, number, number, number]
  prevPosition: [number, number, number]
  prevRotation: [number, number, number, number]
  interpolationT: number
  isLocallyDragged: boolean
  localDragPosition: [number, number, number] | null
  isOwnedByLocalPlayer: boolean
  onDragStart?: (event: ThreeEvent<PointerEvent>, dieId: string) => void
}
```

In the `useFrame` loop, check `isLocallyDragged`:

```typescript
useFrame(() => {
  if (!meshRef.current) return

  if (isLocallyDragged && localDragPosition) {
    // Optimistic: show die at local drag position
    meshRef.current.position.set(localDragPosition[0], localDragPosition[1], localDragPosition[2])
  } else {
    // Normal interpolation from server snapshots
    meshRef.current.position.lerpVectors(prevPosVec, targetPosVec, interpolationT)
    meshRef.current.quaternion.slerpQuaternions(prevQuatRef, targetQuatRef, interpolationT)
  }
})
```

Add pointer event handler:

```typescript
<mesh
  ref={meshRef}
  onPointerDown={isOwnedByLocalPlayer ? (e) => onDragStart?.(e, dieId) : undefined}
  // cursor changes on hover for own dice
  onPointerEnter={isOwnedByLocalPlayer ? () => { document.body.style.cursor = 'grab' } : undefined}
  onPointerLeave={() => { document.body.style.cursor = '' }}
>
```

**Step 2: Update MultiplayerDiceRenderer in Scene.tsx to pass drag props**

```typescript
function MultiplayerDiceRenderer() {
  const dice = useMultiplayerStore((s) => s.dice)
  const players = useMultiplayerStore((s) => s.players)
  const localPlayerId = useMultiplayerStore((s) => s.localPlayerId)
  const tRef = useSnapshotInterpolation()
  const { onPointerDown } = useMultiplayerDrag()

  const diceArray = Array.from(dice.values())

  return (
    <>
      {diceArray.map((die) => {
        const player = players.get(die.ownerId)
        const color = player?.color || '#ffffff'
        const isOwned = die.ownerId === localPlayerId

        return (
          <MultiplayerDie
            key={die.id}
            dieId={die.id}
            diceType={die.diceType}
            color={color}
            targetPosition={die.targetPosition}
            targetRotation={die.targetRotation}
            prevPosition={die.prevPosition}
            prevRotation={die.prevRotation}
            interpolationT={tRef.current}
            isLocallyDragged={die.isLocallyDragged}
            localDragPosition={die.localDragPosition}
            isOwnedByLocalPlayer={isOwned}
            onDragStart={onPointerDown}
          />
        )
      })}
    </>
  )
}
```

**Step 3: Register global pointer listeners for multiplayer drag**

The `useMultiplayerDrag` hook needs its `onPointerMove`, `onPointerUp`, and `onPointerCancel` registered as global listeners (same pattern as `useDiceInteraction`). Add a `useEffect` in the hook or in Scene.tsx to register them on the canvas/window.

In `useMultiplayerDrag.ts`, add:

```typescript
import { useEffect } from 'react'

// Inside the hook, after defining handlers:
useEffect(() => {
  const canvas = gl.domElement
  canvas.addEventListener('pointermove', onPointerMove)
  window.addEventListener('pointerup', onPointerUp)
  window.addEventListener('pointercancel', onPointerCancel)
  return () => {
    canvas.removeEventListener('pointermove', onPointerMove)
    window.removeEventListener('pointerup', onPointerUp)
    window.removeEventListener('pointercancel', onPointerCancel)
  }
}, [gl.domElement, onPointerMove, onPointerUp, onPointerCancel])
```

**Step 4: Verify build**

Run: `npm run build`
Expected: Build succeeds

**Step 5: Commit**

```bash
git add src/components/multiplayer/MultiplayerDie.tsx src/components/Scene.tsx src/hooks/useMultiplayerDrag.ts
git commit -m "feat(client): wire multiplayer drag interaction with optimistic rendering"
```

---

## Task 13: Adapt Camera to Show Full 9:16 Arena

**Files:**
- Modify: `src/components/Scene.tsx` (camera setup for multiplayer)

**Step 1: Calculate camera height to fit 9:16 arena**

The camera needs to be positioned so the full 9:16 arena is visible regardless of screen aspect ratio. The constraining dimension is whichever makes the arena appear larger relative to the viewport.

Add a component or logic in Scene.tsx that adjusts the camera for multiplayer:

```typescript
import { useEffect } from 'react'
import { useThree } from '@react-three/fiber'
import { MULTIPLAYER_ARENA_HALF_X, MULTIPLAYER_ARENA_HALF_Z } from '../config/physicsConfig'

function MultiplayerCamera() {
  const { camera, size } = useThree()
  const aspect = size.width / size.height

  useEffect(() => {
    if (!('fov' in camera)) return // Only for PerspectiveCamera
    const perspCamera = camera as THREE.PerspectiveCamera

    const fovRad = (perspCamera.fov * Math.PI) / 180
    const halfFovV = fovRad / 2

    // Calculate height needed to see full arena depth (Z axis)
    const heightForZ = MULTIPLAYER_ARENA_HALF_Z / Math.tan(halfFovV)

    // Calculate height needed to see full arena width (X axis)
    const halfFovH = Math.atan(Math.tan(halfFovV) * aspect)
    const heightForX = MULTIPLAYER_ARENA_HALF_X / Math.tan(halfFovH)

    // Use the larger height (ensures both dimensions fit) + margin
    const cameraHeight = Math.max(heightForZ, heightForX) * 1.05 // 5% margin

    perspCamera.position.set(0, cameraHeight, 0)
    perspCamera.lookAt(0, 0, 0)
    perspCamera.updateProjectionMatrix()
  }, [camera, size.width, size.height, aspect])

  return null
}
```

Render `<MultiplayerCamera />` inside the multiplayer branch in Scene.tsx.

**Step 2: Verify build**

Run: `npm run build`
Expected: Build succeeds

**Step 3: Commit**

```bash
git add src/components/Scene.tsx
git commit -m "feat(client): adapt camera to show full 9:16 multiplayer arena on any screen"
```

---

## Task 14: Clean Up Player Drag State on Disconnect

**Files:**
- Modify: `server/src/room.rs:91-101` (remove_player method)

**Step 1: Clear drag state when player disconnects**

In `Room::remove_player()`, before removing dice, clear any active drag state for that player's dice. This is already handled implicitly since the dice are removed entirely, but we should also handle the case where a player disconnects mid-drag — other dice they were pushing should stop being affected.

The existing `remove_player` already removes all the player's dice and their physics bodies, so this is already safe. No change needed here.

However, we should add a safety net: if a player sends `drag_start` and then disconnects, the simulation loop should notice the die was removed and stop processing it. The current `physics_tick` already iterates `self.dice.values()` which won't include removed dice.

**Verification only — no code change needed.**

Run: `~/.cargo/bin/cargo test -p daisu-server`
Expected: All tests pass

---

## Task 15: Integration Test — Drag WebSocket Flow

**Files:**
- Modify: `server/tests/integration.rs` (add drag integration test)

**Step 1: Add integration test for drag message flow**

Add a test that:
1. Connects a player via WebSocket
2. Joins room and spawns a die
3. Sends `drag_start` → `drag_move` → `drag_end`
4. Verifies physics snapshots are received during drag
5. Verifies die settles after throw

```rust
#[tokio::test]
async fn test_drag_flow() {
    let (addr, _cleanup) = start_test_server().await;

    let room_id = "drag-test";
    let mut ws = connect_ws(&addr, room_id).await;

    // Join
    send_json(&mut ws, json!({
        "type": "join",
        "roomId": room_id,
        "displayName": "Dragger",
        "color": "#FF0000"
    })).await;

    let room_state = recv_json(&mut ws).await;
    assert_eq!(room_state["type"], "room_state");

    // Spawn a die
    send_json(&mut ws, json!({
        "type": "spawn_dice",
        "dice": [{"id": "d1", "diceType": "d6"}]
    })).await;

    let spawned = recv_json(&mut ws).await;
    assert_eq!(spawned["type"], "dice_spawned");

    // Start drag
    send_json(&mut ws, json!({
        "type": "drag_start",
        "dieId": "d1",
        "grabOffset": [0.0, 0.0, 0.0],
        "worldPosition": [2.0, 2.0, 0.0]
    })).await;

    // Small delay to let physics tick
    tokio::time::sleep(std::time::Duration::from_millis(100)).await;

    // Move drag
    send_json(&mut ws, json!({
        "type": "drag_move",
        "dieId": "d1",
        "worldPosition": [3.0, 2.0, 1.0]
    })).await;

    // Should receive physics snapshots
    tokio::time::sleep(std::time::Duration::from_millis(100)).await;

    // End drag with velocity history (throw)
    send_json(&mut ws, json!({
        "type": "drag_end",
        "dieId": "d1",
        "velocityHistory": [
            {"position": [2.0, 2.0, 0.0], "time": 0.0},
            {"position": [3.0, 2.0, 1.0], "time": 16.7},
            {"position": [4.0, 2.0, 2.0], "time": 33.4}
        ]
    })).await;

    // Drain messages — should eventually get die_settled
    let mut found_settled = false;
    for _ in 0..200 {
        tokio::time::sleep(std::time::Duration::from_millis(50)).await;
        if let Some(msg) = try_recv_json(&mut ws).await {
            if msg["type"] == "die_settled" {
                found_settled = true;
                assert!(msg["faceValue"].as_u64().unwrap() >= 1);
                assert!(msg["faceValue"].as_u64().unwrap() <= 6);
                break;
            }
        }
    }
    assert!(found_settled, "Die should settle after drag throw");
}
```

Note: This test depends on test helper functions (`start_test_server`, `connect_ws`, `send_json`, `recv_json`, `try_recv_json`) that should already exist in the integration test file. Check and adapt as needed.

**Step 2: Run integration tests**

Run: `~/.cargo/bin/cargo test -p daisu-server --test integration`
Expected: All tests pass including the new drag flow test

**Step 3: Commit**

```bash
git add server/tests/integration.rs
git commit -m "test(server): add integration test for drag WebSocket message flow"
```

---

## Task 16: End-to-End Verification

**Step 1: Run all server tests**

Run: `~/.cargo/bin/cargo test -p daisu-server`
Expected: All tests pass

**Step 2: Run all client tests**

Run: `npm test`
Expected: 161+ tests passing (existing + any new), 3 known failures (haptic throttle)

**Step 3: Run production build**

Run: `npm run build`
Expected: Build succeeds with no errors

**Step 4: Final commit (if any remaining changes)**

```bash
git status
# Stage any remaining files
git commit -m "chore: final cleanup for multiplayer drag physics feature"
```

---

## Architecture Summary

```
Client (drag initiator)           Server (Rapier3D)          Client (observer)
─────────────────────           ──────────────────          ──────────────────
pointerdown on own die
  → drag_start ──────────────→ ServerDie.drag_state = Some
  local: mesh at finger          physics tick:
                                   setLinvel → target
                                   applyTorqueImpulse
pointermove (30Hz throttle)        collides with all dice
  → drag_move ───────────────→ update target_position
  local: mesh follows finger     ──→ physics_snapshot ──→ see die moving smoothly
                                                          own dice get bumped

pointerup
  → drag_end ────────────────→ calculate throw velocity
  stop local override            apply throw + damped spin
  resume server snapshots        die.is_rolling = true
                                ──→ physics_snapshot ──→ see die flying
                                ──→ die_settled ────────→ face value shown
                                ──→ roll_complete ──────→ total calculated
```

## Files Changed Summary

| File | Action | Description |
|------|--------|-------------|
| `server/src/physics.rs` | Modify | 9:16 arena + drag constants |
| `server/src/messages.rs` | Modify | 3 new ClientMessage variants + VelocityHistoryEntry |
| `server/src/room.rs` | Modify | DragState, drag methods, physics_tick drag forces |
| `server/src/ws_handler.rs` | Modify | Handle drag messages, start sim loop |
| `server/tests/integration.rs` | Modify | Drag flow integration test |
| `src/lib/multiplayerMessages.ts` | Modify | 3 new message interfaces |
| `src/config/physicsConfig.ts` | Modify | Arena + throttle constants |
| `src/store/useMultiplayerStore.ts` | Modify | Drag state + actions, skip dragged in snapshots |
| `src/hooks/useMultiplayerDrag.ts` | Create | Multiplayer drag hook |
| `src/components/multiplayer/MultiplayerArena.tsx` | Create | Fixed 9:16 themed arena |
| `src/components/multiplayer/MultiplayerDie.tsx` | Modify | Pointer events + optimistic rendering |
| `src/components/Scene.tsx` | Modify | MultiplayerArena, camera, drag wiring |
