/** Starter, tutorial, and future reward instance templates. */

import {
  createInventoryDieFromCatalogItem,
  getCatalogItemByKey,
} from '../lib/collectibleCatalog'
import type {
  AcquisitionSource,
  DieRarity,
  NewInventoryDie,
} from '../types/inventory'
import type { DiceShape } from '../types/diceShape'

type InventoryDieTemplate = Omit<NewInventoryDie, 'id' | 'acquiredAt'>

function createCatalogDie(
  catalogKey: string,
  name: string,
  source: AcquisitionSource,
): InventoryDieTemplate {
  const item = getCatalogItemByKey(catalogKey)
  if (!item) throw new Error(`Catalog item ${catalogKey} not found`)
  return createInventoryDieFromCatalogItem(item.id, { name, source, isLocked: true })
}

function createConfiguredDie(
  type: DiceShape,
  setId: string,
  rarity: DieRarity,
  name: string,
  source: AcquisitionSource,
): InventoryDieTemplate {
  return createCatalogDie(`${setId}/${type}/${rarity}`, name, source)
}

/**
 * There is deliberately NO `STARTER_DICE` here any more.
 *
 * Every new player used to be seeded 23 local `source: 'starter'` instances
 * (adventurer-starter, six devil d6s, the materials-lab d20s). The default
 * inventory is now EMPTY: basic dice (`src/lib/basicDice.ts`) are the infinite
 * floor, so no seeding is needed for the game to be playable, and dice arrive
 * only through entitlements, pulls and rewards.
 *
 * The server-side `ensure_starter_entitlements` allowlist is unchanged and still
 * owns its 8 catalog items — existing accounts keep every row they were granted.
 * `src/config/starterDice.test.ts` guards both halves of that split.
 */

export const TUTORIAL_REWARDS: InventoryDieTemplate[] = [
  createConfiguredDie('d20', 'lucky-bronze', 'uncommon', 'Lucky Bronze d20', 'tutorial'),
  createConfiguredDie('d6', 'lucky-bronze', 'uncommon', 'Lucky Bronze d6', 'tutorial'),
]

export const DAILY_REWARD_POOL: InventoryDieTemplate[] = [
  createConfiguredDie('d6', 'adventurer-starter', 'common', 'Daily d6', 'daily'),
  createConfiguredDie('d20', 'adventurer-starter', 'common', 'Daily d20', 'daily'),
  createConfiguredDie('d6', 'lucky-bronze', 'uncommon', 'Bronze Reward d6', 'daily'),
  createConfiguredDie('d20', 'lucky-bronze', 'uncommon', 'Bronze Reward d20', 'daily'),
  createConfiguredDie('d20', 'dragon-jade', 'rare', 'Jade Gift d20', 'daily'),
]

export const FIRST_PURCHASE_BONUS: InventoryDieTemplate[] = [
  createConfiguredDie('d20', 'dragon-jade', 'rare', 'First Purchase d20', 'shop'),
  createConfiguredDie('d6', 'dragon-jade', 'rare', 'First Purchase d6', 'shop'),
]
