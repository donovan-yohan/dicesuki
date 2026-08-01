/**
 * Source guard: no accent-filled control may label itself with anything other
 * than `onAccent`.
 *
 * `contrast.guard.test.ts` proves every *declared* pairing is legible. It
 * cannot notice a component that starts consuming an undeclared combination —
 * which is exactly how eight live accent-filled controls kept painting
 * `text.primary` on `accent` through a green suite. This suite closes that hole
 * for the accent fill, the combination that has actually bitten us.
 *
 * If this fails: use `--color-on-accent` / `theme.tokens.colors.onAccent` /
 * `text-theme-on-accent` for the label. Do not pick a colour by hand — `accent`
 * is light on some themes and dark on others, so no fixed literal works.
 */

import { describe, expect, it } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import {
  scanAccentLabels,
  extractInlineStyleObjects,
  extractClassNames,
  splitObjectProperties,
} from './accentLabelScan'

// Vitest runs from the project root (vite.config.ts lives there).
const COMPONENTS_DIR = join(process.cwd(), 'src', 'components')

/**
 * Files whose accent labels are known-wrong but are owned by concurrent work
 * (the My Dice Rolls builder rework). Each entry must still be violating —
 * `remains accurate` below fails once a file is fixed, forcing the entry out
 * so the allowlist cannot rot into a permanent exemption.
 */
const DEFERRED: ReadonlyArray<{ file: string; reason: string }> = [
  {
    file: 'panels/SavedRollsPanel.tsx',
    reason:
      'saved-rolls builder rework (concurrent owner) — 3 sites: the "All" and per-tag filter ' +
      'chips (:302, :318) and the Create New Roll CTA (:337) all label an accent fill #ffffff',
  },
  {
    file: 'panels/saved-rolls/RollBuilder.tsx',
    reason:
      'saved-rolls builder rework (concurrent owner) — 3 sites: dice-type filter chip (:273) ' +
      'and the two save CTAs (:437, :476)',
  },
  {
    file: 'panels/saved-rolls/SavedRollCard.tsx',
    reason: 'saved-rolls builder rework (concurrent owner) — 1 site: Roll CTA (:129)',
  },
  {
    file: 'panels/saved-rolls/DicePool.tsx',
    reason: 'saved-rolls builder rework (concurrent owner) — 1 site: quantity chip (:41)',
  },
]

function walk(dir: string): string[] {
  const out: string[] = []
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) out.push(...walk(full))
    else if (/\.tsx$/.test(entry) && !/\.test\.tsx$/.test(entry)) out.push(full)
  }
  return out
}

const FILES = walk(COMPONENTS_DIR).map((full) => ({
  full,
  rel: full.slice(COMPONENTS_DIR.length + 1),
  source: readFileSync(full, 'utf8'),
}))

const isDeferred = (rel: string) => DEFERRED.some((d) => d.file === rel)

describe('accent-filled controls label themselves with onAccent', () => {
  it('scans a non-trivial number of components', () => {
    // Guards against a broken walk silently passing the suite.
    expect(FILES.length).toBeGreaterThan(40)
  })

  it('has no violations outside the deferred saved-rolls builder', () => {
    const violations = FILES.filter((f) => !isDeferred(f.rel)).flatMap((f) =>
      scanAccentLabels(f.rel, f.source),
    )

    expect(
      violations.map((v) => `${v.file}:${v.line} [${v.kind}] ${v.snippet}`),
      '\nAccent-filled control(s) labelled with something other than onAccent:\n' +
        violations.map((v) => `  - ${v.file}:${v.line}\n      ${v.snippet}`).join('\n') +
        '\n\nUse --color-on-accent / colors.onAccent / text-theme-on-accent.\n',
    ).toEqual([])
  })

  describe('deferred allowlist remains accurate', () => {
    it.each(DEFERRED.map((d) => [d.file, d.reason] as const))(
      '%s still violates (remove the entry once fixed)',
      (rel) => {
        const file = FILES.find((f) => f.rel === rel)
        expect(file, `deferred file ${rel} no longer exists — drop the allowlist entry`).toBeDefined()
        const violations = scanAccentLabels(rel, file!.source)
        expect(
          violations.length,
          `${rel} no longer violates — delete its entry from DEFERRED so the guard covers it`,
        ).toBeGreaterThan(0)
      },
    )
  })
})

describe('accent label scanner', () => {
  const scan = (src: string) => scanAccentLabels('fixture.tsx', src)

  it('flags an inline accent fill labelled with text.primary', () => {
    expect(
      scan(`<button style={{ backgroundColor: theme.tokens.colors.accent, color: theme.tokens.colors.text.primary }}>Go</button>`),
    ).toHaveLength(1)
  })

  it('flags the CSS-variable form', () => {
    expect(
      scan(`<button style={{ backgroundColor: 'var(--color-accent)', color: 'var(--color-text-primary)' }}>Go</button>`),
    ).toHaveLength(1)
  })

  it('flags a hardcoded white label on an accent fill', () => {
    expect(
      scan(`<button style={{ backgroundColor: 'var(--color-accent)', color: '#ffffff' }}>Go</button>`),
    ).toHaveLength(1)
  })

  it('flags a conditional accent fill whose active label is not onAccent', () => {
    expect(
      scan(`<button style={{ backgroundColor: active ? colors.accent : colors.surface, color: active ? colors.text.primary : colors.text.secondary }}>Go</button>`),
    ).toHaveLength(1)
  })

  // The first version of this scanner was line-oriented and silently missed
  // these, which is how the SavedRollsPanel tag chips escaped the first sweep.
  it('flags a ternary fill whose value spans multiple lines', () => {
    expect(
      scan(`<button
          style={{
            backgroundColor: selectedTag === null
              ? 'var(--color-accent)'
              : 'rgba(255, 255, 255, 0.1)',
            color: selectedTag === null
              ? '#ffffff'
              : 'var(--color-text-secondary)',
          }}
        >All</button>`),
    ).toHaveLength(1)
  })

  it('splits properties on top-level commas only', () => {
    const props = splitObjectProperties(
      `a: fn(1, 2), backgroundColor: cond ? x : y, color: 'a, b'`,
    )
    expect(props.map((p) => p.key)).toEqual(['a', 'backgroundColor', 'color'])
    expect(props[2].value).toBe(`'a, b'`)
  })

  it('splits key from value on the first top-level colon, not a ternary colon', () => {
    const props = splitObjectProperties(`color: a ? b : c`)
    expect(props).toEqual([{ key: 'color', value: 'a ? b : c' }])
  })

  it('accepts onAccent in all three spellings', () => {
    expect(scan(`<b style={{ backgroundColor: colors.accent, color: colors.onAccent }}>x</b>`)).toEqual([])
    expect(scan(`<b style={{ backgroundColor: 'var(--color-accent)', color: 'var(--color-on-accent)' }}>x</b>`)).toEqual([])
    expect(scan(`<b className="bg-theme-accent text-theme-on-accent">x</b>`)).toEqual([])
  })

  it('flags bg-theme-accent paired with a non-on-accent text utility', () => {
    expect(scan(`<b className="bg-theme-accent text-theme-primary">x</b>`)).toHaveLength(1)
    expect(scan(`<b className="bg-theme-accent text-white">x</b>`)).toHaveLength(1)
  })

  it('ignores an accent fill with no label colour (progress bars, knobs)', () => {
    expect(scan(`<div style={{ width: '40%', backgroundColor: 'var(--color-accent)' }} />`)).toEqual([])
    expect(scan(`<div className="bg-theme-accent h-1 w-full" />`)).toEqual([])
  })

  it('does not confuse an accent border or accent text for an accent fill', () => {
    expect(
      scan(`<b style={{ border: '1px solid var(--color-accent)', color: 'var(--color-text-primary)' }}>x</b>`),
    ).toEqual([])
    expect(scan(`<b style={{ color: 'var(--color-accent)' }}>x</b>`)).toEqual([])
  })

  it('does not treat accent-adjacent identifiers as the accent token', () => {
    expect(
      scan(`<b style={{ backgroundColor: accentWash, color: colors.text.primary }}>x</b>`),
    ).toEqual([])
  })

  it('parses nested braces in a style object without losing the tail', () => {
    const objects = extractInlineStyleObjects(
      `<b style={{ a: { b: 1 }, backgroundColor: colors.accent, color: colors.text.primary }} />`,
    )
    expect(objects).toHaveLength(1)
    expect(objects[0].body).toContain('color: colors.text.primary')
  })

  it('reads className from string, single-quote and template forms', () => {
    expect(extractClassNames(`<b className="a b" />`)[0].value).toBe('a b')
    expect(extractClassNames(`<b className='a b' />`)[0].value).toBe('a b')
    expect(extractClassNames('<b className={`a b`} />')[0].value).toBe('a b')
  })
})
