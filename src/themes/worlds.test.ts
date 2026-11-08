import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { getThemeById, resolveRoomEnvironmentTheme } from './registry'
import { defaultTheme, THEME_ICON_KEYS } from './tokens'
import { auditTheme } from './contrast'

const worlds = [
  ['sunlit-glade-cel', 'woodland', 'woodland'],
  ['cyberpunk-cutline', 'cyberpunk', 'cyberpunk-alley'],
  ['monster-dungeon', 'monster-dungeon', 'monster-dungeon'],
] as const

const names = { uiToggle: 'ui-toggle', savedRolls: 'saved-rolls' } as const

describe('three world skins on the existing theme system', () => {
  it.each(worlds)('%s has a complete local icon family and a coordinated environment', (id, family, kind) => {
    const theme = getThemeById(id)
    expect(theme).toBeDefined()
    expect(theme?.environment.scene?.kind).toBe(kind)
    for (const slot of THEME_ICON_KEYS) {
      const file = slot === 'uiToggle' || slot === 'savedRolls' ? names[slot] : slot
      const url = `/icons/${family}/${file}.svg`
      expect(theme?.assets.icons[slot]).toBe(url)
      const relativePath = '../../public' + url
      const markup = readFileSync(fileURLToPath(new URL(relativePath, import.meta.url)), 'utf8')
      expect(markup).toContain('viewBox="0 0 24 24"')
      expect(markup).toContain('currentColor')
      expect(markup).not.toMatch(/<script|onload=|foreignObject|href=/i)
    }
    expect(auditTheme(theme!).filter(row => !row.passes)).toEqual([])
  })

  it.each(worlds)('%s remains a room environment choice, not a personal UI mutation', (id) => {
    const personalBefore = JSON.stringify(defaultTheme)
    const environment = resolveRoomEnvironmentTheme(id, defaultTheme)
    expect(environment.id).toBe(id)
    expect(JSON.stringify(defaultTheme)).toBe(personalBefore)
  })

  it('keeps legacy theme IDs resolvable without changing classic icons', () => {
    for (const id of ['default', 'fantasy-earth', 'critter-forest', 'dungeon-castle', 'neon-cyber-city', 'sunlit-glade']) {
      expect(getThemeById(id)).toBeDefined()
    }
    expect(defaultTheme.assets.icons.roll).toBe('/icons/default/roll.svg')
  })
})
