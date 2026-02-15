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

  describe('setConnectionStatus', () => {
    it('should update connection status', () => {
      useMultiplayerStore.getState().setConnectionStatus('connecting')
      expect(useMultiplayerStore.getState().connectionStatus).toBe('connecting')

      useMultiplayerStore.getState().setConnectionStatus('connected')
      expect(useMultiplayerStore.getState().connectionStatus).toBe('connected')
    })
  })
})
