import { createContext, useContext } from 'react'
import type { DiceShape } from '../lib/geometries'
import type { PlayerInfo } from '../lib/multiplayerMessages'
import type { RollSnapshot } from '../store/useDiceStore'
import type { ConnectionStatus } from '../store/useMultiplayerStore'

export type DiceBackendMode = 'local' | 'multiplayer'

export interface DiceBackendState {
  /** Which mode is active */
  mode: DiceBackendMode

  /** Roll actions */
  roll: () => void
  /** Returns the client request id when the spawn was sent, otherwise null. */
  addDie: (type: DiceShape, inventoryDieId?: string) => string | null
  /** Returns the client request id when the spawn was sent, otherwise null. */
  addGenericDie: (type: DiceShape) => string | null
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
    connectionStatus: ConnectionStatus
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
