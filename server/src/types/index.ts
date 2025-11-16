/**
 * Type definitions for Daisu Physics Server
 */

import type { Vector3, Quaternion } from '@dimforge/rapier3d-compat'

// ============================================================================
// DICE TYPES
// ============================================================================

export type DiceShape = 'd4' | 'd6' | 'd8' | 'd10' | 'd12' | 'd20'

export interface DiceState {
  id: string
  ownerId: string
  type: DiceShape
  position: [number, number, number]
  rotation: [number, number, number, number] // Quaternion [x, y, z, w]
  linearVelocity: [number, number, number]
  angularVelocity: [number, number, number]
  isAtRest: boolean
  faceValue: number | null
}

export interface DiceInput {
  type: 'ADD_DICE' | 'REMOVE_DICE' | 'APPLY_IMPULSE' | 'DRAG_UPDATE'
  diceId?: string
  diceType?: DiceShape
  impulse?: Vector3
  torque?: Vector3
  dragTarget?: Vector3
  color?: string
}

// ============================================================================
// ROOM TYPES
// ============================================================================

export interface Room {
  id: string
  code: string
  maxPlayers: number
  players: Map<string, Player>
  dice: Map<string, DiceState>
  createdAt: number
  lastActivityAt: number
  isActive: boolean
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

// ============================================================================
// NETWORK EVENTS (Client → Server)
// ============================================================================

export interface ClientToServerEvents {
  // Room management
  'room:create': (data: {
    playerName: string
    playerColor: string
    password?: string
    maxPlayers?: number
  }, callback: (response: CreateRoomResponse) => void) => void

  'room:join': (data: {
    roomCode: string
    playerName: string
    playerColor: string
    password?: string
  }, callback: (response: JoinRoomResponse) => void) => void

  'room:leave': () => void

  // Dice actions
  'dice:add': (data: {
    type: DiceShape
    position?: [number, number, number]
    rotation?: [number, number, number, number]
  }) => void

  'dice:remove': (diceId: string) => void

  'dice:impulse': (data: {
    diceId: string
    impulse: [number, number, number]
    torque?: [number, number, number]
  }) => void

  'dice:drag': (data: {
    diceId: string
    targetPosition: [number, number, number]
  }) => void

  // Heartbeat
  'ping': (callback: (timestamp: number) => void) => void
}

// ============================================================================
// NETWORK EVENTS (Server → Client)
// ============================================================================

export interface ServerToClientEvents {
  // Room events
  'room:joined': (data: RoomJoinedData) => void
  'room:player_joined': (player: Player) => void
  'room:player_left': (playerId: string) => void
  'room:closed': (reason: string) => void

  // Physics state
  'physics:snapshot': (snapshot: PhysicsSnapshot) => void

  // Dice events
  'dice:added': (dice: DiceState) => void
  'dice:removed': (diceId: string) => void
  'dice:result': (data: DiceResultData) => void

  // Errors
  'error': (error: ErrorResponse) => void

  // Heartbeat
  'pong': (timestamp: number) => void
}

// ============================================================================
// RESPONSE TYPES
// ============================================================================

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

export interface RoomJoinedData {
  roomCode: string
  roomId: string
  players: Player[]
  dice: DiceState[]
  maxPlayers: number
  yourPlayerId: string
}

export interface PhysicsSnapshot {
  tick: number
  timestamp: number
  dice: DiceState[]
}

export interface DiceResultData {
  diceId: string
  ownerId: string
  diceType: DiceShape
  faceValue: number
}

export interface ErrorResponse {
  code: string
  message: string
}

// ============================================================================
// PHYSICS CONFIG
// ============================================================================

export interface PhysicsConfig {
  gravity: [number, number, number]
  tickRate: number // FPS for physics simulation
  broadcastRate: number // Hz for network updates

  // Dice material properties
  dice: {
    restitution: number
    friction: number
  }

  // Rest detection
  rest: {
    linearVelocityThreshold: number
    angularVelocityThreshold: number
    durationMs: number
  }

  // Limits
  maxDiceVelocity: number
}

// ============================================================================
// SERVER CONFIG
// ============================================================================

export interface ServerConfig {
  port: number
  environment: 'development' | 'production'

  supabase: {
    url: string
    serviceRoleKey: string
  }

  physics: PhysicsConfig

  room: {
    maxPlayers: number
    maxDice: number
    idleTimeoutMs: number
    cleanupIntervalMs: number
  }

  security: {
    bcryptRounds: number
    maxRoomsPerIp: number
    rateLimitWindow: number
    rateLimitMaxRequests: number
  }

  logging: {
    level: 'debug' | 'info' | 'warn' | 'error'
    logPhysicsStats: boolean
  }
}
