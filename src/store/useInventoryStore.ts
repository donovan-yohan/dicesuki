/**
 * Inventory Store
 *
 * Zustand store for managing player inventory.
 * Handles dice collection, assignment, stats tracking, and crafting.
 */

import { create } from 'zustand'
import { persist, createJSONStorage } from 'zustand/middleware'
import {
  InventoryDie,
  NewInventoryDie,
  DieUpdate,
  DieRarity,
  SetCompletion,
  Currency,
  DieStats
} from '../types/inventory'
import { CraftingRecipe, CraftingResult } from '../types/crafting'
import { DiceShape } from '../lib/geometries'
import { getDieMax } from '../lib/diceHelpers'
import { getDieSetById } from '../config/dieSets'
import { STARTER_DICE } from '../config/starterDice'
import { createBlobUrlFromStorage, deleteCustomDiceModel } from '../lib/customDiceDB'
// CRAFTING_RECIPES imported for future use
// import { CRAFTING_RECIPES } from '../config/craftingRecipes'

// ============================================================================
// Store Interface
// ============================================================================

interface InventoryStore {
  // ============================================================================
  // State
  // ============================================================================

  dice: InventoryDie[]
  currency: Currency

  // Assignment tracking (savedRollId:entryId:slotIndex -> dieId)
  assignments: Record<string, string>

  // ============================================================================
  // Dice Management
  // ============================================================================

  addDie: (die: NewInventoryDie) => InventoryDie
  removeDie: (dieId: string) => boolean
  updateDie: (dieId: string, updates: DieUpdate) => void

  // Player customization
  renameDie: (dieId: string, name: string) => void
  setDescription: (dieId: string, description: string) => void
  toggleFavorite: (dieId: string) => void
  toggleLock: (dieId: string) => void

  // Stats tracking
  recordRoll: (dieId: string, value: number) => void
  getDieStats: (dieId: string) => DieStats | undefined

  // ============================================================================
  // Assignment (Integration with Saved Rolls)
  // ============================================================================

  assignDieToSlot: (
    savedRollId: string,
    entryId: string,
    slotIndex: number,
    dieId: string
  ) => void

  unassignDieFromSlot: (
    savedRollId: string,
    entryId: string,
    slotIndex: number
  ) => void

  getAssignedDie: (
    savedRollId: string,
    entryId: string,
    slotIndex: number
  ) => InventoryDie | undefined

  isDieAssigned: (dieId: string) => boolean
  getRollsUsingDie: (dieId: string) => string[]

  // ============================================================================
  // Filtering & Sorting
  // ============================================================================

  getDiceByType: (type: DiceShape) => InventoryDie[]
  getDiceByRarity: (rarity: DieRarity) => InventoryDie[]
  getDiceBySet: (setId: string) => InventoryDie[]
  getUnassignedDice: (type?: DiceShape) => InventoryDie[]
  getFavoriteDice: () => InventoryDie[]
  getDuplicates: (dieId: string) => InventoryDie[]
  hasCompleteSet: (setId: string) => boolean
  getSetCompletion: (setId: string) => SetCompletion

  // ============================================================================
  // Crafting System
  // ============================================================================

  canCraft: (recipe: CraftingRecipe, inputDiceIds: string[]) => boolean
  craft: (recipe: CraftingRecipe, inputDiceIds: string[]) => CraftingResult

  // ============================================================================
  // Economy (Placeholder for Future)
  // ============================================================================

  addCurrency: (type: keyof Currency, amount: number) => void
  spendCurrency: (type: keyof Currency, amount: number) => boolean
  sellDie: (dieId: string) => number

  // ============================================================================
  // Initialization
  // ============================================================================

  initializeStarterDice: () => void
  reset: () => void

  // ============================================================================
  // Custom Dice Persistence (IndexedDB)
  // ============================================================================

  regenerateCustomDiceBlobUrls: () => Promise<void>
  getDevDice: () => InventoryDie[]
  removeAllDevDice: () => Promise<void>
}

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Generate unique die ID
 */
function generateDieId(): string {
  return `die_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`
}

/**
 * Create assignment key
 */
function getAssignmentKey(
  savedRollId: string,
  entryId: string,
  slotIndex: number
): string {
  return `${savedRollId}:${entryId}:${slotIndex}`
}

/**
 * Get sell value for a die based on rarity
 */
function getSellValue(rarity: DieRarity): number {
  const values: Record<DieRarity, number> = {
    common: 10,
    uncommon: 25,
    rare: 75,
    epic: 200,
    legendary: 500,
    mythic: 1500
  }
  return values[rarity]
}

/**
 * Initialize default stats
 */
function getDefaultStats(): DieStats {
  return {
    timesRolled: 0,
    totalValue: 0,
    critsRolled: 0,
    failsRolled: 0
  }
}

/**
 * Create a complete InventoryDie from NewInventoryDie
 */
function createInventoryDie(newDie: NewInventoryDie): InventoryDie {
  return {
    ...newDie,
    id: newDie.id || generateDieId(),
    acquiredAt: newDie.acquiredAt || Date.now(),
    stats: { ...getDefaultStats(), ...newDie.stats },
    assignedToRolls: newDie.assignedToRolls || []
  }
}

// ============================================================================
// Store Implementation
// ============================================================================

export const useInventoryStore = create<InventoryStore>()(
  persist(
    (set, get) => ({
      // ========================================================================
      // Initial State
      // ========================================================================

      dice: [],
      currency: {
        coins: 0,
        gems: 0,
        standardTokens: 0,
        premiumTokens: 0
      },
      assignments: {},

      // ========================================================================
      // Dice Management
      // ========================================================================

      addDie: (newDie: NewInventoryDie) => {
        const die = createInventoryDie(newDie)
        set(state => ({
          dice: [...state.dice, die]
        }))
        return die
      },

      removeDie: (dieId: string) => {
        const state = get()
        const die = state.dice.find(d => d.id === dieId)

        if (!die) return false

        // Check if die is locked
        if (die.isLocked) {
          console.warn(`Cannot remove locked die: ${dieId}`)
          return false
        }

        // Unassign from all rolls
        die.assignedToRolls.forEach(() => {
          // Remove assignments
          Object.keys(state.assignments).forEach(key => {
            if (state.assignments[key] === dieId) {
              delete state.assignments[key]
            }
          })
        })

        set(state => ({
          dice: state.dice.filter(d => d.id !== dieId)
        }))

        return true
      },

      updateDie: (dieId: string, updates: DieUpdate) => {
        set(state => ({
          dice: state.dice.map(d =>
            d.id === dieId ? { ...d, ...updates } : d
          )
        }))
      },

      renameDie: (dieId: string, name: string) => {
        get().updateDie(dieId, { name })
      },

      setDescription: (dieId: string, description: string) => {
        get().updateDie(dieId, { description })
      },

      toggleFavorite: (dieId: string) => {
        const die = get().dice.find(d => d.id === dieId)
        if (die) {
          get().updateDie(dieId, { isFavorite: !die.isFavorite })
        }
      },

      toggleLock: (dieId: string) => {
        const die = get().dice.find(d => d.id === dieId)
        if (die) {
          get().updateDie(dieId, { isLocked: !die.isLocked })
        }
      },

      recordRoll: (dieId: string, value: number) => {
        set(state => ({
          dice: state.dice.map(d => {
            if (d.id !== dieId) return d

            // Get max value for this die type
            const maxValue = getDieMax(d.type)

            const newStats: DieStats = {
              timesRolled: d.stats.timesRolled + 1,
              totalValue: d.stats.totalValue + value,
              critsRolled: d.stats.critsRolled + (value === maxValue ? 1 : 0),
              failsRolled: d.stats.failsRolled + (value === 1 ? 1 : 0),
              highestRoll: Math.max(d.stats.highestRoll || 0, value),
              lowestRoll: Math.min(d.stats.lowestRoll || Infinity, value)
            }

            return { ...d, stats: newStats }
          })
        }))
      },

      getDieStats: (dieId: string) => {
        const die = get().dice.find(d => d.id === dieId)
        return die?.stats
      },

      // ========================================================================
      // Assignment
      // ========================================================================

      assignDieToSlot: (
        savedRollId: string,
        entryId: string,
        slotIndex: number,
        dieId: string
      ) => {
        const key = getAssignmentKey(savedRollId, entryId, slotIndex)

        set(state => ({
          assignments: {
            ...state.assignments,
            [key]: dieId
          },
          dice: state.dice.map(d => {
            if (d.id === dieId && !d.assignedToRolls.includes(savedRollId)) {
              return {
                ...d,
                assignedToRolls: [...d.assignedToRolls, savedRollId]
              }
            }
            return d
          })
        }))
      },

      unassignDieFromSlot: (
        savedRollId: string,
        entryId: string,
        slotIndex: number
      ) => {
        const key = getAssignmentKey(savedRollId, entryId, slotIndex)
        const dieId = get().assignments[key]

        set(state => {
          const newAssignments = { ...state.assignments }
          delete newAssignments[key]

          // Check if die is still assigned to this roll in other slots
          const stillAssigned = Object.keys(newAssignments).some(
            k => k.startsWith(`${savedRollId}:`) && newAssignments[k] === dieId
          )

          return {
            assignments: newAssignments,
            dice: !stillAssigned && dieId
              ? state.dice.map(d =>
                  d.id === dieId
                    ? {
                        ...d,
                        assignedToRolls: d.assignedToRolls.filter(
                          id => id !== savedRollId
                        )
                      }
                    : d
                )
              : state.dice
          }
        })
      },

      getAssignedDie: (
        savedRollId: string,
        entryId: string,
        slotIndex: number
      ) => {
        const key = getAssignmentKey(savedRollId, entryId, slotIndex)
        const dieId = get().assignments[key]
        return dieId ? get().dice.find(d => d.id === dieId) : undefined
      },

      isDieAssigned: (dieId: string) => {
        return Object.values(get().assignments).includes(dieId)
      },

      getRollsUsingDie: (dieId: string) => {
        const die = get().dice.find(d => d.id === dieId)
        return die?.assignedToRolls || []
      },

      // ========================================================================
      // Filtering & Sorting
      // ========================================================================

      getDiceByType: (type: DiceShape) => {
        return get().dice.filter(d => d.type === type)
      },

      getDiceByRarity: (rarity: DieRarity) => {
        return get().dice.filter(d => d.rarity === rarity)
      },

      getDiceBySet: (setId: string) => {
        return get().dice.filter(d => d.setId === setId)
      },

      getUnassignedDice: (type?: DiceShape) => {
        const { dice, assignments } = get()
        const assignedIds = new Set(Object.values(assignments))

        return dice.filter(d => {
          const typeMatches = !type || d.type === type
          const notAssigned = !assignedIds.has(d.id)
          return typeMatches && notAssigned
        })
      },

      getFavoriteDice: () => {
        return get().dice.filter(d => d.isFavorite)
      },

      getDuplicates: (dieId: string) => {
        const die = get().dice.find(d => d.id === dieId)
        if (!die) return []

        return get().dice.filter(
          d =>
            d.id !== dieId &&
            d.setId === die.setId &&
            d.type === die.type &&
            d.rarity === die.rarity
        )
      },

      hasCompleteSet: (setId: string) => {
        const completion = get().getSetCompletion(setId)
        return completion.total > 0 && completion.owned === completion.total
      },

      getSetCompletion: (setId: string) => {
        const set = getDieSetById(setId)
        if (!set) {
          return { total: 0, owned: 0, missing: [] }
        }

        const ownedDice = get().getDiceBySet(setId)
        const dieTypes: DiceShape[] = ['d4', 'd6', 'd8', 'd10', 'd12', 'd20']
        const rarities = Object.keys(set.rarityVariants) as DieRarity[]

        const allPossible: Array<{ type: DiceShape; rarity: DieRarity }> = []
        const missing: Array<{ type: DiceShape; rarity: DieRarity }> = []

        // Build list of all possible dice in this set
        for (const type of dieTypes) {
          for (const rarity of rarities) {
            allPossible.push({ type, rarity })

            // Check if player owns at least one
            const hasThis = ownedDice.some(
              d => d.type === type && d.rarity === rarity
            )

            if (!hasThis) {
              missing.push({ type, rarity })
            }
          }
        }

        return {
          total: allPossible.length,
          owned: allPossible.length - missing.length,
          missing
        }
      },

      // ========================================================================
      // Crafting
      // ========================================================================

      canCraft: (recipe: CraftingRecipe, inputDiceIds: string[]) => {
        const state = get()

        // Check if we have the right number of inputs
        const totalRequired = recipe.inputs.reduce(
          (sum, input) => sum + input.count,
          0
        )
        if (inputDiceIds.length !== totalRequired) {
          return false
        }

        // Check if all dice exist and are valid
        const inputDice = inputDiceIds
          .map(id => state.dice.find(d => d.id === id))
          .filter((d): d is InventoryDie => d !== undefined)

        if (inputDice.length !== inputDiceIds.length) {
          return false
        }

        // Check if any dice are locked
        if (inputDice.some(d => d.isLocked)) {
          return false
        }

        // Check if dice match recipe requirements
        for (const input of recipe.inputs) {
          const matchingDice = inputDice.filter(
            d => d.type === input.type && d.rarity === input.rarity
          )

          if (matchingDice.length < input.count) {
            return false
          }

          // If setId is required to match, ensure enough dice are from the required set
          if (input.setId !== undefined) {
            const matchingSet = matchingDice.filter(d => d.setId === input.setId)
            if (matchingSet.length < input.count) {
              return false
            }
          }
        }

        // Check currency requirements
        if (recipe.coinCost && state.currency.coins < recipe.coinCost) {
          return false
        }

        // For "inherit" setId, all input dice must be from same set
        if (recipe.output.setId === 'inherit') {
          const sets = new Set(inputDice.map(d => d.setId))
          if (sets.size > 1) {
            return false
          }
        }

        return true
      },

      craft: (recipe: CraftingRecipe, inputDiceIds: string[]) => {
        const state = get()

        // Validate
        if (!get().canCraft(recipe, inputDiceIds)) {
          return {
            success: false,
            consumedDiceIds: [],
            error: 'Recipe requirements not met'
          }
        }

        const inputDice = inputDiceIds
          .map(id => state.dice.find(d => d.id === id))
          .filter((d): d is InventoryDie => d !== undefined)

        // Determine output setId
        const outputSetId =
          recipe.output.setId === 'inherit'
            ? inputDice[0].setId
            : recipe.output.setId

        // Get set configuration for output
        const dieSet = getDieSetById(outputSetId)
        const variant = dieSet?.rarityVariants[recipe.output.rarity]

        if (!variant) {
          return {
            success: false,
            consumedDiceIds: [],
            error: 'Invalid output configuration'
          }
        }

        // Spend currency
        if (recipe.coinCost) {
          set((state: InventoryStore) => ({
            currency: {
              ...state.currency,
              coins: state.currency.coins - (recipe.coinCost || 0)
            }
          }))
        }

        // Remove input dice
        set((state: InventoryStore) => ({
          dice: state.dice.filter((d: InventoryDie) => !inputDiceIds.includes(d.id))
        }))

        // Create new die
        const newDie = get().addDie({
          type: recipe.output.type,
          setId: outputSetId,
          rarity: recipe.output.rarity,
          appearance: variant.appearance,
          vfx: variant.vfx,
          name: `Crafted ${recipe.output.type.toUpperCase()}`,
          description: `Crafted using recipe: ${recipe.name}`,
          isFavorite: false,
          isLocked: false,
          source: 'crafting'
        })

        return {
          success: true,
          consumedDiceIds: inputDiceIds,
          createdDieId: newDie.id
        }
      },

      // ========================================================================
      // Economy
      // ========================================================================

      addCurrency: (type: keyof Currency, amount: number) => {
        set(state => ({
          currency: {
            ...state.currency,
            [type]: state.currency[type] + amount
          }
        }))
      },

      spendCurrency: (type: keyof Currency, amount: number) => {
        const current = get().currency[type]
        if (current < amount) {
          return false
        }

        set(state => ({
          currency: {
            ...state.currency,
            [type]: current - amount
          }
        }))

        return true
      },

      sellDie: (dieId: string) => {
        const die = get().dice.find(d => d.id === dieId)
        if (!die) return 0

        const value = getSellValue(die.rarity)

        // Remove die (will check if locked)
        const removed = get().removeDie(dieId)

        if (removed) {
          get().addCurrency('coins', value)
          return value
        }

        return 0
      },

      // ========================================================================
      // Initialization
      // ========================================================================

      initializeStarterDice: () => {
        const state = get()

        // Only initialize if player has no dice
        if (state.dice.length > 0) {
          console.log('[Inventory] Already has dice, skipping starter initialization')
          return
        }

        console.log('[Inventory] Initializing starter dice')

        STARTER_DICE.forEach(starterDie => {
          get().addDie(starterDie)
        })

        // Give some starting currency
        set(state => ({
          currency: {
            ...state.currency,
            coins: 500,
            standardTokens: 5
          }
        }))
      },

      reset: () => {
        set({
          dice: [],
          currency: {
            coins: 0,
            gems: 0,
            standardTokens: 0,
            premiumTokens: 0
          },
          assignments: {}
        })
      },

      // ======================================================================
      // Custom Dice Persistence
      // ======================================================================

      /**
       * Regenerate blob URLs for custom dice from IndexedDB
       * Call this on app initialization to restore custom dice after page reload
       */
      regenerateCustomDiceBlobUrls: async () => {
        const state = get()
        const customDice = state.dice.filter(die => die.customAsset)

        console.log(`[InventoryStore] Regenerating blob URLs for ${customDice.length} custom dice`)

        for (const die of customDice) {
          if (!die.customAsset) continue

          try {
            // Use assetId if available (new format), otherwise fall back to modelUrl (old format)
            const assetId = die.customAsset.assetId || die.customAsset.modelUrl
            console.log(`[InventoryStore] Loading asset for die "${die.name}" from IndexedDB key: ${assetId}`)

            // Create new blob URL from IndexedDB storage
            const newBlobUrl = await createBlobUrlFromStorage(assetId)

            if (newBlobUrl) {
              // Update die with fresh blob URL
              set(state => ({
                dice: state.dice.map(d =>
                  d.id === die.id
                    ? {
                        ...d,
                        customAsset: {
                          ...d.customAsset!,
                          modelUrl: newBlobUrl
                        }
                      }
                    : d
                )
              }))
              console.log(`[InventoryStore] Regenerated blob URL for die: ${die.id}`)
            } else {
              console.warn(`[InventoryStore] No stored model found for die: ${die.id}`)
            }
          } catch (error) {
            console.error(`[InventoryStore] Failed to regenerate blob URL for die ${die.id}:`, error)
          }
        }
      },

      /**
       * Get all dev/test dice
       */
      getDevDice: () => {
        return get().dice.filter(die => die.isDev === true)
      },

      /**
       * Remove all dev/test dice from inventory
       * Also cleans up IndexedDB storage for custom dice
       */
      removeAllDevDice: async () => {
        const state = get()
        const devDice = state.dice.filter(die => die.isDev === true)

        console.log(`[InventoryStore] Removing ${devDice.length} dev dice`)

        // Delete custom models from IndexedDB
        for (const die of devDice) {
          if (die.customAsset) {
            try {
              await deleteCustomDiceModel(die.id)
              console.log(`[InventoryStore] Deleted custom model for dev die: ${die.id}`)
            } catch (error) {
              console.error(`[InventoryStore] Failed to delete custom model for die ${die.id}:`, error)
            }
          }
        }

        // Remove from state
        set(state => ({
          dice: state.dice.filter(die => !die.isDev)
        }))

        console.log(`[InventoryStore] Removed all dev dice`)
      }
    }),

    // ========================================================================
    // Persistence Configuration
    // ========================================================================

    {
      name: 'dicesuki-player-inventory',
      storage: createJSONStorage(() => localStorage),

      // SCHEMA VERSION
      // Increment this when starter dice or inventory structure changes
      // This will trigger the migrate function below
      version: 2,

      // Migration function - runs when stored version doesn't match current version
      migrate: (persistedState, version) => {
        // Keep migration logs in production - they're useful for debugging user issues
        console.log(`[InventoryStore] Migrating from version ${version} to 2`)

        // Version 1 -> 2: Reset inventory to get new devil d6 starter dice
        if (version < 2) {
          console.log('[InventoryStore] v1->v2: Resetting inventory for devil d6 starter dice')
          // Return empty state - initializeStarterDice will populate fresh starter dice
          return {
            dice: [],
            currency: {
              coins: 0,
              gems: 0,
              standardTokens: 0,
              premiumTokens: 0
            },
            assignments: {}
          }
        }

        return persistedState as InventoryStore
      },

      // Partial persistence (only save essential data)
      partialize: state => ({
        dice: state.dice,
        currency: state.currency,
        assignments: state.assignments
      })
    }
  )
)
