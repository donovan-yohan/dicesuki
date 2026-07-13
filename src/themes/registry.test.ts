import { describe, it, expect } from 'vitest'
import { defaultTheme } from './tokens'
import { getThemeById, resolveRoomEnvironmentTheme } from './registry'

describe('resolveRoomEnvironmentTheme', () => {
  const personalTheme = getThemeById('fantasy-earth')!

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
