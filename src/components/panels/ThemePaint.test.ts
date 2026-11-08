import { resolve } from 'node:path'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { contrastRatio } from '../../themes/contrast'
import { getThemeById } from '../../themes/registry'

// Source adoption gate only: interaction/focus and native layout are covered by
// the mounted component suites and browser HUD journey, not by this scan.
const CONSUMERS = [
  'BottomSheet.tsx', 'FlyoutPanel.tsx', 'HistoryPanel.tsx', 'SettingsPanel.tsx',
  'SavedRollsPanel.tsx', 'HeroDieInspector.tsx',
  'saved-rolls/SavedRollCard.tsx', 'saved-rolls/RollBuilder.tsx',
  'saved-rolls/RollDicePicker.tsx', 'saved-rolls/DiceEntryCard.tsx',
]
// Keep Vite's browser-asset URL rewrite out of this Node source fixture.
const rootPath = '../../../'
const ROOT = fileURLToPath(new URL(rootPath, import.meta.url))

describe('existing panel skin adoption', () => {
  it.each(['sunlit-glade-cel', 'cyberpunk-cutline', 'monster-dungeon'])('%s keeps tinted surfaces distinct from solid accent fills', (id) => {
    const css = readFileSync(resolve(ROOT, 'src/index.css'), 'utf8')
    const themed = css.slice(css.indexOf(':root:is('), css.indexOf('/* The new skins'))
    const theme = getThemeById(id)
    if (!theme) throw new Error(`Missing world skin: ${id}`)
    const { colors } = theme.tokens
    for (const percent of [10, 12, 16, 20, 22]) {
      expect(css).toContain(`--ui-tint-${percent}: color-mix(in srgb, var(--color-accent) ${percent}%, transparent);`)
      expect(themed).toContain(`--ui-tint-${percent}: var(--color-background);`)
    }
    for (const ink of [colors.accent, colors.text.primary, colors.text.secondary]) {
      expect(contrastRatio(ink, colors.background)).toBeGreaterThanOrEqual(4.5)
    }
    expect(themed).toContain('--ui-nav-active: var(--color-accent);')
    expect(themed).toContain('--ui-nav-active-ink: var(--color-on-accent);')
  })

  it.each(CONSUMERS)('%s uses theme accent roles instead of baked-in pink paint', (file) => {
    const source = readFileSync(resolve(ROOT, 'src/components/panels', file), 'utf8')
    expect(source).not.toMatch(/rgba\(249, 135, 151,/)
  })

  it('roster chrome uses the skin without recoloring player or connection identity', () => {
    const source = readFileSync(resolve(ROOT, 'src/components/multiplayer/PlayerPanel.tsx'), 'utf8')
    expect(source).toContain("backgroundColor: 'var(--ui-roster-surface)'")
    expect(source).not.toContain('rgba(139, 92, 246, 0.55)')
    expect(source).toContain('backgroundColor: player.color')
    expect(source).toContain('backgroundColor: indicator.color')
  })

  it('consumes published fonts without changing the live type scale', () => {
    const css = readFileSync(resolve(ROOT, 'src/index.css'), 'utf8')
    const tailwind = readFileSync(resolve(ROOT, 'tailwind.config.js'), 'utf8')
    expect(css).toContain('font-family: var(--font-family-primary)')
    expect(tailwind).toContain("mono: ['var(--font-family-mono)']")
    expect(tailwind).toContain("sans: ['var(--font-family-primary)']")
    expect(tailwind).not.toContain('fontSize:')
    expect(tailwind).not.toContain('spacing:')
  })
})
