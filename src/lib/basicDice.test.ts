import { describe, expect, it } from 'vitest'

import {
  BASIC_DIE_ACCENT_COLOR,
  BASIC_DIE_BASE_COLOR,
  basicDieDisplayName,
  createBasicDicePresentation,
  dieChipLabel,
  isBasicDiePresentation,
} from './basicDice'
import { INVENTORY_DICE_SHAPES } from '../types/diceShape'

describe('createBasicDicePresentation', () => {
  it('describes a plain white die with black numerals', () => {
    expect(createBasicDicePresentation('d20')).toEqual({
      basic: true,
      displayName: 'Basic D20',
      baseColor: '#ffffff',
      accentColor: '#000000',
      material: 'plastic',
    })
  })

  it('claims no ownership identity for any shape', () => {
    // Everything that treats a die as OWNED — the toolbar's available count, set
    // completion, selling, stats, the "already on the table" guard — keys on
    // `inventoryDieId`. A basic die must be invisible to all of it.
    for (const shape of [...INVENTORY_DICE_SHAPES, 'd10tens'] as const) {
      const presentation = createBasicDicePresentation(shape)
      expect(presentation.inventoryDieId).toBeUndefined()
      expect(presentation.setId).toBeUndefined()
      expect(presentation.rarity).toBeUndefined()
      expect(presentation.customAssetId).toBeUndefined()
      expect(presentation.baseColor).toBe(BASIC_DIE_BASE_COLOR)
      expect(presentation.accentColor).toBe(BASIC_DIE_ACCENT_COLOR)
    }
  })

  it('names the percentile tens half as the d100 half it is', () => {
    expect(basicDieDisplayName('d10tens')).toBe('Basic D100 (tens)')
  })

  it('returns a fresh object each call so merges cannot corrupt a shared one', () => {
    const first = createBasicDicePresentation('d6')
    const second = createBasicDicePresentation('d6')
    expect(first).not.toBe(second)
    first.displayName = 'mutated'
    expect(second.displayName).toBe('Basic D6')
  })
})

describe('isBasicDiePresentation', () => {
  it('keys on the explicit flag, not on the colours', () => {
    expect(isBasicDiePresentation(createBasicDicePresentation('d6'))).toBe(true)

    // A legitimately owned white-with-black-numbers die is NOT basic: it keeps
    // its own material, mesh and set flair.
    expect(isBasicDiePresentation({
      inventoryDieId: 'die_1',
      displayName: 'Bone d6',
      baseColor: '#ffffff',
      accentColor: '#000000',
      material: 'bone',
    })).toBe(false)
  })

  it('treats a missing or presentation-less die as not basic', () => {
    expect(isBasicDiePresentation(undefined)).toBe(false)
    expect(isBasicDiePresentation({})).toBe(false)
  })
})

describe('dieChipLabel', () => {
  it('reads a basic die as the bare shape, not "Basic D6"', () => {
    // A player with no collection rolls nothing but basics; prefixing every
    // result chip with BASIC would be noise on the most scannable surface.
    expect(dieChipLabel('d6', createBasicDicePresentation('d6'))).toBe('D6')
    expect(dieChipLabel('d20', createBasicDicePresentation('d20'))).toBe('D20')
    // The name is still carried for surfaces that genuinely NAME a die.
    expect(createBasicDicePresentation('d6').displayName).toBe('Basic D6')
  })

  it('keeps an owned die its own name', () => {
    expect(dieChipLabel('d20', { inventoryDieId: 'die_1', displayName: 'Lucky d20' }))
      .toBe('Lucky d20')
  })

  it('falls back to the shape label for an unnamed or absent presentation', () => {
    expect(dieChipLabel('d12')).toBe('D12')
    expect(dieChipLabel('d12', {})).toBe('D12')
  })

  it('never surfaces the raw engine shape for a stray tens die', () => {
    expect(dieChipLabel('d10tens')).toBe('D100 (tens)')
    expect(dieChipLabel('d10tens', createBasicDicePresentation('d10tens')))
      .toBe('D100 (tens)')
  })
})
