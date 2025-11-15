import { create } from 'zustand'

/**
 * Represents a single dice result in a roll
 */
export interface DiceResult {
  id: string
  value: number
  type: string // 'd4', 'd6', 'd8', 'd12', 'd20'
}

/**
 * Represents a complete roll with multiple dice
 */
export interface RollResult {
  dice: DiceResult[]
  sum: number
  timestamp: number
}

/**
 * Zustand store for dice roll state
 *
 * This store is kept OUTSIDE React's render cycle to prevent
 * Canvas/Physics re-renders when UI state changes.
 *
 * The physics world (Canvas + Physics + D6) should never re-render
 * due to result updates. Only UI components that display results
 * should subscribe to this store.
 */
interface DiceStore {
  // Current roll state
  currentRoll: DiceResult[]
  expectedDiceCount: number

  // Roll history
  lastResult: RollResult | null
  rollHistory: RollResult[]

  // Actions
  startRoll: (diceCount: number) => void
  recordDiceResult: (id: string, value: number, type: string) => void
  completeRoll: () => void
  reset: () => void
  clearHistory: () => void
}

export const useDiceStore = create<DiceStore>((set, get) => ({
  currentRoll: [],
  expectedDiceCount: 0,
  lastResult: null,
  rollHistory: [],

  /**
   * Start a new roll
   * Resets current roll state and sets expected dice count
   */
  startRoll: (diceCount: number) => {
    console.log('Store: Starting roll with', diceCount, 'dice')
    set({
      currentRoll: [],
      expectedDiceCount: diceCount
    })
  },

  /**
   * Record a single dice result
   * Adds to current roll and auto-completes if all dice have reported
   */
  recordDiceResult: (id: string, value: number, type: string) => {
    console.log('Store: Recording dice result:', id, value, type)
    set((state) => {
      // Check if this dice already reported (prevent duplicates)
      if (state.currentRoll.some(d => d.id === id)) {
        console.log('Store: Dice', id, 'already reported, ignoring')
        return state
      }

      const newRoll = [...state.currentRoll, { id, value, type }]

      // Auto-complete if all dice have reported
      if (newRoll.length === state.expectedDiceCount) {
        console.log('Store: All dice reported, completing roll')
        const sum = newRoll.reduce((acc, d) => acc + d.value, 0)
        const rollResult: RollResult = {
          dice: newRoll,
          sum,
          timestamp: Date.now()
        }

        return {
          currentRoll: [],
          expectedDiceCount: 0,
          lastResult: rollResult,
          rollHistory: [...state.rollHistory, rollResult]
        }
      }

      return { currentRoll: newRoll }
    })
  },

  /**
   * Manually complete the current roll
   */
  completeRoll: () => {
    const state = get()
    if (state.currentRoll.length === 0) return

    const sum = state.currentRoll.reduce((acc, d) => acc + d.value, 0)
    const rollResult: RollResult = {
      dice: state.currentRoll,
      sum,
      timestamp: Date.now()
    }

    set({
      lastResult: rollResult,
      rollHistory: [...state.rollHistory, rollResult]
    })
  },

  /**
   * Reset all dice state
   */
  reset: () => set({
    currentRoll: [],
    expectedDiceCount: 0,
    lastResult: null,
    rollHistory: []
  }),

  /**
   * Clear roll history only
   */
  clearHistory: () => set({
    rollHistory: [],
    lastResult: null
  })
}))
