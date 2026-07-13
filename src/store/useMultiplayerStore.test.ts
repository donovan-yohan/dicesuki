import { describe, it, expect, beforeEach, vi } from 'vitest'
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
      expect(state.hostId).toBeNull()
      expect(state.isHost).toBe(false)
      expect(state.roomSettings).toEqual({ version: 1 })
    })
  })

  describe('host role & settings', () => {
    it('sets isHost when the local player is the host in room_state', () => {
      // Local player is the last in the list (p2); host is p2.
      useMultiplayerStore.getState().handleServerMessage({
        type: 'room_state',
        roomId: 'abc123',
        hostId: 'p2',
        players: [
          { id: 'p1', displayName: 'Gandalf', color: '#8B5CF6' },
          { id: 'p2', displayName: 'Frodo', color: '#3B82F6' },
        ],
        dice: [],
        settings: { version: 1, physicsMode: 'arcade' },
      })

      const state = useMultiplayerStore.getState()
      expect(state.hostId).toBe('p2')
      expect(state.localPlayerId).toBe('p2')
      expect(state.isHost).toBe(true)
      expect(state.roomSettings.physicsMode).toBe('arcade')
    })

    it('does not set isHost when a different player is the host', () => {
      // Local player is p2 (last), host is p1.
      useMultiplayerStore.getState().handleServerMessage({
        type: 'room_state',
        roomId: 'abc123',
        hostId: 'p1',
        players: [
          { id: 'p1', displayName: 'Gandalf', color: '#8B5CF6' },
          { id: 'p2', displayName: 'Frodo', color: '#3B82F6' },
        ],
        dice: [],
        settings: { version: 1 },
      })

      const state = useMultiplayerStore.getState()
      expect(state.hostId).toBe('p1')
      expect(state.isHost).toBe(false)
    })

    it('promotes local player to host on host_changed', () => {
      useMultiplayerStore.getState().handleServerMessage({
        type: 'room_state',
        roomId: 'abc123',
        hostId: 'p1',
        players: [
          { id: 'p1', displayName: 'Gandalf', color: '#8B5CF6' },
          { id: 'p2', displayName: 'Frodo', color: '#3B82F6' },
        ],
        dice: [],
        settings: { version: 1 },
      })
      expect(useMultiplayerStore.getState().isHost).toBe(false)

      // Host (p1) leaves; server promotes local player (p2).
      useMultiplayerStore.getState().handleServerMessage({
        type: 'host_changed',
        hostId: 'p2',
      })

      const state = useMultiplayerStore.getState()
      expect(state.hostId).toBe('p2')
      expect(state.isHost).toBe(true)
    })

    it('updates roomSettings on settings_updated, preserving forward-compat fields', () => {
      useMultiplayerStore.getState().handleServerMessage({
        type: 'settings_updated',
        settings: { version: 2, physicsMode: 'gentle', theme: 'neon' },
      })

      const settings = useMultiplayerStore.getState().roomSettings
      expect(settings.version).toBe(2)
      expect(settings.physicsMode).toBe('gentle')
      expect(settings.theme).toBe('neon')
    })

    it('sends update_settings over the socket', () => {
      const send = vi.fn()
      useMultiplayerStore.setState({
        connectionStatus: 'connected',
        socket: { send } as unknown as WebSocket,
      })

      useMultiplayerStore.getState().updateSettings({ version: 1, physicsMode: 'arcade' })

      expect(send).toHaveBeenCalledTimes(1)
      const payload = JSON.parse(send.mock.calls[0][0])
      expect(payload).toEqual({
        type: 'update_settings',
        settings: { version: 1, physicsMode: 'arcade' },
      })
    })

    it('resets host and settings state on reset', () => {
      useMultiplayerStore.setState({ hostId: 'p1', isHost: true, roomSettings: { version: 3 } })

      useMultiplayerStore.getState().reset()

      const state = useMultiplayerStore.getState()
      expect(state.hostId).toBeNull()
      expect(state.isHost).toBe(false)
      expect(state.roomSettings).toEqual({ version: 1 })
    })
  })

  describe('motion control', () => {
    it('host setMotionControl sends update_settings preserving other fields', () => {
      const send = vi.fn()
      useMultiplayerStore.setState({
        connectionStatus: 'connected',
        socket: { send } as unknown as WebSocket,
        isHost: true,
        roomSettings: { version: 1, playerCap: 4 },
      })

      useMultiplayerStore.getState().setMotionControl('room')

      expect(send).toHaveBeenCalledTimes(1)
      const payload = JSON.parse(send.mock.calls[0][0])
      expect(payload).toEqual({
        type: 'update_settings',
        settings: { version: 1, playerCap: 4, motionControl: 'room' },
      })
    })

    it('non-host setMotionControl is a no-op (server also enforces)', () => {
      const send = vi.fn()
      useMultiplayerStore.setState({
        connectionStatus: 'connected',
        socket: { send } as unknown as WebSocket,
        isHost: false,
        roomSettings: { version: 1 },
      })

      useMultiplayerStore.getState().setMotionControl('room')

      expect(send).not.toHaveBeenCalled()
    })

    it('sendMotionImpulse does nothing when motion is off', () => {
      const send = vi.fn()
      useMultiplayerStore.setState({
        connectionStatus: 'connected',
        socket: { send } as unknown as WebSocket,
        roomSettings: { version: 1, motionControl: 'off' },
      })

      useMultiplayerStore.getState().sendMotionImpulse([1, 0, 0])

      expect(send).not.toHaveBeenCalled()
    })

    it('sendMotionImpulse sends, then throttles, then sends again after the interval', () => {
      vi.useFakeTimers({ toFake: ['performance'] })
      try {
        const send = vi.fn()
        useMultiplayerStore.setState({
          connectionStatus: 'connected',
          socket: { send } as unknown as WebSocket,
          roomSettings: { version: 1, motionControl: 'own_dice' },
        })

        const store = useMultiplayerStore.getState()
        store.sendMotionImpulse([1, 0, 0])
        store.sendMotionImpulse([2, 0, 0]) // within throttle window — dropped
        expect(send).toHaveBeenCalledTimes(1)
        const first = JSON.parse(send.mock.calls[0][0])
        expect(first).toEqual({ type: 'motion_impulse', impulse: [1, 0, 0] })

        vi.advanceTimersByTime(60) // > MOTION_IMPULSE_MIN_INTERVAL_MS (50)
        store.sendMotionImpulse([3, 0, 0])
        expect(send).toHaveBeenCalledTimes(2)
      } finally {
        vi.useRealTimers()
      }
    })
  })

  describe('delegated roller', () => {
    it('host setRoller sends update_settings preserving other fields', () => {
      const send = vi.fn()
      useMultiplayerStore.setState({
        connectionStatus: 'connected',
        socket: { send } as unknown as WebSocket,
        isHost: true,
        roomSettings: { version: 1, playerCap: 4, motionControl: 'room' },
      })

      useMultiplayerStore.getState().setRoller('p2')

      expect(send).toHaveBeenCalledTimes(1)
      const payload = JSON.parse(send.mock.calls[0][0])
      expect(payload).toEqual({
        type: 'update_settings',
        settings: { version: 1, playerCap: 4, motionControl: 'room', roller: 'p2' },
      })
    })

    it('host setRoller(null) revokes by clearing the roller field', () => {
      const send = vi.fn()
      useMultiplayerStore.setState({
        connectionStatus: 'connected',
        socket: { send } as unknown as WebSocket,
        isHost: true,
        roomSettings: { version: 1, roller: 'p2' },
      })

      useMultiplayerStore.getState().setRoller(null)

      expect(send).toHaveBeenCalledTimes(1)
      const payload = JSON.parse(send.mock.calls[0][0])
      expect(payload).toEqual({ type: 'update_settings', settings: { version: 1 } })
    })

    it('non-host setRoller is a no-op (server also enforces)', () => {
      const send = vi.fn()
      useMultiplayerStore.setState({
        connectionStatus: 'connected',
        socket: { send } as unknown as WebSocket,
        isHost: false,
        roomSettings: { version: 1 },
      })

      useMultiplayerStore.getState().setRoller('p2')

      expect(send).not.toHaveBeenCalled()
    })
  })

  describe('reconnect & lifecycle', () => {
    it('uses the server-echoed localPlayerId even when not last in the list', () => {
      // Simulates a graceful rejoin: the reclaimed player (p1) is not last.
      useMultiplayerStore.getState().handleServerMessage({
        type: 'room_state',
        roomId: 'abc123',
        hostId: 'p1',
        localPlayerId: 'p1',
        players: [
          { id: 'p1', displayName: 'Alice', color: '#8B5CF6' },
          { id: 'p2', displayName: 'Bob', color: '#3B82F6' },
        ],
        dice: [],
        settings: { version: 1 },
      })

      const state = useMultiplayerStore.getState()
      expect(state.localPlayerId).toBe('p1')
      expect(state.isHost).toBe(true)
    })

    it('falls back to the last player when localPlayerId is absent', () => {
      useMultiplayerStore.getState().handleServerMessage({
        type: 'room_state',
        roomId: 'abc123',
        hostId: 'p1',
        players: [
          { id: 'p1', displayName: 'Alice', color: '#8B5CF6' },
          { id: 'p2', displayName: 'Bob', color: '#3B82F6' },
        ],
        dice: [],
        settings: { version: 1 },
      })
      expect(useMultiplayerStore.getState().localPlayerId).toBe('p2')
    })

    it('disconnect sends an explicit leave and suppresses auto-reconnect', () => {
      const send = vi.fn()
      const close = vi.fn()
      useMultiplayerStore.setState({
        connectionStatus: 'connected',
        socket: { send, close } as unknown as WebSocket,
      })

      useMultiplayerStore.getState().disconnect()

      expect(send).toHaveBeenCalledTimes(1)
      expect(JSON.parse(send.mock.calls[0][0])).toEqual({ type: 'leave' })
      expect(close).toHaveBeenCalledTimes(1)
      // reset() runs after, returning to a clean disconnected state.
      expect(useMultiplayerStore.getState().connectionStatus).toBe('disconnected')
      expect(useMultiplayerStore.getState().socket).toBeNull()
    })

    it('reset clears reconnect and notice state', () => {
      useMultiplayerStore.setState({
        roomClosedNotice: 'gone',
        reconnectAttempts: 4,
        intentionalDisconnect: true,
        reconnectToken: 'tok',
        lastJoin: { roomId: 'r', displayName: 'n', color: '#fff', serverUrl: 'ws://x', token: 'tok' },
      })

      useMultiplayerStore.getState().reset()

      const state = useMultiplayerStore.getState()
      expect(state.roomClosedNotice).toBeNull()
      expect(state.reconnectAttempts).toBe(0)
      expect(state.intentionalDisconnect).toBe(false)
      expect(state.reconnectToken).toBeNull()
      expect(state.lastJoin).toBeNull()
    })
  })

  describe('handleServerMessage', () => {
    it('should handle room_state message', () => {
      const msg: ServerMessage = {
        type: 'room_state',
        roomId: 'abc123',
        hostId: 'p1',
        players: [
          { id: 'p1', displayName: 'Gandalf', color: '#8B5CF6' },
          { id: 'p2', displayName: 'Frodo', color: '#3B82F6' },
        ],
        dice: [
          { id: 'd1', ownerId: 'p1', diceType: 'd20', position: [0, 1, 0], rotation: [0, 0, 0, 1] },
        ],
        settings: { version: 1 },
      }

      useMultiplayerStore.getState().handleServerMessage(msg)
      const state = useMultiplayerStore.getState()

      expect(state.players.size).toBe(2)
      expect(state.players.get('p1')?.displayName).toBe('Gandalf')
      expect(state.dice.size).toBe(1)
      expect(state.dice.get('d1')?.diceType).toBe('d20')
      expect(state.localPlayerId).toBe('p2') // Last player = local
    })

    it('should preserve inventory presentation metadata from room_state', () => {
      useMultiplayerStore.getState().handleServerMessage({
        type: 'room_state',
        roomId: 'abc123',
        hostId: 'p1',
        players: [{ id: 'p1', displayName: 'Gandalf', color: '#8B5CF6' }],
        dice: [
          {
            id: 'd1',
            ownerId: 'p1',
            diceType: 'd20',
            position: [0, 1, 0],
            rotation: [0, 0, 0, 1],
            presentation: {
              inventoryDieId: 'die_lucky_d20',
              displayName: 'Lucky D20',
              baseColor: '#8b5cf6',
            },
          },
        ],
        settings: { version: 1 },
      })

      const die = useMultiplayerStore.getState().dice.get('d1')
      expect(die?.presentation?.inventoryDieId).toBe('die_lucky_d20')
      expect(die?.presentation?.displayName).toBe('Lucky D20')
      expect(die?.presentation?.baseColor).toBe('#8b5cf6')
    })

    it('should handle player_joined message', () => {
      useMultiplayerStore.getState().handleServerMessage({
        type: 'room_state',
        roomId: 'abc123',
        hostId: 'p1',
        players: [{ id: 'p1', displayName: 'Gandalf', color: '#8B5CF6' }],
        dice: [],
        settings: { version: 1 },
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
        hostId: 'p1',
        players: [
          { id: 'p1', displayName: 'Gandalf', color: '#8B5CF6' },
          { id: 'p2', displayName: 'Frodo', color: '#3B82F6' },
        ],
        dice: [],
        settings: { version: 1 },
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

    it('should preserve prev position on snapshot update', () => {
      useMultiplayerStore.getState().handleServerMessage({
        type: 'dice_spawned',
        ownerId: 'p1',
        dice: [
          { id: 'd1', ownerId: 'p1', diceType: 'd6', position: [0, 2, 0], rotation: [0, 0, 0, 1] },
        ],
      })

      // First snapshot
      useMultiplayerStore.getState().handleServerMessage({
        type: 'physics_snapshot',
        tick: 1,
        dice: [{ id: 'd1', p: [1, 1, 1], r: [0, 0, 0, 1] }],
      })

      // Second snapshot — prev should be the first target
      useMultiplayerStore.getState().handleServerMessage({
        type: 'physics_snapshot',
        tick: 2,
        dice: [{ id: 'd1', p: [2, 2, 2], r: [0.5, 0.5, 0.5, 0.5] }],
      })

      const die = useMultiplayerStore.getState().dice.get('d1')
      expect(die?.prevPosition).toEqual([1, 1, 1])
      expect(die?.targetPosition).toEqual([2, 2, 2])
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
      expect(die?.position).toEqual([1, 0, 0.5])
    })

    it('should handle dice_knocked message by re-rolling the die and clearing its face', () => {
      useMultiplayerStore.getState().handleServerMessage({
        type: 'dice_spawned',
        ownerId: 'p1',
        dice: [
          { id: 'd1', ownerId: 'p1', diceType: 'd6', position: [0, 2, 0], rotation: [0, 0, 0, 1] },
        ],
      })
      // Settle it first so it has a stale face value.
      useMultiplayerStore.getState().handleServerMessage({
        type: 'die_settled',
        diceId: 'd1',
        faceValue: 4,
        position: [1, 0, 0.5],
        rotation: [0, 0, 0, 1],
      })
      expect(useMultiplayerStore.getState().dice.get('d1')?.faceValue).toBe(4)

      // A knock must clear the stale face and mark the die rolling again.
      useMultiplayerStore.getState().handleServerMessage({
        type: 'dice_knocked',
        diceId: 'd1',
        position: [1, 0, 0.5],
        impactSpeed: 6.5,
      })

      const die = useMultiplayerStore.getState().dice.get('d1')
      expect(die?.isRolling).toBe(true)
      expect(die?.faceValue).toBeNull()
    })

    it('should handle dice_knocked for an unknown die without crashing', () => {
      useMultiplayerStore.getState().handleServerMessage({
        type: 'dice_knocked',
        diceId: 'ghost',
        position: [0, 0, 0],
        impactSpeed: 5,
      })
      expect(useMultiplayerStore.getState().dice.size).toBe(0)
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

    it('should handle error message without crashing', () => {
      // Should not throw
      useMultiplayerStore.getState().handleServerMessage({
        type: 'error',
        code: 'ROOM_FULL',
        message: 'Room is full (8/8 players)',
      })
      // Store state should be unchanged
      expect(useMultiplayerStore.getState().players.size).toBe(0)
    })

    it('should handle roll_complete message without crashing', () => {
      useMultiplayerStore.getState().handleServerMessage({
        type: 'roll_complete',
        playerId: 'p1',
        results: [{ diceId: 'd1', diceType: 'd20', faceValue: 17 }],
        total: 17,
      })
      // roll_complete is handled by room history store, not this one
      expect(useMultiplayerStore.getState().dice.size).toBe(0)
    })
  })

  describe('sendMessage', () => {
    it('should not throw when disconnected', () => {
      // Should not throw even without a connected socket
      expect(() => {
        useMultiplayerStore.getState().sendMessage({ type: 'roll' })
      }).not.toThrow()
    })

    it('should send spawn_dice with presentation metadata when connected', () => {
      const send = vi.fn()
      useMultiplayerStore.setState({
        connectionStatus: 'connected',
        socket: { send } as unknown as WebSocket,
        localPlayerId: 'p1',
      })

      useMultiplayerStore.getState().spawnDice('d20', {
        inventoryDieId: 'die_lucky_d20',
        displayName: 'Lucky D20',
        baseColor: '#8b5cf6',
      })

      expect(send).toHaveBeenCalledTimes(1)
      const payload = JSON.parse(send.mock.calls[0][0])
      expect(payload).toMatchObject({
        type: 'spawn_dice',
        dice: [
          {
            diceType: 'd20',
            presentation: {
              inventoryDieId: 'die_lucky_d20',
              displayName: 'Lucky D20',
              baseColor: '#8b5cf6',
            },
          },
        ],
      })
      expect(payload.dice[0].id).toContain('die_lucky_d20')
      expect(payload.dice[0].id).toMatch(/^die_lucky_d20-\d+-[a-z0-9]+$/)
      expect(useMultiplayerStore.getState().pendingInventoryDieIds.has('die_lucky_d20')).toBe(true)
    })

    it('blocks duplicate pending inventory dice before the server roundtrip', () => {
      const send = vi.fn()
      useMultiplayerStore.setState({
        connectionStatus: 'connected',
        socket: { send } as unknown as WebSocket,
        localPlayerId: 'p1',
      })

      useMultiplayerStore.getState().spawnDice('d20', { inventoryDieId: 'die_lucky_d20' })
      useMultiplayerStore.getState().spawnDice('d20', { inventoryDieId: 'die_lucky_d20' })

      expect(send).toHaveBeenCalledTimes(1)
    })

    it('clears pending inventory dice when the server acknowledges the spawn', () => {
      const send = vi.fn()
      useMultiplayerStore.setState({
        connectionStatus: 'connected',
        socket: { send } as unknown as WebSocket,
        localPlayerId: 'p1',
      })

      useMultiplayerStore.getState().spawnDice('d20', { inventoryDieId: 'die_lucky_d20' })
      expect(useMultiplayerStore.getState().pendingInventoryDieIds.has('die_lucky_d20')).toBe(true)

      useMultiplayerStore.getState().handleServerMessage({
        type: 'dice_spawned',
        ownerId: 'p1',
        dice: [
          {
            id: 'die_lucky_d20-1',
            ownerId: 'p1',
            diceType: 'd20',
            position: [0, 2, 0],
            rotation: [0, 0, 0, 1],
            presentation: { inventoryDieId: 'die_lucky_d20' },
          },
        ],
      })

      expect(useMultiplayerStore.getState().pendingInventoryDieIds.has('die_lucky_d20')).toBe(false)
    })

    it('generates random-suffixed ids for inventory and generic dice', () => {
      const send = vi.fn()
      useMultiplayerStore.setState({
        connectionStatus: 'connected',
        socket: { send } as unknown as WebSocket,
        localPlayerId: 'p1',
      })

      useMultiplayerStore.getState().spawnDice('d20', { inventoryDieId: 'die_lucky_d20' })
      useMultiplayerStore.getState().spawnDice('d6')

      const inventoryPayload = JSON.parse(send.mock.calls[0][0])
      const genericPayload = JSON.parse(send.mock.calls[1][0])
      expect(inventoryPayload.dice[0].id).toMatch(/^die_lucky_d20-\d+-[a-z0-9]+$/)
      expect(genericPayload.dice[0].id).toMatch(/^d6-\d+-[a-z0-9]+$/)
    })
  })

  describe('reset', () => {
    it('should reset all state', () => {
      useMultiplayerStore.getState().handleServerMessage({
        type: 'room_state',
        roomId: 'abc123',
        hostId: 'p1',
        players: [{ id: 'p1', displayName: 'Test', color: '#FFF' }],
        dice: [],
        settings: { version: 1 },
      })

      useMultiplayerStore.getState().reset()
      const state = useMultiplayerStore.getState()

      expect(state.connectionStatus).toBe('disconnected')
      expect(state.players.size).toBe(0)
      expect(state.dice.size).toBe(0)
      expect(state.roomId).toBeNull()
    })
  })

  describe('setConnectionStatus', () => {
    it('should update connection status', () => {
      useMultiplayerStore.getState().setConnectionStatus('connecting')
      expect(useMultiplayerStore.getState().connectionStatus).toBe('connecting')

      useMultiplayerStore.getState().setConnectionStatus('connected')
      expect(useMultiplayerStore.getState().connectionStatus).toBe('connected')
    })
  })
})
