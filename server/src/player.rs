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
