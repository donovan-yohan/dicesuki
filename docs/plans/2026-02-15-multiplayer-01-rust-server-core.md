# Multiplayer 01: Rust Server Core

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Scaffold the Rust server project with message types, room management, and player handling.

**Architecture:** A Rust binary crate in `server/` at the project root. Uses tokio async runtime, serde for serialization, and nanoid for room IDs.

**Tech Stack:** Rust, tokio, serde, serde_json, nanoid, uuid

---

## Task 1: Scaffold Rust Project

**Files:**
- Create: `server/Cargo.toml`
- Create: `server/src/main.rs`
- Create: `server/.gitignore`

**Step 1: Create the Rust project**

```bash
cd /Users/donovanyohan/Documents/Programs/personal/daisu-app
cargo init server --name daisu-server
```

**Step 2: Set up Cargo.toml with dependencies**

Replace `server/Cargo.toml`:

```toml
[package]
name = "daisu-server"
version = "0.1.0"
edition = "2021"

[dependencies]
tokio = { version = "1", features = ["full"] }
tokio-tungstenite = "0.24"
rapier3d = "0.22"
serde = { version = "1", features = ["derive"] }
serde_json = "1"
uuid = { version = "1", features = ["v4"] }
nanoid = "0.4"
rand = "0.8"
futures-util = "0.3"
hyper = { version = "1", features = ["server", "http1"] }
hyper-util = { version = "0.1", features = ["tokio"] }
http-body-util = "0.1"
nalgebra = "0.33"
log = "0.4"
env_logger = "0.11"

[profile.release]
opt-level = 3
lto = true
```

**Step 3: Write minimal main.rs**

```rust
use log::info;

#[tokio::main]
async fn main() {
    env_logger::init();
    info!("Daisu multiplayer server starting...");
    info!("Server ready on 0.0.0.0:8080");
}
```

**Step 4: Add server .gitignore**

Create `server/.gitignore`:
```
/target
```

**Step 5: Verify it compiles**

```bash
cd server && cargo build
```

Expected: Compiles successfully. First build downloads dependencies.

**Step 6: Commit**

```bash
git add server/
git commit -m "feat(server): scaffold Rust server project with dependencies"
```

---

## Task 2: Define Message Types

**Files:**
- Create: `server/src/messages.rs`
- Modify: `server/src/main.rs`

**Step 1: Write tests for message serialization**

Add to `server/src/messages.rs`:

```rust
use serde::{Deserialize, Serialize};

/// Messages sent from client to server
#[derive(Debug, Deserialize)]
#[serde(tag = "type")]
#[serde(rename_all = "snake_case")]
pub enum ClientMessage {
    Join {
        #[serde(rename = "roomId")]
        room_id: String,
        #[serde(rename = "displayName")]
        display_name: String,
        color: String,
    },
    SpawnDice {
        dice: Vec<SpawnDiceEntry>,
    },
    RemoveDice {
        #[serde(rename = "diceIds")]
        dice_ids: Vec<String>,
    },
    Roll,
    UpdateColor {
        color: String,
    },
    Leave,
}

#[derive(Debug, Deserialize)]
pub struct SpawnDiceEntry {
    pub id: String,
    #[serde(rename = "diceType")]
    pub dice_type: DiceType,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "lowercase")]
pub enum DiceType {
    D4,
    D6,
    D8,
    D10,
    D12,
    D20,
}

/// Messages sent from server to client
#[derive(Debug, Serialize, Clone)]
#[serde(tag = "type")]
#[serde(rename_all = "snake_case")]
pub enum ServerMessage {
    RoomState {
        #[serde(rename = "roomId")]
        room_id: String,
        players: Vec<PlayerInfo>,
        dice: Vec<DiceState>,
    },
    PlayerJoined {
        player: PlayerInfo,
    },
    PlayerLeft {
        #[serde(rename = "playerId")]
        player_id: String,
    },
    DiceSpawned {
        #[serde(rename = "ownerId")]
        owner_id: String,
        dice: Vec<DiceState>,
    },
    DiceRemoved {
        #[serde(rename = "diceIds")]
        dice_ids: Vec<String>,
    },
    RollStarted {
        #[serde(rename = "playerId")]
        player_id: String,
        #[serde(rename = "diceIds")]
        dice_ids: Vec<String>,
    },
    PhysicsSnapshot {
        tick: u64,
        dice: Vec<DiceSnapshot>,
    },
    DieSettled {
        #[serde(rename = "diceId")]
        dice_id: String,
        #[serde(rename = "faceValue")]
        face_value: u32,
        position: [f32; 3],
        rotation: [f32; 4],
    },
    RollComplete {
        #[serde(rename = "playerId")]
        player_id: String,
        results: Vec<DieResult>,
        total: u32,
    },
    Error {
        code: String,
        message: String,
    },
}

#[derive(Debug, Serialize, Clone)]
pub struct PlayerInfo {
    pub id: String,
    #[serde(rename = "displayName")]
    pub display_name: String,
    pub color: String,
}

#[derive(Debug, Serialize, Clone)]
pub struct DiceState {
    pub id: String,
    #[serde(rename = "ownerId")]
    pub owner_id: String,
    #[serde(rename = "diceType")]
    pub dice_type: DiceType,
    pub position: [f32; 3],
    pub rotation: [f32; 4],
}

#[derive(Debug, Serialize, Clone)]
pub struct DiceSnapshot {
    pub id: String,
    #[serde(rename = "p")]
    pub position: [f32; 3],
    #[serde(rename = "r")]
    pub rotation: [f32; 4],
}

#[derive(Debug, Serialize, Clone)]
pub struct DieResult {
    #[serde(rename = "diceId")]
    pub dice_id: String,
    #[serde(rename = "diceType")]
    pub dice_type: DiceType,
    #[serde(rename = "faceValue")]
    pub face_value: u32,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_deserialize_join_message() {
        let json = r#"{"type":"join","roomId":"abc123","displayName":"Gandalf","color":"#8B5CF6"}"#;
        let msg: ClientMessage = serde_json::from_str(json).unwrap();
        match msg {
            ClientMessage::Join { room_id, display_name, color } => {
                assert_eq!(room_id, "abc123");
                assert_eq!(display_name, "Gandalf");
                assert_eq!(color, "#8B5CF6");
            }
            _ => panic!("Expected Join message"),
        }
    }

    #[test]
    fn test_deserialize_spawn_dice() {
        let json = r#"{"type":"spawn_dice","dice":[{"id":"d1","diceType":"d20"},{"id":"d2","diceType":"d6"}]}"#;
        let msg: ClientMessage = serde_json::from_str(json).unwrap();
        match msg {
            ClientMessage::SpawnDice { dice } => {
                assert_eq!(dice.len(), 2);
                assert_eq!(dice[0].dice_type, DiceType::D20);
                assert_eq!(dice[1].dice_type, DiceType::D6);
            }
            _ => panic!("Expected SpawnDice message"),
        }
    }

    #[test]
    fn test_deserialize_roll() {
        let json = r#"{"type":"roll"}"#;
        let msg: ClientMessage = serde_json::from_str(json).unwrap();
        assert!(matches!(msg, ClientMessage::Roll));
    }

    #[test]
    fn test_serialize_room_state() {
        let msg = ServerMessage::RoomState {
            room_id: "abc123".to_string(),
            players: vec![PlayerInfo {
                id: "p1".to_string(),
                display_name: "Gandalf".to_string(),
                color: "#8B5CF6".to_string(),
            }],
            dice: vec![],
        };
        let json = serde_json::to_string(&msg).unwrap();
        assert!(json.contains("\"type\":\"room_state\""));
        assert!(json.contains("\"roomId\":\"abc123\""));
        assert!(json.contains("\"displayName\":\"Gandalf\""));
    }

    #[test]
    fn test_serialize_physics_snapshot() {
        let msg = ServerMessage::PhysicsSnapshot {
            tick: 42,
            dice: vec![DiceSnapshot {
                id: "d1".to_string(),
                position: [1.0, 2.0, 3.0],
                rotation: [0.0, 0.0, 0.0, 1.0],
            }],
        };
        let json = serde_json::to_string(&msg).unwrap();
        assert!(json.contains("\"p\":[1.0,2.0,3.0]"));
        assert!(json.contains("\"r\":[0.0,0.0,0.0,1.0]"));
    }

    #[test]
    fn test_serialize_error() {
        let msg = ServerMessage::Error {
            code: "ROOM_FULL".to_string(),
            message: "Room is full (8/8 players)".to_string(),
        };
        let json = serde_json::to_string(&msg).unwrap();
        assert!(json.contains("ROOM_FULL"));
    }
}
```

**Step 2: Register module in main.rs**

```rust
mod messages;

use log::info;

#[tokio::main]
async fn main() {
    env_logger::init();
    info!("Daisu multiplayer server starting...");
}
```

**Step 3: Run tests**

```bash
cd server && cargo test
```

Expected: All 6 tests pass.

**Step 4: Commit**

```bash
git add server/src/messages.rs server/src/main.rs
git commit -m "feat(server): add client/server message types with serde serialization"
```

---

## Task 3: Player Struct

**Files:**
- Create: `server/src/player.rs`
- Modify: `server/src/main.rs`

**Step 1: Write player module with tests**

```rust
use tokio::sync::mpsc;
use crate::messages::ServerMessage;

pub type PlayerSender = mpsc::UnboundedSender<ServerMessage>;

#[derive(Debug)]
pub struct Player {
    pub id: String,
    pub display_name: String,
    pub color: String,
    pub sender: PlayerSender,
    pub dice_ids: Vec<String>,
}

impl Player {
    pub fn new(id: String, display_name: String, color: String, sender: PlayerSender) -> Self {
        Self {
            id,
            display_name,
            color,
            sender,
            dice_ids: Vec::new(),
        }
    }

    pub fn send(&self, msg: &ServerMessage) -> bool {
        self.sender.send(msg.clone()).is_ok()
    }

    pub fn to_info(&self) -> crate::messages::PlayerInfo {
        crate::messages::PlayerInfo {
            id: self.id.clone(),
            display_name: self.display_name.clone(),
            color: self.color.clone(),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_player_creation() {
        let (tx, _rx) = mpsc::unbounded_channel();
        let player = Player::new(
            "p1".to_string(),
            "Gandalf".to_string(),
            "#8B5CF6".to_string(),
            tx,
        );
        assert_eq!(player.id, "p1");
        assert_eq!(player.display_name, "Gandalf");
        assert_eq!(player.color, "#8B5CF6");
        assert!(player.dice_ids.is_empty());
    }

    #[test]
    fn test_player_to_info() {
        let (tx, _rx) = mpsc::unbounded_channel();
        let player = Player::new(
            "p1".to_string(),
            "Gandalf".to_string(),
            "#8B5CF6".to_string(),
            tx,
        );
        let info = player.to_info();
        assert_eq!(info.id, "p1");
        assert_eq!(info.display_name, "Gandalf");
    }

    #[test]
    fn test_player_send_success() {
        let (tx, _rx) = mpsc::unbounded_channel();
        let player = Player::new("p1".to_string(), "Test".to_string(), "#FFF".to_string(), tx);
        let msg = ServerMessage::Error {
            code: "TEST".to_string(),
            message: "test".to_string(),
        };
        assert!(player.send(&msg));
    }

    #[test]
    fn test_player_send_fails_when_receiver_dropped() {
        let (tx, rx) = mpsc::unbounded_channel();
        drop(rx);
        let player = Player::new("p1".to_string(), "Test".to_string(), "#FFF".to_string(), tx);
        let msg = ServerMessage::Error {
            code: "TEST".to_string(),
            message: "test".to_string(),
        };
        assert!(!player.send(&msg));
    }
}
```

**Step 2: Register module**

Add `mod player;` to `server/src/main.rs`.

**Step 3: Run tests**

```bash
cd server && cargo test
```

Expected: All tests pass (previous + 4 new).

**Step 4: Commit**

```bash
git add server/src/player.rs server/src/main.rs
git commit -m "feat(server): add Player struct with message sending"
```

---

## Task 4: Room Manager

**Files:**
- Create: `server/src/room.rs`
- Create: `server/src/room_manager.rs`
- Modify: `server/src/main.rs`

**Step 1: Write Room struct**

Create `server/src/room.rs`:

```rust
use std::collections::HashMap;
use std::time::Instant;
use crate::messages::*;
use crate::player::Player;

pub const MAX_PLAYERS: usize = 8;
pub const MAX_DICE: usize = 30;
pub const IDLE_TIMEOUT_SECS: u64 = 1800; // 30 minutes

#[derive(Debug)]
pub struct ServerDie {
    pub id: String,
    pub owner_id: String,
    pub dice_type: DiceType,
    pub position: [f32; 3],
    pub rotation: [f32; 4], // quaternion [x, y, z, w]
    pub is_rolling: bool,
    pub face_value: Option<u32>,
}

pub struct Room {
    pub id: String,
    pub players: HashMap<String, Player>,
    pub dice: HashMap<String, ServerDie>,
    pub last_activity: Instant,
    pub is_simulating: bool,
    pub tick_count: u64,
    // Rapier physics fields will be added in Plan 02
}

impl Room {
    pub fn new(id: String) -> Self {
        Self {
            id,
            players: HashMap::new(),
            dice: HashMap::new(),
            last_activity: Instant::now(),
            is_simulating: false,
            tick_count: 0,
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

    pub fn is_dice_full(&self) -> bool {
        self.dice.len() >= MAX_DICE
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

    /// Spawn dice for a player. Returns error if dice limit exceeded.
    pub fn spawn_dice(&mut self, owner_id: &str, entries: Vec<(String, DiceType)>) -> Result<Vec<DiceState>, String> {
        if self.dice.len() + entries.len() > MAX_DICE {
            return Err("DICE_LIMIT".to_string());
        }
        if !self.players.contains_key(owner_id) {
            return Err("PLAYER_NOT_FOUND".to_string());
        }

        let mut spawned = Vec::new();
        for (id, dice_type) in entries {
            let position = [0.0, 2.0, 0.0]; // Will be set by physics in Plan 02
            let rotation = [0.0, 0.0, 0.0, 1.0];
            let die = ServerDie {
                id: id.clone(),
                owner_id: owner_id.to_string(),
                dice_type,
                position,
                rotation,
                is_rolling: false,
                face_value: None,
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

        // Track dice IDs on the player
        if let Some(player) = self.players.get_mut(owner_id) {
            for d in &spawned {
                player.dice_ids.push(d.id.clone());
            }
        }

        self.touch();
        Ok(spawned)
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
}
```

**Step 2: Write RoomManager**

Create `server/src/room_manager.rs`:

```rust
use std::collections::HashMap;
use std::sync::Arc;
use tokio::sync::RwLock;
use log::info;
use crate::room::Room;

pub type SharedRoom = Arc<RwLock<Room>>;

pub struct RoomManager {
    rooms: HashMap<String, SharedRoom>,
}

impl RoomManager {
    pub fn new() -> Self {
        Self {
            rooms: HashMap::new(),
        }
    }

    pub fn create_room(&mut self) -> (String, SharedRoom) {
        let room_id = nanoid::nanoid!(6);
        let room = Arc::new(RwLock::new(Room::new(room_id.clone())));
        self.rooms.insert(room_id.clone(), room.clone());
        info!("Room created: {}", room_id);
        (room_id, room)
    }

    pub fn get_room(&self, room_id: &str) -> Option<SharedRoom> {
        self.rooms.get(room_id).cloned()
    }

    pub fn remove_room(&mut self, room_id: &str) {
        self.rooms.remove(room_id);
        info!("Room destroyed: {}", room_id);
    }

    pub fn room_count(&self) -> usize {
        self.rooms.len()
    }

    /// Remove rooms that have been empty past the idle timeout
    pub async fn cleanup_stale_rooms(&mut self) {
        let mut stale_ids = Vec::new();
        for (id, room) in &self.rooms {
            let room = room.read().await;
            if room.is_idle_expired() {
                stale_ids.push(id.clone());
            }
        }
        for id in &stale_ids {
            self.remove_room(id);
        }
        if !stale_ids.is_empty() {
            info!("Cleaned up {} stale rooms", stale_ids.len());
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_create_room() {
        let mut mgr = RoomManager::new();
        let (id, _room) = mgr.create_room();
        assert_eq!(id.len(), 6);
        assert_eq!(mgr.room_count(), 1);
    }

    #[test]
    fn test_get_room() {
        let mut mgr = RoomManager::new();
        let (id, _) = mgr.create_room();
        assert!(mgr.get_room(&id).is_some());
        assert!(mgr.get_room("nonexistent").is_none());
    }

    #[test]
    fn test_remove_room() {
        let mut mgr = RoomManager::new();
        let (id, _) = mgr.create_room();
        mgr.remove_room(&id);
        assert_eq!(mgr.room_count(), 0);
        assert!(mgr.get_room(&id).is_none());
    }

    #[test]
    fn test_multiple_rooms() {
        let mut mgr = RoomManager::new();
        let (id1, _) = mgr.create_room();
        let (id2, _) = mgr.create_room();
        assert_ne!(id1, id2);
        assert_eq!(mgr.room_count(), 2);
    }
}
```

**Step 3: Register modules in main.rs**

```rust
mod messages;
mod player;
mod room;
mod room_manager;

use log::info;

#[tokio::main]
async fn main() {
    env_logger::init();
    info!("Daisu multiplayer server starting...");
}
```

**Step 4: Run all tests**

```bash
cd server && cargo test
```

Expected: All tests pass (~25 tests total).

**Step 5: Commit**

```bash
git add server/src/
git commit -m "feat(server): add Room and RoomManager with player/dice management"
```
