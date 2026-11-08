import { describe, expect, it } from 'vitest'
import { getThemeById, resolveRoomEnvironmentTheme } from './registry'
import { defaultTheme } from './tokens'
import { sunlitGladeTheme } from './woodland'
import type { WoodlandRecipe } from '../lib/environmentQuality'
import { Color, SRGBColorSpace } from 'three'

describe('Sunlit Glade environment', () => {
  it('retains the authored smooth clearing for compatibility without changing cel lighting or personal dice appearance', () => {
    const cel = getThemeById('sunlit-glade-cel')
    const smooth = sunlitGladeTheme
    expect(cel).toBeDefined()
    expect(cel?.price).toBe(0)
    expect(cel?.environment.scene).toMatchObject({ kind: 'woodland', shading: 'cel', seed: 2718 })
    expect((cel?.environment.scene as WoodlandRecipe)?.grass).toEqual({ base: '#91ad85', tip: '#c3d19b' })
    expect((smooth.environment.scene as WoodlandRecipe)?.grass).toEqual({ base: '#42694f', tip: '#9db579' })
    expect(cel?.environment.floor.color).toBe('#91ad85')
    expect(cel?.environment.background.color).toBe('#486b58')
    expect(cel?.environment.lighting.ambient).toEqual({ color: '#d1e5dd', intensity: 0.32 })
    expect(cel?.environment.lighting.directional.color).toBe('#fff0cc')
    expect(cel?.dice).toEqual(smooth.dice)
    expect(smooth.environment.scene).not.toHaveProperty('shading', 'cel')
    expect(cel?.environment.lighting.ambient.intensity).toBeLessThan(smooth.environment.lighting.ambient.intensity)
  })

  it('offers a free woodland recipe through the existing theme registry', () => {
    const theme = getThemeById('sunlit-glade-cel')
    expect(theme?.price).toBe(0)
    expect(theme?.environment.scene).toMatchObject({ kind: 'woodland', shading: 'cel', seed: 2718 })
    expect(theme?.environment.lighting.directional.color).toBe('#fff0cc')
    expect(theme?.environment.floor.receiveShadow).toBe(true)
  })

  it('keeps the retained smooth forest greens softly saturated instead of fluorescent lime', () => {
    const grass = (sunlitGladeTheme.environment.scene as WoodlandRecipe).grass
    for (const value of [grass.base, grass.tip]) {
      const hsl = new Color(value).getHSL({ h: 0, s: 0, l: 0 }, SRGBColorSpace)
      expect(hsl.s).toBeLessThan(0.43)
      expect(hsl.h).toBeGreaterThan(0.23)
      expect(hsl.h).toBeLessThan(0.43)
    }
  })

  it('uses a host-selected glade without changing the personal theme', () => {
    const resolved = resolveRoomEnvironmentTheme('sunlit-glade', defaultTheme)
    expect(resolved.id).toBe('sunlit-glade-cel')
    expect(defaultTheme.environment.scene).toBeUndefined()
    expect(defaultTheme.id).toBe('default')
  })
})
