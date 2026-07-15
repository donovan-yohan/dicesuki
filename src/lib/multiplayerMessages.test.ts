import { describe, it, expect } from 'vitest'
import type {
  ClientMessage,
  ServerMessage,
  RoomStateMessage,
  PhysicsSnapshotMessage,
  DiceKnockedMessage,
} from './multiplayerMessages'
import {
  getMotionControl,
  setMotionControl,
  DEFAULT_MOTION_CONTROL,
  getRoller,
  setRoller,
  getRoomThemeId,
  setRoomThemeId,
  getVisibility,
  isRoomPublic,
  setVisibility,
  DEFAULT_VISIBILITY,
  getRoomName,
  setRoomName,
  sanitizeRoomName,
  ROOM_NAME_MAX_LEN,
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

    it('should type-check a spawn_dice message with inventory presentation metadata', () => {
      const msg: ClientMessage = {
        type: 'spawn_dice',
        dice: [
          {
            id: 'die_lucky_d20-1',
            diceType: 'd20',
            presentation: {
              inventoryDieId: 'die_lucky_d20',
              displayName: 'Lucky D20',
              setId: 'starter',
              rarity: 'rare',
              baseColor: '#8b5cf6',
              accentColor: '#ffffff',
              material: 'plastic',
              customAssetId: 'asset_lucky_d20',
              customAssetName: 'Lucky Mesh',
              unsupportedReason: 'Custom GLB assets are local-only in multiplayer; using generic server physics.',
            },
          },
        ],
      }

      expect(msg.dice[0].presentation?.inventoryDieId).toBe('die_lucky_d20')
      expect(msg.dice[0].presentation?.baseColor).toBe('#8b5cf6')
    })

    it('should type-check a roll message', () => {
      const msg: ClientMessage = { type: 'roll' }
      expect(msg.type).toBe('roll')
    })

    it('should type-check an update_color message', () => {
      const msg: ClientMessage = { type: 'update_color', color: '#FF0000' }
      expect(msg.type).toBe('update_color')
    })

    it('should type-check a remove_dice message', () => {
      const msg: ClientMessage = { type: 'remove_dice', diceIds: ['d1', 'd2'] }
      expect(msg.type).toBe('remove_dice')
    })

    it('should type-check a leave message', () => {
      const msg: ClientMessage = { type: 'leave' }
      expect(msg.type).toBe('leave')
    })

    it('should type-check an update_settings message', () => {
      const msg: ClientMessage = {
        type: 'update_settings',
        settings: { version: 1, physicsMode: 'arcade' },
      }
      expect(msg.type).toBe('update_settings')
      if (msg.type === 'update_settings') {
        expect(msg.settings.version).toBe(1)
        expect(msg.settings.physicsMode).toBe('arcade')
      }
    })
  })

  describe('ServerMessage parsing', () => {
    it('should parse a room_state message', () => {
      const json = '{"type":"room_state","roomId":"abc123","hostId":"p1","players":[{"id":"p1","displayName":"Gandalf","color":"#8B5CF6"}],"dice":[],"settings":{"version":1}}'
      const msg: ServerMessage = JSON.parse(json)
      expect(msg.type).toBe('room_state')
      const roomState = msg as RoomStateMessage
      expect(roomState.roomId).toBe('abc123')
      expect(roomState.hostId).toBe('p1')
      expect(roomState.settings.version).toBe(1)
      expect(roomState.players).toHaveLength(1)
      expect(roomState.players[0].displayName).toBe('Gandalf')
    })

    it('should parse a host_changed message', () => {
      const json = '{"type":"host_changed","hostId":"p2"}'
      const msg: ServerMessage = JSON.parse(json)
      expect(msg.type).toBe('host_changed')
      if (msg.type === 'host_changed') {
        expect(msg.hostId).toBe('p2')
      }
    })

    it('should parse a settings_updated message with unknown forward-compat fields', () => {
      const json = '{"type":"settings_updated","settings":{"version":2,"physicsMode":"arcade","theme":"neon"}}'
      const msg: ServerMessage = JSON.parse(json)
      expect(msg.type).toBe('settings_updated')
      if (msg.type === 'settings_updated') {
        expect(msg.settings.version).toBe(2)
        // Unknown/newer fields round-trip through the index signature.
        expect(msg.settings.physicsMode).toBe('arcade')
        expect(msg.settings.theme).toBe('neon')
      }
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

    it('should parse a die_settled message', () => {
      const json = '{"type":"die_settled","diceId":"d1","faceValue":6,"position":[1,0,0],"rotation":[0,0,0,1]}'
      const msg: ServerMessage = JSON.parse(json)
      expect(msg.type).toBe('die_settled')
    })

    it('should parse a dice_knocked message', () => {
      const json = '{"type":"dice_knocked","diceId":"d1","position":[1,0.5,2],"impactSpeed":6.4}'
      const msg: ServerMessage = JSON.parse(json)
      expect(msg.type).toBe('dice_knocked')
      const knocked = msg as DiceKnockedMessage
      expect(knocked.diceId).toBe('d1')
      expect(knocked.position).toEqual([1, 0.5, 2])
      expect(knocked.impactSpeed).toBeCloseTo(6.4)
    })

    it('should parse a roll_complete message', () => {
      const json = '{"type":"roll_complete","playerId":"p1","results":[{"diceId":"d1","diceType":"d20","faceValue":17}],"total":17}'
      const msg: ServerMessage = JSON.parse(json)
      expect(msg.type).toBe('roll_complete')
    })

    it('should parse dice presentation metadata from server messages', () => {
      const json = '{"type":"dice_spawned","ownerId":"p1","dice":[{"id":"d1","ownerId":"p1","diceType":"d20","position":[0,1,0],"rotation":[0,0,0,1],"presentation":{"inventoryDieId":"die_lucky_d20","displayName":"Lucky D20","baseColor":"#8b5cf6"}}]}'
      const msg: ServerMessage = JSON.parse(json)

      expect(msg.type).toBe('dice_spawned')
      if (msg.type === 'dice_spawned') {
        expect(msg.dice[0].presentation?.inventoryDieId).toBe('die_lucky_d20')
        expect(msg.dice[0].presentation?.displayName).toBe('Lucky D20')
      }
    })
  })

  describe('motion control protocol', () => {
    it('type-checks a motion_field message', () => {
      const msg: ClientMessage = { type: 'motion_field', field: [1, -2, 0.5] }
      expect(msg.type).toBe('motion_field')
    })

    it('getMotionControl reads the setting and defaults when absent/invalid', () => {
      expect(getMotionControl({ version: 1 })).toBe(DEFAULT_MOTION_CONTROL)
      expect(getMotionControl({ version: 1 })).toBe('own_dice')
      expect(getMotionControl({ version: 1, motionControl: 'off' })).toBe('off')
      expect(getMotionControl({ version: 1, motionControl: 'room' })).toBe('room')
      // Unknown/malformed value falls back to the default.
      expect(getMotionControl({ version: 1, motionControl: 'bogus' })).toBe('own_dice')
      expect(getMotionControl(null)).toBe('own_dice')
    })

    it('setMotionControl returns a new object preserving other fields', () => {
      const original = { version: 1, playerCap: 4 }
      const next = setMotionControl(original, 'room')
      expect(next).toEqual({ version: 1, playerCap: 4, motionControl: 'room' })
      // Never mutates the input.
      expect(original).toEqual({ version: 1, playerCap: 4 })
      expect(next).not.toBe(original)
    })
  })

  describe('delegated roller protocol', () => {
    it('getRoller reads the roller id and returns null when absent/invalid', () => {
      expect(getRoller({ version: 1 })).toBeNull()
      expect(getRoller({ version: 1, roller: 'p2' })).toBe('p2')
      expect(getRoller(null)).toBeNull()
      // Non-string / empty values are treated as no roller.
      expect(getRoller({ version: 1, roller: '' })).toBeNull()
      expect(getRoller({ version: 1, roller: 42 })).toBeNull()
    })

    it('setRoller assigns and clears while preserving other fields', () => {
      const original = { version: 1, playerCap: 4, motionControl: 'room' }
      const assigned = setRoller(original, 'p2')
      expect(assigned).toEqual({
        version: 1,
        playerCap: 4,
        motionControl: 'room',
        roller: 'p2',
      })
      // Clearing removes the key entirely, keeping everything else.
      const cleared = setRoller(assigned, null)
      expect(cleared).toEqual({ version: 1, playerCap: 4, motionControl: 'room' })
      expect('roller' in cleared).toBe(false)
      // Never mutates the input.
      expect(original).toEqual({ version: 1, playerCap: 4, motionControl: 'room' })
      expect(assigned).not.toBe(original)
    })
  })

  describe('room theme protocol', () => {
    it('getRoomThemeId reads the theme id and returns null when absent/invalid', () => {
      expect(getRoomThemeId({ version: 1 })).toBeNull()
      expect(getRoomThemeId({ version: 1, themeId: 'neon-cyber-city' })).toBe('neon-cyber-city')
      expect(getRoomThemeId(null)).toBeNull()
      // Non-string / empty values mean "no room theme" (players keep their own).
      expect(getRoomThemeId({ version: 1, themeId: '' })).toBeNull()
      expect(getRoomThemeId({ version: 1, themeId: 42 })).toBeNull()
    })

    it('setRoomThemeId assigns and clears while preserving other fields', () => {
      const original = { version: 1, playerCap: 4, motionControl: 'room' }
      const assigned = setRoomThemeId(original, 'fantasy')
      expect(assigned).toEqual({
        version: 1,
        playerCap: 4,
        motionControl: 'room',
        themeId: 'fantasy',
      })
      // Clearing removes the key entirely, keeping everything else.
      const cleared = setRoomThemeId(assigned, null)
      expect(cleared).toEqual({ version: 1, playerCap: 4, motionControl: 'room' })
      expect('themeId' in cleared).toBe(false)
      // Never mutates the input.
      expect(original).toEqual({ version: 1, playerCap: 4, motionControl: 'room' })
      expect(assigned).not.toBe(original)
    })
  })

  describe('room discovery / visibility (#79)', () => {
    it('defaults to unlisted and reads public when set', () => {
      expect(DEFAULT_VISIBILITY).toBe('unlisted')
      expect(getVisibility({ version: 1 })).toBe('unlisted')
      expect(getVisibility(null)).toBe('unlisted')
      expect(getVisibility({ version: 1, visibility: 'public' })).toBe('public')
      // Unknown values fall back to unlisted.
      expect(getVisibility({ version: 1, visibility: 'secret' })).toBe('unlisted')
      expect(isRoomPublic({ version: 1, visibility: 'public' })).toBe(true)
      expect(isRoomPublic({ version: 1 })).toBe(false)
    })

    it('setVisibility preserves other fields and never mutates', () => {
      const original = { version: 1, playerCap: 4 }
      const next = setVisibility(original, 'public')
      expect(next).toEqual({ version: 1, playerCap: 4, visibility: 'public' })
      expect(original).toEqual({ version: 1, playerCap: 4 })
    })

    it('sanitizeRoomName strips control chars, collapses whitespace, caps length', () => {
      expect(sanitizeRoomName('  Taco   Tuesday  ')).toBe('Taco Tuesday')
      expect(sanitizeRoomName('a\nb\tc')).toBe('a b c')
      const long = 'x'.repeat(100)
      expect(sanitizeRoomName(long).length).toBe(ROOM_NAME_MAX_LEN)
    })

    it('getRoomName returns null when blank/unset, sanitized string otherwise', () => {
      expect(getRoomName({ version: 1 })).toBeNull()
      expect(getRoomName({ version: 1, roomName: '   ' })).toBeNull()
      expect(getRoomName({ version: 1, roomName: '  Game Night ' })).toBe('Game Night')
      expect(getRoomName({ version: 1, roomName: 42 })).toBeNull()
    })

    it('setRoomName sets sanitized name and clears when blank', () => {
      const original = { version: 1, visibility: 'public' }
      const named = setRoomName(original, '  My Room  ')
      expect(named).toEqual({ version: 1, visibility: 'public', roomName: 'My Room' })
      const cleared = setRoomName(named, '   ')
      expect('roomName' in cleared).toBe(false)
      // Never mutates the input.
      expect(original).toEqual({ version: 1, visibility: 'public' })
    })
  })
})
