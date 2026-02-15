import { create } from 'zustand'
import { persist, createJSONStorage } from 'zustand/middleware'

/**
 * Represents a single die that has settled with a face value
 */
export interface DieSettledState {
  diceId: string
  value: number
  type: string
  settledAt: number
}

/**
 * Represents a snapshot of a completed roll cycle for history
 */
export interface RollSnapshot {
  dice: DieSettledState[]
  sum: number
  timestamp: number
}

/**
 * Tracks the active saved roll context for bonus display.
 * This is transient state (not persisted) — do not add to partialize.
 * perDieBonuses uses Map which does not serialize to JSON.
 */
export interface ActiveSavedRoll {
  name: string
  flatBonus: number
  perDieBonuses: Map<string, number> // dice instance ID → per-die bonus
}

/**
 * Zustand store for per-die roll state tracking
 *
 * Each die independently reports when it starts moving (markDiceRolling)
 * and when it settles (recordDieSettled). The UI sums all settled dice.
 *
 * Roll cycles for history:
 * - A "roll cycle" starts when rollingDice goes from empty to non-empty
 * - All dice that enter rollingDice during the cycle accumulate in currentRollCycleDice
 * - When rollingDice empties, a history snapshot is saved containing only those dice
 */
interface DiceStore {
  settledDice: Map<string, DieSettledState>
  rollingDice: Set<string>
  currentRollCycleDice: Set<string>
  rollHistory: RollSnapshot[]
  activeSavedRoll: ActiveSavedRoll | null

  markDiceRolling: (diceIds: string[]) => void
  recordDieSettled: (diceId: string, value: number, type: string) => void
  removeDieState: (diceId: string) => void
  clearAllDieStates: () => void
  setActiveSavedRoll: (roll: ActiveSavedRoll) => void
  clearActiveSavedRoll: () => void
  clearHistory: () => void
  reset: () => void
}

export const useDiceStore = create<DiceStore>()(
  persist(
    (set) => ({
      settledDice: new Map(),
      rollingDice: new Set(),
      currentRollCycleDice: new Set(),
      rollHistory: [],
      activeSavedRoll: null,

      markDiceRolling: (diceIds: string[]) => {
        set((state) => {
          const newSettled = new Map(state.settledDice)
          const wasEmpty = state.rollingDice.size === 0
          const newRolling = new Set(state.rollingDice)
          const newCycleDice = wasEmpty ? new Set<string>() : new Set(state.currentRollCycleDice)

          for (const id of diceIds) {
            newSettled.delete(id)
            newRolling.add(id)
            newCycleDice.add(id)
          }

          return {
            settledDice: newSettled,
            rollingDice: newRolling,
            currentRollCycleDice: newCycleDice,
          }
        })
      },

      recordDieSettled: (diceId: string, value: number, type: string) => {
        set((state) => {
          const newSettled = new Map(state.settledDice)
          newSettled.set(diceId, {
            diceId,
            value,
            type,
            settledAt: Date.now(),
          })

          const newRolling = new Set(state.rollingDice)
          newRolling.delete(diceId)

          // If all rolling dice have settled, save history snapshot
          if (newRolling.size === 0 && state.currentRollCycleDice.size > 0) {
            // Build snapshot from only the dice in the current cycle
            const cycleDice: DieSettledState[] = []
            for (const cycleId of state.currentRollCycleDice) {
              const settled = newSettled.get(cycleId)
              if (settled) {
                cycleDice.push(settled)
              }
            }

            if (cycleDice.length > 0) {
              const sum = cycleDice.reduce((acc, d) => acc + d.value, 0)
              const snapshot: RollSnapshot = {
                dice: cycleDice,
                sum,
                timestamp: Date.now(),
              }

              return {
                settledDice: newSettled,
                rollingDice: newRolling,
                currentRollCycleDice: new Set<string>(),
                rollHistory: [...state.rollHistory, snapshot],
              }
            }
          }

          return {
            settledDice: newSettled,
            rollingDice: newRolling,
          }
        })
      },

      removeDieState: (diceId: string) => {
        set((state) => {
          const newSettled = new Map(state.settledDice)
          newSettled.delete(diceId)

          const newRolling = new Set(state.rollingDice)
          newRolling.delete(diceId)

          const newCycleDice = new Set(state.currentRollCycleDice)
          newCycleDice.delete(diceId)

          return {
            settledDice: newSettled,
            rollingDice: newRolling,
            currentRollCycleDice: newCycleDice,
          }
        })
      },

      clearAllDieStates: () => {
        set({
          settledDice: new Map(),
          rollingDice: new Set(),
          currentRollCycleDice: new Set(),
        })
      },

      setActiveSavedRoll: (roll: ActiveSavedRoll) => {
        set({ activeSavedRoll: roll })
      },

      clearActiveSavedRoll: () => {
        set({ activeSavedRoll: null })
      },

      clearHistory: () => {
        set({ rollHistory: [] })
      },

      reset: () => {
        set({
          settledDice: new Map(),
          rollingDice: new Set(),
          currentRollCycleDice: new Set(),
          rollHistory: [],
          activeSavedRoll: null,
        })
      },
    }),
    {
      name: 'dicesuki-dice-rolls',
      storage: createJSONStorage(() => localStorage),
      partialize: (state) => ({
        rollHistory: state.rollHistory,
      }),
    }
  )
)
