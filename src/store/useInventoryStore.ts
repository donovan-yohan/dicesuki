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
import { INVENTORY_DICE_SHAPES } from '../types/diceShape'
import { getDieMax } from '../lib/diceHelpers'
import { getDieSetById } from '../config/dieSets'
import { createBlobUrlFromStorage, deleteCustomDiceModel } from '../lib/customDiceDB'
import { pruneSavedRollsForRemovedDice } from '../lib/savedRollDieCleanup'
import {
  mapInventoryDieToCatalogRef,
} from '../lib/collectibleCatalog'
import type { CollectibleCatalog } from '../types/catalog'
import type {
  DiceCopiesByCatalogItem,
  DiceCopySourceKind,
} from '../lib/diceCopies'
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
  /** Guest/local inventory retained while the authenticated server view is active. */
  localDice: InventoryDie[]
  localAssignments: Record<string, string>
  serverCopiesActive: boolean
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
  //
  // There is deliberately no seeding action here. An empty inventory is the
  // DEFAULT and a fully playable state: every player has an unlimited supply of
  // basic dice (`src/lib/basicDice.ts`), so nothing has to be granted for the
  // game to work. Dice arrive from entitlements, pulls and rewards only.
  // ============================================================================

  reset: () => void

  // ============================================================================
  // Custom Dice Persistence (IndexedDB)
  // ============================================================================

  regenerateCustomDiceBlobUrls: () => Promise<void>
  customDiceLoadErrors: string[]
  getDevDice: () => InventoryDie[]
  removeAllDevDice: () => Promise<void>

  // ============================================================================
  // Authenticated server inventory
  // ============================================================================

  syncServerCopies: (
    copies: DiceCopiesByCatalogItem,
    catalog?: CollectibleCatalog | null,
  ) => boolean
  clearServerCopies: () => void
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
  const die: InventoryDie = {
    ...newDie,
    id: newDie.id || generateDieId(),
    acquiredAt: newDie.acquiredAt || Date.now(),
    stats: { ...getDefaultStats(), ...newDie.stats },
    assignedToRolls: newDie.assignedToRolls || []
  }
  const catalogRef = mapInventoryDieToCatalogRef(die)
  return catalogRef ? { ...die, catalogRef } : die
}

function emptyPersistedInventory() {
  return {
    dice: [] as InventoryDie[],
    localDice: [] as InventoryDie[],
    localAssignments: {} as Record<string, string>,
    serverCopiesActive: false,
    currency: {
      coins: 0,
      gems: 0,
      standardTokens: 0,
      premiumTokens: 0,
    },
    assignments: {} as Record<string, string>,
  }
}

export interface VisibleInventoryState {
  readonly dice: readonly InventoryDie[]
  readonly assignments: Readonly<Record<string, string>>
  readonly serverCopiesActive: boolean
}

/**
 * Canonical local projection for sync, refresh, sign-out, and persistence.
 * Authenticated copy rows are ephemeral; every other visible row remains part
 * of the retained local-first inventory.
 */
export function selectRetainedLocalInventory(
  state: VisibleInventoryState,
): {
  dice: InventoryDie[]
  assignments: Record<string, string>
} {
  if (!state.serverCopiesActive) {
    return {
      dice: [...state.dice],
      assignments: { ...state.assignments },
    }
  }
  const serverIds = new Set(
    state.dice
      .filter(die => Boolean(die.serverCopyMetadata))
      .map(die => die.id),
  )
  return {
    dice: state.dice.filter(die => !die.serverCopyMetadata),
    assignments: Object.fromEntries(
      Object.entries(state.assignments).filter(
        ([, dieId]) => !serverIds.has(dieId),
      ),
    ),
  }
}

function acquisitionSource(source: DiceCopySourceKind): InventoryDie['source'] {
  switch (source) {
    case 'pull':
      return 'gacha_standard'
    case 'craft':
      return 'crafting'
    case 'purchase':
      return 'shop'
    case 'reward':
      return 'achievement'
  }
}

/**
 * Join live immutable copy identities to the fetched catalog definitions. The
 * result exactly matches the long-standing InventoryDie consumer contract used
 * by the room backend and dicePresentation.
 */
export function mapServerCopiesToInventoryDice(
  copies: DiceCopiesByCatalogItem,
  catalog: CollectibleCatalog,
): InventoryDie[] | null {
  const itemById = new Map(catalog.items.map(item => [item.id, item]))
  const assetById = new Map(catalog.assetVersions.map(asset => [asset.id, asset]))
  const result: InventoryDie[] = []

  for (const group of Object.values(copies)) {
    if (group.liveCount !== group.copies.length) return null
    const item = itemById.get(group.catalogItemId)
    if (!item) {
      if (group.liveCount > 0) return null
      continue
    }
    const asset = assetById.get(item.assetVersionId)
    if (!asset || asset.catalogItemId !== item.id) {
      if (group.liveCount > 0) return null
      continue
    }

    for (const copy of group.copies) {
      const die: InventoryDie = {
        id: copy.id,
        type: item.diceType,
        setId: item.setId,
        rarity: item.rarity,
        appearance: asset.metadata.appearance,
        vfx: asset.metadata.vfx,
        name: asset.metadata.name,
        description: asset.metadata.description,
        isFavorite: false,
        // Server copy mutation is RPC-owned; local delete/craft must not imply it.
        isLocked: true,
        acquiredAt: Date.parse(copy.acquiredAt),
        source: acquisitionSource(copy.sourceKind),
        catalogRef: {
          itemId: item.id,
          assetVersionId: asset.id,
        },
        serverCopyMetadata: {
          isFirstCopy: copy.isFirstCopy,
        },
        stats: getDefaultStats(),
        assignedToRolls: [],
      }
      if (asset.assetKind === 'gltf') {
        die.customAsset = {
          modelUrl: asset.modelPath,
          thumbnailUrl: asset.metadata.delivery?.thumbnailPath,
          assetId: item.catalogKey,
          storage: 'bundled',
          metadata: asset.metadata.diceMetadata,
        }
      }
      result.push(die)
    }
  }
  return result.sort((a, b) => a.acquiredAt - b.acquiredAt || a.id.localeCompare(b.id))
}

function isLegacyBundledDevilAsset(die: InventoryDie): boolean {
  return die.setId === 'devil-set' &&
    !die.isDev &&
    (die.customAsset?.assetId === 'devil-set/devil-d6' ||
      die.customAsset?.modelUrl === '/dice/devil-set/devil-d6/model.glb')
}

function asAssignments(value: unknown): Record<string, string> {
  return value && typeof value === 'object'
    ? { ...(value as Record<string, string>) }
    : {}
}

/**
 * v4 -> v5 retires the seeded local starter inventory.
 *
 * Every player used to get 23 `source: 'starter'` instances on first load
 * (adventurer-starter, devil d6s, materials-lab d20s). Basic dice
 * (`src/lib/basicDice.ts`) are the floor now, so the default inventory is empty
 * and those rows are removed — including from existing sessions, which is the
 * whole point of the bump: a returning player must not keep a private stash the
 * game no longer grants.
 *
 * Only `source: 'starter'` rows go. Purchased, pulled, rewarded, crafted and
 * custom-uploaded dice are untouched, and assignments naming a dropped die are
 * pruned so no roll slot points at a row that no longer exists.
 *
 * The server side is deliberately NOT touched: `ensure_starter_entitlements`
 * still owns the same 8-item allowlist and existing `dice_copies` rows stay
 * valid (they are harmless, and revoking granted property is not this slice's
 * business). See `src/config/starterDice.test.ts` for the guard that keeps those
 * two halves honest.
 */
function dropSeededStarterDice(state: Record<string, unknown>): {
  state: Record<string, unknown>
  removedDieIds: string[]
} {
  const collect = (value: unknown): InventoryDie[] => (
    Array.isArray(value) ? value as InventoryDie[] : []
  )
  const isSeededStarter = (die: InventoryDie) => die?.source === 'starter'

  const removedDieIds = Array.from(new Set(
    [...collect(state.dice), ...collect(state.localDice)]
      .filter(isSeededStarter)
      .map(die => die.id)
      .filter((id): id is string => typeof id === 'string'),
  ))

  if (removedDieIds.length === 0) {
    return { state, removedDieIds }
  }

  const removed = new Set(removedDieIds)
  const pruneAssignments = (value: unknown) => Object.fromEntries(
    Object.entries(asAssignments(value)).filter(([, dieId]) => !removed.has(dieId)),
  )

  return {
    state: {
      ...state,
      dice: collect(state.dice).filter(die => !isSeededStarter(die)),
      localDice: collect(state.localDice).filter(die => !isSeededStarter(die)),
      assignments: pruneAssignments(state.assignments),
      localAssignments: pruneAssignments(state.localAssignments),
    },
    removedDieIds,
  }
}

/**
 * v2 -> v3 adds best-effort catalog definition refs without replacing any
 * client-local instance. It also marks the one known production GLTF as a
 * bundled asset so legacy sessions never try to load it from IndexedDB. IDs,
 * order, assignments, stats and duplicate copies are otherwise preserved.
 *
 * v3 -> v4 establishes a separate persisted guest/local inventory. The live
 * server-copy view is deliberately ephemeral and is rebuilt after sign-in.
 *
 * v4 -> v5 removes the seeded starter dice — see {@link dropSeededStarterDice}.
 *
 * Returns the dropped die ids alongside the state so the caller can repair
 * saved rolls that pinned one of them; the migration itself stays pure.
 */
export function migratePersistedInventory(
  persistedState: unknown,
  version: number,
): { state: unknown; removedStarterDieIds: string[] } {
  if (!persistedState || typeof persistedState !== 'object') {
    return { state: emptyPersistedInventory(), removedStarterDieIds: [] }
  }
  const state = persistedState as Record<string, unknown>
  if (!Array.isArray(state.dice)) return { state: persistedState, removedStarterDieIds: [] }
  const dice = (version >= 3 ? state.dice : state.dice.map(value => {
    if (!value || typeof value !== 'object') return value
    const die = value as InventoryDie
    const migratedDie = isLegacyBundledDevilAsset(die) && die.customAsset
      ? { ...die, customAsset: { ...die.customAsset, storage: 'bundled' as const } }
      : die
    const catalogRef = mapInventoryDieToCatalogRef(migratedDie)
    return catalogRef ? { ...migratedDie, catalogRef } : migratedDie
  })) as InventoryDie[]

  const throughV4 = version >= 4 ? state : {
    ...state,
    dice,
    localDice: [...dice],
    localAssignments: asAssignments(state.assignments),
    serverCopiesActive: false,
  }

  const { state: withoutStarters, removedDieIds } = dropSeededStarterDice(throughV4)
  return { state: withoutStarters, removedStarterDieIds: removedDieIds }
}

/** Pure state-only view of {@link migratePersistedInventory}. */
export function migratePersistedInventoryState(
  persistedState: unknown,
  version: number,
): unknown {
  return migratePersistedInventory(persistedState, version).state
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
      localDice: [],
      localAssignments: {},
      serverCopiesActive: false,
      currency: {
        coins: 0,
        gems: 0,
        standardTokens: 0,
        premiumTokens: 0
      },
      assignments: {},
      customDiceLoadErrors: [],

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

        // Remove die and all of its assignments in a single set() call
        set(state => {
          const newAssignments = Object.fromEntries(
            Object.entries(state.assignments).filter(([, assignedDieId]) => assignedDieId !== dieId)
          )
          return {
            dice: state.dice.filter(d => d.id !== dieId),
            assignments: newAssignments
          }
        })

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

            return {
              ...d,
              stats: newStats,
              lastRolledAt: Date.now(),
              recentRollValues: [value, ...(d.recentRollValues || [])].slice(0, 20)
            }
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
        const dieTypes = INVENTORY_DICE_SHAPES
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

      reset: () => {
        set({
          dice: [],
          localDice: [],
          localAssignments: {},
          serverCopiesActive: false,
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
        set({ customDiceLoadErrors: [] })

        const state = get()
        const customDice = state.dice.filter(
          die => die.customAsset && die.customAsset.storage !== 'bundled',
        )

        console.log(`[InventoryStore] Regenerating blob URLs for ${customDice.length} custom dice`)

        const failedDiceIds: string[] = []

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
              failedDiceIds.push(die.id)
            }
          } catch (error) {
            console.error(`[InventoryStore] Failed to regenerate blob URL for die ${die.id}:`, error)
            failedDiceIds.push(die.id)
          }
        }

        if (failedDiceIds.length > 0) {
          set({ customDiceLoadErrors: failedDiceIds })
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
      },

      // ======================================================================
      // Authenticated server inventory
      // ======================================================================

      syncServerCopies: (copies, catalog) => {
        if (!catalog) return false
        const serverDice = mapServerCopiesToInventoryDice(copies, catalog)
        if (!serverDice) return false
        const retained = selectRetainedLocalInventory(get())
        const playableLocalDice = retained.dice
        const localIds = new Set(playableLocalDice.map(die => die.id))
        if (serverDice.some(die => localIds.has(die.id))) return false

        set({
          // Signed-in play keeps the local-first baseline and overlays the
          // authoritative copy rows. An empty result is simply an empty
          // inventory now — basic dice are the playable floor, so there is no
          // starter baseline to fall back to. Refresh always derives local state
          // from current visible non-server rows.
          localDice: playableLocalDice,
          localAssignments: retained.assignments,
          dice: [...playableLocalDice, ...serverDice],
          serverCopiesActive: true,
          assignments: retained.assignments,
        })
        return true
      },

      clearServerCopies: () => {
        const state = get()
        if (!state.serverCopiesActive) return

        const retained = selectRetainedLocalInventory(state)
        // Signing out leaves exactly the local rows, which may be none: an empty
        // inventory is valid and still fully playable via basic dice.
        const playableLocalDice = retained.dice
        set({
          dice: playableLocalDice,
          localDice: playableLocalDice,
          assignments: retained.assignments,
          localAssignments: retained.assignments,
          serverCopiesActive: false,
        })
      },
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
      version: 5,

      // Migration function - runs when stored version doesn't match current version
      migrate: (persistedState, version) => {
        // Keep migration logs in production - they're useful for debugging user issues
        console.log(`[InventoryStore] Migrating from version ${version} to 5`)
        const { state, removedStarterDieIds } = migratePersistedInventory(persistedState, version)
        if (removedStarterDieIds.length > 0) {
          console.log(`[InventoryStore] Removed ${removedStarterDieIds.length} seeded starter dice`)
          // Saved rolls that pinned one of those dice would otherwise keep a
          // dangling id forever; rewrite them to plain (basic) dice here, while
          // the exact removed ids are still known.
          pruneSavedRollsForRemovedDice(removedStarterDieIds)
        }
        return state as InventoryStore
      },

      // Partial persistence (only save essential data)
      partialize: state => {
        // Frontend-ADR-002: server truth is never persisted. While signed in,
        // derive the retained local view from current visible rows so edits made
        // during an authenticated overlay are not lost.
        const retained = selectRetainedLocalInventory(state)
        return {
          dice: retained.dice,
          localDice: retained.dice,
          assignments: retained.assignments,
          localAssignments: retained.assignments,
          serverCopiesActive: false,
          currency: state.currency,
        }
      }
    }
  )
)
