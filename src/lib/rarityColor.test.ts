import { describe, expect, it } from 'vitest'
import type { Theme } from '../themes/tokens'
import { getRarityColor, pullTierFallbackRarity } from './rarityColor'

const theme = {
  tokens: { colors: { text: { secondary: '#secondary' } } },
} as unknown as Theme

describe('rarityColor', () => {
  it('preserves the established inventory rarity palette', () => {
    expect(getRarityColor('common', theme)).toBe('#secondary')
    expect(getRarityColor('uncommon', theme)).toBe('#1eff00')
    expect(getRarityColor('rare', theme)).toBe('#0070dd')
    expect(getRarityColor('epic', theme)).toBe('#a335ee')
    expect(getRarityColor('legendary', theme)).toBe('#ff8000')
    expect(getRarityColor('mythic', theme)).toBe('#e6cc80')
  })

  it('documents the pull-tier fallback without replacing catalog rarity', () => {
    expect(pullTierFallbackRarity('standard')).toBe('common')
    expect(pullTierFallbackRarity('rare')).toBe('rare')
    expect(pullTierFallbackRarity('epic')).toBe('epic')
    expect(pullTierFallbackRarity('signature')).toBe('legendary')
    expect(pullTierFallbackRarity('future-tier')).toBeNull()
  })
})
