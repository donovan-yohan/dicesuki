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
 * Complete D&D set given locally to every new player. These are playable
 * without auth/network; the catalog refs describe them but do not prove
 * server-side ownership.
 */
export const STARTER_DICE: InventoryDieTemplate[] = [
  createCatalogDie('materials-lab/steel-d20', 'Steel d20', 'starter'),
  createCatalogDie('materials-lab/rubber-d20', 'Rubber d20', 'starter'),

  createConfiguredDie('d20', 'adventurer-starter', 'common', 'Starter d20', 'starter'),

  createConfiguredDie('d12', 'adventurer-starter', 'common', 'Starter d12 #1', 'starter'),
  createConfiguredDie('d12', 'adventurer-starter', 'common', 'Starter d12 #2', 'starter'),

  createConfiguredDie('d10', 'adventurer-starter', 'common', 'Starter d10 #1', 'starter'),
  createConfiguredDie('d10', 'adventurer-starter', 'common', 'Starter d10 #2', 'starter'),

  createConfiguredDie('d8', 'adventurer-starter', 'common', 'Starter d8 #1', 'starter'),
  createConfiguredDie('d8', 'adventurer-starter', 'common', 'Starter d8 #2', 'starter'),
  createConfiguredDie('d8', 'adventurer-starter', 'common', 'Starter d8 #3', 'starter'),
  createConfiguredDie('d8', 'adventurer-starter', 'common', 'Starter d8 #4', 'starter'),

  createCatalogDie('devil-set/devil-d6', 'Devil d6 #1', 'starter'),
  createCatalogDie('devil-set/devil-d6', 'Devil d6 #2', 'starter'),
  createCatalogDie('devil-set/devil-d6', 'Devil d6 #3', 'starter'),
  createCatalogDie('devil-set/devil-d6', 'Devil d6 #4', 'starter'),
  createCatalogDie('devil-set/devil-d6', 'Devil d6 #5', 'starter'),
  createCatalogDie('devil-set/devil-d6', 'Devil d6 #6', 'starter'),

  createConfiguredDie('d4', 'adventurer-starter', 'common', 'Starter d4 #1', 'starter'),
  createConfiguredDie('d4', 'adventurer-starter', 'common', 'Starter d4 #2', 'starter'),
  createConfiguredDie('d4', 'adventurer-starter', 'common', 'Starter d4 #3', 'starter'),
  createConfiguredDie('d4', 'adventurer-starter', 'common', 'Starter d4 #4', 'starter'),
  createConfiguredDie('d4', 'adventurer-starter', 'common', 'Starter d4 #5', 'starter'),
  createConfiguredDie('d4', 'adventurer-starter', 'common', 'Starter d4 #6', 'starter'),
]

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
