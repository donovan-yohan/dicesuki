import { describe, it, expect } from 'vitest'
import { defaultTheme, THEME_ICON_KEYS } from './tokens'
import { getThemeById, resolveRoomEnvironmentTheme, THEME_REGISTRY } from './registry'

describe('selectable themes', () => {
  it('offers only Classic and the three environment-backed worlds', () => {
    expect(THEME_REGISTRY.map(theme => theme.id)).toEqual([
      'default',
      'sunlit-glade-cel',
      'cyberpunk-cutline',
      'monster-dungeon',
    ])
  })
})

describe('legacy theme resolution', () => {
  it.each([
    ['fantasy-earth', 'sunlit-glade-cel'],
    ['critter-forest', 'sunlit-glade-cel'],
    ['sunlit-glade', 'sunlit-glade-cel'],
    ['dungeon-castle', 'monster-dungeon'],
    ['neon-cyber-city', 'cyberpunk-cutline'],
  ])('resolves %s to the registered %s world without exposing a legacy choice', (legacyId, canonicalId) => {
    const canonical = THEME_REGISTRY.find(theme => theme.id === canonicalId)
    expect(getThemeById(legacyId)).toBe(canonical)
    expect(resolveRoomEnvironmentTheme(legacyId, defaultTheme)).toBe(canonical)
    expect(THEME_REGISTRY.some(theme => theme.id === legacyId)).toBe(false)
  })

  it.each(['totally-made-up', 'toString', '__proto__', 'Sunlit-glade', ''])('does not resolve an unknown id %j', (id) => {
    expect(getThemeById(id)).toBeUndefined()
    expect(resolveRoomEnvironmentTheme(id, defaultTheme)).toBe(defaultTheme)
  })
})

describe('resolveRoomEnvironmentTheme', () => {
  const personalTheme = getThemeById('sunlit-glade-cel')!

  it('uses the personal theme when no room theme is set (solo / fresh room)', () => {
    expect(resolveRoomEnvironmentTheme(null, personalTheme)).toBe(personalTheme)
    expect(resolveRoomEnvironmentTheme(undefined, personalTheme)).toBe(personalTheme)
    expect(resolveRoomEnvironmentTheme('', personalTheme)).toBe(personalTheme)
  })

  it('applies a known room theme, overriding the personal theme', () => {
    const roomTheme = getThemeById('neon-cyber-city')!
    expect(resolveRoomEnvironmentTheme('neon-cyber-city', personalTheme)).toBe(roomTheme)
    expect(resolveRoomEnvironmentTheme('neon-cyber-city', personalTheme)).not.toBe(personalTheme)
  })

  it('falls back to the default theme for an unknown room theme id', () => {
    expect(resolveRoomEnvironmentTheme('totally-made-up', personalTheme)).toBe(defaultTheme)
  })
})

/**
 * Frontend-ADR-003: every theme implements the complete `Theme` interface — no
 * partial themes. A theme that simply omits an icon key type-checks only
 * because the object literal is checked at the declaration site; this proves it
 * for every registered theme at once, so adding a theme (or an icon slot) can
 * never leave a hole that renders as `undefined` instead of the emoji fallback.
 */
describe('theme icon completeness', () => {
  it.each(THEME_REGISTRY.map(theme => [theme.id, theme] as const))(
    '%s declares every icon slot explicitly',
    (id, theme) => {
      expect(Object.keys(theme.assets.icons).sort()).toEqual([...THEME_ICON_KEYS].sort())

      for (const key of THEME_ICON_KEYS) {
        const value = theme.assets.icons[key]
        // `null` is a legitimate value — it selects the component's emoji
        // fallback. `undefined` is not: it means the slot was forgotten.
        expect(value === null || typeof value === 'string', `${id}.${key}`).toBe(true)
      }
    }
  )

  it('ships the default theme with every slot filled', () => {
    for (const key of THEME_ICON_KEYS) {
      expect(defaultTheme.assets.icons[key], key).toBeTruthy()
    }
  })
})
