import { describe, expect, it } from 'vitest'
import { shouldPreviewSculptedDie, shouldPreviewWoodDie, sculptedDiePreviewUrl, woodDiePreviewUrl } from './woodlandExperiment'

describe('woodland asset experiment boundary', () => {
  const eligible = { development: true, requested: true, workerRoom: true, shape: 'd6', owned: false }
  it('permits an explicitly requested local basic D6 visual proof', () => {
    expect(shouldPreviewWoodDie(eligible)).toBe(true)
  })
  it('never changes production, network, owned or other-shaped dice', () => {
    for (const denied of [
      { development: false }, { requested: false }, { workerRoom: false },
      { owned: true }, { shape: 'd20' },
    ]) expect(shouldPreviewWoodDie({ ...eligible, ...denied })).toBe(false)
  })
  it.each(['d4', 'd6', 'd8', 'd10', 'd12', 'd20'])('selects the exact sculpted %s only for an explicitly requested local basic die', shape => {
    expect(sculptedDiePreviewUrl(shape)).toBe(`/__experiments/woodland/sculpted/${shape}.glb`)
    expect(shouldPreviewSculptedDie({ ...eligible, shape })).toBe(true)
    for (const denied of [
      { development: false }, { requested: false }, { workerRoom: false }, { owned: true },
    ]) expect(shouldPreviewSculptedDie({ ...eligible, shape, ...denied })).toBe(false)
  })
  it.each(['d10tens', 'd100', 'D6', 'd6.glb', '../d6', '', 'toString', '__proto__'])('refuses unsupported or nonliteral sculpted shape %s', shape => {
    expect(sculptedDiePreviewUrl(shape)).toBeNull()
    expect(shouldPreviewSculptedDie({ ...eligible, shape })).toBe(false)
  })
  it('selects the small proof for low/mid dice and desktop proof only for high', () => {
    expect(woodDiePreviewUrl('low')).toBe('/__experiments/woodland/variants/mobile.glb')
    expect(woodDiePreviewUrl('mid')).toBe('/__experiments/woodland/variants/mobile.glb')
    expect(woodDiePreviewUrl('high')).toBe('/__experiments/woodland/variants/desktop.glb')
  })
})
