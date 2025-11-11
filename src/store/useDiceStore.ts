import { create } from 'zustand'

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
  // UI state (isolated from physics)
  lastResult: number | null
  rollHistory: number[]

  // Actions
  recordResult: (value: number) => void
  reset: () => void
}

export const useDiceStore = create<DiceStore>((set) => ({
  lastResult: null,
  rollHistory: [],

  /**
   * Record a dice roll result
   * Updates lastResult and appends to history
   */
  recordResult: (value: number) => {
    console.log('Store: Recording result:', value)
    set((state) => ({
      lastResult: value,
      rollHistory: [...state.rollHistory, value]
    }))
  },

  /**
   * Reset all dice state
   */
  reset: () => set({
    lastResult: null,
    rollHistory: []
  })
}))
