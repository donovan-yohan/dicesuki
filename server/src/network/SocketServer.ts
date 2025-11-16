/**
 * Socket.io Server
 * Handles WebSocket connections and room-based broadcasting
 */

import { Server as HTTPServer } from 'http'
import { Server as SocketIOServer } from 'socket.io'
import type { Socket } from 'socket.io'
import type {
  ClientToServerEvents,
  ServerToClientEvents,
  ServerConfig,
} from '../types/index.js'
import { RoomManager } from '../room/RoomManager.js'
import { EventHandlers } from './EventHandlers.js'

export class SocketServer {
  private io: SocketIOServer<ClientToServerEvents, ServerToClientEvents>
  private roomManager: RoomManager
  private config: ServerConfig
  private eventHandlers: EventHandlers

  // Track player socket mappings
  private playerSockets: Map<string, Socket> = new Map()
  private socketPlayers: Map<string, string> = new Map() // socket.id -> playerId
  private socketRooms: Map<string, string> = new Map() // socket.id -> roomId

  constructor(httpServer: HTTPServer, config: ServerConfig) {
    this.config = config
    this.roomManager = new RoomManager(config)

    // Initialize Socket.io with CORS
    this.io = new SocketIOServer(httpServer, {
      cors: {
        origin: '*', // TODO: Configure allowed origins in production
        methods: ['GET', 'POST'],
      },
      transports: ['websocket', 'polling'],
    })

    this.eventHandlers = new EventHandlers(this.roomManager, this.config, this.io)

    this.setupConnectionHandlers()
    this.startPhysicsLoop()
  }

  /**
   * Set up connection and disconnection handlers
   */
  private setupConnectionHandlers(): void {
    this.io.on('connection', (socket) => {
      console.log(`Client connected: ${socket.id}`)

      // Register event handlers
      this.registerEventHandlers(socket)

      // Handle disconnection
      socket.on('disconnect', () => {
        this.handleDisconnect(socket)
      })

      // Heartbeat/ping
      socket.on('ping', (callback) => {
        callback(Date.now())
      })
    })
  }

  /**
   * Register all event handlers for a socket
   */
  private registerEventHandlers(socket: Socket): void {
    // Room events
    socket.on('room:create', (data, callback) => {
      this.eventHandlers.handleCreateRoom(socket, data, callback)
    })

    socket.on('room:join', (data, callback) => {
      this.eventHandlers.handleJoinRoom(socket, data, callback)
    })

    socket.on('room:leave', () => {
      this.eventHandlers.handleLeaveRoom(socket)
    })

    // Dice events
    socket.on('dice:add', (data) => {
      this.eventHandlers.handleAddDice(socket, data)
    })

    socket.on('dice:remove', (diceId) => {
      this.eventHandlers.handleRemoveDice(socket, diceId)
    })

    socket.on('dice:impulse', (data) => {
      this.eventHandlers.handleDiceImpulse(socket, data)
    })

    socket.on('dice:drag', (data) => {
      this.eventHandlers.handleDiceDrag(socket, data)
    })
  }

  /**
   * Handle client disconnect
   */
  private handleDisconnect(socket: Socket): void {
    console.log(`Client disconnected: ${socket.id}`)

    const playerId = this.socketPlayers.get(socket.id)
    const roomId = this.socketRooms.get(socket.id)

    if (playerId && roomId) {
      const room = this.roomManager.getRoom(roomId)
      if (room) {
        // Notify other players
        socket.to(roomId).emit('room:player_left', playerId)

        // Remove player from room
        this.roomManager.leaveRoom(roomId, playerId)
      }

      // Clean up mappings
      this.playerSockets.delete(playerId)
      this.socketPlayers.delete(socket.id)
      this.socketRooms.delete(socket.id)
    }
  }

  /**
   * Start physics simulation and broadcasting loop
   */
  private startPhysicsLoop(): void {
    const tickInterval = 1000 / this.config.physics.tickRate
    const broadcastInterval = 1000 / this.config.physics.broadcastRate

    let lastBroadcast = Date.now()

    setInterval(() => {
      const now = Date.now()
      const deltaTime = tickInterval / 1000 // Convert to seconds

      // Step physics for all active rooms
      this.roomManager['rooms'].forEach((room, roomId) => {
        room.getPhysics().step(deltaTime)
        room.incrementTick()

        // Broadcast state at configured rate
        if (now - lastBroadcast >= broadcastInterval) {
          this.broadcastPhysicsState(roomId, room)
        }
      })

      if (now - lastBroadcast >= broadcastInterval) {
        lastBroadcast = now
      }
    }, tickInterval)

    console.log(`Physics loop started: ${this.config.physics.tickRate} FPS`)
    console.log(`Broadcast rate: ${this.config.physics.broadcastRate} Hz`)
  }

  /**
   * Broadcast physics state to all clients in a room
   */
  private broadcastPhysicsState(roomId: string, room: any): void {
    const snapshot = {
      tick: room.getTick(),
      timestamp: Date.now(),
      dice: room.getPhysics().getState(),
    }

    this.io.to(roomId).emit('physics:snapshot', snapshot)
  }

  /**
   * Get Socket.io server instance
   */
  getIO(): SocketIOServer {
    return this.io
  }

  /**
   * Register player socket mapping
   */
  registerPlayer(playerId: string, socketId: string, roomId: string): void {
    const socket = this.io.sockets.sockets.get(socketId)
    if (socket) {
      this.playerSockets.set(playerId, socket)
      this.socketPlayers.set(socketId, playerId)
      this.socketRooms.set(socketId, roomId)

      // Join room for broadcasting
      socket.join(roomId)
    }
  }

  /**
   * Shutdown server
   */
  shutdown(): void {
    this.roomManager.shutdown()
    this.io.close()
  }
}
