-- ============================================================================
-- Daisu Multiplayer - Initial Database Schema
-- ============================================================================
-- This migration sets up the core tables for multiplayer functionality:
-- - rooms: Game rooms where players can join and play together
-- - room_players: Tracks which players are in which rooms
-- - user_preferences: Stores user settings (themes, dice presets, etc.)
-- ============================================================================

-- Enable UUID extension if not already enabled
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ============================================================================
-- ROOMS TABLE
-- ============================================================================
-- Stores metadata for multiplayer game rooms
-- Rooms are ephemeral and automatically cleaned up after expiration

CREATE TABLE rooms (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  code VARCHAR(6) UNIQUE NOT NULL,  -- Short alphanumeric code (e.g., "ABC123")
  password_hash TEXT,               -- bcrypt hash of room password (NULL for public rooms)
  owner_id UUID,                    -- Creator of the room (can be NULL for guest-created rooms)
  max_players INT DEFAULT 8 NOT NULL CHECK (max_players > 0 AND max_players <= 16),
  current_players INT DEFAULT 0 NOT NULL CHECK (current_players >= 0),
  is_active BOOLEAN DEFAULT true NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
  expires_at TIMESTAMPTZ DEFAULT (NOW() + INTERVAL '24 hours') NOT NULL,
  last_activity_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,

  -- Metadata
  room_name VARCHAR(100),           -- Optional friendly room name
  settings JSONB DEFAULT '{}'::JSONB NOT NULL  -- Room settings (max dice, physics presets, etc.)
);

-- Indexes for performance
CREATE INDEX idx_rooms_code ON rooms(code);
CREATE INDEX idx_rooms_active ON rooms(is_active) WHERE is_active = true;
CREATE INDEX idx_rooms_expires ON rooms(expires_at);
CREATE INDEX idx_rooms_last_activity ON rooms(last_activity_at);

-- ============================================================================
-- ROOM_PLAYERS TABLE
-- ============================================================================
-- Tracks which players are in which rooms
-- Junction table between rooms and players (guest or authenticated)

CREATE TABLE room_players (
  room_id UUID REFERENCES rooms(id) ON DELETE CASCADE,
  player_id UUID NOT NULL,          -- Can be auth.users.id OR a generated guest UUID
  player_name VARCHAR(50) NOT NULL, -- Display name (for guests or custom names)
  player_color VARCHAR(7) NOT NULL, -- Hex color for player's dice (e.g., "#3b82f6")
  joined_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
  last_seen_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
  is_guest BOOLEAN DEFAULT false NOT NULL,

  PRIMARY KEY (room_id, player_id)
);

-- Indexes
CREATE INDEX idx_room_players_room ON room_players(room_id);
CREATE INDEX idx_room_players_player ON room_players(player_id);
CREATE INDEX idx_room_players_last_seen ON room_players(last_seen_at);

-- ============================================================================
-- USER_PREFERENCES TABLE
-- ============================================================================
-- Stores user preferences (only for authenticated users, not guests)
-- Synced across devices

CREATE TABLE user_preferences (
  user_id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,

  -- Dice presets (saved dice configurations)
  dice_presets JSONB DEFAULT '[]'::JSONB NOT NULL,

  -- Theme settings
  theme_id VARCHAR(50) DEFAULT 'default' NOT NULL,

  -- UI preferences
  haptic_enabled BOOLEAN DEFAULT true NOT NULL,
  motion_mode_enabled BOOLEAN DEFAULT true NOT NULL,

  -- Timestamps
  created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
);

-- Index for lookups
CREATE INDEX idx_user_preferences_user ON user_preferences(user_id);

-- ============================================================================
-- FUNCTIONS & TRIGGERS
-- ============================================================================

-- Function: Update updated_at timestamp
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Trigger: Auto-update updated_at on user_preferences
CREATE TRIGGER update_user_preferences_updated_at
  BEFORE UPDATE ON user_preferences
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- Function: Update last_activity_at on rooms when players join/leave
CREATE OR REPLACE FUNCTION update_room_last_activity()
RETURNS TRIGGER AS $$
BEGIN
  UPDATE rooms
  SET last_activity_at = NOW()
  WHERE id = COALESCE(NEW.room_id, OLD.room_id);
  RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql;

-- Trigger: Update room activity when players join/leave
CREATE TRIGGER update_room_activity_on_player_change
  AFTER INSERT OR UPDATE OR DELETE ON room_players
  FOR EACH ROW
  EXECUTE FUNCTION update_room_last_activity();

-- Function: Update current_players count
CREATE OR REPLACE FUNCTION update_room_player_count()
RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    UPDATE rooms
    SET current_players = current_players + 1
    WHERE id = NEW.room_id;
  ELSIF TG_OP = 'DELETE' THEN
    UPDATE rooms
    SET current_players = current_players - 1
    WHERE id = OLD.room_id;
  END IF;
  RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql;

-- Trigger: Auto-update current_players count
CREATE TRIGGER update_room_player_count_trigger
  AFTER INSERT OR DELETE ON room_players
  FOR EACH ROW
  EXECUTE FUNCTION update_room_player_count();

-- Function: Clean up expired rooms
-- This should be called periodically (e.g., via cron job or scheduled function)
CREATE OR REPLACE FUNCTION cleanup_expired_rooms()
RETURNS void AS $$
BEGIN
  -- Delete rooms that have expired
  DELETE FROM rooms
  WHERE expires_at < NOW()
    OR (is_active = false AND last_activity_at < NOW() - INTERVAL '1 hour');
END;
$$ LANGUAGE plpgsql;

-- ============================================================================
-- ROW LEVEL SECURITY (RLS)
-- ============================================================================

-- Enable RLS on all tables
ALTER TABLE rooms ENABLE ROW LEVEL SECURITY;
ALTER TABLE room_players ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_preferences ENABLE ROW LEVEL SECURITY;

-- Rooms Policies
-- Anyone can read active rooms (for browsing/joining)
CREATE POLICY "Anyone can read active rooms"
  ON rooms FOR SELECT
  USING (is_active = true);

-- Anyone can create rooms (guests or authenticated users)
CREATE POLICY "Anyone can create rooms"
  ON rooms FOR INSERT
  WITH CHECK (true);

-- Only room owner can update room settings
CREATE POLICY "Room owner can update room"
  ON rooms FOR UPDATE
  USING (owner_id IS NULL OR auth.uid() = owner_id);

-- Only room owner can delete room
CREATE POLICY "Room owner can delete room"
  ON rooms FOR DELETE
  USING (owner_id IS NULL OR auth.uid() = owner_id);

-- Room Players Policies
-- Anyone can read players in a room they're part of
CREATE POLICY "Players can read room players"
  ON room_players FOR SELECT
  USING (
    room_id IN (
      SELECT room_id FROM room_players WHERE player_id = auth.uid()
    )
    OR is_guest = true  -- Allow reading guest players
  );

-- Anyone can join a room (guests or authenticated users)
CREATE POLICY "Anyone can join rooms"
  ON room_players FOR INSERT
  WITH CHECK (true);

-- Players can update their own entry (e.g., last_seen_at)
CREATE POLICY "Players can update themselves"
  ON room_players FOR UPDATE
  USING (player_id = auth.uid() OR is_guest = true);

-- Players can leave rooms
CREATE POLICY "Players can leave rooms"
  ON room_players FOR DELETE
  USING (player_id = auth.uid() OR is_guest = true);

-- User Preferences Policies
-- Users can only read their own preferences
CREATE POLICY "Users can read own preferences"
  ON user_preferences FOR SELECT
  USING (auth.uid() = user_id);

-- Users can insert their own preferences
CREATE POLICY "Users can insert own preferences"
  ON user_preferences FOR INSERT
  WITH CHECK (auth.uid() = user_id);

-- Users can update their own preferences
CREATE POLICY "Users can update own preferences"
  ON user_preferences FOR UPDATE
  USING (auth.uid() = user_id);

-- Users can delete their own preferences
CREATE POLICY "Users can delete own preferences"
  ON user_preferences FOR DELETE
  USING (auth.uid() = user_id);

-- ============================================================================
-- HELPER FUNCTIONS (API)
-- ============================================================================

-- Function: Generate unique room code
CREATE OR REPLACE FUNCTION generate_room_code()
RETURNS VARCHAR(6) AS $$
DECLARE
  chars TEXT := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';  -- Exclude ambiguous chars (0,O,1,I)
  result VARCHAR(6) := '';
  i INT;
BEGIN
  FOR i IN 1..6 LOOP
    result := result || substr(chars, floor(random() * length(chars) + 1)::int, 1);
  END LOOP;

  -- Check if code already exists (recursive call if collision)
  IF EXISTS (SELECT 1 FROM rooms WHERE code = result) THEN
    RETURN generate_room_code();  -- Recursive retry
  END IF;

  RETURN result;
END;
$$ LANGUAGE plpgsql;

-- Function: Check if player can join room
CREATE OR REPLACE FUNCTION can_join_room(
  p_room_id UUID,
  p_password TEXT DEFAULT NULL
)
RETURNS BOOLEAN AS $$
DECLARE
  v_room RECORD;
BEGIN
  -- Get room details
  SELECT * INTO v_room FROM rooms WHERE id = p_room_id AND is_active = true;

  -- Room doesn't exist or is inactive
  IF NOT FOUND THEN
    RETURN false;
  END IF;

  -- Room is full
  IF v_room.current_players >= v_room.max_players THEN
    RETURN false;
  END IF;

  -- Room has password but none provided
  IF v_room.password_hash IS NOT NULL AND p_password IS NULL THEN
    RETURN false;
  END IF;

  -- Password provided but doesn't match (handled in application layer with bcrypt)
  -- We can't verify bcrypt in SQL, so this is just a placeholder
  -- Actual verification happens in the application

  RETURN true;
END;
$$ LANGUAGE plpgsql;

-- ============================================================================
-- COMMENTS
-- ============================================================================

COMMENT ON TABLE rooms IS 'Multiplayer game rooms where players can join and play together';
COMMENT ON TABLE room_players IS 'Junction table tracking which players are in which rooms';
COMMENT ON TABLE user_preferences IS 'User preferences for authenticated users (synced across devices)';
COMMENT ON FUNCTION cleanup_expired_rooms() IS 'Deletes expired rooms and inactive rooms. Should be called periodically via cron.';
COMMENT ON FUNCTION generate_room_code() IS 'Generates a unique 6-character room code for easy sharing';
COMMENT ON FUNCTION can_join_room(UUID, TEXT) IS 'Checks if a player can join a room (capacity, password, etc.)';
