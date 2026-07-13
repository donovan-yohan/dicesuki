use serde::{Deserialize, Serialize};

/// Current room-settings schema version. Bumped when the shape of the known
/// settings fields changes in a way clients need to reason about.
pub const ROOM_SETTINGS_VERSION: u32 = 1;

/// Versioned, forward-compatible room settings.
///
/// Only the host may mutate these. The struct carries an explicit `version`
/// plus a flattened bag (`fields`) so future additions (physics mode, theme,
/// delegated roller, ...) slot in without a protocol break: unknown/newer
/// fields round-trip through `fields` and are ignored by older clients rather
/// than causing a deserialization failure.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct RoomSettings {
    pub version: u32,
    #[serde(flatten, default)]
    pub fields: serde_json::Map<String, serde_json::Value>,
}

impl Default for RoomSettings {
    fn default() -> Self {
        Self {
            version: ROOM_SETTINGS_VERSION,
            fields: serde_json::Map::new(),
        }
    }
}

/// Messages sent from client to server
#[derive(Debug, Deserialize)]
#[serde(tag = "type")]
#[serde(rename_all = "snake_case")]
pub enum ClientMessage {
    Join {
        #[serde(rename = "roomId")]
        _room_id: String,
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
    UpdateSettings {
        settings: RoomSettings,
    },
}

#[derive(Debug, Deserialize)]
pub struct SpawnDiceEntry {
    pub id: String,
    #[serde(rename = "diceType")]
    pub dice_type: DiceType,
    pub presentation: Option<DicePresentationMetadata>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct DicePresentationMetadata {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub inventory_die_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub display_name: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub set_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub rarity: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub base_color: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub accent_color: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub material: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub custom_asset_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub custom_asset_name: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub unsupported_reason: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct VelocityHistoryEntry {
    pub position: [f32; 3],
    pub time: f32,
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
        #[serde(rename = "hostId")]
        host_id: Option<String>,
        players: Vec<PlayerInfo>,
        dice: Vec<DiceState>,
        settings: RoomSettings,
    },
    HostChanged {
        #[serde(rename = "hostId")]
        host_id: String,
    },
    SettingsUpdated {
        settings: RoomSettings,
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
    #[serde(skip_serializing_if = "Option::is_none")]
    pub presentation: Option<DicePresentationMetadata>,
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
    #[serde(skip_serializing_if = "Option::is_none")]
    pub presentation: Option<DicePresentationMetadata>,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_deserialize_join_message() {
        let json = r##"{"type":"join","roomId":"abc123","displayName":"Gandalf","color":"#8B5CF6"}"##;
        let msg: ClientMessage = serde_json::from_str(json).unwrap();
        match msg {
            #[allow(clippy::used_underscore_binding)]
            ClientMessage::Join { _room_id, display_name, color } => {
                assert_eq!(_room_id, "abc123");
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
                assert!(dice[0].presentation.is_none());
            }
            _ => panic!("Expected SpawnDice message"),
        }
    }

    #[test]
    fn test_deserialize_spawn_dice_with_presentation_metadata() {
        let json = r##"{"type":"spawn_dice","dice":[{"id":"d1","diceType":"d20","presentation":{"inventoryDieId":"die_lucky_d20","displayName":"Lucky D20","setId":"starter","rarity":"rare","baseColor":"#8b5cf6","customAssetId":"die_lucky_d20","customAssetName":"Lucky Mesh","unsupportedReason":"generic fallback"}}]}"##;
        let msg: ClientMessage = serde_json::from_str(json).unwrap();
        match msg {
            ClientMessage::SpawnDice { dice } => {
                let presentation = dice[0].presentation.as_ref().unwrap();
                assert_eq!(presentation.inventory_die_id.as_deref(), Some("die_lucky_d20"));
                assert_eq!(presentation.display_name.as_deref(), Some("Lucky D20"));
                assert_eq!(presentation.base_color.as_deref(), Some("#8b5cf6"));
                assert_eq!(presentation.unsupported_reason.as_deref(), Some("generic fallback"));
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
            host_id: Some("p1".to_string()),
            players: vec![PlayerInfo {
                id: "p1".to_string(),
                display_name: "Gandalf".to_string(),
                color: "#8B5CF6".to_string(),
            }],
            dice: vec![],
            settings: RoomSettings::default(),
        };
        let json = serde_json::to_string(&msg).unwrap();
        assert!(json.contains("\"type\":\"room_state\""));
        assert!(json.contains("\"roomId\":\"abc123\""));
        assert!(json.contains("\"displayName\":\"Gandalf\""));
        assert!(json.contains("\"hostId\":\"p1\""));
        assert!(json.contains("\"settings\":{\"version\":1}"));
    }

    #[test]
    fn test_room_settings_default_is_versioned() {
        let settings = RoomSettings::default();
        assert_eq!(settings.version, ROOM_SETTINGS_VERSION);
        assert!(settings.fields.is_empty());
    }

    #[test]
    fn test_room_settings_unknown_field_round_trips() {
        // A newer client sends a setting an older server doesn't know about.
        // It must deserialize (not crash) and round-trip through `fields`.
        let json = r#"{"version":2,"physicsMode":"arcade","theme":"neon"}"#;
        let settings: RoomSettings = serde_json::from_str(json).unwrap();
        assert_eq!(settings.version, 2);
        assert_eq!(settings.fields.get("physicsMode").unwrap(), "arcade");
        assert_eq!(settings.fields.get("theme").unwrap(), "neon");

        let reserialized = serde_json::to_string(&settings).unwrap();
        assert!(reserialized.contains("\"physicsMode\":\"arcade\""));
        assert!(reserialized.contains("\"theme\":\"neon\""));
    }

    #[test]
    fn test_deserialize_update_settings() {
        let json = r#"{"type":"update_settings","settings":{"version":1,"physicsMode":"gentle"}}"#;
        let msg: ClientMessage = serde_json::from_str(json).unwrap();
        match msg {
            ClientMessage::UpdateSettings { settings } => {
                assert_eq!(settings.version, 1);
                assert_eq!(settings.fields.get("physicsMode").unwrap(), "gentle");
            }
            _ => panic!("Expected UpdateSettings message"),
        }
    }

    #[test]
    fn test_serialize_host_changed() {
        let msg = ServerMessage::HostChanged { host_id: "p2".to_string() };
        let json = serde_json::to_string(&msg).unwrap();
        assert!(json.contains("\"type\":\"host_changed\""));
        assert!(json.contains("\"hostId\":\"p2\""));
    }

    #[test]
    fn test_serialize_settings_updated() {
        let msg = ServerMessage::SettingsUpdated { settings: RoomSettings::default() };
        let json = serde_json::to_string(&msg).unwrap();
        assert!(json.contains("\"type\":\"settings_updated\""));
        assert!(json.contains("\"version\":1"));
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
    #[allow(clippy::float_cmp)]
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
    #[allow(clippy::float_cmp)]
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
    #[allow(clippy::float_cmp)]
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
