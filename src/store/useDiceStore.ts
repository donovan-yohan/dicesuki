import { create } from 'zustand'
import { persist, createJSONStorage } from 'zustand/middleware'

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
 * Represents an active roll group (e.g., "Greatsword Attack", "Greatsword Damage")
 * Extends the saved roll tracking to support multiple simultaneous rolls
 */
export interface RollGroup {
  id: string
  name: string
  currentRoll: DiceResult[]
  expectedDiceCount: number
  flatBonus: number
  perDieBonuses: Map<string, number> // dice ID -> per-die bonus
  isComplete: boolean
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
  // Active roll groups (multiple simultaneous saved rolls)
  activeRollGroups: RollGroup[]

  // Manual dice (backward compatibility for non-grouped rolls)
  currentRoll: DiceResult[]
  expectedDiceCount: number

  // Saved roll tracking (backward compatibility - deprecated in favor of roll groups)
  activeSavedRoll: {
    flatBonus: number
    perDieBonuses: Map<string, number> // dice ID -> per-die bonus
    expectedDiceCount: number // total number of dice in the saved roll
  } | null

  // Roll history
  lastResult: RollResult | null
  rollHistory: RollResult[]

  // Roll group actions
  startRollGroup: (groupId: string, groupName: string, diceCount: number, flatBonus: number, perDieBonuses: Map<string, number>) => void
  recordDiceResultForGroup: (groupId: string, diceId: string, value: number, type: string) => void
  removeRollGroup: (groupId: string) => void
  clearAllGroups: () => void

  // Manual dice actions (backward compatibility)
  startRoll: (diceCount: number) => void
  setActiveSavedRoll: (flatBonus: number, perDieBonuses: Map<string, number>, expectedDiceCount: number) => void
  clearActiveSavedRoll: () => void
  recordDiceResult: (id: string, value: number, type: string, groupId?: string) => void
  completeRoll: () => void
  reset: () => void
  clearHistory: () => void
}

const MAX_ACTIVE_GROUPS = 5

export const useDiceStore = create<DiceStore>()(
  persist(
    (set, get) => ({
      // State
      activeRollGroups: [],
      currentRoll: [],
      expectedDiceCount: 0,
      activeSavedRoll: null,
      lastResult: null,
      rollHistory: [],

      // Roll Group Actions
      startRollGroup: (groupId: string, groupName: string, diceCount: number, flatBonus: number, perDieBonuses: Map<string, number>) => {
        console.log('Store: Starting roll group:', groupName, 'with', diceCount, 'dice')
        set((state) => {
          // Check if group already exists - if so, reset it
          const existingIndex = state.activeRollGroups.findIndex(g => g.id === groupId)

          if (existingIndex >= 0) {
            // Reset existing group
            const updated = [...state.activeRollGroups]
            updated[existingIndex] = {
              id: groupId,
              name: groupName,
              currentRoll: [],
              expectedDiceCount: diceCount,
              flatBonus,
              perDieBonuses,
              isComplete: false
            }
            return { activeRollGroups: updated }
          } else {
            // Check max groups limit
            if (state.activeRollGroups.length >= MAX_ACTIVE_GROUPS) {
              console.warn('Store: Max roll groups reached, removing oldest')
              const updated = state.activeRollGroups.slice(1)
              return {
                activeRollGroups: [
                  ...updated,
                  {
                    id: groupId,
                    name: groupName,
                    currentRoll: [],
                    expectedDiceCount: diceCount,
                    flatBonus,
                    perDieBonuses,
                    isComplete: false
                  }
                ]
              }
            }

            // Add new group
            return {
              activeRollGroups: [
                ...state.activeRollGroups,
                {
                  id: groupId,
                  name: groupName,
                  currentRoll: [],
                  expectedDiceCount: diceCount,
                  flatBonus,
                  perDieBonuses,
                  isComplete: false
                }
              ]
            }
          }
        })
      },

      recordDiceResultForGroup: (groupId: string, diceId: string, value: number, type: string) => {
        console.log('Store: Recording dice result for group:', groupId, diceId, value, type)
        set((state) => {
          const groupIndex = state.activeRollGroups.findIndex(g => g.id === groupId)
          if (groupIndex < 0) {
            console.warn('Store: Group not found:', groupId)
            return state
          }

          const group = state.activeRollGroups[groupIndex]

          // Check if dice already reported
          if (group.currentRoll.some(d => d.id === diceId)) {
            console.log('Store: Dice already reported for group, ignoring')
            return state
          }

          const newRoll = [...group.currentRoll, { id: diceId, value, type }]
          const isComplete = newRoll.length === group.expectedDiceCount

          const updated = [...state.activeRollGroups]
          updated[groupIndex] = {
            ...group,
            currentRoll: newRoll,
            isComplete
          }

          console.log('Store: Group progress:', newRoll.length, '/', group.expectedDiceCount, 'complete:', isComplete)

          return { activeRollGroups: updated }
        })
      },

      removeRollGroup: (groupId: string) => {
        console.log('Store: Removing roll group:', groupId)
        set((state) => ({
          activeRollGroups: state.activeRollGroups.filter(g => g.id !== groupId)
        }))
      },

      clearAllGroups: () => {
        console.log('Store: Clearing all roll groups')
        set({ activeRollGroups: [] })
      },

      // Manual Dice Actions (Backward Compatibility)
      startRoll: (diceCount: number) => {
        console.log('Store: Starting manual roll with', diceCount, 'dice')
        set({
          currentRoll: [],
          expectedDiceCount: diceCount
        })
      },

      setActiveSavedRoll: (flatBonus: number, perDieBonuses: Map<string, number>, expectedDiceCount: number) => {
        set({
          activeSavedRoll: { flatBonus, perDieBonuses, expectedDiceCount }
        })
      },

      clearActiveSavedRoll: () => {
        set({ activeSavedRoll: null })
      },

      /**
       * Record a single dice result
       * Routes to roll group if groupId provided, otherwise handles as manual dice
       */
      recordDiceResult: (id: string, value: number, type: string, groupId?: string) => {
        // If groupId provided, route to group method
        if (groupId) {
          get().recordDiceResultForGroup(groupId, id, value, type)
          return
        }

        // Otherwise, handle as manual dice
        console.log('Store: Recording manual dice result:', id, value, type)
        set((state) => {
          // Check if this dice already reported (prevent duplicates)
          if (state.currentRoll.some(d => d.id === id)) {
            console.log('Store: Dice', id, 'already reported, ignoring')
            return state
          }

          const newRoll = [...state.currentRoll, { id, value, type }]

          // Auto-complete if all dice have reported
          if (newRoll.length === state.expectedDiceCount) {
            console.log('Store: All manual dice reported, completing roll')
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

      reset: () => set({
        activeRollGroups: [],
        currentRoll: [],
        expectedDiceCount: 0,
        activeSavedRoll: null,
        lastResult: null,
        rollHistory: []
      }),

      clearHistory: () => set({
        rollHistory: [],
        lastResult: null
      })
    }),
    {
      name: 'daisu-dice-rolls',
      storage: createJSONStorage(() => localStorage),
      // Only persist active roll groups
      partialize: (state) => ({
        activeRollGroups: state.activeRollGroups.map(group => ({
          ...group,
          // Convert Map to object for JSON serialization
          perDieBonuses: Object.fromEntries(group.perDieBonuses)
        }))
      }),
      // Rehydrate Maps from objects
      onRehydrateStorage: () => (state) => {
        if (state?.activeRollGroups) {
          state.activeRollGroups = state.activeRollGroups.map((group: any) => ({
            ...group,
            perDieBonuses: new Map(Object.entries(group.perDieBonuses || {}))
          }))
        }
      }
    }
  )
)
