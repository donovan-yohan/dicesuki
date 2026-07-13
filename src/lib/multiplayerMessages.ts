import type { DiceShape } from './geometries'

// ==========================================
// Client → Server Messages
// ==========================================

export interface JoinMessage {
  type: 'join'
  roomId: string
  displayName: string
  color: string
}

export interface DicePresentationMetadata {
  inventoryDieId?: string
  displayName?: string
  setId?: string
  rarity?: string
  baseColor?: string
  accentColor?: string
  material?: string
  customAssetId?: string
  customAssetName?: string
  unsupportedReason?: string
}

export interface SpawnDiceEntry {
  id: string
  diceType: DiceShape
  presentation?: DicePresentationMetadata
}

export interface SpawnDiceMessage {
  type: 'spawn_dice'
  dice: SpawnDiceEntry[]
}

export interface RemoveDiceMessage {
  type: 'remove_dice'
  diceIds: string[]
}

export interface RollMessage {
  type: 'roll'
}

export interface UpdateColorMessage {
  type: 'update_color'
  color: string
}

export interface LeaveMessage {
  type: 'leave'
}

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

export interface VelocityHistoryEntry {
  position: [number, number, number]
  time: number
}

export interface DragEndMessage {
  type: 'drag_end'
  dieId: string
  velocityHistory: VelocityHistoryEntry[]
}

/**
 * Versioned, forward-compatible room settings.
 *
 * Only the host may mutate these. `version` tracks the known-field schema;
 * the index signature keeps the type forward-compatible so future additions
 * (physics mode, theme, delegated roller, ...) flow through without a protocol
 * break, and unknown/newer fields from a newer server are simply ignored by
 * older clients rather than crashing them.
 */
export interface RoomSettings {
  version: number
  [key: string]: unknown
}

export interface UpdateSettingsMessage {
  type: 'update_settings'
  settings: RoomSettings
}

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
  | UpdateSettingsMessage

// ==========================================
// Server → Client Messages
// ==========================================

export interface PlayerInfo {
  id: string
  displayName: string
  color: string
}

export interface DiceState {
  id: string
  ownerId: string
  diceType: DiceShape
  position: [number, number, number]
  rotation: [number, number, number, number] // quaternion [x, y, z, w]
  presentation?: DicePresentationMetadata
}

export interface DiceSnapshot {
  id: string
  p: [number, number, number]        // position (compact key)
  r: [number, number, number, number] // rotation (compact key)
}

export interface DieResult {
  diceId: string
  diceType: DiceShape
  faceValue: number
  presentation?: DicePresentationMetadata
}

export interface RoomStateMessage {
  type: 'room_state'
  roomId: string
  hostId: string | null
  players: PlayerInfo[]
  dice: DiceState[]
  settings: RoomSettings
}

export interface HostChangedMessage {
  type: 'host_changed'
  hostId: string
}

export interface SettingsUpdatedMessage {
  type: 'settings_updated'
  settings: RoomSettings
}

export interface PlayerJoinedMessage {
  type: 'player_joined'
  player: PlayerInfo
}

export interface PlayerLeftMessage {
  type: 'player_left'
  playerId: string
}

export interface DiceSpawnedMessage {
  type: 'dice_spawned'
  ownerId: string
  dice: DiceState[]
}

export interface DiceRemovedMessage {
  type: 'dice_removed'
  diceIds: string[]
}

export interface RollStartedMessage {
  type: 'roll_started'
  playerId: string
  diceIds: string[]
}

export interface PhysicsSnapshotMessage {
  type: 'physics_snapshot'
  tick: number
  dice: DiceSnapshot[]
}

export interface DieSettledMessage {
  type: 'die_settled'
  diceId: string
  faceValue: number
  position: [number, number, number]
  rotation: [number, number, number, number]
}

/**
 * A previously-settled die was bumped back into motion by a collision.
 * Purely a client feedback signal (haptics/SFX) fired at the impact site; the
 * authoritative re-settled face still arrives later via a `die_settled` message.
 */
export interface DiceKnockedMessage {
  type: 'dice_knocked'
  diceId: string
  position: [number, number, number]
  impactSpeed: number
}

export interface RollCompleteMessage {
  type: 'roll_complete'
  playerId: string
  results: DieResult[]
  total: number
}

export interface ErrorMessage {
  type: 'error'
  code: string
  message: string
}

export type ServerMessage =
  | RoomStateMessage
  | HostChangedMessage
  | SettingsUpdatedMessage
  | PlayerJoinedMessage
  | PlayerLeftMessage
  | DiceSpawnedMessage
  | DiceRemovedMessage
  | RollStartedMessage
  | PhysicsSnapshotMessage
  | DieSettledMessage
  | DiceKnockedMessage
  | RollCompleteMessage
  | ErrorMessage
