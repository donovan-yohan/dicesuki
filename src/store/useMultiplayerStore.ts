import { create } from 'zustand'
import type { DiceShape } from '../lib/geometries'
import type {
  ClientMessage,
  ServerMessage,
  PlayerInfo,
  DiceState,
  VelocityHistoryEntry,
} from '../lib/multiplayerMessages'
import { getWsServerUrl } from '../lib/multiplayerServer'
import { useDiceStore } from './useDiceStore'

export type ConnectionStatus = 'disconnected' | 'connecting' | 'connected'

export interface MultiplayerDie {
  id: string
  ownerId: string
  diceType: DiceShape
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
  // Drag state (local optimistic)
  isLocallyDragged: boolean
  localDragPosition: [number, number, number] | null
}

interface MultiplayerState {
  // Connection
  connectionStatus: ConnectionStatus
  socket: WebSocket | null
  serverUrl: string

  // Room
  roomId: string | null
  players: Map<string, PlayerInfo>
  localPlayerId: string | null

  // Dice
  dice: Map<string, MultiplayerDie>

  // Snapshot interpolation
  lastSnapshotTime: number
  snapshotInterval: number // ms between snapshots (should match server SNAPSHOT_DIVISOR)

  // Actions
  connect: (roomId: string, displayName: string, color: string) => void
  disconnect: () => void
  sendMessage: (msg: ClientMessage) => void
  handleServerMessage: (msg: ServerMessage) => void

  // Game actions
  spawnDice: (diceType: DiceShape) => void
  removeDice: (diceIds: string[]) => void
  roll: () => void
  updateColor: (color: string) => void

  // Drag actions
  startDrag: (dieId: string, grabOffset: [number, number, number], worldPosition: [number, number, number]) => void
  moveDrag: (dieId: string, worldPosition: [number, number, number]) => void
  endDrag: (dieId: string, velocityHistory: VelocityHistoryEntry[]) => void
  setLocalDragPosition: (dieId: string, position: [number, number, number] | null) => void

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
  roomId: null as string | null,
  players: new Map<string, PlayerInfo>(),
  localPlayerId: null as string | null,
  dice: new Map<string, MultiplayerDie>(),
  lastSnapshotTime: 0,
  snapshotInterval: 50,
  selectedPlayerId: null as string | null,
})

export const useMultiplayerStore = create<MultiplayerState>((set, get) => ({
  ...createInitialState(),

  connect: (roomId: string, displayName: string, color: string) => {
    const { serverUrl } = get()
    set({ connectionStatus: 'connecting' })

    const wsUrl = `${serverUrl}/ws/${roomId}`
    const socket = new WebSocket(wsUrl)

    socket.onopen = () => {
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
      set({ connectionStatus: 'disconnected', socket: null })
    }

    socket.onerror = (error) => {
      console.error('[Multiplayer] WebSocket error:', error)
      set({ connectionStatus: 'disconnected', socket: null })
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
        set({ players, dice, localPlayerId })
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
        set({ dice: newDice })
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
          if (die && !die.isLocallyDragged) {
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
        break
      }
    }
  },

  spawnDice: (diceType: DiceShape) => {
    const id = `${diceType}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`
    get().sendMessage({
      type: 'spawn_dice',
      dice: [{ id, diceType }],
    })
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
    const { dice } = get()
    const newDice = new Map(dice)
    const die = newDice.get(dieId)
    if (die) {
      newDice.set(dieId, { ...die, isLocallyDragged: true, localDragPosition: worldPosition })
    }
    set({ dice: newDice })
    get().sendMessage({ type: 'drag_start', dieId, grabOffset, worldPosition })
  },

  moveDrag: (dieId, worldPosition) => {
    // Update local optimistic position (direct mutation for perf — avoid Map clone on every 30Hz update)
    const die = get().dice.get(dieId)
    if (die) {
      die.localDragPosition = worldPosition
    }
    get().sendMessage({ type: 'drag_move', dieId, worldPosition })
  },

  endDrag: (dieId, velocityHistory) => {
    const { dice } = get()
    const newDice = new Map(dice)
    const die = newDice.get(dieId)
    if (die) {
      newDice.set(dieId, { ...die, isLocallyDragged: false, localDragPosition: null })
    }
    set({ dice: newDice })
    get().sendMessage({ type: 'drag_end', dieId, velocityHistory })
  },

  setLocalDragPosition: (dieId, position) => {
    const die = get().dice.get(dieId)
    if (die) {
      die.localDragPosition = position
    }
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

function diceStateToMultiplayerDie(d: DiceState): MultiplayerDie {
  return {
    id: d.id,
    ownerId: d.ownerId,
    diceType: d.diceType,
    position: d.position,
    rotation: d.rotation,
    targetPosition: d.position,
    targetRotation: d.rotation,
    prevPosition: d.position,
    prevRotation: d.rotation,
    isRolling: false,
    faceValue: null,
    isLocallyDragged: false,
    localDragPosition: null,
  }
}
