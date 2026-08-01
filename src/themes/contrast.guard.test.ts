/**
 * WCAG contrast gate for the theme system.
 *
 * PO 2026-07-27: "dark font over dark background" occurrences must die and
 * never come back. This suite is the "never come back" half. It walks the
 * exported THEME_REGISTRY — not a hardcoded list — so a theme added later is
 * covered automatically, and it walks CONTRAST_PAIRINGS, so a newly consumed
 * pairing is one line in the manifest.
 *
 * If this fails: fix the colour in `src/themes/tokens.ts`. Do NOT fix it by
 * hardcoding a colour in a component (Frontend-ADR-003).
 */

import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { THEME_REGISTRY } from './registry'
import { defaultTheme } from './tokens'
import {
  BACKDROPS,
  CONTRAST_PAIRINGS,
  THRESHOLDS,
  auditTheme,
  compositeOver,
  contrastRatio,
  describeFailure,
  hexToRgb,
  relativeLuminance,
  resolveToken,
  type Backdrop,
  type ColorTokenPath,
} from './contrast'

describe('WCAG contrast maths', () => {
  it('matches the WCAG 2.1 reference ratios', () => {
    // Reference values from the WCAG 2.1 definition of contrast ratio.
    expect(contrastRatio('#ffffff', '#000000')).toBeCloseTo(21, 5)
    expect(contrastRatio('#000000', '#ffffff')).toBeCloseTo(21, 5)
    expect(contrastRatio('#777777', '#ffffff')).toBeCloseTo(4.478, 2)
    expect(contrastRatio('#767676', '#ffffff')).toBeCloseTo(4.54, 2)
    expect(contrastRatio('#ff0000', '#ffffff')).toBeCloseTo(3.998, 2)
    expect(contrastRatio('#123456', '#123456')).toBeCloseTo(1, 5)
  })

  it('is symmetric and bounded', () => {
    expect(contrastRatio('#1a101d', '#f3ebe2')).toBeCloseTo(
      contrastRatio('#f3ebe2', '#1a101d'),
      10,
    )
  })

  it('computes relative luminance at the sRGB extremes', () => {
    expect(relativeLuminance('#000000')).toBe(0)
    expect(relativeLuminance('#ffffff')).toBeCloseTo(1, 10)
  })

  it('expands 3-digit hex and rejects non-hex input', () => {
    expect(hexToRgb('#abc')).toEqual(hexToRgb('#aabbcc'))
    expect(() => hexToRgb('rgba(0,0,0,0.5)')).toThrow(/Not a hex colour/)
    expect(() => hexToRgb('#12345')).toThrow(/Not a hex colour/)
  })

  it('composites a translucent overlay source-over', () => {
    expect(compositeOver('#ffffff', 0, '#1a101d')).toBe('#1a101d')
    expect(compositeOver('#ffffff', 1, '#1a101d')).toBe('#ffffff')
    // 50% white over black is mid grey.
    expect(compositeOver('#ffffff', 0.5, '#000000')).toBe('#808080')
  })
})

describe('theme registry', () => {
  it('has themes to check', () => {
    expect(THEME_REGISTRY.length).toBeGreaterThan(0)
  })

  it('exposes every colour token the manifest addresses', () => {
    const paths: ColorTokenPath[] = [
      'primary',
      'secondary',
      'accent',
      'onAccent',
      'background',
      'surface',
      'error',
      'text.primary',
      'text.secondary',
      'text.muted',
    ]
    for (const theme of THEME_REGISTRY) {
      for (const path of paths) {
        expect(
          resolveToken(theme, path),
          `${theme.id} is missing colour token "${path}"`,
        ).toMatch(/^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/)
      }
    }
  })
})

describe('WCAG AA text contrast, every theme x every declared pairing', () => {
  // One test per theme so a failure names the offending theme in its title.
  for (const theme of THEME_REGISTRY) {
    it(`"${theme.id}" clears its threshold on all ${CONTRAST_PAIRINGS.length} pairings`, () => {
      const failures = auditTheme(theme)
        .filter((result) => !result.passes)
        .map((result) => describeFailure(theme.id, result))

      expect(
        failures,
        `\n${failures.length} contrast failure(s) in theme "${theme.id}":\n` +
          failures.map((f) => `  - ${f}`).join('\n') +
          '\n\nFix the colour in src/themes/tokens.ts — never by hardcoding a component colour.\n',
      ).toEqual([])
    })
  }

  it('checks every registered theme (no theme can opt out)', () => {
    const audited = THEME_REGISTRY.map((t) => t.id)
    expect(new Set(audited).size).toBe(THEME_REGISTRY.length)
    expect(audited).toContain(defaultTheme.id)
  })
})

describe('contrast manifest hygiene', () => {
  it('has unique pairing names', () => {
    const names = CONTRAST_PAIRINGS.map((p) => p.name)
    expect(new Set(names).size).toBe(names.length)
  })

  it('documents a real render site for every pairing', () => {
    for (const pairing of CONTRAST_PAIRINGS) {
      expect(pairing.usedBy.length, `${pairing.name} has no usedBy note`).toBeGreaterThan(10)
    }
  })

  it('uses only the two WCAG 1.4.3 thresholds', () => {
    expect(THRESHOLDS.normal).toBe(4.5)
    expect(THRESHOLDS.large).toBe(3)
    for (const pairing of CONTRAST_PAIRINGS) {
      expect(['normal', 'large']).toContain(pairing.threshold)
    }
  })

  it('keeps overlay alphas in (0,1)', () => {
    const backdrops: Backdrop[] = Object.values(BACKDROPS)
    for (const backdrop of backdrops) {
      if (!backdrop.overlay) continue
      expect(backdrop.overlay.alpha, `${backdrop.id} overlay alpha`).toBeGreaterThan(0)
      expect(backdrop.overlay.alpha, `${backdrop.id} overlay alpha`).toBeLessThan(1)
    }
  })

  it('gives every backdrop a source note', () => {
    const backdrops: Backdrop[] = Object.values(BACKDROPS)
    for (const backdrop of backdrops) {
      expect(backdrop.source.length, `${backdrop.id} has no source note`).toBeGreaterThan(10)
    }
  })
})

/**
 * Drift guard: `src/index.css` paints the pre-hydration frame and claims to
 * mirror `defaultTheme`. Before this suite existed it had already drifted.
 * ThemeProvider must also publish every gated token as a CSS variable, or the
 * gate would be checking colours the browser never sees.
 */
describe('CSS variable plumbing matches the tokens', () => {
  const read = (relative: string) =>
    readFileSync(fileURLToPath(new URL(relative, import.meta.url)), 'utf8')

  const indexCss = read('../index.css')
  const themeProvider = read('../contexts/ThemeProvider.tsx')

  const CSS_VAR_BY_TOKEN: ReadonlyArray<[string, ColorTokenPath]> = [
    ['--color-primary', 'primary'],
    ['--color-secondary', 'secondary'],
    ['--color-accent', 'accent'],
    ['--color-on-accent', 'onAccent'],
    ['--color-background', 'background'],
    ['--color-surface', 'surface'],
    ['--color-error', 'error'],
    ['--color-text-primary', 'text.primary'],
    ['--color-text-secondary', 'text.secondary'],
    ['--color-text-muted', 'text.muted'],
  ]

  it.each(CSS_VAR_BY_TOKEN)(
    'index.css %s equals the defaultTheme token',
    (cssVar, tokenPath) => {
      const match = indexCss.match(new RegExp(`${cssVar}:\\s*([^;]+);`))
      expect(match, `${cssVar} is not declared in src/index.css`).not.toBeNull()
      expect(match![1].trim().toLowerCase()).toBe(
        resolveToken(defaultTheme, tokenPath).toLowerCase(),
      )
    },
  )

  it.each(CSS_VAR_BY_TOKEN)('ThemeProvider publishes %s', (cssVar) => {
    expect(
      themeProvider.includes(`'${cssVar}'`),
      `ThemeProvider never calls setProperty('${cssVar}', ...), so themes cannot move it`,
    ).toBe(true)
  })
})
