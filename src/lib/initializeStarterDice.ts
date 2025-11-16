/**
 * Utility to initialize player inventory with starter dice
 * Used for testing and new player onboarding
 */

import { useInventoryStore } from '../store/useInventoryStore'
import { STARTER_DICE } from '../config/starterDice'

/**
 * Initialize the inventory with starter dice if empty
 * Safe to call multiple times - won't duplicate dice
 */
export function initializeStarterDice() {
  const { dice, addDie } = useInventoryStore.getState()

  // Only initialize if inventory is empty
  if (dice.length > 0) {
    console.log('Inventory already has dice, skipping starter dice initialization')
    return
  }

  console.log('Initializing inventory with starter dice...')

  // Add each starter die to inventory
  STARTER_DICE.forEach(starterDie => {
    addDie(starterDie)
    console.log(`Added starter die: ${starterDie.name} (${starterDie.type})`)
  })

  console.log(`✅ Inventory initialized with ${STARTER_DICE.length} starter dice`)
}

/**
 * Force reset inventory with starter dice (clears existing dice)
 * Use with caution - this will delete all existing dice!
 */
export function resetToStarterDice() {
  const { reset, addDie } = useInventoryStore.getState()

  console.warn('🔥 Resetting inventory to starter dice (clearing all existing dice)')

  // Use reset() to clear ALL dice (including locked ones)
  // This prevents duplicate starter dice on subsequent calls
  reset()

  // Add starter dice
  STARTER_DICE.forEach(starterDie => {
    addDie(starterDie)
  })

  console.log(`✅ Inventory reset with ${STARTER_DICE.length} starter dice`)
}
