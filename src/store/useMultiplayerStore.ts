import { create } from 'zustand'
import type { DiceShape } from '../lib/geometries'
import type {
  ClientMessage,
  ServerMessage,
  PlayerInfo,
  DiceState,
  DicePresentationMetadata,
  RoomSettings,
  VelocityHistoryEntry,
  MotionControl,
  EngineConfig,
} from '../lib/multiplayerMessages'
import {
  getMotionControl,
  setMotionControl as withMotionControl,
  setRoller as withRoller,
  setRoomThemeId as withRoomTheme,
  setVisibility as withVisibility,
  setRoomName as withRoomName,
} from '../lib/multiplayerMessages'
import type { RoomVisibility } from '../lib/multiplayerMessages'
import type { CarriedDie } from '../lib/roomCarry'
import { MOTION_IMPULSE_MIN_INTERVAL_MS } from '../config/physicsConfig'
import { getWsServerUrl } from '../lib/multiplayerServer'
import { createWorkerRoomTransport } from '../lib/workerRoomTransport'
import { arenaDimensionsForViewport } from '../config/renderScale'
import { triggerCollisionFeedback } from '../lib/collisionFeedback'
import { useDiceStore } from './useDiceStore'

export type ConnectionStatus = 'disconnected' | 'connecting' | 'connected' | 'error'

/**
 * Which transport a room connection runs over. `'websocket'` reaches the public
 * multiplayer server over the network; `'worker'` reaches the in-browser WASM
 * room worker over `postMessage` (solo). Both speak the identical JSON room
 * protocol, so every action below (join, spawn, roll, snapshots, settle,
 * settings, drag, motion) is transport-agnostic — only the socket object differs
 * (issue #114, epic #111).
 */
export type RoomTransportKind = 'websocket' | 'worker'

/** Sentinel `serverUrl` recorded for solo (worker-backed) connections. */
export const SOLO_WORKER_SERVER_URL = 'worker://solo'

/**
 * The `WebSocket`-shaped slice the store depends on, satisfied by both a real
 * `WebSocket` (public multiplayer) and the {@link WorkerRoomTransport} (solo).
 * Narrowing to this interface is what makes the connection layer
 * transport-agnostic.
 */
export interface RoomSocket {
  send(data: string): void
  close(): void
  readonly readyState: number
  onopen: ((event: Event) => void) | null
  onmessage: ((event: MessageEvent) => void) | null
  onerror: ((event: Event) => void) | null
  onclose: ((event: CloseEvent) => void) | null
}

/**
 * Build the room socket for a connection. Public multiplayer opens a real
 * `WebSocket`; solo constructs a {@link WorkerRoomTransport} over the WASM room
 * worker. Both are `WebSocket`-shaped ({@link RoomSocket}), so the rest of the
 * connection logic is identical regardless of transport.
 */
function createRoomSocket(
  transport: RoomTransportKind,
  params: { roomId: string; serverUrl: string },
): RoomSocket {
  if (transport === 'worker') {
    // Size the solo arena to the current viewport at the fixed on-screen dice
    // scale (ADR-008 amendment): a die stays real-die-sized and a larger canvas
    // yields a larger box. Derived from the SAME scale the camera uses
    // (`renderScale`), so the walls frame exactly what's on screen. Captured once
    // here, at room creation; live resize is out of scope. `undefined` in
    // non-DOM/degenerate contexts falls back to the fixed 9:16 arena.
    const arena =
      typeof window !== 'undefined'
        ? arenaDimensionsForViewport(window.innerWidth, window.innerHeight)
        : undefined
    return createWorkerRoomTransport(params.roomId, arena?.width, arena?.depth)
  }
  return new WebSocket(`${params.serverUrl}/ws/${params.roomId}`)
}

export interface MultiplayerDie {
  id: string
  ownerId: string
  diceType: DiceShape
  presentation?: DicePresentationMetadata
  // Current rendered position (interpolated)
  position: [number, number, number]
  rotation: [number, number, number, number]
  // Target position (from latest snapshot)
  targetPosition: [number, number, number]
  targetRotation: [number, number, number, number]
  // Previous position (for interpolation)
  prevPosition: [number, number, number]
  prevRotation: [number, number, number, number]
  // State
  isRolling: boolean
  faceValue: number | null
}

interface MultiplayerState {
  // Connection
  connectionStatus: ConnectionStatus
  socket: RoomSocket | null
  serverUrl: string
  connectionError: string | null

  // Room
  roomId: string | null
  players: Map<string, PlayerInfo>
  localPlayerId: string | null

  // Reconnect / lifecycle
  /** Stable token that lets the server reclaim this seat on a graceful rejoin. */
  reconnectToken: string | null
  /** Number of consecutive auto-reconnect attempts since the last live socket. */
  reconnectAttempts: number
  /** True when the client itself asked to leave (suppresses auto-reconnect). */
  intentionalDisconnect: boolean
  /** Parameters of the last join, replayed by auto-reconnect. */
  lastJoin: { roomId: string; displayName: string; color: string; serverUrl: string; token: string; transport: RoomTransportKind } | null
  /** User-facing notice shown when a room went away (idle cleanup / unreachable). */
  roomClosedNotice: string | null
  // Host role & settings
  hostId: string | null
  isHost: boolean
  roomSettings: RoomSettings
  /**
   * Engine physics constants the room delivered via `room_state.config` — the
   * single source of truth from `dicesuki-core` (Shared-ADR-007). `null` until a
   * room is joined. Read through `src/config/engineConfig.ts`, not a local literal.
   */
  engineConfig: EngineConfig | null

  // Dice
  dice: Map<string, MultiplayerDie>
  pendingInventoryDieIds: Set<string>

  // Snapshot interpolation
  lastSnapshotTime: number
  snapshotInterval: number // ms between snapshots (should match server SNAPSHOT_DIVISOR)

  // Parse error tracking
  parseErrorCount: number

  // Actions
  connect: (roomId: string, displayName: string, color: string, serverUrl?: string, transport?: RoomTransportKind) => void
  disconnect: () => void
  sendMessage: (msg: ClientMessage) => void
  handleServerMessage: (msg: ServerMessage) => void

  // Game actions
  spawnDice: (diceType: DiceShape, presentation?: DicePresentationMetadata) => void
  /**
   * Recreate a batch of carried dice (Shared-ADR-005) in one spawn message, each
   * at its explicit resting position/rotation. Used by the "Go Online" flow to
   * bring a solo room's dice into a fresh server room.
   */
  spawnCarriedDice: (dice: CarriedDie[]) => void
  removeDice: (diceIds: string[]) => void
  roll: () => void
  updateColor: (color: string) => void
  updateSettings: (settings: RoomSettings) => void
  /** Host-only: set the room's device-motion policy. No-op for non-hosts. */
  setMotionControl: (mode: MotionControl) => void
  /**
   * Host-only: delegate (or, with `null`, revoke) the roller role — the single
   * player who controls every die on the table (drag + motion). No-op for
   * non-hosts; the server re-validates.
   */
  setRoller: (playerId: string | null) => void
  /** Host-only: mark the room public or unlisted in the browser (#79). */
  setVisibility: (visibility: RoomVisibility) => void
  /** Host-only: set the room's display name for the public browser (#79). */
  setRoomName: (name: string) => void
  /**
   * Host-only: set (or, with `null`, clear) the room's shared visual theme — the
   * environment/tray look every client applies from room settings (#75). No-op
   * for non-hosts; the server re-validates. Personal dice skins are unaffected.
   */
  setRoomTheme: (themeId: string | null) => void
  /**
   * Host-only: resize the shared arena to `aspect` (width/height). The server
   * re-validates, derives area-preserving bounds, and broadcasts `arena_changed`
   * (Shared-ADR-009). No-op for non-hosts. The solo player is the host, so this
   * works in solo too.
   */
  setArena: (aspect: number) => void
  /**
   * Send a device-motion (shake/gravity) impulse. Policy-aware: silently drops
   * when motion is disabled (`off`) and throttles to `MOTION_IMPULSE_MIN_INTERVAL_MS`.
   * The server remains authoritative over which dice the impulse affects.
   * The DeviceMotion sensor that feeds this lands in #74.
   */
  sendMotionImpulse: (impulse: [number, number, number]) => void

  // Drag actions
  startDrag: (dieId: string, grabOffset: [number, number, number], worldPosition: [number, number, number]) => void
  moveDrag: (dieId: string, worldPosition: [number, number, number]) => void
  endDrag: (dieId: string, velocityHistory: VelocityHistoryEntry[]) => void
  // Player filtering
  selectedPlayerId: string | null
  setSelectedPlayerId: (playerId: string | null) => void

  // Internal
  setConnectionStatus: (status: ConnectionStatus) => void
  reset: () => void
}

const createInitialState = () => ({
  connectionStatus: 'disconnected' as ConnectionStatus,
  socket: null as RoomSocket | null,
  serverUrl: getWsServerUrl(),
  connectionError: null as string | null,
  roomId: null as string | null,
  players: new Map<string, PlayerInfo>(),
  localPlayerId: null as string | null,
  reconnectToken: null as string | null,
  reconnectAttempts: 0,
  intentionalDisconnect: false,
  lastJoin: null as MultiplayerState['lastJoin'],
  roomClosedNotice: null as string | null,
  hostId: null as string | null,
  isHost: false,
  roomSettings: { version: 1 } as RoomSettings,
  engineConfig: null as EngineConfig | null,
  dice: new Map<string, MultiplayerDie>(),
  pendingInventoryDieIds: new Set<string>(),
  lastSnapshotTime: 0,
  snapshotInterval: 1000 / 60, // ~16.67ms — must match server SNAPSHOT_DIVISOR=1 (60Hz)
  selectedPlayerId: null as string | null,
  parseErrorCount: 0,
})

type StoreSet = (partial: Partial<MultiplayerState>) => void
type StoreGet = () => MultiplayerState

const MAX_RECONNECT_ATTEMPTS = 5
const RECONNECT_BASE_DELAY_MS = 1000
const RECONNECT_MAX_DELAY_MS = 8000
const ROOM_CLOSED_MESSAGE =
  'Lost connection to this room. It may have been closed after a period of inactivity. Rejoin to start again.'

/**
 * Server `error` codes that can only occur while attempting to join (before a
 * `room_state` arrives). These are terminal for the join attempt — retrying with
 * the same input will not help — so we surface them on the join form instead of
 * silently swallowing the error or auto-reconnecting.
 */
const JOIN_ERROR_CODES = new Set(['ROOM_FULL', 'INVALID_NAME', 'INVALID_COLOR', 'ALREADY_JOINED'])

let reconnectTimer: ReturnType<typeof setTimeout> | null = null

/** Timestamp (performance.now) of the last sent motion impulse, for throttling.
 *  Starts at -Infinity so the first impulse always passes the throttle. */
let lastMotionImpulseSentAt = Number.NEGATIVE_INFINITY

function clearReconnectTimer() {
  if (reconnectTimer !== null) {
    clearTimeout(reconnectTimer)
    reconnectTimer = null
  }
}

/**
 * Return a stable per-room reconnect token, persisted in sessionStorage so a
 * page reload within the grace window still reclaims the same seat. Falls back
 * to an ephemeral token when sessionStorage is unavailable (SSR/tests).
 */
function getOrCreateReconnectToken(roomId: string): string {
  const key = `dicesuki:reconnectToken:${roomId}`
  const mint = () => `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
  try {
    const existing = sessionStorage.getItem(key)
    if (existing) return existing
    const token = mint()
    sessionStorage.setItem(key, token)
    return token
  } catch {
    return mint()
  }
}

/**
 * Open a WebSocket and wire its lifecycle handlers, including auto-reconnect on
 * an unexpected drop. Shared by the user-initiated `connect` and the backoff
 * reconnect loop.
 */
function establishConnection(
  set: StoreSet,
  get: StoreGet,
  params: { roomId: string; displayName: string; color: string; serverUrl: string; token: string; transport: RoomTransportKind },
) {
  const { roomId, displayName, color, serverUrl, token, transport } = params
  const existingSocket = get().socket
  if (existingSocket) {
    existingSocket.close()
  }

  const socket = createRoomSocket(transport, { roomId, serverUrl })
  set({ socket, connectionStatus: 'connecting', serverUrl, parseErrorCount: 0 })

  socket.onopen = () => {
    if (get().socket !== socket) {
      socket.close()
      return
    }
    // A live connection resets the retry budget and clears prior notices.
    set({
      socket,
      connectionStatus: 'connected',
      roomId,
      reconnectAttempts: 0,
      connectionError: null,
      roomClosedNotice: null,
    })
    const joinMsg: ClientMessage = { type: 'join', roomId, displayName, color, reconnectToken: token }
    socket.send(JSON.stringify(joinMsg))
  }

  socket.onmessage = (event) => {
    try {
      const msg: ServerMessage = JSON.parse(event.data)
      get().handleServerMessage(msg)
      if (get().parseErrorCount !== 0) {
        set({ parseErrorCount: 0 })
      }
    } catch (e) {
      console.error('[Multiplayer] Failed to parse server message:', e)
      const newCount = get().parseErrorCount + 1
      if (newCount > 3) {
        set({ parseErrorCount: newCount, connectionStatus: 'error' })
      } else {
        set({ parseErrorCount: newCount })
      }
    }
  }

  socket.onerror = (error) => {
    // Log only — the following `onclose` drives state and reconnection so we
    // don't tear down the socket mid-retry.
    console.error('[Multiplayer] WebSocket error:', error)
  }

  socket.onclose = () => {
    if (get().socket !== socket) return

    const { intentionalDisconnect, reconnectAttempts, lastJoin } = get()
    if (intentionalDisconnect) {
      set({ connectionStatus: 'disconnected', socket: null })
      return
    }

    // The solo worker transport is local: it never drops mid-session, and
    // re-spinning a fresh wasm room would silently lose all table state. Treat an
    // unexpected close as terminal rather than reconnecting.
    if (lastJoin?.transport === 'worker') {
      set({ connectionStatus: 'disconnected', socket: null })
      return
    }

    // Exhausted retries (or no join to replay): surface an understandable notice
    // instead of failing silently.
    if (reconnectAttempts >= MAX_RECONNECT_ATTEMPTS || !lastJoin) {
      set({
        connectionStatus: 'disconnected',
        socket: null,
        roomClosedNotice: ROOM_CLOSED_MESSAGE,
      })
      return
    }

    const attempt = reconnectAttempts + 1
    const delay = Math.min(RECONNECT_BASE_DELAY_MS * 2 ** (attempt - 1), RECONNECT_MAX_DELAY_MS)
    set({ connectionStatus: 'connecting', socket: null, reconnectAttempts: attempt })
    clearReconnectTimer()
    reconnectTimer = setTimeout(() => {
      reconnectTimer = null
      const replay = get().lastJoin
      if (replay && !get().intentionalDisconnect) {
        establishConnection(set, get, replay)
      }
    }, delay)
  }
}

export const useMultiplayerStore = create<MultiplayerState>((set, get) => ({
  ...createInitialState(),

  connect: (roomId: string, displayName: string, color: string, serverUrlOverride?: string, transport: RoomTransportKind = 'websocket') => {
    clearReconnectTimer()
    // Solo (worker) connections have no network server; record a sentinel URL so
    // any UI that reads `serverUrl` shows something coherent.
    const activeServerUrl =
      transport === 'worker' ? SOLO_WORKER_SERVER_URL : serverUrlOverride || get().serverUrl
    const token = getOrCreateReconnectToken(roomId)

    // Fresh, user-initiated connection: clear any prior notice and reset the
    // reconnect budget. The token comes from sessionStorage so a reconnect (or
    // reload) reclaims the same seat within the grace window.
    set({
      connectionError: null,
      roomClosedNotice: null,
      intentionalDisconnect: false,
      reconnectAttempts: 0,
      reconnectToken: token,
      lastJoin: { roomId, displayName, color, serverUrl: activeServerUrl, token, transport },
    })

    establishConnection(set, get, { roomId, displayName, color, serverUrl: activeServerUrl, token, transport })
  },

  disconnect: () => {
    clearReconnectTimer()
    const { socket, connectionStatus } = get()
    // Signal an intentional leave so the server frees the seat immediately
    // (no grace hold) and `onclose` does not auto-reconnect.
    set({ intentionalDisconnect: true })
    if (socket && connectionStatus === 'connected') {
      try {
        socket.send(JSON.stringify({ type: 'leave' } as ClientMessage))
      } catch {
        // socket may already be closing — ignore.
      }
    }
    if (socket) {
      socket.close()
    }
    get().reset()
  },

  sendMessage: (msg: ClientMessage) => {
    const { socket, connectionStatus } = get()
    if (socket && connectionStatus === 'connected') {
      socket.send(JSON.stringify(msg))
    }
  },

  handleServerMessage: (msg: ServerMessage) => {
    switch (msg.type) {
      case 'room_state': {
        const players = new Map<string, PlayerInfo>()
        for (const p of msg.players) {
          players.set(p.id, p)
        }
        const dice = new Map<string, MultiplayerDie>()
        for (const d of msg.dice) {
          dice.set(d.id, diceStateToMultiplayerDie(d))
        }
        // Prefer the server-echoed id (robust across rejoin, where the reclaimed
        // player is not necessarily last in the unordered list). Fall back to the
        // last player for older servers that don't send it.
        const localPlayerId = msg.localPlayerId ?? msg.players[msg.players.length - 1]?.id ?? null
        const pendingInventoryDieIds = removeResolvedPendingInventoryIds(
          get().pendingInventoryDieIds,
          msg.dice,
          localPlayerId,
        )
        const hostId = msg.hostId ?? null
        set({
          players,
          dice,
          pendingInventoryDieIds,
          localPlayerId,
          hostId,
          isHost: localPlayerId !== null && localPlayerId === hostId,
          roomSettings: msg.settings,
          // Engine constants from the room's dicesuki-core build. Older servers
          // that predate Shared-ADR-007 omit this; keep any prior value rather
          // than clobbering it with null.
          ...(msg.config ? { engineConfig: msg.config } : {}),
        })
        break
      }

      case 'host_changed': {
        const { localPlayerId } = get()
        set({
          hostId: msg.hostId,
          isHost: localPlayerId !== null && localPlayerId === msg.hostId,
        })
        break
      }

      case 'settings_updated': {
        set({ roomSettings: msg.settings })
        break
      }

      case 'arena_changed': {
        // Host resized the shared arena (Shared-ADR-009): adopt the new engine
        // config so walls, shadows, and camera reflow. Same write as room_state.
        set({ engineConfig: msg.config })
        break
      }

      case 'player_joined': {
        const { players } = get()
        const newPlayers = new Map(players)
        newPlayers.set(msg.player.id, msg.player)
        set({ players: newPlayers })
        break
      }

      case 'player_left': {
        const { players } = get()
        const newPlayers = new Map(players)
        newPlayers.delete(msg.playerId)
        set({ players: newPlayers })
        break
      }

      case 'dice_spawned': {
        const { dice } = get()
        const newDice = new Map(dice)
        for (const d of msg.dice) {
          newDice.set(d.id, diceStateToMultiplayerDie(d))
        }
        const pendingInventoryDieIds = removeResolvedPendingInventoryIds(
          get().pendingInventoryDieIds,
          msg.dice,
          get().localPlayerId,
        )
        set({ dice: newDice, pendingInventoryDieIds })
        break
      }

      case 'dice_removed': {
        const { dice } = get()
        const newDice = new Map(dice)
        for (const id of msg.diceIds) {
          newDice.delete(id)
        }
        set({ dice: newDice })
        break
      }

      case 'roll_started': {
        const { dice } = get()
        const newDice = new Map(dice)
        for (const id of msg.diceIds) {
          const die = newDice.get(id)
          if (die) {
            newDice.set(id, { ...die, isRolling: true, faceValue: null })
          }
        }
        set({ dice: newDice })

        // Also mark in unified dice store
        useDiceStore.getState().markDiceRolling(msg.diceIds)
        break
      }

      case 'physics_snapshot': {
        const { dice } = get()
        const newDice = new Map(dice)
        const now = performance.now()
        for (const snap of msg.dice) {
          const die = newDice.get(snap.id)
          if (die) {
            newDice.set(snap.id, {
              ...die,
              prevPosition: die.targetPosition,
              prevRotation: die.targetRotation,
              targetPosition: snap.p,
              targetRotation: snap.r,
            })
          }
        }
        set({ dice: newDice, lastSnapshotTime: now })
        break
      }

      case 'die_settled': {
        const { dice } = get()
        const newDice = new Map(dice)
        const die = newDice.get(msg.diceId)
        if (die) {
          newDice.set(msg.diceId, {
            ...die,
            isRolling: false,
            faceValue: msg.faceValue,
            position: msg.position,
            rotation: msg.rotation,
            targetPosition: msg.position,
            targetRotation: msg.rotation,
            prevPosition: msg.position,
            prevRotation: msg.rotation,
          })
        }
        set({ dice: newDice })

        // Also record in unified dice store
        if (die) {
          useDiceStore.getState().recordDieSettled(
            msg.diceId,
            msg.faceValue,
            die.diceType,
            die.presentation,
          )
        }
        break
      }

      case 'dice_knocked': {
        // A settled die was bumped back into motion by a collision. Mark it rolling so
        // the UI stops showing a stale settled value; the authoritative re-settled face
        // arrives later via `die_settled`. Fire collision haptics/SFX at the impact.
        const { dice } = get()
        const die = dice.get(msg.diceId)
        if (die) {
          const newDice = new Map(dice)
          newDice.set(msg.diceId, { ...die, isRolling: true, faceValue: null })
          set({ dice: newDice })
        }
        triggerCollisionFeedback(msg.impactSpeed)
        break
      }

      case 'roll_complete': {
        const { players } = get()
        const player = players.get(msg.playerId)
        if (player) {
          const now = Date.now()
          const dice = msg.results.map((r) => ({
            diceId: r.diceId,
            value: r.faceValue,
            type: r.diceType.toString(),
            settledAt: now,
            presentation: r.presentation,
          }))
          const sum = dice.reduce((acc, d) => acc + d.value, 0)

          useDiceStore.getState().addRollToHistory({
            dice,
            sum,
            timestamp: now,
            player: {
              id: msg.playerId,
              displayName: player.displayName,
              color: player.color,
            },
          })
        }
        break
      }

      case 'error': {
        console.error(`[Multiplayer] Server error: ${msg.code} - ${msg.message}`)
        if (get().pendingInventoryDieIds.size > 0) {
          set({ pendingInventoryDieIds: new Set<string>() })
        }
        // A join-phase rejection (e.g. room full) arrives on an open socket but
        // before `room_state`. Surface it on the join form and stop the socket so
        // auto-reconnect doesn't hammer a room that will keep rejecting us.
        if (JOIN_ERROR_CODES.has(msg.code) && get().localPlayerId === null) {
          clearReconnectTimer()
          const socket = get().socket
          set({
            intentionalDisconnect: true,
            connectionError: msg.message,
            connectionStatus: 'disconnected',
            lastJoin: null,
          })
          if (socket) socket.close()
          set({ socket: null })
        }
        break
      }
    }
  },

  spawnDice: (diceType: DiceShape, presentation?: DicePresentationMetadata) => {
    const { connectionStatus, dice, localPlayerId, pendingInventoryDieIds, socket } = get()
    if (!socket || connectionStatus !== 'connected') {
      return
    }

    const inventoryDieId = presentation?.inventoryDieId
    if (inventoryDieId) {
      const inventoryDieAlreadyOwned = Array.from(dice.values()).some((die) => (
        die.presentation?.inventoryDieId === inventoryDieId
        && (!localPlayerId || die.ownerId === localPlayerId)
      ))
      if (pendingInventoryDieIds.has(inventoryDieId) || inventoryDieAlreadyOwned) {
        console.warn(`[Multiplayer] Inventory die ${inventoryDieId} is already pending or on the table`)
        return
      }
      set({ pendingInventoryDieIds: new Set(pendingInventoryDieIds).add(inventoryDieId) })
    }

    const id = createDiceSpawnId(inventoryDieId ?? diceType)
    socket.send(JSON.stringify({
      type: 'spawn_dice',
      dice: [{ id, diceType, presentation }],
    }))
  },

  spawnCarriedDice: (dice: CarriedDie[]) => {
    const { connectionStatus, socket, pendingInventoryDieIds } = get()
    if (!socket || connectionStatus !== 'connected' || dice.length === 0) {
      return
    }

    const entries = dice.map((die) => ({
      id: createDiceSpawnId(die.presentation?.inventoryDieId ?? die.diceType),
      diceType: die.diceType,
      presentation: die.presentation,
      position: die.position,
      rotation: die.rotation,
    }))

    // Mark carried inventory dice pending so the toolbar/panel can't also spawn
    // them before the server acknowledges (mirrors `spawnDice`).
    const inventoryIds = dice
      .map((die) => die.presentation?.inventoryDieId)
      .filter((id): id is string => Boolean(id))
    if (inventoryIds.length > 0) {
      const next = new Set(pendingInventoryDieIds)
      inventoryIds.forEach((id) => next.add(id))
      set({ pendingInventoryDieIds: next })
    }

    socket.send(JSON.stringify({ type: 'spawn_dice', dice: entries }))
  },

  removeDice: (diceIds: string[]) => {
    get().sendMessage({ type: 'remove_dice', diceIds })
  },

  roll: () => {
    get().sendMessage({ type: 'roll' })
  },

  updateColor: (color: string) => {
    get().sendMessage({ type: 'update_color', color })
  },

  updateSettings: (settings: RoomSettings) => {
    // Server authoritatively rejects non-host mutations; gate optimistically
    // in the UI via `isHost`, but the server remains the source of truth.
    get().sendMessage({ type: 'update_settings', settings })
  },

  setMotionControl: (mode: MotionControl) => {
    // Host-only; the server enforces this too. Merge into the existing settings
    // so other host-controlled fields (playerCap, ...) are preserved.
    if (!get().isHost) return
    get().updateSettings(withMotionControl(get().roomSettings, mode))
  },

  setRoller: (playerId: string | null) => {
    // Host-only; the server re-validates. Merge into existing settings so other
    // host-controlled fields (motionControl, playerCap, ...) are preserved.
    if (!get().isHost) return
    get().updateSettings(withRoller(get().roomSettings, playerId))
  },

  setRoomTheme: (themeId: string | null) => {
    // Host-only; the server re-validates. Merge into existing settings so other
    // host-controlled fields (motionControl, roller, ...) are preserved.
    if (!get().isHost) return
    get().updateSettings(withRoomTheme(get().roomSettings, themeId))
  },

  setVisibility: (visibility: RoomVisibility) => {
    // Host-only; the server re-validates. Merge so other settings are preserved.
    if (!get().isHost) return
    get().updateSettings(withVisibility(get().roomSettings, visibility))
  },

  setRoomName: (name: string) => {
    // Host-only; the server sanitizes and re-validates. Merge to preserve others.
    if (!get().isHost) return
    get().updateSettings(withRoomName(get().roomSettings, name))
  },

  setArena: (aspect: number) => {
    // Host-only; the server re-validates. Sends a dedicated set_arena message;
    // the room replies with a broadcast arena_changed carrying the new bounds.
    if (!get().isHost) return
    get().sendMessage({ type: 'set_arena', aspect })
  },

  sendMotionImpulse: (impulse: [number, number, number]) => {
    // Optimistic policy gate: when motion is disabled room-wide there is nothing
    // to send. The server re-checks the policy and ownership authoritatively.
    if (getMotionControl(get().roomSettings) === 'off') return

    // Throttle to the shared rate limit so the server never rejects our own
    // impulses for arriving too fast.
    const now = performance.now()
    if (now - lastMotionImpulseSentAt < MOTION_IMPULSE_MIN_INTERVAL_MS) return
    lastMotionImpulseSentAt = now

    get().sendMessage({ type: 'motion_impulse', impulse })
  },

  startDrag: (dieId, grabOffset, worldPosition) => {
    get().sendMessage({ type: 'drag_start', dieId, grabOffset, worldPosition })
  },

  moveDrag: (dieId, worldPosition) => {
    get().sendMessage({ type: 'drag_move', dieId, worldPosition })
  },

  endDrag: (dieId, velocityHistory) => {
    get().sendMessage({ type: 'drag_end', dieId, velocityHistory })
  },

  setSelectedPlayerId: (playerId: string | null) => {
    const current = get().selectedPlayerId
    set({ selectedPlayerId: current === playerId ? null : playerId })
  },

  setConnectionStatus: (status: ConnectionStatus) => {
    set({ connectionStatus: status })
  },

  reset: () => {
    clearReconnectTimer()
    set({
      ...createInitialState(),
      serverUrl: get().serverUrl,
    })
  },
}))

function createDiceSpawnId(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}

function removeResolvedPendingInventoryIds(
  pendingInventoryDieIds: Set<string>,
  dice: DiceState[],
  localPlayerId: string | null,
): Set<string> {
  if (pendingInventoryDieIds.size === 0) {
    return pendingInventoryDieIds
  }

  const resolvedInventoryDieIds = new Set(
    dice
      .filter((die) => !localPlayerId || die.ownerId === localPlayerId)
      .map((die) => die.presentation?.inventoryDieId)
      .filter((id): id is string => Boolean(id)),
  )
  if (resolvedInventoryDieIds.size === 0) {
    return pendingInventoryDieIds
  }

  return new Set(
    Array.from(pendingInventoryDieIds).filter((id) => !resolvedInventoryDieIds.has(id)),
  )
}

function diceStateToMultiplayerDie(d: DiceState): MultiplayerDie {
  return {
    id: d.id,
    ownerId: d.ownerId,
    diceType: d.diceType,
    presentation: d.presentation,
    position: d.position,
    rotation: d.rotation,
    targetPosition: d.position,
    targetRotation: d.rotation,
    prevPosition: d.position,
    prevRotation: d.rotation,
    isRolling: false,
    faceValue: null,
  }
}
