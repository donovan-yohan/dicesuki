# Multiplayer 04: Client Foundation

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Set up the client-side foundation for multiplayer — shared message types, React Router integration, Zustand stores, and WebSocket hook.

**Architecture:** New `/room/:roomId` route renders a multiplayer-specific component tree. New Zustand stores (`useMultiplayerStore`, `useRoomHistoryStore`) manage server-driven state. A `useWebSocket` hook handles connection lifecycle.

**Tech Stack:** React 19, react-router-dom, Zustand, native WebSocket API

**Depends on:** None (can be developed in parallel with server plans 01-03)

---

## Task 1: Shared Message Types

**Files:**
- Create: `src/lib/multiplayerMessages.ts`

**Step 1: Write TypeScript message types matching server protocol**

Create `src/lib/multiplayerMessages.ts`:

```typescript
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

export interface SpawnDiceMessage {
  type: 'spawn_dice'
  dice: { id: string; diceType: DiceShape }[]
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

export type ClientMessage =
  | JoinMessage
  | SpawnDiceMessage
  | RemoveDiceMessage
  | RollMessage
  | UpdateColorMessage
  | LeaveMessage

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
}

export interface RoomStateMessage {
  type: 'room_state'
  roomId: string
  players: PlayerInfo[]
  dice: DiceState[]
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
  | PlayerJoinedMessage
  | PlayerLeftMessage
  | DiceSpawnedMessage
  | DiceRemovedMessage
  | RollStartedMessage
  | PhysicsSnapshotMessage
  | DieSettledMessage
  | RollCompleteMessage
  | ErrorMessage
```

**Step 2: Write test for message type compatibility**

Create `src/lib/multiplayerMessages.test.ts`:

```typescript
import { describe, it, expect } from 'vitest'
import type {
  ClientMessage,
  ServerMessage,
  RoomStateMessage,
  PhysicsSnapshotMessage,
} from './multiplayerMessages'

describe('multiplayerMessages', () => {
  describe('ClientMessage types', () => {
    it('should type-check a join message', () => {
      const msg: ClientMessage = {
        type: 'join',
        roomId: 'abc123',
        displayName: 'Gandalf',
        color: '#8B5CF6',
      }
      expect(msg.type).toBe('join')
    })

    it('should type-check a spawn_dice message', () => {
      const msg: ClientMessage = {
        type: 'spawn_dice',
        dice: [
          { id: 'd1', diceType: 'd20' },
          { id: 'd2', diceType: 'd6' },
        ],
      }
      expect(msg.type).toBe('spawn_dice')
    })

    it('should type-check a roll message', () => {
      const msg: ClientMessage = { type: 'roll' }
      expect(msg.type).toBe('roll')
    })
  })

  describe('ServerMessage parsing', () => {
    it('should parse a room_state message', () => {
      const json = '{"type":"room_state","roomId":"abc123","players":[{"id":"p1","displayName":"Gandalf","color":"#8B5CF6"}],"dice":[]}'
      const msg: ServerMessage = JSON.parse(json)
      expect(msg.type).toBe('room_state')
      const roomState = msg as RoomStateMessage
      expect(roomState.roomId).toBe('abc123')
      expect(roomState.players).toHaveLength(1)
      expect(roomState.players[0].displayName).toBe('Gandalf')
    })

    it('should parse a physics_snapshot message', () => {
      const json = '{"type":"physics_snapshot","tick":42,"dice":[{"id":"d1","p":[1,2,3],"r":[0,0,0,1]}]}'
      const msg: ServerMessage = JSON.parse(json)
      expect(msg.type).toBe('physics_snapshot')
      const snapshot = msg as PhysicsSnapshotMessage
      expect(snapshot.tick).toBe(42)
      expect(snapshot.dice[0].p).toEqual([1, 2, 3])
      expect(snapshot.dice[0].r).toEqual([0, 0, 0, 1])
    })

    it('should parse an error message', () => {
      const json = '{"type":"error","code":"ROOM_FULL","message":"Room is full (8/8 players)"}'
      const msg: ServerMessage = JSON.parse(json)
      expect(msg.type).toBe('error')
    })
  })
})
```

**Step 3: Run tests**

```bash
npm test -- multiplayerMessages.test.ts
```

Expected: All tests pass.

**Step 4: Commit**

```bash
git add src/lib/multiplayerMessages.ts src/lib/multiplayerMessages.test.ts
git commit -m "feat(multiplayer): add shared client/server message type definitions"
```

---

## Task 2: Multiplayer Zustand Store

**Files:**
- Create: `src/store/useMultiplayerStore.ts`

**Step 1: Write multiplayer store with tests**

Create `src/store/useMultiplayerStore.ts`:

```typescript
import { create } from 'zustand'
import type { DiceShape } from '../lib/geometries'
import type {
  ClientMessage,
  ServerMessage,
  PlayerInfo,
  DiceState,
  DiceSnapshot,
  RoomStateMessage,
} from '../lib/multiplayerMessages'

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
  snapshotInterval: number // ms between snapshots (~50ms for 20Hz)

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

  // Internal
  setConnectionStatus: (status: ConnectionStatus) => void
  reset: () => void
}

const INITIAL_STATE = {
  connectionStatus: 'disconnected' as ConnectionStatus,
  socket: null as WebSocket | null,
  serverUrl: import.meta.env.VITE_MULTIPLAYER_SERVER_URL || 'ws://localhost:8080',
  roomId: null as string | null,
  players: new Map<string, PlayerInfo>(),
  localPlayerId: null as string | null,
  dice: new Map<string, MultiplayerDie>(),
  lastSnapshotTime: 0,
  snapshotInterval: 50,
}

export const useMultiplayerStore = create<MultiplayerState>((set, get) => ({
  ...INITIAL_STATE,

  connect: (roomId: string, displayName: string, color: string) => {
    const { serverUrl } = get()
    set({ connectionStatus: 'connecting' })

    const wsUrl = `${serverUrl}/ws/${roomId}`
    const socket = new WebSocket(wsUrl)

    socket.onopen = () => {
      set({ socket, connectionStatus: 'connected', roomId })
      // Send join message
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
        const roomState = msg as RoomStateMessage
        const players = new Map<string, PlayerInfo>()
        for (const p of roomState.players) {
          players.set(p.id, p)
        }
        const dice = new Map<string, MultiplayerDie>()
        for (const d of roomState.dice) {
          dice.set(d.id, diceStateToMultiplayerDie(d))
        }
        // The local player is the last one in the list (just joined)
        const localPlayerId = roomState.players[roomState.players.length - 1]?.id || null
        set({ players: new Map(players), dice: new Map(dice), localPlayerId })
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
        const { players, dice } = get()
        const newPlayers = new Map(players)
        newPlayers.delete(msg.playerId)
        // Dice removal handled by separate dice_removed message
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
              // Previous becomes current target
              prevPosition: die.targetPosition,
              prevRotation: die.targetRotation,
              // New target from snapshot
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
        break
      }

      case 'roll_complete': {
        // Roll history is handled by useRoomHistoryStore (Task 3)
        // This store just ensures dice state is up to date
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

  setConnectionStatus: (status: ConnectionStatus) => {
    set({ connectionStatus: status })
  },

  reset: () => {
    set({
      ...INITIAL_STATE,
      // Preserve serverUrl
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
  }
}
```

**Step 2: Write tests**

Create `src/store/useMultiplayerStore.test.ts`:

```typescript
import { describe, it, expect, beforeEach } from 'vitest'
import { useMultiplayerStore } from './useMultiplayerStore'
import type { ServerMessage } from '../lib/multiplayerMessages'

describe('useMultiplayerStore', () => {
  beforeEach(() => {
    useMultiplayerStore.getState().reset()
  })

  describe('initial state', () => {
    it('should start disconnected with empty state', () => {
      const state = useMultiplayerStore.getState()
      expect(state.connectionStatus).toBe('disconnected')
      expect(state.socket).toBeNull()
      expect(state.roomId).toBeNull()
      expect(state.players.size).toBe(0)
      expect(state.dice.size).toBe(0)
      expect(state.localPlayerId).toBeNull()
    })
  })

  describe('handleServerMessage', () => {
    it('should handle room_state message', () => {
      const msg: ServerMessage = {
        type: 'room_state',
        roomId: 'abc123',
        players: [
          { id: 'p1', displayName: 'Gandalf', color: '#8B5CF6' },
          { id: 'p2', displayName: 'Frodo', color: '#3B82F6' },
        ],
        dice: [
          { id: 'd1', ownerId: 'p1', diceType: 'd20', position: [0, 1, 0], rotation: [0, 0, 0, 1] },
        ],
      }

      useMultiplayerStore.getState().handleServerMessage(msg)
      const state = useMultiplayerStore.getState()

      expect(state.players.size).toBe(2)
      expect(state.players.get('p1')?.displayName).toBe('Gandalf')
      expect(state.dice.size).toBe(1)
      expect(state.dice.get('d1')?.diceType).toBe('d20')
      expect(state.localPlayerId).toBe('p2') // Last player = local
    })

    it('should handle player_joined message', () => {
      // Set up initial state
      useMultiplayerStore.getState().handleServerMessage({
        type: 'room_state',
        roomId: 'abc123',
        players: [{ id: 'p1', displayName: 'Gandalf', color: '#8B5CF6' }],
        dice: [],
      })

      useMultiplayerStore.getState().handleServerMessage({
        type: 'player_joined',
        player: { id: 'p2', displayName: 'Frodo', color: '#3B82F6' },
      })

      expect(useMultiplayerStore.getState().players.size).toBe(2)
    })

    it('should handle player_left message', () => {
      useMultiplayerStore.getState().handleServerMessage({
        type: 'room_state',
        roomId: 'abc123',
        players: [
          { id: 'p1', displayName: 'Gandalf', color: '#8B5CF6' },
          { id: 'p2', displayName: 'Frodo', color: '#3B82F6' },
        ],
        dice: [],
      })

      useMultiplayerStore.getState().handleServerMessage({
        type: 'player_left',
        playerId: 'p1',
      })

      expect(useMultiplayerStore.getState().players.size).toBe(1)
      expect(useMultiplayerStore.getState().players.has('p1')).toBe(false)
    })

    it('should handle dice_spawned message', () => {
      useMultiplayerStore.getState().handleServerMessage({
        type: 'dice_spawned',
        ownerId: 'p1',
        dice: [
          { id: 'd1', ownerId: 'p1', diceType: 'd6', position: [0, 2, 0], rotation: [0, 0, 0, 1] },
        ],
      })

      const die = useMultiplayerStore.getState().dice.get('d1')
      expect(die).toBeDefined()
      expect(die?.diceType).toBe('d6')
      expect(die?.ownerId).toBe('p1')
      expect(die?.isRolling).toBe(false)
    })

    it('should handle roll_started message', () => {
      // Spawn dice first
      useMultiplayerStore.getState().handleServerMessage({
        type: 'dice_spawned',
        ownerId: 'p1',
        dice: [
          { id: 'd1', ownerId: 'p1', diceType: 'd6', position: [0, 2, 0], rotation: [0, 0, 0, 1] },
        ],
      })

      useMultiplayerStore.getState().handleServerMessage({
        type: 'roll_started',
        playerId: 'p1',
        diceIds: ['d1'],
      })

      const die = useMultiplayerStore.getState().dice.get('d1')
      expect(die?.isRolling).toBe(true)
      expect(die?.faceValue).toBeNull()
    })

    it('should handle physics_snapshot message', () => {
      // Spawn and start rolling
      useMultiplayerStore.getState().handleServerMessage({
        type: 'dice_spawned',
        ownerId: 'p1',
        dice: [
          { id: 'd1', ownerId: 'p1', diceType: 'd6', position: [0, 2, 0], rotation: [0, 0, 0, 1] },
        ],
      })

      useMultiplayerStore.getState().handleServerMessage({
        type: 'physics_snapshot',
        tick: 42,
        dice: [
          { id: 'd1', p: [1, 1.5, 0.5], r: [0.1, 0.2, 0.3, 0.9] },
        ],
      })

      const die = useMultiplayerStore.getState().dice.get('d1')
      expect(die?.targetPosition).toEqual([1, 1.5, 0.5])
      expect(die?.targetRotation).toEqual([0.1, 0.2, 0.3, 0.9])
    })

    it('should handle die_settled message', () => {
      useMultiplayerStore.getState().handleServerMessage({
        type: 'dice_spawned',
        ownerId: 'p1',
        dice: [
          { id: 'd1', ownerId: 'p1', diceType: 'd6', position: [0, 2, 0], rotation: [0, 0, 0, 1] },
        ],
      })

      useMultiplayerStore.getState().handleServerMessage({
        type: 'die_settled',
        diceId: 'd1',
        faceValue: 4,
        position: [1, 0, 0.5],
        rotation: [0, 0, 0, 1],
      })

      const die = useMultiplayerStore.getState().dice.get('d1')
      expect(die?.isRolling).toBe(false)
      expect(die?.faceValue).toBe(4)
    })

    it('should handle dice_removed message', () => {
      useMultiplayerStore.getState().handleServerMessage({
        type: 'dice_spawned',
        ownerId: 'p1',
        dice: [
          { id: 'd1', ownerId: 'p1', diceType: 'd6', position: [0, 2, 0], rotation: [0, 0, 0, 1] },
          { id: 'd2', ownerId: 'p1', diceType: 'd20', position: [1, 2, 0], rotation: [0, 0, 0, 1] },
        ],
      })

      useMultiplayerStore.getState().handleServerMessage({
        type: 'dice_removed',
        diceIds: ['d1'],
      })

      expect(useMultiplayerStore.getState().dice.size).toBe(1)
      expect(useMultiplayerStore.getState().dice.has('d1')).toBe(false)
      expect(useMultiplayerStore.getState().dice.has('d2')).toBe(true)
    })
  })

  describe('reset', () => {
    it('should reset all state', () => {
      useMultiplayerStore.getState().handleServerMessage({
        type: 'room_state',
        roomId: 'abc123',
        players: [{ id: 'p1', displayName: 'Test', color: '#FFF' }],
        dice: [],
      })

      useMultiplayerStore.getState().reset()
      const state = useMultiplayerStore.getState()

      expect(state.connectionStatus).toBe('disconnected')
      expect(state.players.size).toBe(0)
      expect(state.dice.size).toBe(0)
      expect(state.roomId).toBeNull()
    })
  })
})
```

**Step 3: Run tests**

```bash
npm test -- useMultiplayerStore.test.ts
```

Expected: All tests pass.

**Step 4: Commit**

```bash
git add src/store/useMultiplayerStore.ts src/store/useMultiplayerStore.test.ts
git commit -m "feat(multiplayer): add useMultiplayerStore with server message handling"
```

---

## Task 3: Room History Store

**Files:**
- Create: `src/store/useRoomHistoryStore.ts`

**Step 1: Write room history store**

Create `src/store/useRoomHistoryStore.ts`:

```typescript
import { create } from 'zustand'
import type { DiceShape } from '../lib/geometries'

export interface RoomRollEntry {
  id: string
  playerId: string
  displayName: string
  color: string
  results: {
    diceId: string
    diceType: DiceShape
    faceValue: number
  }[]
  total: number
  timestamp: number
}

interface RoomHistoryState {
  rolls: RoomRollEntry[]
  addRoll: (entry: RoomRollEntry) => void
  clear: () => void
}

const MAX_HISTORY = 50

export const useRoomHistoryStore = create<RoomHistoryState>((set) => ({
  rolls: [],

  addRoll: (entry: RoomRollEntry) => {
    set((state) => ({
      rolls: [entry, ...state.rolls].slice(0, MAX_HISTORY),
    }))
  },

  clear: () => set({ rolls: [] }),
}))
```

**Step 2: Write tests**

Create `src/store/useRoomHistoryStore.test.ts`:

```typescript
import { describe, it, expect, beforeEach } from 'vitest'
import { useRoomHistoryStore } from './useRoomHistoryStore'

describe('useRoomHistoryStore', () => {
  beforeEach(() => {
    useRoomHistoryStore.getState().clear()
  })

  it('should start with empty rolls', () => {
    expect(useRoomHistoryStore.getState().rolls).toHaveLength(0)
  })

  it('should add a roll entry', () => {
    useRoomHistoryStore.getState().addRoll({
      id: 'r1',
      playerId: 'p1',
      displayName: 'Gandalf',
      color: '#8B5CF6',
      results: [{ diceId: 'd1', diceType: 'd20', faceValue: 17 }],
      total: 17,
      timestamp: Date.now(),
    })

    expect(useRoomHistoryStore.getState().rolls).toHaveLength(1)
    expect(useRoomHistoryStore.getState().rolls[0].displayName).toBe('Gandalf')
  })

  it('should add newest rolls first', () => {
    useRoomHistoryStore.getState().addRoll({
      id: 'r1',
      playerId: 'p1',
      displayName: 'First',
      color: '#FFF',
      results: [],
      total: 0,
      timestamp: 1000,
    })
    useRoomHistoryStore.getState().addRoll({
      id: 'r2',
      playerId: 'p1',
      displayName: 'Second',
      color: '#FFF',
      results: [],
      total: 0,
      timestamp: 2000,
    })

    const rolls = useRoomHistoryStore.getState().rolls
    expect(rolls[0].id).toBe('r2')
    expect(rolls[1].id).toBe('r1')
  })

  it('should cap at 50 entries', () => {
    for (let i = 0; i < 60; i++) {
      useRoomHistoryStore.getState().addRoll({
        id: `r${i}`,
        playerId: 'p1',
        displayName: 'Test',
        color: '#FFF',
        results: [],
        total: i,
        timestamp: i,
      })
    }

    expect(useRoomHistoryStore.getState().rolls).toHaveLength(50)
  })

  it('should clear all rolls', () => {
    useRoomHistoryStore.getState().addRoll({
      id: 'r1',
      playerId: 'p1',
      displayName: 'Test',
      color: '#FFF',
      results: [],
      total: 0,
      timestamp: 0,
    })
    useRoomHistoryStore.getState().clear()
    expect(useRoomHistoryStore.getState().rolls).toHaveLength(0)
  })
})
```

**Step 3: Run tests**

```bash
npm test -- useRoomHistoryStore.test.ts
```

Expected: All tests pass.

**Step 4: Commit**

```bash
git add src/store/useRoomHistoryStore.ts src/store/useRoomHistoryStore.test.ts
git commit -m "feat(multiplayer): add useRoomHistoryStore for room-wide roll history"
```

---

## Task 4: React Router — Add Multiplayer Route

**Files:**
- Modify: `src/App.tsx`
- Create: `src/components/multiplayer/MultiplayerRoom.tsx`

**Step 1: Create placeholder multiplayer room component**

Create `src/components/multiplayer/MultiplayerRoom.tsx`:

```typescript
import { useParams } from 'react-router-dom'

export function MultiplayerRoom() {
  const { roomId } = useParams<{ roomId: string }>()

  return (
    <div style={{
      width: '100vw',
      height: '100dvh',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      flexDirection: 'column',
      gap: '1rem',
      fontFamily: 'system-ui, sans-serif',
      color: 'white',
      background: '#1a1a2e',
    }}>
      <h1>Multiplayer Room</h1>
      <p>Room ID: {roomId}</p>
      <p>Connecting...</p>
    </div>
  )
}
```

**Step 2: Add route to App.tsx**

In `src/App.tsx`, add the import and route:

```typescript
// Add import
import { MultiplayerRoom } from './components/multiplayer/MultiplayerRoom'

// Add route BEFORE the catch-all route:
<Route path="/room/:roomId" element={<MultiplayerRoom />} />
```

The routes should look like:
```tsx
<Routes>
  <Route path="/test/dice-faces" element={<DiceFaceTestHarness />} />
  <Route path="/room/:roomId" element={<MultiplayerRoom />} />
  <Route
    path="/*"
    element={
      <ThemeProvider>
        <DeviceMotionProvider>
          <MainApp />
        </DeviceMotionProvider>
      </ThemeProvider>
    }
  />
</Routes>
```

**Step 3: Add environment variable for server URL**

Create/update `.env.development`:
```
VITE_MULTIPLAYER_SERVER_URL=ws://localhost:8080
```

Create/update `.env.production`:
```
VITE_MULTIPLAYER_SERVER_URL=wss://daisu-server.fly.dev
```

**Step 4: Verify it works**

```bash
npm run dev
# Open http://localhost:3000/room/test123
# Should see "Multiplayer Room" and "Room ID: test123"
```

**Step 5: Commit**

```bash
git add src/App.tsx src/components/multiplayer/MultiplayerRoom.tsx .env.development .env.production
git commit -m "feat(multiplayer): add /room/:roomId route with placeholder component"
```
