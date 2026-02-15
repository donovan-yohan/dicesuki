/**
 * Saved Rolls Store
 *
 * Zustand store for managing saved/favorite dice rolls.
 * Persists to localStorage for cross-session persistence.
 */

import { create } from 'zustand'
import { persist, createJSONStorage } from 'zustand/middleware'
import { SavedRoll, DiceEntry } from '../types/savedRolls'
import { createDefaultSavedRoll } from '../lib/diceHelpers'

interface SavedRollsStore {
  // State
  savedRolls: SavedRoll[]
  currentlyEditing: SavedRoll | null

  // Actions
  addRoll: (roll: SavedRoll) => void
  updateRoll: (id: string, updates: Partial<SavedRoll>) => void
  deleteRoll: (id: string) => void
  duplicateRoll: (id: string) => void
  toggleFavorite: (id: string) => void

  // Roll usage tracking
  markRollAsUsed: (id: string) => void

  // Editing
  startEditing: (roll: SavedRoll) => void
  stopEditing: () => void
  updateCurrentRoll: (updates: Partial<SavedRoll>) => void

  // Dice entry management (for current roll being edited)
  addDiceEntry: (entry: DiceEntry) => void
  updateDiceEntry: (entryId: string, updates: Partial<DiceEntry>) => void
  removeDiceEntry: (entryId: string) => void
  reorderDiceEntries: (fromIndex: number, toIndex: number) => void

  // Filtering/searching
  getFavoriteRolls: () => SavedRoll[]
  getRollsByTag: (tag: string) => SavedRoll[]
  searchRolls: (query: string) => SavedRoll[]
  getAllTags: () => string[]
}

export const useSavedRollsStore = create<SavedRollsStore>()(
  persist(
    (set, get) => ({
      // Initial state
      savedRolls: [],
      currentlyEditing: null,

      // Add a new saved roll
      addRoll: (roll) => set((state) => {
        // Prevent duplicates by ID
        if (state.savedRolls.some(r => r.id === roll.id)) {
          return state
        }
        return {
          savedRolls: [...state.savedRolls, roll]
        }
      }),

      // Update an existing roll
      updateRoll: (id, updates) => set((state) => ({
        savedRolls: state.savedRolls.map(roll =>
          roll.id === id ? { ...roll, ...updates } : roll
        )
      })),

      // Delete a roll
      deleteRoll: (id) => set((state) => ({
        savedRolls: state.savedRolls.filter(roll => roll.id !== id)
      })),

      // Duplicate a roll (creates a new roll with same settings)
      duplicateRoll: (id) => set((state) => {
        const original = state.savedRolls.find(r => r.id === id)
        if (!original) return state

        const duplicate: SavedRoll = {
          ...original,
          id: `roll-${Date.now()}`,
          name: `${original.name} (Copy)`,
          createdAt: Date.now(),
          lastUsed: undefined,
        }

        return {
          savedRolls: [...state.savedRolls, duplicate]
        }
      }),

      // Toggle favorite status
      toggleFavorite: (id) => set((state) => ({
        savedRolls: state.savedRolls.map(roll =>
          roll.id === id ? { ...roll, isFavorite: !roll.isFavorite } : roll
        )
      })),

      // Mark a roll as recently used
      markRollAsUsed: (id) => set((state) => ({
        savedRolls: state.savedRolls.map(roll =>
          roll.id === id ? { ...roll, lastUsed: Date.now() } : roll
        )
      })),

      // Start editing a roll (creates a working copy)
      startEditing: (roll) => set({
        currentlyEditing: { ...roll }
      }),

      // Stop editing (discard changes)
      stopEditing: () => set({
        currentlyEditing: null
      }),

      // Update the currently editing roll
      updateCurrentRoll: (updates) => set((state) => {
        if (!state.currentlyEditing) return state
        return {
          currentlyEditing: {
            ...state.currentlyEditing,
            ...updates
          }
        }
      }),

      // Add dice entry to currently editing roll
      addDiceEntry: (entry) => set((state) => {
        if (!state.currentlyEditing) return state
        return {
          currentlyEditing: {
            ...state.currentlyEditing,
            dice: [...state.currentlyEditing.dice, entry]
          }
        }
      }),

      // Update dice entry in currently editing roll
      updateDiceEntry: (entryId, updates) => set((state) => {
        if (!state.currentlyEditing) return state
        return {
          currentlyEditing: {
            ...state.currentlyEditing,
            dice: state.currentlyEditing.dice.map(entry =>
              entry.id === entryId ? { ...entry, ...updates } : entry
            )
          }
        }
      }),

      // Remove dice entry from currently editing roll
      removeDiceEntry: (entryId) => set((state) => {
        if (!state.currentlyEditing) return state
        return {
          currentlyEditing: {
            ...state.currentlyEditing,
            dice: state.currentlyEditing.dice.filter(entry => entry.id !== entryId)
          }
        }
      }),

      // Reorder dice entries in currently editing roll
      reorderDiceEntries: (fromIndex, toIndex) => set((state) => {
        if (!state.currentlyEditing) return state
        const dice = [...state.currentlyEditing.dice]
        const [movedEntry] = dice.splice(fromIndex, 1)
        dice.splice(toIndex, 0, movedEntry)

        return {
          currentlyEditing: {
            ...state.currentlyEditing,
            dice
          }
        }
      }),

      // Get all favorite rolls
      getFavoriteRolls: () => {
        return get().savedRolls.filter(roll => roll.isFavorite)
      },

      // Get rolls by tag
      getRollsByTag: (tag) => {
        return get().savedRolls.filter(roll => roll.tags?.includes(tag))
      },

      // Search rolls by name or description
      searchRolls: (query) => {
        const lowerQuery = query.toLowerCase()
        return get().savedRolls.filter(roll =>
          roll.name.toLowerCase().includes(lowerQuery) ||
          roll.description?.toLowerCase().includes(lowerQuery)
        )
      },

      // Get all unique tags
      getAllTags: () => {
        const allTags = get().savedRolls.flatMap(roll => roll.tags || [])
        return Array.from(new Set(allTags)).sort()
      },
    }),
    {
      name: 'dicesuki-saved-rolls', // localStorage key
      storage: createJSONStorage(() => localStorage),
    }
  )
)

// Helper function to create a new roll and start editing
export function createNewRoll(): SavedRoll {
  const roll = createDefaultSavedRoll()
  useSavedRollsStore.getState().startEditing(roll)
  return roll
}

// Helper function to save the currently editing roll
export function saveCurrentRoll() {
  const { currentlyEditing, addRoll, updateRoll, stopEditing } = useSavedRollsStore.getState()
  if (!currentlyEditing) return

  const existingRoll = useSavedRollsStore.getState().savedRolls.find(r => r.id === currentlyEditing.id)

  if (existingRoll) {
    updateRoll(currentlyEditing.id, currentlyEditing)
  } else {
    addRoll(currentlyEditing)
  }

  stopEditing()
}
