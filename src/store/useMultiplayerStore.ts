/**
 * Multiplayer Store
 * Manages multiplayer connection state, room state, and player information
 */

import { create } from 'zustand'

export interface Player {
  id: string
  name: string
  color: string
  isGuest: boolean
  joinedAt: number
  isConnected: boolean
}

export interface RoomState {
  id: string
  code: string
  maxPlayers: number
  players: Player[]
}

interface MultiplayerStore {
  // Connection state
  isConnected: boolean
  isConnecting: boolean
  connectionError: string | null

  // Room state
  roomCode: string | null
  roomId: string | null
  room: RoomState | null

  // Local player
  playerId: string | null
  playerName: string | null
  playerColor: string | null

  // Multiplayer mode
  isMultiplayer: boolean

  // Actions
  setConnected: (connected: boolean) => void
  setConnecting: (connecting: boolean) => void
  setConnectionError: (error: string | null) => void

  setRoom: (room: RoomState | null) => void
  setRoomCode: (code: string | null) => void
  setRoomId: (id: string | null) => void

  setPlayer: (id: string, name: string, color: string) => void
  clearPlayer: () => void

  addPlayer: (player: Player) => void
  removePlayer: (playerId: string) => void
  updatePlayer: (playerId: string, updates: Partial<Player>) => void

  setMultiplayer: (enabled: boolean) => void

  reset: () => void
}

export const useMultiplayerStore = create<MultiplayerStore>((set) => ({
  // Initial state
  isConnected: false,
  isConnecting: false,
  connectionError: null,

  roomCode: null,
  roomId: null,
  room: null,

  playerId: null,
  playerName: null,
  playerColor: null,

  isMultiplayer: false,

  // Connection actions
  setConnected: (connected) => set({ isConnected: connected }),
  setConnecting: (connecting) => set({ isConnecting: connecting }),
  setConnectionError: (error) => set({ connectionError: error }),

  // Room actions
  setRoom: (room) =>
    set({
      room,
      roomId: room?.id || null,
      roomCode: room?.code || null,
      isMultiplayer: !!room,
    }),

  setRoomCode: (code) => set({ roomCode: code }),
  setRoomId: (id) => set({ roomId: id }),

  // Player actions
  setPlayer: (id, name, color) =>
    set({
      playerId: id,
      playerName: name,
      playerColor: color,
    }),

  clearPlayer: () =>
    set({
      playerId: null,
      playerName: null,
      playerColor: null,
    }),

  addPlayer: (player) =>
    set((state) => ({
      room: state.room
        ? {
            ...state.room,
            players: [...state.room.players, player],
          }
        : null,
    })),

  removePlayer: (playerId) =>
    set((state) => ({
      room: state.room
        ? {
            ...state.room,
            players: state.room.players.filter((p) => p.id !== playerId),
          }
        : null,
    })),

  updatePlayer: (playerId, updates) =>
    set((state) => ({
      room: state.room
        ? {
            ...state.room,
            players: state.room.players.map((p) =>
              p.id === playerId ? { ...p, ...updates } : p
            ),
          }
        : null,
    })),

  setMultiplayer: (enabled) => set({ isMultiplayer: enabled }),

  // Reset all state (when leaving room)
  reset: () =>
    set({
      isConnected: false,
      isConnecting: false,
      connectionError: null,
      roomCode: null,
      roomId: null,
      room: null,
      playerId: null,
      playerName: null,
      playerColor: null,
      isMultiplayer: false,
    }),
}))
