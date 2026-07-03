import { create } from 'zustand'
import type { DiceShape } from '../lib/geometries'
import type {
  ClientMessage,
  ServerMessage,
  PlayerInfo,
  DiceState,
  DicePresentationMetadata,
  VelocityHistoryEntry,
} from '../lib/multiplayerMessages'
import { getWsServerUrl } from '../lib/multiplayerServer'
import { useDiceStore } from './useDiceStore'

export type ConnectionStatus = 'disconnected' | 'connecting' | 'connected'

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
  socket: WebSocket | null
  serverUrl: string
  connectionError: string | null

  // Room
  roomId: string | null
  players: Map<string, PlayerInfo>
  localPlayerId: string | null

  // Dice
  dice: Map<string, MultiplayerDie>
  pendingInventoryDieIds: Set<string>

  // Snapshot interpolation
  lastSnapshotTime: number
  snapshotInterval: number // ms between snapshots (should match server SNAPSHOT_DIVISOR)

  // Actions
  connect: (roomId: string, displayName: string, color: string, serverUrl?: string) => void
  disconnect: () => void
  sendMessage: (msg: ClientMessage) => void
  handleServerMessage: (msg: ServerMessage) => void

  // Game actions
  spawnDice: (diceType: DiceShape, presentation?: DicePresentationMetadata) => void
  removeDice: (diceIds: string[]) => void
  roll: () => void
  updateColor: (color: string) => void

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
  socket: null as WebSocket | null,
  serverUrl: getWsServerUrl(),
  connectionError: null as string | null,
  roomId: null as string | null,
  players: new Map<string, PlayerInfo>(),
  localPlayerId: null as string | null,
  dice: new Map<string, MultiplayerDie>(),
  pendingInventoryDieIds: new Set<string>(),
  lastSnapshotTime: 0,
  snapshotInterval: 1000 / 60, // ~16.67ms — must match server SNAPSHOT_DIVISOR=1 (60Hz)
  selectedPlayerId: null as string | null,
})

export const useMultiplayerStore = create<MultiplayerState>((set, get) => ({
  ...createInitialState(),

  connect: (roomId: string, displayName: string, color: string, serverUrlOverride?: string) => {
    const { serverUrl, socket: existingSocket } = get()
    if (existingSocket) {
      existingSocket.close()
    }

    const activeServerUrl = serverUrlOverride || serverUrl

    const wsUrl = `${activeServerUrl}/ws/${roomId}`
    const socket = new WebSocket(wsUrl)
    set({ socket, connectionStatus: 'connecting', connectionError: null, serverUrl: activeServerUrl })

    socket.onopen = () => {
      if (get().socket !== socket) {
        socket.close()
        return
      }
      set({ socket, connectionStatus: 'connected', roomId })
      const joinMsg: ClientMessage = {
        type: 'join',
        roomId,
        displayName,
        color,
      }
      socket.send(JSON.stringify(joinMsg))
    }

    socket.onmessage = (event) => {
      try {
        const msg: ServerMessage = JSON.parse(event.data)
        get().handleServerMessage(msg)
      } catch (e) {
        console.error('[Multiplayer] Failed to parse server message:', e)
      }
    }

    socket.onclose = () => {
      if (get().socket === socket) {
        set({ connectionStatus: 'disconnected', socket: null })
      }
    }

    socket.onerror = (error) => {
      console.error('[Multiplayer] WebSocket error:', error)
      if (get().socket === socket) {
        set({
          connectionStatus: 'disconnected',
          connectionError: `Could not connect to ${activeServerUrl}. Verify the room server is running and this room still exists.`,
          socket: null,
        })
      }
    }
  },

  disconnect: () => {
    const { socket } = get()
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
        // The local player is the last one in the list (just joined)
        const localPlayerId = msg.players[msg.players.length - 1]?.id || null
        const pendingInventoryDieIds = removeResolvedPendingInventoryIds(
          get().pendingInventoryDieIds,
          msg.dice,
          localPlayerId,
        )
        set({ players, dice, pendingInventoryDieIds, localPlayerId })
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

  removeDice: (diceIds: string[]) => {
    get().sendMessage({ type: 'remove_dice', diceIds })
  },

  roll: () => {
    get().sendMessage({ type: 'roll' })
  },

  updateColor: (color: string) => {
    get().sendMessage({ type: 'update_color', color })
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
