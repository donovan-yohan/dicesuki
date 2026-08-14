/**
 * Guards for the bundled default-theme icon set.
 *
 * The failure this suite exists to catch is silent: if the `?raw` glob in
 * `bundledIcons.ts` ever stops resolving (renamed folder, changed Vite glob
 * semantics), `getBundledIconMarkup` returns `null` for everything, `ThemeIcon`
 * quietly falls back to `<img>`, and every HUD glyph renders black-on-charcoal
 * instead of inheriting `currentColor`. Nothing else in the suite would notice.
 */

import { describe, expect, it } from 'vitest'
import { BUNDLED_ICON_MARKUP, getBundledIconMarkup } from './bundledIcons'
import { defaultTheme, THEME_ICON_KEYS } from './tokens'

describe('bundled default-theme icons', () => {
  it('bundles markup for all ten public icon files', () => {
    expect(Object.keys(BUNDLED_ICON_MARKUP).sort()).toEqual(
      [
        '/icons/default/dice.svg',
        '/icons/default/history.svg',
        '/icons/default/motion.svg',
        '/icons/default/profile.svg',
        '/icons/default/roll.svg',
        '/icons/default/rotate.svg',
        '/icons/default/saved-rolls.svg',
        '/icons/default/settings.svg',
        '/icons/default/shop.svg',
        '/icons/default/ui-toggle.svg',
      ].sort()
    )
  })

  it('fills every default-theme icon slot with a bundled, inlinable icon', () => {
    // The default theme is the one theme that must be complete: it is the
    // fallback every other theme degrades to.
    expect(Object.keys(defaultTheme.assets.icons).sort()).toEqual(
      [...THEME_ICON_KEYS].sort()
    )

    for (const key of THEME_ICON_KEYS) {
      const url = defaultTheme.assets.icons[key]
      expect(url, `defaultTheme icon "${key}" must be set`).toMatch(
        /^\/icons\/default\/[a-z-]+\.svg$/
      )
      expect(getBundledIconMarkup(url), `"${key}" must be bundled`).not.toBeNull()
    }
  })

  it('keeps every bundled icon a currentColor 24x24 line SVG', () => {
    for (const [url, markup] of Object.entries(BUNDLED_ICON_MARKUP)) {
      expect(markup.startsWith('<svg'), url).toBe(true)
      expect(markup.endsWith('</svg>'), url).toBe(true)
      // Standalone .svg files must declare the namespace or they will not parse
      // when fetched directly (the <img> fallback path).
      expect(markup, url).toContain('xmlns="http://www.w3.org/2000/svg"')
      expect(markup, url).toContain('viewBox="0 0 24 24"')
      // The whole point of inlining: the glyph takes the button's colour.
      expect(markup, url).toContain('currentColor')
      // A baked-in fill/stroke literal would ignore the theme.
      expect(markup, url).not.toMatch(/(?:fill|stroke)="#/)
    }
  })

  it('returns null for anything that is not a first-party bundled icon', () => {
    expect(getBundledIconMarkup(null)).toBeNull()
    expect(getBundledIconMarkup(undefined)).toBeNull()
    expect(getBundledIconMarkup('')).toBeNull()
    expect(getBundledIconMarkup('https://cdn.example.com/theme/roll.svg')).toBeNull()
    expect(getBundledIconMarkup('/icons/default/not-a-real-icon.svg')).toBeNull()
  })
})
