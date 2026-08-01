import { createContext, useContext } from 'react'
import type { DiceShape } from '../lib/geometries'
import type { PlayerInfo } from '../lib/multiplayerMessages'
import type { PercentilePresentationFields } from '../lib/percentileRolls'
import type { RollSnapshot } from '../store/useDiceStore'
import type { ConnectionStatus } from '../store/useMultiplayerStore'

export type DiceBackendMode = 'local' | 'multiplayer'

export interface DiceBackendState {
  /** Which mode is active */
  mode: DiceBackendMode

  /** Roll actions */
  roll: () => void
  /**
   * Spawn one die of `type`, preferring an owned one and falling back to a basic
   * die (`lib/basicDice.ts`) when the inventory cannot supply it — an unknown
   * `inventoryDieId`, a die already on the table, or every owned die of the type
   * in play. Inventory scarcity never blocks a spawn.
   *
   * Returns the client request id, or null when the ROOM refused the spawn
   * (disconnected, at capacity).
   *
   * `presentationExtras` is merged over the resolved presentation. It is
   * deliberately narrowed to the percentile pairing fields so a caller cannot
   * overwrite the die's identity (name, colours, inventory id) on the way in —
   * see `percentileRolls.ts`.
   */
  addDie: (
    type: DiceShape,
    inventoryDieId?: string,
    presentationExtras?: PercentilePresentationFields,
  ) => string | null
  /**
   * Spawn a die that is deliberately not an owned one — always a basic die.
   * Returns the client request id when the spawn was sent, otherwise null.
   */
  addGenericDie: (
    type: DiceShape,
    presentationExtras?: PercentilePresentationFields,
  ) => string | null
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
