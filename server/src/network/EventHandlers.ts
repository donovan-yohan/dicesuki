/**
 * Event Handlers
 * Handles all client events and validates input
 */

import type { Socket, Server as SocketIOServer } from 'socket.io'
import type {
  ClientToServerEvents,
  ServerToClientEvents,
  ServerConfig,
  CreateRoomResponse,
  JoinRoomResponse,
} from '../types/index.js'
import { RoomManager } from '../room/RoomManager.js'
import { v4 as uuidv4 } from 'crypto'

export class EventHandlers {
  private roomManager: RoomManager
  private config: ServerConfig
  private io: SocketIOServer<ClientToServerEvents, ServerToClientEvents>

  constructor(
    roomManager: RoomManager,
    config: ServerConfig,
    io: SocketIOServer<ClientToServerEvents, ServerToClientEvents>
  ) {
    this.roomManager = roomManager
    this.config = config
    this.io = io
  }

  /**
   * Handle room creation
   */
  async handleCreateRoom(
    socket: Socket,
    data: {
      playerName: string
      playerColor: string
      password?: string
      maxPlayers?: number
    },
    callback: (response: CreateRoomResponse) => void
  ): Promise<void> {
    try {
      // Validate input
      if (!data.playerName || data.playerName.length > 50) {
        callback({ success: false, error: 'Invalid player name' })
        return
      }

      if (!data.playerColor || !/^#[0-9A-F]{6}$/i.test(data.playerColor)) {
        callback({ success: false, error: 'Invalid player color' })
        return
      }

      // Generate player ID (guest)
      const playerId = uuidv4()

      // Create room
      const { roomCode, roomId } = await this.roomManager.createRoom(
        playerId,
        data.playerName,
        data.playerColor,
        data.password,
        data.maxPlayers
      )

      // Join the room
      const { room } = await this.roomManager.joinRoom(
        roomCode,
        playerId,
        data.playerName,
        data.playerColor,
        data.password,
        true // isGuest
      )

      // Register socket
      socket.join(roomId)
      ;(socket as any).playerId = playerId
      ;(socket as any).roomId = roomId

      // Add player to room
      room.addPlayer(playerId, data.playerName, data.playerColor, true, socket.id)

      // Notify player
      socket.emit('room:joined', {
        roomCode,
        roomId,
        players: room.getPlayers(),
        dice: room.getPhysics().getState(),
        maxPlayers: room.getMaxPlayers(),
        yourPlayerId: playerId,
      })

      callback({ success: true, roomCode, roomId })

      console.log(`Room created: ${roomCode} by ${data.playerName}`)
    } catch (error) {
      console.error('Error creating room:', error)
      callback({
        success: false,
        error: error instanceof Error ? error.message : 'Failed to create room',
      })
    }
  }

  /**
   * Handle joining a room
   */
  async handleJoinRoom(
    socket: Socket,
    data: {
      roomCode: string
      playerName: string
      playerColor: string
      password?: string
    },
    callback: (response: JoinRoomResponse) => void
  ): Promise<void> {
    try {
      // Validate input
      if (!data.roomCode || data.roomCode.length !== 6) {
        callback({ success: false, error: 'Invalid room code' })
        return
      }

      if (!data.playerName || data.playerName.length > 50) {
        callback({ success: false, error: 'Invalid player name' })
        return
      }

      if (!data.playerColor || !/^#[0-9A-F]{6}$/i.test(data.playerColor)) {
        callback({ success: false, error: 'Invalid player color' })
        return
      }

      // Generate player ID (guest)
      const playerId = uuidv4()

      // Join room
      const { roomId, room } = await this.roomManager.joinRoom(
        data.roomCode.toUpperCase(),
        playerId,
        data.playerName,
        data.playerColor,
        data.password,
        true // isGuest
      )

      // Register socket
      socket.join(roomId)
      ;(socket as any).playerId = playerId
      ;(socket as any).roomId = roomId

      // Update room
      room.addPlayer(playerId, data.playerName, data.playerColor, true, socket.id)

      // Notify new player
      socket.emit('room:joined', {
        roomCode: data.roomCode.toUpperCase(),
        roomId,
        players: room.getPlayers(),
        dice: room.getPhysics().getState(),
        maxPlayers: room.getMaxPlayers(),
        yourPlayerId: playerId,
      })

      // Notify existing players
      socket.to(roomId).emit('room:player_joined', {
        id: playerId,
        socketId: socket.id,
        name: data.playerName,
        color: data.playerColor,
        isGuest: true,
        joinedAt: Date.now(),
        lastSeenAt: Date.now(),
        isConnected: true,
      })

      callback({ success: true })

      console.log(`Player ${data.playerName} joined room ${data.roomCode}`)
    } catch (error) {
      console.error('Error joining room:', error)
      callback({
        success: false,
        error: error instanceof Error ? error.message : 'Failed to join room',
      })
    }
  }

  /**
   * Handle leaving a room
   */
  async handleLeaveRoom(socket: Socket): Promise<void> {
    const playerId = (socket as any).playerId
    const roomId = (socket as any).roomId

    if (!playerId || !roomId) return

    try {
      // Notify other players
      socket.to(roomId).emit('room:player_left', playerId)

      // Leave room
      await this.roomManager.leaveRoom(roomId, playerId)
      socket.leave(roomId)

      // Clear socket data
      delete (socket as any).playerId
      delete (socket as any).roomId

      console.log(`Player ${playerId} left room ${roomId}`)
    } catch (error) {
      console.error('Error leaving room:', error)
    }
  }

  /**
   * Handle adding a dice
   */
  handleAddDice(
    socket: Socket,
    data: {
      type: 'd4' | 'd6' | 'd8' | 'd10' | 'd12' | 'd20'
      position?: [number, number, number]
      rotation?: [number, number, number, number]
    }
  ): void {
    const playerId = (socket as any).playerId
    const roomId = (socket as any).roomId

    if (!playerId || !roomId) {
      socket.emit('error', { code: 'NOT_IN_ROOM', message: 'Not in a room' })
      return
    }

    const room = this.roomManager.getRoom(roomId)
    if (!room) {
      socket.emit('error', { code: 'ROOM_NOT_FOUND', message: 'Room not found' })
      return
    }

    // Check dice limit
    if (room.getPhysics().getDiceCount() >= this.config.room.maxDice) {
      socket.emit('error', { code: 'MAX_DICE_REACHED', message: 'Maximum dice limit reached' })
      return
    }

    // Generate dice ID
    const diceId = `dice-${playerId}-${Date.now()}`

    // Get player color
    const player = room.getPlayer(playerId)
    const color = player?.color || '#3b82f6'

    // Default position and rotation
    const position: [number, number, number] = data.position || [0, 5, 0]
    const rotation: [number, number, number, number] = data.rotation || [0, 0, 0, 1]

    // Add dice to physics world
    room.getPhysics().addDice(diceId, playerId, data.type, position, rotation, color)

    // Get dice state
    const diceState = room.getPhysics().getDiceState(diceId)
    if (!diceState) return

    // Broadcast to all players in room
    this.io.to(roomId).emit('dice:added', diceState)

    room.updateActivity()
  }

  /**
   * Handle removing a dice
   */
  handleRemoveDice(socket: Socket, diceId: string): void {
    const playerId = (socket as any).playerId
    const roomId = (socket as any).roomId

    if (!playerId || !roomId) return

    const room = this.roomManager.getRoom(roomId)
    if (!room) return

    // Verify ownership
    const diceState = room.getPhysics().getDiceState(diceId)
    if (!diceState || diceState.ownerId !== playerId) {
      socket.emit('error', { code: 'NOT_OWNER', message: 'Not the owner of this dice' })
      return
    }

    // Remove dice
    room.getPhysics().removeDice(diceId)

    // Broadcast to all players
    this.io.to(roomId).emit('dice:removed', diceId)

    room.updateActivity()
  }

  /**
   * Handle applying impulse to dice
   */
  handleDiceImpulse(
    socket: Socket,
    data: {
      diceId: string
      impulse: [number, number, number]
      torque?: [number, number, number]
    }
  ): void {
    const playerId = (socket as any).playerId
    const roomId = (socket as any).roomId

    if (!playerId || !roomId) return

    const room = this.roomManager.getRoom(roomId)
    if (!room) return

    // Verify ownership
    const diceState = room.getPhysics().getDiceState(data.diceId)
    if (!diceState || diceState.ownerId !== playerId) {
      socket.emit('error', { code: 'NOT_OWNER', message: 'Not the owner of this dice' })
      return
    }

    // Apply impulse
    room.getPhysics().applyImpulse(data.diceId, data.impulse, data.torque)

    room.updateActivity()
  }

  /**
   * Handle dice drag update
   */
  handleDiceDrag(
    socket: Socket,
    data: {
      diceId: string
      targetPosition: [number, number, number]
    }
  ): void {
    const playerId = (socket as any).playerId
    const roomId = (socket as any).roomId

    if (!playerId || !roomId) return

    const room = this.roomManager.getRoom(roomId)
    if (!room) return

    // Verify ownership
    const diceState = room.getPhysics().getDiceState(data.diceId)
    if (!diceState || diceState.ownerId !== playerId) {
      return
    }

    // Update drag target
    room.getPhysics().updateDrag(data.diceId, data.targetPosition)

    room.updateActivity()
  }
}
