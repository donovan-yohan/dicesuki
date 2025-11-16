/**
 * Room Manager
 * Manages game rooms and their physics simulations
 */

import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import bcrypt from 'bcrypt'
import type { Room, Player, DiceState, ServerConfig } from '../types/index.js'
import { PhysicsWorld } from '../physics/PhysicsWorld.js'

export class RoomManager {
  private rooms: Map<string, GameRoom> = new Map()
  private supabase: SupabaseClient
  private config: ServerConfig
  private cleanupInterval: NodeJS.Timeout | null = null

  constructor(config: ServerConfig) {
    this.config = config

    // Initialize Supabase client
    this.supabase = createClient(
      config.supabase.url,
      config.supabase.serviceRoleKey
    )

    // Start cleanup interval
    this.startCleanup()
  }

  /**
   * Create a new room
   */
  async createRoom(
    ownerId: string,
    ownerName: string,
    ownerColor: string,
    password?: string,
    maxPlayers?: number
  ): Promise<{ roomCode: string; roomId: string }> {
    // Generate unique room code
    const roomCode = await this.generateRoomCode()

    // Hash password if provided
    const passwordHash = password
      ? await bcrypt.hash(password, this.config.security.bcryptRounds)
      : null

    // Create room in database
    const { data, error } = await this.supabase
      .from('rooms')
      .insert({
        code: roomCode,
        password_hash: passwordHash,
        owner_id: ownerId,
        max_players: maxPlayers || this.config.room.maxPlayers,
      })
      .select()
      .single()

    if (error) {
      throw new Error(`Failed to create room: ${error.message}`)
    }

    const roomId = data.id

    // Create game room instance
    const gameRoom = new GameRoom(
      roomId,
      roomCode,
      maxPlayers || this.config.room.maxPlayers,
      this.config
    )

    await gameRoom.initialize()
    this.rooms.set(roomId, gameRoom)

    console.log(`Room created: ${roomCode} (${roomId})`)

    return { roomCode, roomId }
  }

  /**
   * Join an existing room
   */
  async joinRoom(
    roomCode: string,
    playerId: string,
    playerName: string,
    playerColor: string,
    password?: string,
    isGuest: boolean = true
  ): Promise<{ roomId: string; room: GameRoom }> {
    // Find room in database
    const { data: roomData, error } = await this.supabase
      .from('rooms')
      .select('*')
      .eq('code', roomCode)
      .eq('is_active', true)
      .single()

    if (error || !roomData) {
      throw new Error('Room not found')
    }

    const roomId = roomData.id

    // Verify password if required
    if (roomData.password_hash && password) {
      const isValid = await bcrypt.compare(password, roomData.password_hash)
      if (!isValid) {
        throw new Error('Invalid password')
      }
    } else if (roomData.password_hash && !password) {
      throw new Error('Password required')
    }

    // Get or create game room instance
    let gameRoom = this.rooms.get(roomId)
    if (!gameRoom) {
      gameRoom = new GameRoom(
        roomId,
        roomCode,
        roomData.max_players,
        this.config
      )
      await gameRoom.initialize()
      this.rooms.set(roomId, gameRoom)
    }

    // Check if room is full
    if (gameRoom.getPlayerCount() >= roomData.max_players) {
      throw new Error('Room is full')
    }

    // Add player to room
    gameRoom.addPlayer(playerId, playerName, playerColor, isGuest)

    // Add player to database
    await this.supabase
      .from('room_players')
      .insert({
        room_id: roomId,
        player_id: playerId,
        player_name: playerName,
        player_color: playerColor,
        is_guest: isGuest,
      })

    console.log(`Player ${playerName} joined room ${roomCode}`)

    return { roomId, room: gameRoom }
  }

  /**
   * Leave a room
   */
  async leaveRoom(roomId: string, playerId: string): Promise<void> {
    const room = this.rooms.get(roomId)
    if (!room) return

    room.removePlayer(playerId)

    // Remove from database
    await this.supabase
      .from('room_players')
      .delete()
      .eq('room_id', roomId)
      .eq('player_id', playerId)

    // Close room if empty
    if (room.getPlayerCount() === 0) {
      await this.closeRoom(roomId)
    }
  }

  /**
   * Close a room
   */
  async closeRoom(roomId: string): Promise<void> {
    const room = this.rooms.get(roomId)
    if (!room) return

    room.destroy()
    this.rooms.delete(roomId)

    // Mark room as inactive in database
    await this.supabase
      .from('rooms')
      .update({ is_active: false })
      .eq('id', roomId)

    console.log(`Room closed: ${roomId}`)
  }

  /**
   * Get room by ID
   */
  getRoom(roomId: string): GameRoom | undefined {
    return this.rooms.get(roomId)
  }

  /**
   * Generate unique room code
   */
  private async generateRoomCode(): Promise<string> {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789' // Exclude ambiguous chars
    let code: string

    // Keep generating until we find a unique one
    do {
      code = ''
      for (let i = 0; i < 6; i++) {
        code += chars.charAt(Math.floor(Math.random() * chars.length))
      }

      // Check if exists in database
      const { data } = await this.supabase
        .from('rooms')
        .select('code')
        .eq('code', code)
        .single()

      if (!data) break // Unique code found
    } while (true)

    return code
  }

  /**
   * Start cleanup interval
   */
  private startCleanup(): void {
    this.cleanupInterval = setInterval(() => {
      this.cleanupIdleRooms()
    }, this.config.room.cleanupIntervalMs)
  }

  /**
   * Clean up idle rooms
   */
  private cleanupIdleRooms(): void {
    const now = Date.now()

    this.rooms.forEach((room, roomId) => {
      if (now - room.getLastActivity() > this.config.room.idleTimeoutMs) {
        console.log(`Cleaning up idle room: ${roomId}`)
        this.closeRoom(roomId)
      }
    })
  }

  /**
   * Shutdown room manager
   */
  shutdown(): void {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval)
    }

    // Close all rooms
    this.rooms.forEach((_, roomId) => {
      this.closeRoom(roomId)
    })
  }
}

/**
 * Game Room
 * Represents a single multiplayer game room with physics simulation
 */
export class GameRoom {
  private id: string
  private code: string
  private maxPlayers: number
  private players: Map<string, Player> = new Map()
  private physics: PhysicsWorld
  private config: ServerConfig

  private lastActivity: number = Date.now()
  private tick: number = 0
  private isActive: boolean = true

  constructor(id: string, code: string, maxPlayers: number, config: ServerConfig) {
    this.id = id
    this.code = code
    this.maxPlayers = maxPlayers
    this.config = config
    this.physics = new PhysicsWorld(config.physics)
  }

  async initialize(): Promise<void> {
    await this.physics.initialize()
  }

  addPlayer(id: string, name: string, color: string, isGuest: boolean, socketId: string = ''): void {
    const player: Player = {
      id,
      socketId,
      name,
      color,
      isGuest,
      joinedAt: Date.now(),
      lastSeenAt: Date.now(),
      isConnected: true,
    }

    this.players.set(id, player)
    this.updateActivity()
  }

  removePlayer(id: string): void {
    this.players.delete(id)
    this.updateActivity()

    // Remove player's dice
    const playerDice = this.physics.getDiceByOwner(id)
    playerDice.forEach(dice => {
      this.physics.removeDice(dice.id)
    })
  }

  getPlayer(id: string): Player | undefined {
    return this.players.get(id)
  }

  getPlayers(): Player[] {
    return Array.from(this.players.values())
  }

  getPlayerCount(): number {
    return this.players.size
  }

  updateActivity(): void {
    this.lastActivity = Date.now()
  }

  getLastActivity(): number {
    return this.lastActivity
  }

  getId(): string {
    return this.id
  }

  getCode(): string {
    return this.code
  }

  getMaxPlayers(): number {
    return this.maxPlayers
  }

  getPhysics(): PhysicsWorld {
    return this.physics
  }

  getTick(): number {
    return this.tick
  }

  incrementTick(): void {
    this.tick++
  }

  destroy(): void {
    this.isActive = false
    this.physics.destroy()
  }
}
