/**
 * Dice set registry.
 *
 * Shipped/configured collectible sets are sourced from the same deterministic
 * JSON input that generates the server catalog. Local artist uploads remain a
 * deliberately separate, client-only set.
 */

import catalogSource from './collectibleCatalogSource.json'
import type { DieSet } from '../types/inventory'

const CONFIGURED_DIE_SETS = catalogSource.configuredSets as unknown as DieSet[]

function requireConfiguredSet(id: string): DieSet {
  const set = CONFIGURED_DIE_SETS.find(candidate => candidate.id === id)
  if (!set) throw new Error(`Configured die set ${id} is missing`)
  return set
}

export const ADVENTURER_STARTER_SET = requireConfiguredSet('adventurer-starter')
export const LUCKY_BRONZE_SET = requireConfiguredSet('lucky-bronze')
export const DRAGON_JADE_SET = requireConfiguredSet('dragon-jade')
export const CELESTIAL_GOLD_SET = requireConfiguredSet('celestial-gold')
export const VOID_CRYSTAL_SET = requireConfiguredSet('void-crystal')
export const INFERNAL_OBSIDIAN_SET = requireConfiguredSet('infernal-obsidian')

/** Client-only artist uploads are not catalog items or entitlement evidence. */
export const CUSTOM_ARTIST_SET: DieSet = {
  id: 'custom-artist',
  name: 'Custom Artist Collection',
  description: 'Unique dice created by talented artists in the community. Each die is a work of art.',
  theme: {
    colorPalette: ['#8b5cf6', '#a78bfa', '#c4b5fd'],
    materialType: 'plastic',
    visualStyle: 'fantasy',
  },
  rarityVariants: {
    rare: {
      appearance: {
        baseColor: '#8b5cf6',
        accentColor: '#ffffff',
        material: 'plastic',
        roughness: 0.7,
        metalness: 0,
      },
      vfx: {},
    },
  },
  availability: 'always',
  releaseDate: 0,
}

export const DIE_SETS: DieSet[] = [
  ...CONFIGURED_DIE_SETS,
  CUSTOM_ARTIST_SET,
]

export function getDieSetById(id: string): DieSet | undefined {
  return DIE_SETS.find(set => set.id === id)
}

export function getDieSetsByAvailability(
  availability: DieSet['availability'],
): DieSet[] {
  return DIE_SETS.filter(set => set.availability === availability)
}

export function getActiveLimitedSets(): DieSet[] {
  const now = Date.now()
  return DIE_SETS.filter(
    set =>
      set.availability === 'limited' &&
      set.releaseDate <= now &&
      (!set.endDate || set.endDate > now),
  )
}

export function setSupportsRarity(setId: string, rarity: string): boolean {
  const set = getDieSetById(setId)
  return set ? rarity in set.rarityVariants : false
}
