use std::collections::HashMap;
use std::sync::Arc;
use std::time::Duration;
use tokio::sync::RwLock;
use log::info;
use crate::messages::ServerMessage;
use crate::room::{Room, RECONNECT_GRACE_SECS};

pub use crate::room::SharedRoom;

pub struct RoomManager {
    rooms: HashMap<String, SharedRoom>,
}

impl Default for RoomManager {
    fn default() -> Self {
        Self::new()
    }
}

impl RoomManager {
    #[must_use]
    pub fn new() -> Self {
        Self {
            rooms: HashMap::new(),
        }
    }

    pub fn create_room(&mut self) -> (String, SharedRoom) {
        let room_id = nanoid::nanoid!(6);
        let room = Arc::new(RwLock::new(Room::new(room_id.clone())));
        self.rooms.insert(room_id.clone(), room.clone());
        (room_id, room)
    }

    #[must_use]
    pub fn get_room(&self, room_id: &str) -> Option<SharedRoom> {
        self.rooms.get(room_id).cloned()
    }

    pub fn remove_room(&mut self, room_id: &str) {
        self.rooms.remove(room_id);
        info!("Room destroyed: {room_id}");
    }

    #[must_use]
    pub fn room_count(&self) -> usize {
        self.rooms.len()
    }

    /// A snapshot of every room's shared handle. Callers clone the `Arc`s so they
    /// can release the manager lock before acquiring per-room read locks (matching
    /// the lock-ordering discipline in the HTTP handlers). Used by the public room
    /// browser listing (`GET /api/rooms`, #79).
    #[must_use]
    pub fn rooms_snapshot(&self) -> Vec<SharedRoom> {
        self.rooms.values().cloned().collect()
    }

    /// Periodic room maintenance, run by the background task:
    /// 1. Expire disconnected players whose reconnect grace window has elapsed,
    ///    broadcasting the resulting dice/player/host changes to each room.
    /// 2. Remove rooms that have been empty past the idle timeout.
    ///
    /// Ordering matters: grace expiry can empty a room (freeing the last held
    /// seat), making it eligible for idle cleanup in the same pass.
    pub async fn run_maintenance(&mut self) {
        let grace = Duration::from_secs(RECONNECT_GRACE_SECS);

        for room in self.rooms.values() {
            let mut room = room.write().await;
            let expiry = room.expire_grace_players(grace);
            if expiry.removed_players.is_empty() {
                continue;
            }
            if !expiry.removed_dice.is_empty() {
                room.broadcast(&ServerMessage::DiceRemoved {
                    dice_ids: expiry.removed_dice,
                });
            }
            for player_id in expiry.removed_players {
                info!("Grace window expired for player {player_id} in room {}", room.id);
                room.broadcast(&ServerMessage::PlayerLeft { player_id });
            }
            if let Some(host_id) = expiry.new_host {
                room.broadcast(&ServerMessage::HostChanged { host_id });
            }
        }

        let mut stale_ids = Vec::new();
        for (id, room) in &self.rooms {
            if room.read().await.is_idle_expired() {
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
