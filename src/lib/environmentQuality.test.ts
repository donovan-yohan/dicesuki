import { describe, expect, it } from 'vitest'
import { resolveEnvironmentQuality } from './environmentQuality'

const desktop = {
  deviceTier: 'high' as const,
  compactViewport: false,
  coarsePointer: false,
  reducedMotion: false,
}

describe('resolveEnvironmentQuality', () => {
  it('bounds desktop high quality without suppressing atmosphere', () => {
    expect(resolveEnvironmentQuality(desktop)).toEqual({
      tier: 'high', maxDpr: 2, shadowMapSize: 2048,
      grassCount: 12000, particleCount: 48, shaftCount: 4, animate: true,
    })
  })

  it.each([
    { compactViewport: true, coarsePointer: false },
    { compactViewport: false, coarsePointer: true },
    { compactViewport: true, coarsePointer: true },
  ])('caps high GPUs on constrained surfaces: %o', (surface) => {
    expect(resolveEnvironmentQuality({ ...desktop, ...surface })).toEqual({
      tier: 'mid', maxDpr: 1.5, shadowMapSize: 512,
      grassCount: 6000, particleCount: 12, shaftCount: 2, animate: true,
    })
  })

  it('keeps a bounded moving meadow on low tier without particles or shafts', () => {
    expect(resolveEnvironmentQuality({ ...desktop, deviceTier: 'low' })).toEqual({
      tier: 'low', maxDpr: 1, shadowMapSize: 512,
      grassCount: 2500, particleCount: 0, shaftCount: 0, animate: true,
    })
  })

  it.each(['low', 'mid', 'high'] as const)('freezes %s ambient motion without changing geometry', (deviceTier) => {
    const animated = resolveEnvironmentQuality({ ...desktop, deviceTier })
    const still = resolveEnvironmentQuality({ ...desktop, deviceTier, reducedMotion: true })
    expect(still).toEqual({ ...animated, animate: false })
  })

  it('does not mutate its input or share mutable result objects', () => {
    const input = Object.freeze({ ...desktop })
    const first = resolveEnvironmentQuality(input)
    first.grassCount = 0
    expect(resolveEnvironmentQuality(input).grassCount).toBe(12000)
    expect(input).toEqual(desktop)
  })

  it('keeps desktop mid below high budgets', () => {
    expect(resolveEnvironmentQuality({ ...desktop, deviceTier: 'mid' })).toEqual({
      tier: 'mid', maxDpr: 1.5, shadowMapSize: 1024,
      grassCount: 6000, particleCount: 12, shaftCount: 2, animate: true,
    })
  })
})
