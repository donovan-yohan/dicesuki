/**
 * Starter Dice Configuration
 *
 * Defines the dice given to new players and tutorial rewards.
 */

import { NewInventoryDie } from '../types/inventory'
import { getDieSetById } from './dieSets'

// ============================================================================
// Helper Function
// ============================================================================

/**
 * Create a starter die configuration from a set
 */
function createStarterDie(
  type: NewInventoryDie['type'],
  setId: string,
  rarity: NewInventoryDie['rarity'],
  name: string,
  source: NewInventoryDie['source']
): Omit<NewInventoryDie, 'id' | 'acquiredAt'> {
  // Get the set configuration dynamically
  const setConfig = getDieSetById(setId)

  if (!setConfig) {
    throw new Error(`Set ${setId} not found`)
  }

  const variant = setConfig.rarityVariants[rarity]

  if (!variant) {
    throw new Error(`Rarity ${rarity} not found in set ${setId}`)
  }

  return {
    type,
    setId,
    rarity,
    appearance: variant.appearance,
    vfx: variant.vfx,
    name,
    description: undefined,
    isFavorite: false,
    isLocked: true,  // Starter dice are locked - can't be deleted/crafted
    source
  }
}

// ============================================================================
// Starter Dice (Given on Account Creation)
// ============================================================================

/**
 * Complete D&D set given to all new players
 * All dice are common rarity from the Adventurer's Starter set
 *
 * Distribution: 6d4, 6d6, 4d8, 2d10, 2d12, 1d20
 */
export const STARTER_DICE: Array<Omit<NewInventoryDie, 'id' | 'acquiredAt'>> = [
  // 1 d20
  createStarterDie('d20', 'adventurer-starter', 'common', 'Starter d20', 'starter'),

  // 2 d12
  createStarterDie('d12', 'adventurer-starter', 'common', 'Starter d12 #1', 'starter'),
  createStarterDie('d12', 'adventurer-starter', 'common', 'Starter d12 #2', 'starter'),

  // 2 d10
  createStarterDie('d10', 'adventurer-starter', 'common', 'Starter d10 #1', 'starter'),
  createStarterDie('d10', 'adventurer-starter', 'common', 'Starter d10 #2', 'starter'),

  // 4 d8
  createStarterDie('d8', 'adventurer-starter', 'common', 'Starter d8 #1', 'starter'),
  createStarterDie('d8', 'adventurer-starter', 'common', 'Starter d8 #2', 'starter'),
  createStarterDie('d8', 'adventurer-starter', 'common', 'Starter d8 #3', 'starter'),
  createStarterDie('d8', 'adventurer-starter', 'common', 'Starter d8 #4', 'starter'),

  // 6 d6
  createStarterDie('d6', 'adventurer-starter', 'common', 'Starter d6 #1', 'starter'),
  createStarterDie('d6', 'adventurer-starter', 'common', 'Starter d6 #2', 'starter'),
  createStarterDie('d6', 'adventurer-starter', 'common', 'Starter d6 #3', 'starter'),
  createStarterDie('d6', 'adventurer-starter', 'common', 'Starter d6 #4', 'starter'),
  createStarterDie('d6', 'adventurer-starter', 'common', 'Starter d6 #5', 'starter'),
  createStarterDie('d6', 'adventurer-starter', 'common', 'Starter d6 #6', 'starter'),

  // 6 d4
  createStarterDie('d4', 'adventurer-starter', 'common', 'Starter d4 #1', 'starter'),
  createStarterDie('d4', 'adventurer-starter', 'common', 'Starter d4 #2', 'starter'),
  createStarterDie('d4', 'adventurer-starter', 'common', 'Starter d4 #3', 'starter'),
  createStarterDie('d4', 'adventurer-starter', 'common', 'Starter d4 #4', 'starter'),
  createStarterDie('d4', 'adventurer-starter', 'common', 'Starter d4 #5', 'starter'),
  createStarterDie('d4', 'adventurer-starter', 'common', 'Starter d4 #6', 'starter')
]

// ============================================================================
// Tutorial Rewards (Earned During First-Time Experience)
// ============================================================================

/**
 * Dice earned through tutorial progression
 * These are slightly better than starter dice to encourage engagement
 */
export const TUTORIAL_REWARDS: Array<Omit<NewInventoryDie, 'id' | 'acquiredAt'>> = [
  // Reward for completing first roll tutorial
  createStarterDie('d20', 'lucky-bronze', 'uncommon', 'Lucky Bronze d20', 'tutorial'),

  // Reward for completing saved roll tutorial (future)
  createStarterDie('d6', 'lucky-bronze', 'uncommon', 'Lucky Bronze d6', 'tutorial')
]

// ============================================================================
// Daily Login Rewards (Future)
// ============================================================================

/**
 * Pool of dice that can be given as daily login rewards
 * These rotate and provide variety
 */
export const DAILY_REWARD_POOL: Array<Omit<NewInventoryDie, 'id' | 'acquiredAt'>> = [
  // Common tier (80% chance)
  createStarterDie('d6', 'adventurer-starter', 'common', 'Daily d6', 'daily'),
  createStarterDie('d20', 'adventurer-starter', 'common', 'Daily d20', 'daily'),

  // Uncommon tier (15% chance)
  createStarterDie('d6', 'lucky-bronze', 'uncommon', 'Bronze Reward d6', 'daily'),
  createStarterDie('d20', 'lucky-bronze', 'uncommon', 'Bronze Reward d20', 'daily'),

  // Rare tier (5% chance)
  createStarterDie('d20', 'dragon-jade', 'rare', 'Jade Gift d20', 'daily')
]

// ============================================================================
// First Purchase Bonus (Future)
// ============================================================================

/**
 * Bonus dice given when player makes first real-money purchase
 */
export const FIRST_PURCHASE_BONUS: Array<Omit<NewInventoryDie, 'id' | 'acquiredAt'>> = [
  createStarterDie('d20', 'dragon-jade', 'rare', 'First Purchase d20', 'shop'),
  createStarterDie('d6', 'dragon-jade', 'rare', 'First Purchase d6', 'shop')
]
