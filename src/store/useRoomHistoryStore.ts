import { create } from 'zustand'
import type { DieResult } from '../lib/multiplayerMessages'

export interface RoomRollEntry {
  id: string
  playerId: string
  displayName: string
  color: string
  results: DieResult[]
  total: number
  timestamp: number
}

interface RoomHistoryState {
  rolls: RoomRollEntry[]
  addRoll: (entry: RoomRollEntry) => void
  clear: () => void
}

const MAX_HISTORY = 50

export const useRoomHistoryStore = create<RoomHistoryState>((set) => ({
  rolls: [],

  addRoll: (entry: RoomRollEntry) => {
    set((state) => ({
      rolls: [entry, ...state.rolls].slice(0, MAX_HISTORY),
    }))
  },

  clear: () => set({ rolls: [] }),
}))
