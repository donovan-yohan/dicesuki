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
