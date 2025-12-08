/**
 * Starter Dice Configuration
 *
 * Defines the dice given to new players and tutorial rewards.
 */

import { NewInventoryDie } from '../types/inventory'
import { getDieSetById } from './dieSets'
import { DiceMetadata, DiceRarity } from '../types/customDice'

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Create a starter die from a production dice asset (custom GLB model)
 * Used for devil-set and other production dice
 */
function createProductionStarterDie(
  setId: string,
  diceId: string,
  name: string,
  metadata: DiceMetadata,
  rarity: DiceRarity = 'common'
): Omit<NewInventoryDie, 'id' | 'acquiredAt'> {
  const modelUrl = `/dice/${setId}/${diceId}/model.glb`

  return {
    type: metadata.diceType,
    setId,
    rarity,
    appearance: {
      baseColor: '#8b5cf6', // Purple for custom dice
      accentColor: '#ffffff',
      material: 'plastic',
      roughness: 0.7,
      metalness: 0.0,
    },
    vfx: {},
    name,
    description: metadata.description || `A ${metadata.name} from the ${setId} collection`,
    isFavorite: false,
    isLocked: true, // Starter dice are locked
    source: 'starter',
    customAsset: {
      modelUrl,
      assetId: `${setId}/${diceId}`,
      metadata,
    },
  }
}

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
// Production Dice Metadata
// ============================================================================

/**
 * Devil D6 metadata from public/dice/devil-set/devil-d6/metadata.json
 * Hardcoded here for starter dice (avoids async loading at startup)
 */
const DEVIL_D6_METADATA: DiceMetadata = {
  version: '1.0',
  diceType: 'd6',
  name: 'Devil D6',
  artist: 'Zabi',
  created: '2025-12-08',
  scale: 0.4,
  faceNormals: [
    { value: 1, normal: [0.19944679289912032, 0.3543332366985917, 0.9136021750045012] },
    { value: 2, normal: [0.8471490184729035, -0.5141427188065125, 0.13414844463743922] },
    { value: 3, normal: [-0.03203371138028793, -0.9994514461355557, 0.008405245549706689] },
    { value: 4, normal: [0.26567059240604196, 0.9640638341443597, -0.0002450010189993582] },
    { value: 5, normal: [-0.9864952371565209, -0.0021288041269176493, 0.16377611321706467] },
    { value: 6, normal: [-0.15573002002007064, -0.08028842700476305, -0.9845313247193558] },
  ],
  physics: {
    density: 0.2,
    restitution: 0.4,
    friction: 0.6,
  },
  colliderType: 'roundCuboid',
  colliderArgs: {
    halfExtents: [0.5, 0.5, 0.5],
    borderRadius: 0.08,
  },
  rarity: 'rare',
  description: 'A fiery die from the Devil Collection',
}

// ============================================================================
// Starter Dice (Given on Account Creation)
// ============================================================================

/**
 * Complete D&D set given to all new players
 * All dice are common rarity from the Adventurer's Starter set
 * EXCEPT: 6 d6's are now Devil d6's for testing custom dice
 *
 * Distribution: 6d4, 6d6 (Devil), 4d8, 2d10, 2d12, 1d20
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

  // 6 d6 - Devil D6's from production dice (custom GLB models)
  createProductionStarterDie('devil-set', 'devil-d6', 'Devil d6 #1', DEVIL_D6_METADATA, 'rare'),
  createProductionStarterDie('devil-set', 'devil-d6', 'Devil d6 #2', DEVIL_D6_METADATA, 'rare'),
  createProductionStarterDie('devil-set', 'devil-d6', 'Devil d6 #3', DEVIL_D6_METADATA, 'rare'),
  createProductionStarterDie('devil-set', 'devil-d6', 'Devil d6 #4', DEVIL_D6_METADATA, 'rare'),
  createProductionStarterDie('devil-set', 'devil-d6', 'Devil d6 #5', DEVIL_D6_METADATA, 'rare'),
  createProductionStarterDie('devil-set', 'devil-d6', 'Devil d6 #6', DEVIL_D6_METADATA, 'rare'),

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
