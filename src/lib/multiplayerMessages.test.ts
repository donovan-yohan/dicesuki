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

    it('should parse a die_settled message', () => {
      const json = '{"type":"die_settled","diceId":"d1","faceValue":6,"position":[1,0,0],"rotation":[0,0,0,1]}'
      const msg: ServerMessage = JSON.parse(json)
      expect(msg.type).toBe('die_settled')
    })

    it('should parse a roll_complete message', () => {
      const json = '{"type":"roll_complete","playerId":"p1","results":[{"diceId":"d1","diceType":"d20","faceValue":17}],"total":17}'
      const msg: ServerMessage = JSON.parse(json)
      expect(msg.type).toBe('roll_complete')
    })
  })
})
