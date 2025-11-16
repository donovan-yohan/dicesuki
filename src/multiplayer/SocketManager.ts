/**
 * Socket.io Connection Manager
 * Singleton class to manage WebSocket connection to physics server
 */

import { io, Socket } from 'socket.io-client'
import type {
  DiceShape,
} from '../lib/geometries'

// Server event types (matching server/src/types/index.ts)
export interface PhysicsSnapshot {
  tick: number
  timestamp: number
  dice: DiceState[]
}

export interface DiceState {
  id: string
  ownerId: string
  type: DiceShape
  position: [number, number, number]
  rotation: [number, number, number, number]
  linearVelocity: [number, number, number]
  angularVelocity: [number, number, number]
  isAtRest: boolean
  faceValue: number | null
  rollGroupId?: string      // Optional: Links dice to a saved roll group
  rollGroupName?: string    // Optional: Display name for the group
}

export interface Player {
  id: string
  socketId: string
  name: string
  color: string
  isGuest: boolean
  joinedAt: number
  lastSeenAt: number
  isConnected: boolean
}

export interface RoomJoinedData {
  roomCode: string
  roomId: string
  players: Player[]
  dice: DiceState[]
  maxPlayers: number
  yourPlayerId: string
}

export interface CreateRoomResponse {
  success: boolean
  roomCode?: string
  roomId?: string
  error?: string
}

export interface JoinRoomResponse {
  success: boolean
  error?: string
}

export interface ErrorResponse {
  code: string
  message: string
}

/**
 * Socket Manager Singleton
 */
class SocketManagerClass {
  private socket: Socket | null = null
  private serverUrl: string

  constructor() {
    this.serverUrl = import.meta.env.VITE_PHYSICS_SERVER_URL || 'http://localhost:3001'
  }

  /**
   * Connect to physics server
   */
  connect(): Socket {
    if (this.socket?.connected) {
      return this.socket
    }

    this.socket = io(this.serverUrl, {
      transports: ['websocket', 'polling'],
      reconnection: true,
      reconnectionAttempts: 5,
      reconnectionDelay: 1000,
    })

    this.setupBaseListeners()

    return this.socket
  }

  /**
   * Disconnect from server
   */
  disconnect(): void {
    if (this.socket) {
      this.socket.disconnect()
      this.socket = null
    }
  }

  /**
   * Get socket instance
   */
  getSocket(): Socket | null {
    return this.socket
  }

  /**
   * Check if connected
   */
  isConnected(): boolean {
    return this.socket?.connected || false
  }

  /**
   * Setup base event listeners
   */
  private setupBaseListeners(): void {
    if (!this.socket) return

    this.socket.on('connect', () => {
      console.log('Connected to physics server')
    })

    this.socket.on('disconnect', (reason) => {
      console.log('Disconnected from physics server:', reason)
    })

    this.socket.on('connect_error', (error) => {
      console.error('Connection error:', error)
    })
  }

  /**
   * Create a room
   */
  async createRoom(
    playerName: string,
    playerColor: string,
    password?: string,
    maxPlayers?: number
  ): Promise<CreateRoomResponse> {
    return new Promise((resolve) => {
      if (!this.socket) {
        resolve({ success: false, error: 'Not connected' })
        return
      }

      this.socket.emit(
        'room:create',
        { playerName, playerColor, password, maxPlayers },
        (response: CreateRoomResponse) => {
          resolve(response)
        }
      )
    })
  }

  /**
   * Join a room
   */
  async joinRoom(
    roomCode: string,
    playerName: string,
    playerColor: string,
    password?: string
  ): Promise<JoinRoomResponse> {
    return new Promise((resolve) => {
      if (!this.socket) {
        resolve({ success: false, error: 'Not connected' })
        return
      }

      this.socket.emit(
        'room:join',
        { roomCode, playerName, playerColor, password },
        (response: JoinRoomResponse) => {
          resolve(response)
        }
      )
    })
  }

  /**
   * Leave current room
   */
  leaveRoom(): void {
    if (this.socket) {
      this.socket.emit('room:leave')
    }
  }

  /**
   * Add a dice
   */
  addDice(
    type: DiceShape,
    position?: [number, number, number],
    rotation?: [number, number, number, number]
  ): void {
    if (this.socket) {
      this.socket.emit('dice:add', { type, position, rotation })
    }
  }

  /**
   * Remove a dice
   */
  removeDice(diceId: string): void {
    if (this.socket) {
      this.socket.emit('dice:remove', diceId)
    }
  }

  /**
   * Apply impulse to dice
   */
  applyDiceImpulse(
    diceId: string,
    impulse: [number, number, number],
    torque?: [number, number, number]
  ): void {
    if (this.socket) {
      this.socket.emit('dice:impulse', { diceId, impulse, torque })
    }
  }

  /**
   * Update dice drag
   */
  updateDiceDrag(diceId: string, targetPosition: [number, number, number]): void {
    if (this.socket) {
      this.socket.emit('dice:drag', { diceId, targetPosition })
    }
  }

  /**
   * Register event listener
   */
  on<E extends keyof ServerToClientEvents>(
    event: E,
    handler: ServerToClientEvents[E]
  ): void {
    if (this.socket) {
      this.socket.on(event, handler as any)
    }
  }

  /**
   * Remove event listener
   */
  off<E extends keyof ServerToClientEvents>(
    event: E,
    handler?: ServerToClientEvents[E]
  ): void {
    if (this.socket) {
      this.socket.off(event, handler as any)
    }
  }
}

// Event types
interface ServerToClientEvents {
  'room:joined': (data: RoomJoinedData) => void
  'room:player_joined': (player: Player) => void
  'room:player_left': (playerId: string) => void
  'room:closed': (reason: string) => void
  'physics:snapshot': (snapshot: PhysicsSnapshot) => void
  'dice:added': (dice: DiceState) => void
  'dice:removed': (diceId: string) => void
  'error': (error: ErrorResponse) => void
  pong: (timestamp: number) => void
}

// Export singleton instance
export const SocketManager = new SocketManagerClass()
