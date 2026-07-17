// Clock seam (epic #111): std::time::Instant panics at runtime on wasm; web-time
// re-exports std on native and uses the Performance API on wasm.
use web_time::Instant;
use crate::messages::ServerMessage;
use crate::sink::MessageSink;

pub struct Player {
    pub id: String,
    pub display_name: String,
    pub color: String,
    /// Output seam (epic #111): the room emits protocol messages through this
    /// without knowing the host runtime. The native server wraps a tokio mpsc
    /// sender; a future wasm worker wraps `postMessage`.
    pub sender: Box<dyn MessageSink>,
    pub dice_ids: Vec<String>,
    /// Monotonic join sequence, assigned by the room on `add_player`.
    /// Used to pick the oldest remaining player when the host disconnects.
    pub join_order: u64,
    /// Stable, client-supplied token used to reclaim this seat on graceful
    /// rejoin. Empty for players that joined without one (no reconnect support).
    pub reconnect_token: String,
    /// Supabase user id (`sub` claim) this seat is bound to, when the player
    /// joined with a valid auth token. `None` for guest players (auth is
    /// optional per ADR 006). Reserved for future ownership features.
    pub user_id: Option<String>,
    /// Whether this player currently has a live WebSocket connection.
    /// A `false` value means the seat is held during the reconnect grace window.
    pub connected: bool,
    /// When the connection dropped, used to expire the grace window. `None`
    /// while connected.
    pub disconnected_at: Option<Instant>,
    /// This player's latest device-motion field (U/s²): the continuous "shake your
    /// dice box" acceleration applied each tick to their own dice (Shared-ADR-010).
    /// `[0, 0, 0]` when motion is idle. Clamped to `MOTION_FIELD_MAX_ACCEL` when set.
    pub motion_field: [f32; 3],
    /// Optional shake-derived angular acceleration (rad/s²), latched and scoped
    /// with `motion_field`. It never contains fused-orientation tilt.
    pub motion_angular_accel: [f32; 3],
    /// When `motion_field` was last updated, used to expire a stale field
    /// (`MOTION_FIELD_STALE_MS`) so dice stop if updates cease without a closing
    /// zero. `None` until the first `motion_field` message.
    pub motion_field_at: Option<Instant>,
}

impl Player {
    #[must_use]
    pub fn new(
        id: String,
        display_name: String,
        color: String,
        sender: impl MessageSink + 'static,
    ) -> Self {
        Self {
            id,
            display_name,
            color,
            sender: Box::new(sender),
            dice_ids: Vec::new(),
            join_order: 0,
            reconnect_token: String::new(),
            user_id: None,
            connected: true,
            disconnected_at: None,
            motion_field: [0.0, 0.0, 0.0],
            motion_angular_accel: [0.0, 0.0, 0.0],
            motion_field_at: None,
        }
    }

    #[must_use]
    pub fn send(&self, msg: &ServerMessage) -> bool {
        self.sender.send(msg)
    }

    #[must_use]
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
    // Runtime-free stand-in for tokio's mpsc, with matching liveness semantics.
    use crate::sink::testing as mpsc;

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
