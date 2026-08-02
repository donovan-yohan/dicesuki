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
import {
  isRecord,
  normalizePersistedSavedRoll,
  normalizeSavedRollSources,
  withNormalizedRollSources,
  withRollSources,
} from '../lib/rollSources'
import {
  normalizeTombstones,
  type SavedRollTombstones,
} from '../lib/savedRollsMerge'

/**
 * Stamp a roll as locally modified.
 *
 * `updatedAt` is the per-roll revision cross-device sync compares when the SAME
 * roll was edited on two devices (`src/lib/savedRollsMerge.ts`). Every mutating
 * action routes through here so no path can produce a roll that looks older than
 * it is — an unstamped edit would silently lose to a stale remote copy.
 */
function touchRoll(roll: SavedRoll, now: number = Date.now()): SavedRoll {
  return { ...roll, updatedAt: now }
}

export interface SavedRollsStore {
  // State
  savedRolls: SavedRoll[]
  currentlyEditing: SavedRoll | null
  /**
   * Tombstones for rolls deleted on this device: roll id -> deletion time.
   *
   * Sync merges the two devices' roll lists by union, so a delete that left no
   * trace would simply be undone by the other device's surviving copy. These
   * rows are what make a deletion propagate. Garbage collected by
   * `normalizeTombstones` (TTL + cap) so the blob stays bounded.
   */
  deletedRolls: SavedRollTombstones

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

export function normalizePersistedSavedRollsState(persistedState: unknown): Partial<SavedRollsStore> {
  const state = isRecord(persistedState)
    ? persistedState as Partial<SavedRollsStore>
    : {}
  const savedRolls = Array.isArray(state.savedRolls)
    ? state.savedRolls
      .map(normalizePersistedSavedRoll)
      .filter((roll): roll is SavedRoll => roll !== null)
    : []
  const currentlyEditing = normalizePersistedSavedRoll(state.currentlyEditing)

  return {
    ...state,
    savedRolls,
    currentlyEditing,
    // Also the normalizer for REMOTE blobs (dataSync reuses this function), so a
    // v1 blob — which has no tombstones at all — has to read back as "no
    // deletions known", not `undefined`.
    deletedRolls: normalizeTombstones(state.deletedRolls),
  }
}

export const useSavedRollsStore = create<SavedRollsStore>()(
  persist(
    (set, get) => ({
      // Initial state
      savedRolls: [],
      currentlyEditing: null,
      deletedRolls: {},

      // Add a new saved roll
      addRoll: (roll) => set((state) => {
        // Prevent duplicates by ID
        if (state.savedRolls.some(r => r.id === roll.id)) {
          return state
        }
        // Re-adding a previously deleted id retires its tombstone; leaving it
        // would have the next merge delete the new roll on sight.
        const deletedRolls = { ...state.deletedRolls }
        delete deletedRolls[roll.id]
        return {
          savedRolls: [...state.savedRolls, touchRoll(normalizeSavedRollSources(roll))],
          deletedRolls,
        }
      }),

      // Update an existing roll
      updateRoll: (id, updates) => set((state) => ({
        savedRolls: state.savedRolls.map(roll =>
          roll.id === id ? touchRoll(normalizeSavedRollSources({ ...roll, ...updates })) : roll
        )
      })),

      // Delete a roll
      deleteRoll: (id) => set((state) => ({
        savedRolls: state.savedRolls.filter(roll => roll.id !== id),
        // Recorded so the delete survives a merge with a device that still has
        // its copy — a union of the two lists would otherwise resurrect it.
        deletedRolls: normalizeTombstones({ ...state.deletedRolls, [id]: Date.now() }),
      })),

      // Duplicate a roll (creates a new roll with same settings)
      duplicateRoll: (id) => set((state) => {
        const original = state.savedRolls.find(r => r.id === id)
        if (!original) return state

        const duplicate: SavedRoll = touchRoll(normalizeSavedRollSources({
          ...original,
          id: `roll-${Date.now()}`,
          name: `${original.name} (Copy)`,
          createdAt: Date.now(),
          lastUsed: undefined,
        }))

        return {
          savedRolls: [...state.savedRolls, duplicate]
        }
      }),

      // Toggle favorite status
      toggleFavorite: (id) => set((state) => ({
        savedRolls: state.savedRolls.map(roll =>
          roll.id === id ? touchRoll({ ...roll, isFavorite: !roll.isFavorite }) : roll
        )
      })),

      // Mark a roll as recently used
      markRollAsUsed: (id) => set((state) => ({
        savedRolls: state.savedRolls.map(roll =>
          roll.id === id ? touchRoll({ ...roll, lastUsed: Date.now() }) : roll
        )
      })),

      // Start editing a roll (creates a working copy)
      startEditing: (roll) => set({
        currentlyEditing: normalizeSavedRollSources(roll)
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
            dice: [...state.currentlyEditing.dice, withNormalizedRollSources(entry)]
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
              entry.id === entryId
                ? updates.sources
                  ? withRollSources({ ...entry, ...updates }, updates.sources)
                  : withNormalizedRollSources({ ...entry, ...updates })
                : entry
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
      // v1 -> v2 adds `deletedRolls` (delete tombstones) and per-roll
      // `updatedAt`. The bump is what makes `migrate` run for everyone already
      // holding a v1 blob — persist skips it when the version matches, which
      // would leave `deletedRolls` undefined on exactly the installs that have
      // saved rolls worth syncing.
      version: 2,
      migrate: normalizePersistedSavedRollsState,
    }
  )
)

// Helper function to create a new roll and start editing
export function createAndStartEditingRoll(): SavedRoll {
  const roll = createDefaultSavedRoll()
  useSavedRollsStore.getState().startEditing(roll)
  return roll
}

// Helper function to save the currently editing roll and stop editing
export function saveAndStopEditing() {
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
