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
import { BUNDLED_ICON_MARKUP, createBundledIconMap, getBundledIconMarkup } from './bundledIcons'
import { defaultTheme, THEME_ICON_KEYS } from './tokens'

describe('bundled default-theme icons', () => {
  it('bundles markup for all ten public icon files', () => {
    expect(Object.keys(BUNDLED_ICON_MARKUP).filter(url => url.startsWith('/icons/default/')).sort()).toEqual(
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

  it.each(['woodland', 'cyberpunk', 'monster-dungeon'])('maps the ten released %s slots without colliding with default', (directory) => {
    const files = Object.keys(BUNDLED_ICON_MARKUP)
      .filter(url => url.startsWith('/icons/default/'))
      .map(url => url.split('/').at(-1)!)
    const raw = Object.fromEntries(files.map(file => [
      `../../public/icons/${directory}/${file}`,
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path stroke="currentColor" d="M2 2L8 8"/></svg>',
    ]))
    const bundled = createBundledIconMap(raw)
    expect(Object.keys(bundled).sort()).toEqual(files.map(file => `/icons/${directory}/${file}`).sort())
  })

  it('rejects active SVG markup and files outside the explicit skin slots', () => {
    const svg = (body: string) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24">${body}</svg>`
    const unsafe = [
      svg('<script>alert(1)</script>'),
      svg('<path onload="alert(1)" d="M0 0"/>'),
      svg('<foreignObject><div>HTML</div></foreignObject>'),
      svg('<use href="https://cdn.example.com/symbols.svg#roll"/>'),
      svg('<path style="fill:url(https://cdn.example.com/paint.svg)" d="M0 0"/>'),
      svg('<animate attributeName="href" values="javascript:alert(1)"/>'),
      svg('<path fill="url(#paint)" d="M0 0"/>'),
      '<!DOCTYPE svg [<!ENTITY x "unsafe">]>' + svg('&x;'),
    ]
    for (const markup of unsafe) {
      expect(createBundledIconMap({ '../../public/icons/woodland/roll.svg': markup })).toEqual({})
    }
    const safe = svg('<path stroke="currentColor" d="M0 0L4 4"/>')
    expect(createBundledIconMap({
      '../../public/icons/untrusted/roll.svg': safe,
      '../../public/icons/woodland/extra.svg': safe,
      '../../public/icons/woodland/nested/roll.svg': safe,
    })).toEqual({})
    expect(getBundledIconMarkup('https://cdn.example.com/icons/woodland/roll.svg')).toBeNull()
    expect(getBundledIconMarkup('/icons/default/roll.svg?untrusted=true')).toBeNull()
    expect(getBundledIconMarkup('toString')).toBeNull()
  })

  it('returns null for anything that is not a first-party bundled icon', () => {
    expect(getBundledIconMarkup(null)).toBeNull()
    expect(getBundledIconMarkup(undefined)).toBeNull()
    expect(getBundledIconMarkup('')).toBeNull()
    expect(getBundledIconMarkup('https://cdn.example.com/theme/roll.svg')).toBeNull()
    expect(getBundledIconMarkup('/icons/default/not-a-real-icon.svg')).toBeNull()
  })
})
