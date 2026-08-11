import { describe, it, expect, beforeEach, vi } from 'vitest'
import { useMultiplayerStore, isStaleSessionErrorCode } from './useMultiplayerStore'
import { useDiceStore } from './useDiceStore'
import type { ServerMessage } from '../lib/multiplayerMessages'
import { loadRoomSession, saveRoomSession } from '../lib/roomSession'

// Module-level mock (Frontend-ADR-004): the store reads the Supabase session on
// socket open and, for #264, refreshes it once when the room rejects the token.
// Guest mode (`null`) is the default; auth tests override per case.
const getSupabaseClientMock = vi.hoisted(() => vi.fn(() => null as unknown))
vi.mock('../lib/supabaseClient', () => ({
  getSupabaseClient: getSupabaseClientMock,
}))

// `reset()` deliberately preserves `serverUrl`, so it is the one field a
// `reset()` in `beforeEach` cannot restore. Capture the pristine default and
// re-pin it so a test that points the store at a custom server cannot leak that
// into whatever the runner schedules next (issue #224).
const DEFAULT_SERVER_URL = useMultiplayerStore.getState().serverUrl

describe('useMultiplayerStore', () => {
  beforeEach(() => {
    useMultiplayerStore.getState().reset()
    useMultiplayerStore.setState({ serverUrl: DEFAULT_SERVER_URL })
    localStorage.clear()
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

    it('sendMotionField does nothing when motion is off', () => {
      const send = vi.fn()
      useMultiplayerStore.setState({
        connectionStatus: 'connected',
        socket: { send } as unknown as WebSocket,
        roomSettings: { version: 1, motionControl: 'off' },
      })

      useMultiplayerStore.getState().sendMotionField([1, 0, 0])

      expect(send).not.toHaveBeenCalled()
    })

    it('sendMotionField sends, then throttles, then sends again after the interval', () => {
      vi.useFakeTimers({ toFake: ['performance'] })
      try {
        const send = vi.fn()
        useMultiplayerStore.setState({
          connectionStatus: 'connected',
          socket: { send } as unknown as WebSocket,
          roomSettings: { version: 1, motionControl: 'own_dice' },
        })

        const store = useMultiplayerStore.getState()
        store.sendMotionField([1, 0, 0])
        store.sendMotionField([2, 0, 0]) // within throttle window — dropped
        expect(send).toHaveBeenCalledTimes(1)
        const first = JSON.parse(send.mock.calls[0][0])
        expect(first).toEqual({ type: 'motion_field', field: [1, 0, 0] })

        vi.advanceTimersByTime(40) // > MOTION_FIELD_SEND_THROTTLE_MS (33)
        store.sendMotionField([3, 0, 0])
        expect(send).toHaveBeenCalledTimes(2)
      } finally {
        vi.useRealTimers()
      }
    })

    it('sendMotionField lets a zero field through immediately to stop motion', () => {
      vi.useFakeTimers({ toFake: ['performance'] })
      try {
        const send = vi.fn()
        useMultiplayerStore.setState({
          connectionStatus: 'connected',
          socket: { send } as unknown as WebSocket,
          roomSettings: { version: 1, motionControl: 'own_dice' },
        })

        // Advance well past any throttle state carried over from a prior test so
        // this case stands on its own regardless of order.
        vi.advanceTimersByTime(100_000)

        const store = useMultiplayerStore.getState()
        store.sendMotionField([5, 0, 0]) // sends (call 1)
        store.sendMotionField([2, 0, 0]) // within throttle → dropped
        // A zero field bypasses the throttle so the dice stop promptly (call 2).
        store.sendMotionField([0, 0, 0])
        expect(send).toHaveBeenCalledTimes(2)
        const stop = JSON.parse(send.mock.calls[1][0])
        expect(stop).toEqual({ type: 'motion_field', field: [0, 0, 0] })

        // A held-still phone (motion on) emits a zero field every frame; only the
        // first stop is sent — subsequent zeros must not flood the socket.
        store.sendMotionField([0, 0, 0])
        store.sendMotionField([0, 0, 0])
        expect(send).toHaveBeenCalledTimes(2)

        // Resuming motion sends again (and re-arms the stop).
        vi.advanceTimersByTime(1000)
        store.sendMotionField([4, 0, 0])
        expect(send).toHaveBeenCalledTimes(3)
      } finally {
        vi.useRealTimers()
      }
    })

    it('streams spin-only input and sends both zero terms on disable', () => {
      vi.useFakeTimers({ toFake: ['performance'] })
      try {
        const send = vi.fn()
        useMultiplayerStore.setState({
          connectionStatus: 'connected',
          socket: { send } as unknown as WebSocket,
          roomSettings: { version: 1, motionControl: 'own_dice' },
        })
        vi.advanceTimersByTime(1000)

        const store = useMultiplayerStore.getState()
        store.sendMotionField([0, 0, 0], [0, 30, 0])
        expect(JSON.parse(send.mock.calls[0][0])).toEqual({
          type: 'motion_field',
          field: [0, 0, 0],
          angularAccel: [0, 30, 0],
        })

        store.sendMotionField([0, 0, 0], [0, 0, 0])
        expect(JSON.parse(send.mock.calls[1][0])).toEqual({
          type: 'motion_field',
          field: [0, 0, 0],
          angularAccel: [0, 0, 0],
        })
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

  describe('room theme', () => {
    it('host setRoomTheme sends update_settings preserving other fields', () => {
      const send = vi.fn()
      useMultiplayerStore.setState({
        connectionStatus: 'connected',
        socket: { send } as unknown as WebSocket,
        isHost: true,
        roomSettings: { version: 1, playerCap: 4, motionControl: 'room' },
      })

      useMultiplayerStore.getState().setRoomTheme('neon-cyber-city')

      expect(send).toHaveBeenCalledTimes(1)
      const payload = JSON.parse(send.mock.calls[0][0])
      expect(payload).toEqual({
        type: 'update_settings',
        settings: { version: 1, playerCap: 4, motionControl: 'room', themeId: 'neon-cyber-city' },
      })
    })

    it('host setRoomTheme(null) clears the shared theme field', () => {
      const send = vi.fn()
      useMultiplayerStore.setState({
        connectionStatus: 'connected',
        socket: { send } as unknown as WebSocket,
        isHost: true,
        roomSettings: { version: 1, themeId: 'fantasy-earth' },
      })

      useMultiplayerStore.getState().setRoomTheme(null)

      expect(send).toHaveBeenCalledTimes(1)
      const payload = JSON.parse(send.mock.calls[0][0])
      expect(payload).toEqual({ type: 'update_settings', settings: { version: 1 } })
    })

    it('non-host setRoomTheme is a no-op (server also enforces)', () => {
      const send = vi.fn()
      useMultiplayerStore.setState({
        connectionStatus: 'connected',
        socket: { send } as unknown as WebSocket,
        isHost: false,
        roomSettings: { version: 1 },
      })

      useMultiplayerStore.getState().setRoomTheme('neon-cyber-city')

      expect(send).not.toHaveBeenCalled()
    })
  })

  describe('room discovery (#79)', () => {
    it('host setVisibility sends update_settings preserving other fields', () => {
      const send = vi.fn()
      useMultiplayerStore.setState({
        connectionStatus: 'connected',
        socket: { send } as unknown as WebSocket,
        isHost: true,
        roomSettings: { version: 1, playerCap: 4 },
      })

      useMultiplayerStore.getState().setVisibility('public')

      expect(send).toHaveBeenCalledTimes(1)
      const payload = JSON.parse(send.mock.calls[0][0])
      expect(payload).toEqual({
        type: 'update_settings',
        settings: { version: 1, playerCap: 4, visibility: 'public' },
      })
    })

    it('host setRoomName sanitizes and sends the name', () => {
      const send = vi.fn()
      useMultiplayerStore.setState({
        connectionStatus: 'connected',
        socket: { send } as unknown as WebSocket,
        isHost: true,
        roomSettings: { version: 1, visibility: 'public' },
      })

      useMultiplayerStore.getState().setRoomName('  Taco   Tuesday  ')

      const payload = JSON.parse(send.mock.calls[0][0])
      expect(payload.settings.roomName).toBe('Taco Tuesday')
    })

    it('non-host setVisibility is a no-op (server also enforces)', () => {
      const send = vi.fn()
      useMultiplayerStore.setState({
        connectionStatus: 'connected',
        socket: { send } as unknown as WebSocket,
        isHost: false,
        roomSettings: { version: 1 },
      })

      useMultiplayerStore.getState().setVisibility('public')

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

    it('transient detach closes without Leave and preserves durable resume', () => {
      const send = vi.fn()
      const close = vi.fn()
      useMultiplayerStore.setState({
        connectionStatus: 'connected',
        socket: { send, close } as unknown as WebSocket,
        roomId: 'abc123',
        lastJoin: {
          roomId: 'abc123', displayName: 'Alice', color: '#8B5CF6',
          serverUrl: 'ws://x', token: '12345678-1234-4234-9234-123456789abc', transport: 'websocket',
        },
      })

      useMultiplayerStore.getState().detach()

      expect(send).not.toHaveBeenCalled()
      expect(close).toHaveBeenCalledOnce()
      expect(localStorage.getItem('dicesuki:room-sessions')).toContain('abc123')
    })

    it('reset clears reconnect and notice state', () => {
      useMultiplayerStore.setState({
        roomClosedNotice: 'gone',
        reconnectAttempts: 4,
        intentionalDisconnect: true,
        reconnectToken: 'tok',
        lastJoin: { roomId: 'r', displayName: 'n', color: '#fff', serverUrl: 'ws://x', token: 'tok', transport: 'websocket' },
      })

      useMultiplayerStore.getState().reset()

      const state = useMultiplayerStore.getState()
      expect(state.roomClosedNotice).toBeNull()
      expect(state.reconnectAttempts).toBe(0)
      expect(state.intentionalDisconnect).toBe(false)
      expect(state.reconnectToken).toBeNull()
      expect(state.lastJoin).toBeNull()
    })

    it('reset preserves serverUrl — connection config, not room state', () => {
      // Leaving a room must not forget which server the client is pointed at,
      // or reconnecting to a custom/self-hosted room server silently falls back
      // to the default. This is the one field reset() deliberately carries over.
      useMultiplayerStore.setState({ serverUrl: 'ws://custom.example:9000' })

      useMultiplayerStore.getState().reset()

      expect(useMultiplayerStore.getState().serverUrl).toBe('ws://custom.example:9000')
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

    it('dice_removed prunes the die from the roll-result store so the top HUD total drops it', () => {
      // Arrange: a die on the table that has settled with a face value, mirrored
      // into useDiceStore (the source the top-of-screen total/chips render from).
      useMultiplayerStore.getState().handleServerMessage({
        type: 'room_state',
        roomId: 'r',
        hostId: 'p1',
        players: [{ id: 'p1', displayName: 'A', color: '#fff' }],
        dice: [{ id: 'd1', ownerId: 'p1', diceType: 'd6', position: [0, 0, 0], rotation: [0, 0, 0, 1] }],
        settings: { version: 1 },
      })
      useMultiplayerStore.getState().handleServerMessage({
        type: 'die_settled',
        diceId: 'd1',
        faceValue: 4,
        position: [0, 0, 0],
        rotation: [0, 0, 0, 1],
      })
      expect(useDiceStore.getState().settledDice.has('d1')).toBe(true)

      // Act: delete the die.
      useMultiplayerStore.getState().handleServerMessage({ type: 'dice_removed', diceIds: ['d1'] })

      // Assert: pruned from BOTH the live dice map and the roll-result store, so its
      // value no longer feeds the top total.
      expect(useMultiplayerStore.getState().dice.has('d1')).toBe(false)
      expect(useDiceStore.getState().settledDice.has('d1')).toBe(false)
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

    it('updates held-seat presence without removing the roster entry', () => {
      useMultiplayerStore.setState({
        players: new Map([['p2', { id: 'p2', displayName: 'Frodo', color: '#3B82F6', connected: true }]]),
      })
      useMultiplayerStore.getState().handleServerMessage({
        type: 'player_presence_changed',
        playerId: 'p2',
        connected: false,
      })
      expect(useMultiplayerStore.getState().players.get('p2')?.connected).toBe(false)
    })

    it('host removal clears resume state and suppresses reconnect for the target', () => {
      localStorage.setItem('dicesuki:room-sessions', JSON.stringify({
        version: 1,
        sessions: [{
          version: 1,
          roomId: 'abc123',
          displayName: 'Frodo',
          color: '#3B82F6',
          reconnectToken: 'long-secret-token-value',
          updatedAt: Date.now(),
        }],
      }))
      const close = vi.fn()
      useMultiplayerStore.setState({
        roomId: 'abc123',
        socket: { close } as never,
        lastJoin: {
          roomId: 'abc123', displayName: 'Frodo', color: '#3B82F6',
          serverUrl: 'ws://x', token: 'long-secret-token-value', transport: 'websocket',
        },
      })
      useMultiplayerStore.getState().handleServerMessage({
        type: 'removed_from_room',
        reason: 'The host removed you from the room.',
      })
      const state = useMultiplayerStore.getState()
      expect(state.intentionalDisconnect).toBe(true)
      expect(state.lastJoin).toBeNull()
      expect(state.removedFromRoomNotice).toContain('host removed')
      expect(localStorage.getItem('dicesuki:room-sessions')).toBeNull()
      expect(close).toHaveBeenCalledOnce()
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

    it('should record a REMOTE percentile 00 + 0 as 100 with no local roll state', () => {
      // The regression this guards: pairing used to live in the LOCAL
      // `activeSavedRoll`, so a roll_complete for another player's d100 — or for
      // this client after a refresh — was aggregated as an uncorrected 0. The
      // pairing now arrives on `presentation`, which the room echoes back.
      useDiceStore.getState().reset()
      expect(useDiceStore.getState().activeSavedRoll).toBeNull()
      useMultiplayerStore.setState({
        players: new Map([['p2', {
          id: 'p2',
          displayName: 'Remote Player',
          color: '#ffffff',
          isHost: false,
        }]]) as never,
      })

      useMultiplayerStore.getState().handleServerMessage({
        type: 'roll_complete',
        playerId: 'p2',
        results: [
          {
            diceId: 'tens',
            diceType: 'd10tens',
            faceValue: 0,
            presentation: { percentilePairId: 'p1', percentileRole: 'tens' },
          },
          {
            diceId: 'ones',
            diceType: 'd10',
            faceValue: 0,
            presentation: { percentilePairId: 'p1', percentileRole: 'ones' },
          },
        ],
        // The room reports a PLAIN face sum — the client corrects for display.
        total: 0,
      })

      const [snapshot] = useDiceStore.getState().rollHistory
      expect(snapshot.sum).toBe(100)
      expect(snapshot.player?.displayName).toBe('Remote Player')
    })

    it('drops the roll_complete a wave sequence claimed, even once the latch has cleared', () => {
      // Issue #211: a saved roll whose reroll/explosion never triggers finishes
      // its waves before this message arrives, so suppression cannot key on
      // `savedRollWavesPending`. The claim names the roll's dice instead.
      useDiceStore.getState().reset()
      useMultiplayerStore.setState({
        localPlayerId: 'p1',
        players: new Map([['p1', {
          id: 'p1', displayName: 'Me', color: '#f00', isHost: true,
        }]]) as never,
      })

      // Claimed in spawn order `b, a`; the room will report them sorted as
      // `a, b`. The match has to be set-wise or the claim misses entirely.
      useDiceStore.getState().beginSavedRollWaves(['b', 'a'])
      useDiceStore.getState().markDiceRolling(['a', 'b'])
      useDiceStore.getState().recordDieSettled('a', 2, 'd6')
      useDiceStore.getState().recordDieSettled('b', 3, 'd6')
      useDiceStore.getState().finishSavedRollWaves({
        id: 'p1', displayName: 'Me', color: '#f00',
      })

      // The wave row is written and the latch is down, but the claim stands.
      expect(useDiceStore.getState().rollHistory).toHaveLength(1)
      expect(useDiceStore.getState().savedRollWavesPending).toBe(false)

      // The room finally speaks — in the room's own sorted order, which the
      // claim must match set-wise, not positionally.
      const message = {
        type: 'roll_complete' as const,
        playerId: 'p1',
        total: 5,
        results: [
          { diceId: 'a', diceType: 'd6', faceValue: 2 },
          { diceId: 'b', diceType: 'd6', faceValue: 3 },
        ],
      }
      useMultiplayerStore.getState().handleServerMessage(message as never)
      expect(useDiceStore.getState().rollHistory).toHaveLength(1)

      // One-shot: the claim is consumed, so a later roll of the same dice records.
      useMultiplayerStore.getState().handleServerMessage(message as never)
      expect(useDiceStore.getState().rollHistory).toHaveLength(2)
    })

    it('still drops the claimed roll_complete after the roll was shrunk', () => {
      // Issues #226 + #211. A wave sequence claims its roll by dice id, but the
      // room now completes a SHRUNK roll naming only the survivors — which a
      // reroll wave causes every time it discards a target. The claim shrinks
      // with the room (`applyDiceRemoval`), so this message is still recognised
      // and dropped; otherwise it lands as a second row beside the one
      // `finishSavedRollWaves` wrote for the very same roll.
      useDiceStore.getState().reset()
      useMultiplayerStore.setState({
        localPlayerId: 'p1',
        players: new Map([['p1', {
          id: 'p1', displayName: 'Me', color: '#f00', isHost: true,
        }]]) as never,
        dice: new Map([
          ['keep', { id: 'keep', ownerId: 'p1', diceType: 'd6' }],
          ['discard', { id: 'discard', ownerId: 'p1', diceType: 'd6' }],
        ]) as never,
      })

      useDiceStore.getState().beginSavedRollWaves(['keep', 'discard'])
      useDiceStore.getState().markDiceRolling(['keep', 'discard'])
      useDiceStore.getState().recordDieSettled('keep', 4, 'd6')
      useDiceStore.getState().recordDieSettled('discard', 1, 'd6')

      // The reroll wave discards its target through the room.
      useMultiplayerStore.getState().handleServerMessage({
        type: 'dice_removed',
        diceIds: ['discard'],
      } as never)
      useDiceStore.getState().finishSavedRollWaves({
        id: 'p1', displayName: 'Me', color: '#f00',
      })
      expect(useDiceStore.getState().rollHistory).toHaveLength(1)

      // The room completes the shrunk roll: survivors only.
      useMultiplayerStore.getState().handleServerMessage({
        type: 'roll_complete',
        playerId: 'p1',
        total: 4,
        results: [{ diceId: 'keep', diceType: 'd6', faceValue: 4 }],
      } as never)

      expect(useDiceStore.getState().rollHistory).toHaveLength(1)
    })

    it('records a roll the room shrank exactly once, on the room\'s terms', () => {
      // Issues #226 + #211 together. Removing a tracked die makes the room
      // complete the roll from the SURVIVORS, so the row the local orphan path
      // writes when the table goes still is provisional: the completion that
      // follows a frame later replaces it rather than listing the roll twice.
      useDiceStore.getState().reset()
      useMultiplayerStore.setState({
        localPlayerId: 'p1',
        players: new Map([
          ['p1', { id: 'p1', displayName: 'Me', color: '#f00', isHost: true }],
        ]) as never,
        dice: new Map([
          ['die-1', { id: 'die-1', ownerId: 'p1', diceType: 'd6' }],
          ['die-2', { id: 'die-2', ownerId: 'p1', diceType: 'd6' }],
        ]) as never,
      })

      const send = (message: unknown) =>
        useMultiplayerStore.getState().handleServerMessage(message as never)

      send({ type: 'roll_started', playerId: 'p1', diceIds: ['die-1', 'die-2'] })
      send({
        type: 'die_settled',
        diceId: 'die-1',
        faceValue: 2,
        position: [0, 0, 0],
        rotation: [0, 0, 0, 1],
      })
      // die-2 is trashed while still in the air; the table is now still.
      send({ type: 'dice_removed', diceIds: ['die-2'] })

      const provisional = useDiceStore.getState().rollHistory
      expect(provisional).toHaveLength(1)
      expect(provisional[0].sum).toBe(2)

      // The room completes the shrunk roll from what survived.
      send({
        type: 'roll_complete',
        playerId: 'p1',
        total: 2,
        results: [{ diceId: 'die-1', diceType: 'd6', faceValue: 2 }],
      })

      const history = useDiceStore.getState().rollHistory
      expect(history).toHaveLength(1)
      expect(history[0].id).toBe(provisional[0].id)
      expect(history[0].sum).toBe(2)
      expect(history[0].player?.id).toBe('p1')
    })

    it('records a REMOTE roll from its own roll_complete, cycle untouched', () => {
      // Issue #221: a rival's `roll_started` used to fold their dice into our
      // roll cycle, where a later removal would orphan it into a row we had no
      // business writing. Their roll is the room's to report, start to finish.
      useDiceStore.getState().reset()
      useMultiplayerStore.setState({
        localPlayerId: 'p1',
        players: new Map([
          ['p1', { id: 'p1', displayName: 'Me', color: '#f00', isHost: true }],
          ['p2', { id: 'p2', displayName: 'Rival', color: '#0f0', isHost: false }],
        ]) as never,
        dice: new Map([
          ['their-1', { id: 'their-1', ownerId: 'p2', diceType: 'd6' }],
          ['their-2', { id: 'their-2', ownerId: 'p2', diceType: 'd6' }],
        ]) as never,
      })

      const send = (message: unknown) =>
        useMultiplayerStore.getState().handleServerMessage(message as never)

      send({ type: 'roll_started', playerId: 'p2', diceIds: ['their-1', 'their-2'] })
      expect(useDiceStore.getState().currentRollCycleDice.size).toBe(0)
      expect(useDiceStore.getState().rollingDice.has('their-1')).toBe(true)

      send({
        type: 'die_settled',
        diceId: 'their-1',
        faceValue: 2,
        position: [0, 0, 0],
        rotation: [0, 0, 0, 1],
      })
      send({ type: 'dice_removed', diceIds: ['their-2'] })
      expect(useDiceStore.getState().rollHistory).toHaveLength(0)

      send({
        type: 'roll_complete',
        playerId: 'p2',
        total: 2,
        results: [{ diceId: 'their-1', diceType: 'd6', faceValue: 2 }],
      })

      const history = useDiceStore.getState().rollHistory
      expect(history).toHaveLength(1)
      expect(history[0].sum).toBe(2)
      expect(history[0].player?.displayName).toBe('Rival')
      expect(history[0].player?.id).toBe('p2')
    })

    it('keeps a rival\'s roll out of OUR wave sequence', () => {
      // The #221 repro: their `roll_started` landing between our waves reset
      // the cycle, so the wave row was built from whatever came after it — and
      // the claim that stops that row being written twice went with it.
      useDiceStore.getState().reset()
      useMultiplayerStore.setState({
        localPlayerId: 'p1',
        players: new Map([
          ['p1', { id: 'p1', displayName: 'Me', color: '#f00', isHost: true }],
          ['p2', { id: 'p2', displayName: 'Rival', color: '#0f0', isHost: false }],
        ]) as never,
        dice: new Map([
          ['mine-1', { id: 'mine-1', ownerId: 'p1', diceType: 'd6' }],
          ['theirs', { id: 'theirs', ownerId: 'p2', diceType: 'd6' }],
        ]) as never,
      })

      const send = (message: unknown) =>
        useMultiplayerStore.getState().handleServerMessage(message as never)

      useDiceStore.getState().beginSavedRollWaves(['mine-1'])
      send({ type: 'roll_started', playerId: 'p1', diceIds: ['mine-1'] })
      send({
        type: 'die_settled',
        diceId: 'mine-1',
        faceValue: 4,
        position: [0, 0, 0],
        rotation: [0, 0, 0, 1],
      })

      // A rival rolls mid-sequence.
      send({ type: 'roll_started', playerId: 'p2', diceIds: ['theirs'] })

      expect([...useDiceStore.getState().currentRollCycleDice]).toEqual(['mine-1'])
      expect(useDiceStore.getState().suppressedRollDiceIds).toEqual(['mine-1'])

      // Our wave row still knows what our roll consisted of.
      useDiceStore.getState().finishSavedRollWaves({
        id: 'p1', displayName: 'Me', color: '#f00',
      })
      const history = useDiceStore.getState().rollHistory
      expect(history).toHaveLength(1)
      expect(history[0].dice.map((d) => d.diceId)).toEqual(['mine-1'])
      expect(history[0].sum).toBe(4)
    })

    it('should not pair two loose d10s in a roll_complete', () => {
      useDiceStore.getState().reset()
      useMultiplayerStore.setState({
        players: new Map([['p1', {
          id: 'p1',
          displayName: 'Player One',
          color: '#ffffff',
          isHost: true,
        }]]) as never,
      })

      useMultiplayerStore.getState().handleServerMessage({
        type: 'roll_complete',
        playerId: 'p1',
        results: [
          { diceId: 'a', diceType: 'd10', faceValue: 0 },
          { diceId: 'b', diceType: 'd10', faceValue: 0 },
        ],
        total: 0,
      })

      expect(useDiceStore.getState().rollHistory[0].sum).toBe(0)
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

    it('omits savedRollName entirely for a plain roll', () => {
      const send = vi.fn()
      useMultiplayerStore.setState({
        connectionStatus: 'connected',
        socket: { send } as unknown as WebSocket,
        localPlayerId: 'p1',
      })

      useMultiplayerStore.getState().roll()

      // The key must be absent, not null/empty: a bare `{"type":"roll"}` is
      // exactly what every pre-#244 client sends and what the server's
      // back-compat path accepts.
      expect(JSON.parse(send.mock.calls[0][0])).toEqual({ type: 'roll' })
    })

    it('names the roll when it came from a saved roll', () => {
      const send = vi.fn()
      useMultiplayerStore.setState({
        connectionStatus: 'connected',
        socket: { send } as unknown as WebSocket,
        localPlayerId: 'p1',
      })

      useMultiplayerStore.getState().roll('Sneak Attack')

      expect(JSON.parse(send.mock.calls[0][0])).toEqual({
        type: 'roll',
        savedRollName: 'Sneak Attack',
      })
    })

    it('drops a non-string savedRollName instead of sending an unparseable roll', () => {
      const send = vi.fn()
      useMultiplayerStore.setState({
        connectionStatus: 'connected',
        socket: { send } as unknown as WebSocket,
        localPlayerId: 'p1',
      })

      // `roll` is handed to React event handlers, so a future
      // `onClick={roll}` would pass a click event as the first argument.
      // Serializing that would make the message undeserializable server-side
      // (`Option<String>` vs an object) and silently break the Roll button.
      const clickEvent = { type: 'click', target: {} } as unknown as string
      useMultiplayerStore.getState().roll(clickEvent)
      useMultiplayerStore.getState().roll('   ')

      for (const call of send.mock.calls) {
        expect(JSON.parse(call[0])).toEqual({ type: 'roll' })
      }
      expect(send).toHaveBeenCalledTimes(2)
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

  describe('join-phase error handling (#78)', () => {
    it('surfaces a ROOM_FULL rejection on the form and stops the socket', () => {
      const close = vi.fn()
      // Simulate an open socket that has sent `join` but not yet received room_state.
      useMultiplayerStore.setState({
        socket: { close } as unknown as WebSocket,
        connectionStatus: 'connected',
        localPlayerId: null,
      })

      useMultiplayerStore.getState().handleServerMessage({
        type: 'error',
        code: 'ROOM_FULL',
        message: 'Room is full (8/8 players)',
      })

      const state = useMultiplayerStore.getState()
      expect(state.connectionError).toBe('Room is full (8/8 players)')
      expect(state.connectionStatus).toBe('disconnected')
      expect(state.socket).toBeNull()
      expect(state.lastJoin).toBeNull()
      expect(close).toHaveBeenCalled()
    })

    it('ignores join-phase error codes once already joined (localPlayerId set)', () => {
      const close = vi.fn()
      useMultiplayerStore.setState({
        socket: { close } as unknown as WebSocket,
        connectionStatus: 'connected',
        localPlayerId: 'p1',
      })

      useMultiplayerStore.getState().handleServerMessage({
        type: 'error',
        code: 'INVALID_COLOR',
        message: 'Invalid color',
      })

      const state = useMultiplayerStore.getState()
      // Mid-session errors must not tear down a live connection.
      expect(state.connectionStatus).toBe('connected')
      expect(state.connectionError).toBeNull()
      expect(close).not.toHaveBeenCalled()
    })

    it('fails the join for ANY error code arriving before room_state (#264)', () => {
      // The server keeps the socket open after answering, so an unrecognized
      // code that we swallow leaves the join surface loading forever.
      const close = vi.fn()
      useMultiplayerStore.setState({
        socket: { close } as unknown as WebSocket,
        connectionStatus: 'connected',
        localPlayerId: null,
      })

      useMultiplayerStore.getState().handleServerMessage({
        type: 'error',
        code: 'SOMETHING_UNEXPECTED',
        message: 'Nobody has seen this one before',
      })

      const state = useMultiplayerStore.getState()
      expect(state.connectionStatus).toBe('disconnected')
      expect(state.connectionError).toBe('Nobody has seen this one before')
      expect(state.connectionErrorCode).toBe('SOMETHING_UNEXPECTED')
      expect(state.socket).toBeNull()
      expect(close).toHaveBeenCalled()
    })

    it('never touches a live session: an error with no socket is not a join failure', () => {
      useMultiplayerStore.setState({
        socket: null,
        connectionStatus: 'disconnected',
        localPlayerId: null,
      })

      useMultiplayerStore.getState().handleServerMessage({
        type: 'error',
        code: 'DICE_LIMIT',
        message: 'Table is full',
      })

      expect(useMultiplayerStore.getState().connectionError).toBeNull()
      expect(useMultiplayerStore.getState().connectionErrorCode).toBeNull()
    })

    it('clears only a rejected unauthorized resume so retry mints a new credential', () => {
      const oldToken = '12345678-1234-4234-9234-123456789abc'
      saveRoomSession({
        roomId: 'abc123',
        displayName: 'Alice',
        color: '#8B5CF6',
        reconnectToken: oldToken,
      })
      const close = vi.fn()
      useMultiplayerStore.setState({
        socket: { close } as unknown as WebSocket,
        connectionStatus: 'connected',
        roomId: 'abc123',
        reconnectToken: oldToken,
        localPlayerId: null,
        lastJoin: {
          roomId: 'abc123', displayName: 'Alice', color: '#8B5CF6',
          serverUrl: 'ws://example', token: oldToken, transport: 'websocket',
        },
      })

      useMultiplayerStore.getState().handleServerMessage({
        type: 'error',
        code: 'RECONNECT_UNAUTHORIZED',
        message: 'Reconnect credential does not belong to this user',
      })

      expect(loadRoomSession('abc123')).toBeNull()
      expect(useMultiplayerStore.getState().reconnectToken).toBeNull()

      class StubSocket {
        readyState = 0
        onopen = null
        onmessage = null
        onerror = null
        onclose = null
        send() {}
        close() {}
      }
      vi.stubGlobal('WebSocket', StubSocket)
      useMultiplayerStore.getState().connect('abc123', 'Alice', '#8B5CF6', 'ws://example')
      const newToken = useMultiplayerStore.getState().reconnectToken
      expect(newToken).not.toBeNull()
      expect(newToken).not.toBe(oldToken)
      vi.unstubAllGlobals()
    })

    it('keeps durable resume state for generic ROOM_FULL rejection', () => {
      const token = '12345678-1234-4234-9234-123456789abc'
      saveRoomSession({
        roomId: 'abc123', displayName: 'Alice', color: '#8B5CF6', reconnectToken: token,
      })
      useMultiplayerStore.setState({
        socket: { close: vi.fn() } as unknown as WebSocket,
        connectionStatus: 'connected',
        roomId: 'abc123',
        reconnectToken: token,
        localPlayerId: null,
      })

      useMultiplayerStore.getState().handleServerMessage({
        type: 'error', code: 'ROOM_FULL', message: 'Room is full',
      })

      expect(loadRoomSession('abc123')?.reconnectToken).toBe(token)
      expect(useMultiplayerStore.getState().reconnectToken).toBe(token)
    })
  })

  describe('auth rejection during join (#264)', () => {
    /** An open socket that has sent `join` and is waiting on `room_state`. */
    function armJoiningSocket(send = vi.fn(), close = vi.fn()) {
      useMultiplayerStore.setState({
        socket: { send, close, readyState: WebSocket.OPEN } as unknown as WebSocket,
        connectionStatus: 'connected',
        roomId: 'abc123',
        localPlayerId: null,
        lastJoin: {
          roomId: 'abc123',
          displayName: 'Alice',
          color: '#8B5CF6',
          serverUrl: 'ws://example',
          token: '12345678-1234-4234-9234-123456789abc',
          transport: 'websocket',
        },
      })
      return { send, close }
    }

    /** A Supabase stand-in whose refresh yields `accessToken` (or nothing). */
    function stubSupabase(accessToken: string | null) {
      const refreshSession = vi.fn().mockResolvedValue({
        data: { session: accessToken ? { access_token: accessToken } : null },
      })
      getSupabaseClientMock.mockReturnValue({ auth: { refreshSession } })
      return refreshSession
    }

    const AUTH_INVALID: ServerMessage = {
      type: 'error',
      code: 'AUTH_INVALID',
      message: 'Authentication token is invalid or expired: InvalidAlgorithm',
    }

    it('refreshes the session once and re-sends join on the same socket', async () => {
      const refreshSession = stubSupabase('fresh.jwt.token')
      const { send, close } = armJoiningSocket()

      useMultiplayerStore.getState().handleServerMessage(AUTH_INVALID)

      await vi.waitFor(() => expect(send).toHaveBeenCalled())
      expect(refreshSession).toHaveBeenCalledTimes(1)
      expect(JSON.parse(send.mock.calls[0][0] as string)).toMatchObject({
        type: 'join',
        roomId: 'abc123',
        displayName: 'Alice',
        authToken: 'fresh.jwt.token',
      })
      // Still joining, nothing shown to the player — the retry is silent.
      expect(useMultiplayerStore.getState().connectionStatus).toBe('connected')
      expect(useMultiplayerStore.getState().connectionError).toBeNull()
      expect(close).not.toHaveBeenCalled()
    })

    it('fails terminally when the refreshed token is rejected too (one retry only)', async () => {
      stubSupabase('fresh.jwt.token')
      const { send, close } = armJoiningSocket()

      useMultiplayerStore.getState().handleServerMessage(AUTH_INVALID)
      await vi.waitFor(() => expect(send).toHaveBeenCalledTimes(1))

      useMultiplayerStore.getState().handleServerMessage(AUTH_INVALID)

      const state = useMultiplayerStore.getState()
      expect(state.connectionStatus).toBe('disconnected')
      expect(state.connectionErrorCode).toBe('AUTH_INVALID')
      expect(state.connectionError).toContain('no longer valid')
      expect(state.socket).toBeNull()
      expect(state.lastJoin).toBeNull()
      expect(close).toHaveBeenCalled()
      // No third join attempt.
      expect(send).toHaveBeenCalledTimes(1)
    })

    it('fails terminally when the refresh yields no session', async () => {
      stubSupabase(null)
      const { send } = armJoiningSocket()

      useMultiplayerStore.getState().handleServerMessage(AUTH_INVALID)

      await vi.waitFor(() =>
        expect(useMultiplayerStore.getState().connectionStatus).toBe('disconnected'),
      )
      expect(send).not.toHaveBeenCalled()
      expect(useMultiplayerStore.getState().connectionErrorCode).toBe('AUTH_INVALID')
    })

    it('fails terminally when Supabase is not configured at all', async () => {
      getSupabaseClientMock.mockReturnValue(null)
      armJoiningSocket()

      useMultiplayerStore.getState().handleServerMessage(AUTH_INVALID)

      await vi.waitFor(() =>
        expect(useMultiplayerStore.getState().connectionStatus).toBe('disconnected'),
      )
      expect(useMultiplayerStore.getState().connectionErrorCode).toBe('AUTH_INVALID')
    })

    it('does not retry AUTH_REQUIRED — there is no session to refresh into', () => {
      const refreshSession = stubSupabase('fresh.jwt.token')
      const { close } = armJoiningSocket()

      useMultiplayerStore.getState().handleServerMessage({
        type: 'error',
        code: 'AUTH_REQUIRED',
        message: 'Authentication required',
      })

      expect(refreshSession).not.toHaveBeenCalled()
      expect(useMultiplayerStore.getState().connectionStatus).toBe('disconnected')
      expect(useMultiplayerStore.getState().connectionErrorCode).toBe('AUTH_REQUIRED')
      expect(close).toHaveBeenCalled()
    })

    it('leaves a mid-session auth error to the existing per-action handling', () => {
      const { close } = armJoiningSocket()
      useMultiplayerStore.setState({ localPlayerId: 'p1' })

      useMultiplayerStore.getState().handleServerMessage(AUTH_INVALID)

      expect(useMultiplayerStore.getState().connectionStatus).toBe('connected')
      expect(useMultiplayerStore.getState().connectionError).toBeNull()
      expect(close).not.toHaveBeenCalled()
    })

    it('classifies only the auth codes as a stale session', () => {
      expect(isStaleSessionErrorCode('AUTH_INVALID')).toBe(true)
      expect(isStaleSessionErrorCode('AUTH_REQUIRED')).toBe(true)
      expect(isStaleSessionErrorCode('ROOM_FULL')).toBe(false)
      expect(isStaleSessionErrorCode(null)).toBe(false)
    })
  })

  describe('spawnCarriedDice', () => {
    it('sends every carried die in one spawn_dice message with its transform', () => {
      const send = vi.fn()
      useMultiplayerStore.setState({
        connectionStatus: 'connected',
        socket: { send } as unknown as WebSocket,
      })

      useMultiplayerStore.getState().spawnCarriedDice([
        {
          diceType: 'd20',
          presentation: { inventoryDieId: 'inv-1', baseColor: '#abcdef' },
          position: [1, 2, 3],
          rotation: [0, 0, 0, 1],
        },
        {
          diceType: 'd6',
          position: [-1, 0.5, 2],
          rotation: [0.1, 0.2, 0.3, 0.9],
        },
      ])

      expect(send).toHaveBeenCalledTimes(1)
      const payload = JSON.parse(send.mock.calls[0][0])
      expect(payload.type).toBe('spawn_dice')
      expect(payload.dice).toHaveLength(2)
      expect(payload.dice[0]).toMatchObject({
        diceType: 'd20',
        presentation: { inventoryDieId: 'inv-1', baseColor: '#abcdef' },
        position: [1, 2, 3],
        rotation: [0, 0, 0, 1],
      })
      expect(typeof payload.dice[0].id).toBe('string')
      expect(payload.dice[1]).toMatchObject({
        diceType: 'd6',
        position: [-1, 0.5, 2],
        rotation: [0.1, 0.2, 0.3, 0.9],
      })
      // Carried inventory dice are marked pending so they can't be double-spawned.
      expect(useMultiplayerStore.getState().pendingInventoryDieIds.has('inv-1')).toBe(true)
    })

    it('is a no-op when disconnected or given no dice', () => {
      const send = vi.fn()
      useMultiplayerStore.setState({
        connectionStatus: 'connected',
        socket: { send } as unknown as WebSocket,
      })
      useMultiplayerStore.getState().spawnCarriedDice([])
      expect(send).not.toHaveBeenCalled()

      useMultiplayerStore.setState({ connectionStatus: 'disconnected' })
      useMultiplayerStore.getState().spawnCarriedDice([
        { diceType: 'd6', position: [0, 0, 0], rotation: [0, 0, 0, 1] },
      ])
      expect(send).not.toHaveBeenCalled()
    })
  })

  describe('setArena / arena_changed', () => {
    it('host setArena sends a set_arena message with the aspect', () => {
      const send = vi.fn()
      useMultiplayerStore.setState({
        connectionStatus: 'connected',
        socket: { send } as unknown as WebSocket,
        isHost: true,
      })

      useMultiplayerStore.getState().setArena(16 / 9)

      expect(send).toHaveBeenCalledTimes(1)
      expect(JSON.parse(send.mock.calls[0][0])).toEqual({ type: 'set_arena', aspect: 16 / 9 })
    })

    it('non-host setArena is a no-op', () => {
      const send = vi.fn()
      useMultiplayerStore.setState({
        connectionStatus: 'connected',
        socket: { send } as unknown as WebSocket,
        isHost: false,
      })
      useMultiplayerStore.getState().setArena(1)
      expect(send).not.toHaveBeenCalled()
    })

    it('arena_changed adopts the new engine config (bounds reflow)', () => {
      const config = { arenaHalfX: 8, arenaHalfZ: 4.5 } as unknown as import('../lib/multiplayerMessages').EngineConfig
      useMultiplayerStore.getState().handleServerMessage({ type: 'arena_changed', config })
      expect(useMultiplayerStore.getState().engineConfig).toEqual(config)
    })
  })
})
