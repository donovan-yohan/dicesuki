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
        let json = r##"{"type":"join","roomId":"abc123","displayName":"Gandalf","color":"#8B5CF6"}"##;
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
