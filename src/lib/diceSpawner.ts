/**
 * Centralized Dice Spawning Logic
 *
 * This module provides a unified interface for spawning dice from inventory,
 * ensuring consistency across all UI components (DiceToolbar, InventoryPanel, etc.)
 *
 * ## Architecture
 *
 * All dice spawning flows through this module to ensure:
 * 1. Consistent inventory validation (checking ownership and availability)
 * 2. Proper linking between dice instances and inventory dice
 * 3. Correct handling of dev dice vs starter dice
 * 4. Unified error handling and logging
 *
 * ## Usage Patterns
 *
 * ### From DiceToolbar (spawn first available)
 * ```ts
 * import { spawnDiceFromToolbar } from '../lib/diceSpawner'
 *
 * const handleClick = () => {
 *   const result = spawnDiceFromToolbar('d6', themeId)
 *   if (!result.success) {
 *     console.warn(result.error)
 *   }
 * }
 * ```
 *
 * ### From InventoryPanel (spawn specific die)
 * ```ts
 * import { spawnSpecificDie } from '../lib/diceSpawner'
 *
 * const handleSpawn = (die: InventoryDie) => {
 *   const result = spawnSpecificDie(die.id, die.type, themeId)
 *   if (!result.success) {
 *     console.warn(result.error)
 *   }
 * }
 * ```
 *
 * ### From SavedRollsPanel (spawn with roll group)
 * ```ts
 * import { spawnDiceForRollGroup } from '../lib/diceSpawner'
 *
 * roll.dice.forEach(entry => {
 *   for (let i = 0; i < entry.quantity; i++) {
 *     const result = spawnDiceForRollGroup(
 *       entry.type,
 *       themeId,
 *       rollGroupId,
 *       rollName
 *     )
 *   }
 * })
 * ```
 *
 * ## Design Decisions
 *
 * - **Single Source of Truth**: All spawning logic centralized here
 * - **Inventory-First**: Always validates against inventory before spawning
 * - **Explicit Intent**: Separate functions for toolbar vs specific die spawning
 * - **Error Handling**: Returns SpawnResult with success status and error messages
 * - **Logging**: Comprehensive console logging for debugging
 */

import { DiceShape } from './geometries'
import { useInventoryStore } from '../store/useInventoryStore'
import { useDiceManagerStore } from '../store/useDiceManagerStore'
import { useDiceStore } from '../store/useDiceStore'

export interface SpawnDiceOptions {
  /**
   * Type of die to spawn (d4, d6, d8, etc.)
   */
  type: DiceShape

  /**
   * Optional: Specific inventory die ID to spawn
   * If provided, will spawn this exact die from inventory
   * If not provided, will find first available die of the specified type
   */
  inventoryDieId?: string

  /**
   * Optional: Roll group ID for saved roll spawning
   */
  rollGroupId?: string

  /**
   * Optional: Roll group name for saved roll spawning
   */
  rollGroupName?: string

  /**
   * Current theme ID for color assignment
   */
  themeId: string

  /**
   * Whether to clear existing dice before spawning (default: false)
   */
  clearExisting?: boolean
}

export interface SpawnResult {
  success: boolean
  diceInstanceId?: string
  inventoryDieId?: string
  error?: string
}

/**
 * Spawn a die to the table from inventory
 *
 * This is the single source of truth for dice spawning logic.
 * All UI components should use this function to ensure consistency.
 *
 * @param options Spawn configuration options
 * @returns Spawn result with success status and spawned dice info
 */
export function spawnDiceFromInventory(options: SpawnDiceOptions): SpawnResult {
  const {
    type,
    inventoryDieId,
    rollGroupId,
    rollGroupName,
    themeId,
    clearExisting = false
  } = options

  // Get store instances
  const inventoryStore = useInventoryStore.getState()
  const diceManagerStore = useDiceManagerStore.getState()
  const diceStore = useDiceStore.getState()

  // Get dice currently in use
  const inUseDiceIds = diceManagerStore.getInUseDiceIds()

  let selectedInventoryDie

  if (inventoryDieId) {
    // Spawning a specific die (from inventory panel detail view)
    selectedInventoryDie = inventoryStore.dice.find(d => d.id === inventoryDieId)

    if (!selectedInventoryDie) {
      console.warn(`[DiceSpawner] Specific die ${inventoryDieId} not found in inventory`)
      return {
        success: false,
        error: `Die not found in inventory`
      }
    }

    if (inUseDiceIds.includes(selectedInventoryDie.id)) {
      console.warn(`[DiceSpawner] Die "${selectedInventoryDie.name}" is already in use`)
      return {
        success: false,
        error: `"${selectedInventoryDie.name}" is already on the table`
      }
    }

    console.log(`[DiceSpawner] Spawning SPECIFIC die: ${selectedInventoryDie.name}`)
  } else {
    // Spawning from toolbar - find first available die of this type
    const inventoryDice = inventoryStore.getDiceByType(type)

    if (inventoryDice.length === 0) {
      console.warn(`[DiceSpawner] No dice of type ${type} found in inventory`)
      return {
        success: false,
        error: `No ${type.toUpperCase()} dice in inventory`
      }
    }

    // Find first available die (owned but not in use)
    selectedInventoryDie = inventoryDice.find(die => !inUseDiceIds.includes(die.id))

    if (!selectedInventoryDie) {
      const ownedCount = inventoryDice.length
      const inUseCount = inUseDiceIds.filter(id => inventoryDice.some(d => d.id === id)).length
      console.warn(`[DiceSpawner] All ${type} dice are already in use (${ownedCount} owned, ${inUseCount} in use)`)
      return {
        success: false,
        error: `All ${type.toUpperCase()} dice are in use`
      }
    }

    console.log(`[DiceSpawner] Spawning first available die: ${selectedInventoryDie.name}`)
  }

  // Clear existing dice if requested
  if (clearExisting) {
    diceManagerStore.removeAllDice()
    diceStore.clearActiveSavedRoll()
    diceStore.clearAllGroups()
  }

  // Log spawning details
  console.log(`[DiceSpawner] Spawning die:`)
  console.log(`  - ID: ${selectedInventoryDie.id}`)
  console.log(`  - Name: ${selectedInventoryDie.name}`)
  console.log(`  - Type: ${selectedInventoryDie.type}`)
  console.log(`  - Base Color: ${selectedInventoryDie.appearance.baseColor}`)
  console.log(`  - Set ID: ${selectedInventoryDie.setId}`)
  console.log(`  - Is Dev: ${selectedInventoryDie.isDev}`)
  console.log(`  - Roll Group: ${rollGroupId || 'none'}`)

  // Spawn the die
  const diceInstanceId = diceManagerStore.addDice(
    type,
    themeId,
    undefined, // auto-generate dice instance ID
    rollGroupId,
    rollGroupName,
    selectedInventoryDie.id // link to inventory die
  )

  return {
    success: true,
    diceInstanceId,
    inventoryDieId: selectedInventoryDie.id
  }
}

/**
 * Spawn a die from the DiceToolbar
 * Clears saved rolls and grouped dice before spawning
 */
export function spawnDiceFromToolbar(type: DiceShape, themeId: string): SpawnResult {
  // Clear saved rolls and grouped dice
  const diceStore = useDiceStore.getState()
  diceStore.clearActiveSavedRoll()
  diceStore.clearAllGroups()

  // Remove all grouped dice
  const diceManagerStore = useDiceManagerStore.getState()
  const groupedDice = diceManagerStore.dice.filter(d => d.rollGroupId)
  groupedDice.forEach(d => diceManagerStore.removeDice(d.id))

  // Spawn first available die of this type
  return spawnDiceFromInventory({
    type,
    themeId,
    clearExisting: false
  })
}

/**
 * Spawn a specific die from the InventoryPanel
 * Does NOT clear existing dice or saved rolls
 */
export function spawnSpecificDie(
  inventoryDieId: string,
  type: DiceShape,
  themeId: string
): SpawnResult {
  return spawnDiceFromInventory({
    type,
    inventoryDieId,
    themeId,
    clearExisting: false
  })
}

/**
 * Spawn dice for a saved roll with roll group tracking
 * Used by SavedRollsPanel
 */
export function spawnDiceForRollGroup(
  type: DiceShape,
  themeId: string,
  rollGroupId: string,
  rollGroupName: string
): SpawnResult {
  return spawnDiceFromInventory({
    type,
    themeId,
    rollGroupId,
    rollGroupName,
    clearExisting: false
  })
}
