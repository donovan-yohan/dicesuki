import { createContext, useContext, type ReactNode } from 'react'
import type { DiceShape } from '../lib/geometries'
import type { PlayerInfo } from '../lib/multiplayerMessages'
import type { RollSnapshot } from '../store/useDiceStore'

export type DiceBackendMode = 'local' | 'multiplayer'

export interface DiceBackendState {
  /** Which mode is active */
  mode: DiceBackendMode

  /** Roll actions */
  roll: () => void
  addDie: (type: DiceShape, inventoryDieId?: string) => void
  removeDie: (id: string) => void
  clearAll: () => void

  /** Roll history */
  rollHistory: RollSnapshot[]
  clearHistory: () => void

  /** Multiplayer-only context (null in local mode) */
  multiplayer: {
    players: Map<string, PlayerInfo>
    localPlayerId: string
    roomId: string
    connectionStatus: 'disconnected' | 'connecting' | 'connected'
  } | null
}

export const DiceBackendContext = createContext<DiceBackendState | null>(null)

export function useDiceBackend(): DiceBackendState {
  const ctx = useContext(DiceBackendContext)
  if (!ctx) {
    throw new Error('useDiceBackend must be used within a DiceBackendProvider')
  }
  return ctx
}

interface DiceBackendProviderProps {
  value: DiceBackendState
  children: ReactNode
}

export function DiceBackendProvider({ value, children }: DiceBackendProviderProps) {
  return (
    <DiceBackendContext.Provider value={value}>
      {children}
    </DiceBackendContext.Provider>
  )
}
