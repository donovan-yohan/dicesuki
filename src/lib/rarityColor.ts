import type { Theme } from '../themes/tokens'
import type { DieRarity } from '../types/inventory'

export const RARITY_ACCENT_COLORS: Readonly<
  Record<Exclude<DieRarity, 'common'>, string>
> = {
  uncommon: '#1eff00',
  rare: '#0070dd',
  epic: '#a335ee',
  legendary: '#ff8000',
  mythic: '#e6cc80',
}

/** Established inventory palette; rarity labels must accompany these accents. */
export function getRarityColor(
  rarity: DieRarity,
  theme: Pick<Theme, 'tokens'>,
): string {
  return rarity === 'common'
    ? theme.tokens.colors.text.secondary
    : RARITY_ACCENT_COLORS[rarity]
}

/**
 * Pull tiers and catalog rarity are distinct vocabularies. Catalog rarity is
 * authoritative; this mapping is only a placeholder before catalog resolution.
 */
export function pullTierFallbackRarity(tierId: string): DieRarity | null {
  switch (tierId) {
    case 'standard':
      return 'common'
    case 'rare':
      return 'rare'
    case 'epic':
      return 'epic'
    case 'signature':
      return 'legendary'
    default:
      return null
  }
}
