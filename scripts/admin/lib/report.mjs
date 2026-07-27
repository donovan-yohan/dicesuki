// Pure text formatting for the human-readable (non `--json`) output.

/** `20000` -> `20,000`; keeps the sign for corrections. */
export function formatInteger(value) {
  if (value === null || value === undefined) return '-'
  const number = Number(value)
  if (!Number.isFinite(number)) return String(value)
  return number.toLocaleString('en-US')
}

/** Trim an ISO timestamp to second precision; pass through anything else. */
export function formatTimestamp(value) {
  if (!value) return '-'
  const parsed = new Date(value)
  if (Number.isNaN(parsed.getTime())) return String(value)
  return `${parsed.toISOString().slice(0, 19)}Z`
}

/** Whole seconds between two instants, floored at 0. */
export function secondsUntil(iso, now = new Date()) {
  const target = new Date(iso).getTime()
  if (Number.isNaN(target)) return null
  return Math.max(0, Math.round((target - now.getTime()) / 1000))
}

function cell(value) {
  if (value === null || value === undefined) return '-'
  if (typeof value === 'boolean') return value ? 'yes' : 'no'
  return String(value)
}

/**
 * Fixed-width table. `columns` is `[{ key, label, align }]`; `align: 'right'`
 * is used for numeric columns so ledger deltas line up.
 */
export function formatTable(rows, columns) {
  if (rows.length === 0) return '  (none)'
  const widths = columns.map(column => {
    const longest = rows.reduce(
      (max, row) => Math.max(max, cell(row[column.key]).length),
      column.label.length,
    )
    return longest
  })
  const line = values =>
    '  ' +
    values
      .map((value, index) =>
        columns[index].align === 'right'
          ? value.padStart(widths[index])
          : value.padEnd(widths[index]),
      )
      .join('  ')
      .trimEnd()
  return [
    line(columns.map(column => column.label)),
    line(widths.map(width => '-'.repeat(width))),
    ...rows.map(row => line(columns.map(column => cell(row[column.key])))),
  ].join('\n')
}

/** Aligned `label: value` block. */
export function formatKeyValues(pairs) {
  const entries = pairs.filter(([, value]) => value !== undefined)
  if (entries.length === 0) return '  (none)'
  const width = entries.reduce((max, [label]) => Math.max(max, label.length), 0)
  return entries
    .map(([label, value]) => `  ${`${label}:`.padEnd(width + 1)} ${cell(value)}`)
    .join('\n')
}

export function heading(text) {
  return `\n${text}\n${'='.repeat(text.length)}`
}
