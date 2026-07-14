import { describe, it, expect } from 'vitest'
import { ARENA_PRESETS, activeArenaPreset } from './arenaPresets'

describe('arenaPresets', () => {
  it('exposes portrait / square / landscape aspects', () => {
    const byId = Object.fromEntries(ARENA_PRESETS.map((p) => [p.id, p.aspect]))
    expect(byId['9:16']).toBeCloseTo(9 / 16)
    expect(byId['1:1']).toBe(1)
    expect(byId['16:9']).toBeCloseTo(16 / 9)
  })

  it('detects the active preset from area-preserving bounds', () => {
    // from_aspect(9/16) → half_x 4.5, half_z 8 (the 9:16 default).
    expect(activeArenaPreset(4.5, 8)).toBe('9:16')
    // square → half 6 x 6.
    expect(activeArenaPreset(6, 6)).toBe('1:1')
    // landscape is the transpose → 8 x 4.5.
    expect(activeArenaPreset(8, 4.5)).toBe('16:9')
  })

  it('returns null for a custom (fitted-window) shape', () => {
    expect(activeArenaPreset(7, 5)).toBeNull()
    expect(activeArenaPreset(4.5, 0)).toBeNull()
  })
})
