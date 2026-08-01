/**
 * Source scanner: find accent-filled controls whose label colour is not
 * `onAccent`.
 *
 * `CONTRAST_PAIRINGS` can only check pairings someone remembered to declare.
 * The accent fill is the combination that has actually bitten us — `accent`
 * doubles as a text colour and as a button fill, so a component that picks a
 * label colour by hand almost always picks a light one, which is exactly wrong
 * on a light accent. This module reads component source and reports every site
 * where an accent background and a non-`onAccent` label colour appear in the
 * same inline style object, or where `bg-theme-accent` appears in a className
 * without `text-theme-on-accent`.
 *
 * It is a source-shape check. It cannot see colours composed at runtime, and it
 * deliberately ignores accent fills with no label colour at all (progress bars,
 * toggle knobs, indicator dots — no text to be illegible).
 */

/** One flagged site. */
export interface AccentLabelViolation {
  readonly file: string
  readonly line: number
  readonly kind: 'inline-style' | 'class-name'
  readonly snippet: string
}

/** A value references the accent token. */
const REFERENCES_ACCENT = /--color-accent|\baccent\b/

/** A label colour is acceptable only if it resolves to the onAccent token. */
const ON_ACCENT = /onAccent|--color-on-accent|text-theme-on-accent/

/**
 * Split an object-literal body into its top-level `key: value` properties.
 *
 * Values routinely span several lines (`backgroundColor: cond\n ? a\n : b,`),
 * so a line-oriented regex silently misses them — that false negative hid the
 * SavedRollsPanel tag chips on the first pass. Track nesting and quoting and
 * split only on commas at depth zero.
 */
export function splitObjectProperties(body: string): { key: string; value: string }[] {
  const parts: string[] = []
  let depth = 0
  let quote: string | null = null
  let current = ''
  for (let i = 0; i < body.length; i++) {
    const ch = body[i]
    if (quote) {
      current += ch
      if (ch === '\\') {
        current += body[++i] ?? ''
      } else if (ch === quote) {
        quote = null
      }
      continue
    }
    if (ch === '"' || ch === "'" || ch === '`') {
      quote = ch
      current += ch
      continue
    }
    if (ch === '{' || ch === '(' || ch === '[') depth++
    else if (ch === '}' || ch === ')' || ch === ']') depth--
    if (ch === ',' && depth === 0) {
      parts.push(current)
      current = ''
      continue
    }
    current += ch
  }
  parts.push(current)

  const out: { key: string; value: string }[] = []
  for (const part of parts) {
    // Only split on the FIRST top-level colon; ternaries contain more.
    let d = 0
    let q: string | null = null
    let idx = -1
    for (let i = 0; i < part.length; i++) {
      const ch = part[i]
      if (q) {
        if (ch === '\\') i++
        else if (ch === q) q = null
        continue
      }
      if (ch === '"' || ch === "'" || ch === '`') { q = ch; continue }
      if (ch === '{' || ch === '(' || ch === '[') d++
      else if (ch === '}' || ch === ')' || ch === ']') d--
      else if (ch === ':' && d === 0) { idx = i; break }
    }
    if (idx === -1) continue
    out.push({ key: part.slice(0, idx).trim(), value: part.slice(idx + 1).trim() })
  }
  return out
}

/**
 * Extract the balanced `{...}` body of every `style={{ ... }}` in `source`,
 * with the 1-based line number where it starts.
 */
export function extractInlineStyleObjects(
  source: string,
): { body: string; line: number }[] {
  const out: { body: string; line: number }[] = []
  const opener = /style=\{\{/g
  let match: RegExpExecArray | null
  while ((match = opener.exec(source)) !== null) {
    // Start just after `style={{`, with one brace already open.
    let depth = 1
    let i = match.index + match[0].length
    const start = i
    while (i < source.length && depth > 0) {
      const ch = source[i]
      if (ch === '{') depth++
      else if (ch === '}') depth--
      i++
    }
    if (depth !== 0) continue // unbalanced; skip rather than guess
    out.push({
      body: source.slice(start, i - 1),
      line: source.slice(0, match.index).split('\n').length,
    })
  }
  return out
}

/** Extract every `className="..."` / `className='...'` literal. */
export function extractClassNames(source: string): { value: string; line: number }[] {
  const out: { value: string; line: number }[] = []
  const re = /className=(?:"([^"]*)"|'([^']*)'|\{`([^`]*)`\})/g
  let match: RegExpExecArray | null
  while ((match = re.exec(source)) !== null) {
    out.push({
      value: match[1] ?? match[2] ?? match[3] ?? '',
      line: source.slice(0, match.index).split('\n').length,
    })
  }
  return out
}

/** Scan one file's source for accent-filled controls with a wrong label colour. */
export function scanAccentLabels(file: string, source: string): AccentLabelViolation[] {
  const violations: AccentLabelViolation[] = []

  for (const { body, line } of extractInlineStyleObjects(source)) {
    const props = splitObjectProperties(body)
    const fill = props.find(
      (p) => (p.key === 'background' || p.key === 'backgroundColor') && REFERENCES_ACCENT.test(p.value),
    )
    if (!fill) continue
    // No label colour in this object → nothing to be illegible here.
    const label = props.find((p) => p.key === 'color')
    if (!label) continue
    if (ON_ACCENT.test(label.value)) continue
    violations.push({
      file,
      line,
      kind: 'inline-style',
      snippet: `${fill.key}: ${fill.value.replace(/\s+/g, ' ')} | color: ${label.value.replace(/\s+/g, ' ')}`.slice(0, 200),
    })
  }

  for (const { value, line } of extractClassNames(source)) {
    if (!/\bbg-theme-accent\b/.test(value)) continue
    if (ON_ACCENT.test(value)) continue
    // A className with an accent fill but no text-* utility inherits its colour
    // from an ancestor; only flag when it sets one that is not on-accent.
    if (!/\btext-theme-[a-z-]+\b/.test(value) && !/\btext-(?:white|black)\b/.test(value)) continue
    violations.push({
      file,
      line,
      kind: 'class-name',
      snippet: value.replace(/\s+/g, ' ').trim().slice(0, 160),
    })
  }

  return violations
}
