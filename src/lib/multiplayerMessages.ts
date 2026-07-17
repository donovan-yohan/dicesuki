import type { DiceShape } from './geometries'

// ==========================================
// Client → Server Messages
// ==========================================

export interface JoinMessage {
  type: 'join'
  roomId: string
  displayName: string
  color: string
  /** Stable token used to reclaim a held seat after a dropped connection. */
  reconnectToken?: string
  /** Current Supabase access token; never persisted with room resume data. */
  authToken?: string
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
  customAssetVersionId?: string
  customAssetName?: string
  unsupportedReason?: string
}

export interface SpawnDiceEntry {
  id: string
  diceType: DiceShape
  presentation?: DicePresentationMetadata
  /**
   * Optional explicit resting position `[x, y, z]`. When present the server
   * places the die here (clamped into the arena) instead of the default drop
   * grid — used to carry a solo room's dice into a fresh server room at their
   * exact spots (Shared-ADR-005). Omitted for normal drop-in spawns.
   */
  position?: [number, number, number]
  /**
   * Optional explicit resting orientation (quaternion `[x, y, z, w]`), paired
   * with {@link position} so a carried die reproduces the same face. Omitted for
   * normal spawns.
   */
  rotation?: [number, number, number, number]
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

export interface RemovePlayerMessage {
  type: 'remove_player'
  playerId: string
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

/**
 * Host-controlled policy governing which dice a player's device-motion
 * (shake/gravity) input may affect. Kept in sync with the server `MotionControl`
 * enum (server/src/room.rs).
 * - `off`: motion input is disabled room-wide.
 * - `own_dice`: a player's motion affects only the dice they own.
 * - `room`: a player's motion affects every die on the table (pairs with the
 *   delegated-roller role, #73).
 */
export type MotionControl = 'off' | 'own_dice' | 'room'

/** Settings key holding the room's {@link MotionControl} policy. */
export const MOTION_CONTROL_SETTING = 'motionControl'

/** Default policy for a fresh room — motion scoped to your own dice. */
export const DEFAULT_MOTION_CONTROL: MotionControl = 'own_dice'

/** Read the room's {@link MotionControl}, falling back to the default. */
export function getMotionControl(settings: RoomSettings | null | undefined): MotionControl {
  const raw = settings?.[MOTION_CONTROL_SETTING]
  if (raw === 'off' || raw === 'own_dice' || raw === 'room') {
    return raw
  }
  return DEFAULT_MOTION_CONTROL
}

/**
 * Return a new {@link RoomSettings} with the motion policy set to `mode`,
 * preserving all other fields. Never mutates the input.
 */
export function setMotionControl(settings: RoomSettings, mode: MotionControl): RoomSettings {
  return { ...settings, [MOTION_CONTROL_SETTING]: mode }
}

/** Settings key holding the delegated roller's player id (absent for none). */
export const ROLLER_SETTING = 'roller'

/**
 * Read the delegated roller's player id from settings, or `null` when no roller
 * is assigned. The roller (set by the host) controls every die on the table —
 * drag and motion — until the host revokes or reassigns the role (#73).
 */
export function getRoller(settings: RoomSettings | null | undefined): string | null {
  const raw = settings?.[ROLLER_SETTING]
  return typeof raw === 'string' && raw.length > 0 ? raw : null
}

/**
 * Return a new {@link RoomSettings} with the delegated roller set to `playerId`
 * (or cleared when `null`), preserving all other fields. Never mutates the input.
 */
export function setRoller(settings: RoomSettings, playerId: string | null): RoomSettings {
  const next = { ...settings }
  if (playerId) {
    next[ROLLER_SETTING] = playerId
  } else {
    delete next[ROLLER_SETTING]
  }
  return next
}

/**
 * Settings key holding the room's shared visual theme id (environment + tray).
 * Kept in sync with the server `THEME_SETTING` constant (server/src/room.rs, #75).
 */
export const THEME_SETTING = 'themeId'

/**
 * Read the room's shared theme id from settings, or `null` when the host has not
 * set one. The value is opaque here — the environment layer resolves it against
 * the client theme registry and falls back to the default theme for an unknown
 * id (#75). `null` means clients keep their own personal theme.
 */
export function getRoomThemeId(settings: RoomSettings | null | undefined): string | null {
  const raw = settings?.[THEME_SETTING]
  return typeof raw === 'string' && raw.length > 0 ? raw : null
}

/**
 * Return a new {@link RoomSettings} with the shared theme set to `themeId`
 * (or cleared when `null`), preserving all other fields. Never mutates the input.
 */
export function setRoomThemeId(settings: RoomSettings, themeId: string | null): RoomSettings {
  const next = { ...settings }
  if (themeId) {
    next[THEME_SETTING] = themeId
  } else {
    delete next[THEME_SETTING]
  }
  return next
}

/**
 * Room discovery visibility (#79). Kept in sync with the server (server/src/room.rs):
 * - `public`: the room appears in the public browser (`GET /api/rooms`).
 * - `unlisted`: the room is reachable only by code and never listed (default).
 */
export type RoomVisibility = 'public' | 'unlisted'

/** Settings key holding the room's {@link RoomVisibility}. */
export const VISIBILITY_SETTING = 'visibility'

/** Wire value marking a room as publicly discoverable. */
export const VISIBILITY_PUBLIC: RoomVisibility = 'public'

/**
 * Default visibility for a fresh room — unlisted (private). Rooms only appear in
 * the public browser after a host explicitly opts in.
 */
export const DEFAULT_VISIBILITY: RoomVisibility = 'unlisted'

/** Settings key holding the host-chosen display name for the public browser. */
export const ROOM_NAME_SETTING = 'roomName'

/** Maximum characters retained from a host-supplied room name (matches server). */
export const ROOM_NAME_MAX_LEN = 40

/** Read the room's {@link RoomVisibility}, falling back to the default (unlisted). */
export function getVisibility(settings: RoomSettings | null | undefined): RoomVisibility {
  return settings?.[VISIBILITY_SETTING] === VISIBILITY_PUBLIC ? 'public' : DEFAULT_VISIBILITY
}

/** True when the room is publicly discoverable. */
export function isRoomPublic(settings: RoomSettings | null | undefined): boolean {
  return getVisibility(settings) === 'public'
}

/**
 * Return a new {@link RoomSettings} with visibility set to `visibility`,
 * preserving all other fields. Never mutates the input.
 */
export function setVisibility(settings: RoomSettings, visibility: RoomVisibility): RoomSettings {
  return { ...settings, [VISIBILITY_SETTING]: visibility }
}

/**
 * Sanitize a host-supplied room name for display/transport: strip control
 * characters, collapse whitespace runs, trim, and cap length. Mirrors the
 * server's `sanitize_room_name` so the client shows what the server will store.
 */
export function sanitizeRoomName(raw: string): string {
  return raw
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001F\u007F]/g, ' ')
    .split(/\s+/)
    .filter(Boolean)
    .join(' ')
    .slice(0, ROOM_NAME_MAX_LEN)
}

/** Read the host-chosen room name, or `null` when unset/blank after sanitizing. */
export function getRoomName(settings: RoomSettings | null | undefined): string | null {
  const raw = settings?.[ROOM_NAME_SETTING]
  if (typeof raw !== 'string') return null
  const clean = sanitizeRoomName(raw)
  return clean.length > 0 ? clean : null
}

/**
 * Return a new {@link RoomSettings} with the room name set (sanitized) or cleared
 * when blank, preserving all other fields. Never mutates the input.
 */
export function setRoomName(settings: RoomSettings, name: string): RoomSettings {
  const clean = sanitizeRoomName(name)
  const next = { ...settings }
  if (clean.length > 0) {
    next[ROOM_NAME_SETTING] = clean
  } else {
    delete next[ROOM_NAME_SETTING]
  }
  return next
}

/**
 * Continuous device-motion field (Shared-ADR-010). `field` is a world-space
 * acceleration (engine U/s²) — fused tilt correction plus shake pseudo-force —
 * the server applies each tick to the dice the sender may affect under the room's
 * `motionControl` policy. Latched with a staleness timeout and magnitude-clamped
 * server-side. Streamed while motion is engaged; a single zero field stops it.
 */
export interface MotionFieldMessage {
  type: 'motion_field'
  field: [number, number, number]
  /** Optional for backward compatibility with clients predating shake tumble. */
  angularAccel?: [number, number, number]
}

/**
 * Host-only: resize the shared arena to `aspect` (width/height). The server
 * derives area-preserving bounds and broadcasts an `arena_changed` (Shared-ADR-009).
 */
export interface SetArenaMessage {
  type: 'set_arena'
  aspect: number
}

export type ClientMessage =
  | JoinMessage
  | SpawnDiceMessage
  | RemoveDiceMessage
  | RollMessage
  | UpdateColorMessage
  | LeaveMessage
  | RemovePlayerMessage
  | DragStartMessage
  | DragMoveMessage
  | DragEndMessage
  | UpdateSettingsMessage
  | MotionFieldMessage
  | SetArenaMessage

// ==========================================
// Server → Client Messages
// ==========================================

export interface PlayerInfo {
  id: string
  displayName: string
  color: string
  /** False while the server holds this seat during reconnect grace. */
  connected?: boolean
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

/**
 * Engine physics constants the client needs at runtime, delivered by the room
 * (native server OR wasm worker) so the browser never keeps a copied literal.
 *
 * This is the client mirror of `dicesuki_core::config::EngineConfig` — the single
 * source of truth defined once in `server/core/src/physics.rs` (epic #111,
 * Shared-ADR-007). Fields are the subset the frontend consumes today (arena
 * bounds for camera fit + wall rendering); the rest are carried for reference and
 * forward-compatibility. Optional so a pre-config test message still type-checks.
 */
export interface EngineConfig {
  gravity: number
  diceRestitution: number
  diceFriction: number
  linearVelocityThreshold: number
  angularVelocityThreshold: number
  restDurationMs: number
  knockWakeLinearSpeed: number
  knockWakeAngularSpeed: number
  rollHorizontalMin: number
  rollHorizontalMax: number
  rollVerticalMin: number
  rollVerticalMax: number
  rollTorqueMagnitude: number
  throwVelocityScale: number
  throwUpwardBoost: number
  minThrowSpeed: number
  maxThrowSpeed: number
  maxDiceVelocity: number
  dragFollowSpeed: number
  dragDistanceBoost: number
  dragDistanceThreshold: number
  dragSpinFactor: number
  dragRollFactor: number
  motionFieldMaxAccel: number
  motionFieldMaxAngularAccel: number
  motionFieldMaxAngularSpeed: number
  motionFieldStaleMs: number
  arenaHalfX: number
  arenaHalfZ: number
  arenaGroundY: number
  arenaCeilingY: number
  arenaWallHeight: number
  arenaWallThickness: number
}

export interface RoomStateMessage {
  type: 'room_state'
  roomId: string
  hostId: string | null
  /**
   * The recipient's own player id. Present so the client can identify itself
   * deterministically, including on graceful rejoin where the reclaimed player
   * is not necessarily last in the (unordered) players list.
   */
  localPlayerId?: string | null
  players: PlayerInfo[]
  dice: DiceState[]
  settings: RoomSettings
  /** Engine constants from the room's `dicesuki-core` build (Shared-ADR-007). */
  config?: EngineConfig
}

export interface HostChangedMessage {
  type: 'host_changed'
  hostId: string
}

export interface SettingsUpdatedMessage {
  type: 'settings_updated'
  settings: RoomSettings
}

/**
 * The host resized the shared arena (Shared-ADR-009). Carries the room's new
 * `EngineConfig` (arena bounds) so every client reflows walls, shadows, and
 * camera. Unlike `room_state.config` this is broadcast mid-session, not join-only.
 */
export interface ArenaChangedMessage {
  type: 'arena_changed'
  config: EngineConfig
}

export interface PlayerJoinedMessage {
  type: 'player_joined'
  player: PlayerInfo
}

export interface PlayerLeftMessage {
  type: 'player_left'
  playerId: string
}

export interface PlayerPresenceChangedMessage {
  type: 'player_presence_changed'
  playerId: string
  connected: boolean
}

export interface RemovedFromRoomMessage {
  type: 'removed_from_room'
  reason: string
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
  | ArenaChangedMessage
  | PlayerJoinedMessage
  | PlayerLeftMessage
  | PlayerPresenceChangedMessage
  | RemovedFromRoomMessage
  | DiceSpawnedMessage
  | DiceRemovedMessage
  | RollStartedMessage
  | PhysicsSnapshotMessage
  | DieSettledMessage
  | DiceKnockedMessage
  | RollCompleteMessage
  | ErrorMessage
