import type { DiceEntry, RollSource, SavedRoll } from '../types/savedRolls'

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function clampQuantity(quantity: number): number {
  if (!Number.isFinite(quantity)) return 1
  return Math.max(1, Math.floor(quantity))
}

function normalizeRollSource(value: unknown, fallbackSkinId?: string): RollSource | null {
  if (!isRecord(value)) return null

  if (value.kind === 'anonymous') {
    return createAnonymousRollSource(
      typeof value.quantity === 'number' ? value.quantity : Number.NaN,
      typeof value.skinId === 'string' ? value.skinId : fallbackSkinId,
    )
  }

  if (value.kind === 'specific' && typeof value.dieId === 'string') {
    const dieId = value.dieId.trim()
    if (dieId.length > 0) {
      return createSpecificDieRollSource(
        dieId,
        typeof value.skinId === 'string' ? value.skinId : fallbackSkinId,
      )
    }
  }

  return null
}

export function createAnonymousRollSource(quantity: number, skinId?: string): RollSource {
  return {
    kind: 'anonymous',
    quantity: clampQuantity(quantity),
    ...(skinId ? { skinId } : {}),
  }
}

export function createSpecificDieRollSource(dieId: string, skinId?: string): RollSource {
  return {
    kind: 'specific',
    dieId,
    ...(skinId ? { skinId } : {}),
  }
}

export function getRollSourceQuantity(source: RollSource): number {
  return source.kind === 'anonymous' ? clampQuantity(source.quantity) : 1
}

export function getLegacyEntrySourceQuantity(entry: DiceEntry): number {
  return clampQuantity(entry.rollCount ?? entry.quantity)
}

function getTotalSourceQuantity(sources: RollSource[]): number {
  return sources.reduce(
    (total, source) => total + getRollSourceQuantity(source),
    0
  )
}

function reconcileSourcesToEntryQuantity(entry: DiceEntry, sources: RollSource[]): RollSource[] {
  const targetQuantity = getLegacyEntrySourceQuantity(entry)
  const sourceQuantity = getTotalSourceQuantity(sources)

  if (sourceQuantity === targetQuantity) {
    return sources
  }

  if (sources.length === 1 && sources[0].kind === 'anonymous') {
    return [createAnonymousRollSource(targetQuantity, sources[0]?.skinId ?? entry.skinId)]
  }

  if (sourceQuantity < targetQuantity) {
    return [
      ...sources,
      createAnonymousRollSource(targetQuantity - sourceQuantity, entry.skinId),
    ]
  }

  let remaining = targetQuantity
  const reconciled: RollSource[] = []

  for (const source of sources) {
    if (remaining <= 0) break

    if (source.kind === 'specific') {
      reconciled.push(source)
      remaining -= 1
      continue
    }

    const keptQuantity = Math.min(getRollSourceQuantity(source), remaining)
    if (keptQuantity > 0) {
      reconciled.push(createAnonymousRollSource(keptQuantity, source.skinId ?? entry.skinId))
      remaining -= keptQuantity
    }
  }

  return reconciled.length > 0
    ? reconciled
    : [createAnonymousRollSource(targetQuantity, entry.skinId)]
}

export function normalizeRollSources(
  entry: DiceEntry,
  options: { reconcileToEntryQuantity?: boolean } = {},
): RollSource[] {
  const { reconcileToEntryQuantity = true } = options
  const sources = Array.isArray(entry.sources)
    ? entry.sources
      .map(source => normalizeRollSource(source, entry.skinId))
      .filter((source): source is RollSource => source !== null)
    : undefined

  if (sources && sources.length > 0) {
    return reconcileToEntryQuantity
      ? reconcileSourcesToEntryQuantity(entry, sources)
      : sources
  }

  return [createAnonymousRollSource(getLegacyEntrySourceQuantity(entry), entry.skinId)]
}

export function getDiceEntrySourceQuantity(entry: DiceEntry): number {
  return normalizeRollSources(entry).reduce(
    (total, source) => total + getRollSourceQuantity(source),
    0
  )
}

/**
 * Resize a source list to an exact dice count.
 *
 * Growing appends generic dice. Shrinking removes generic dice first (from the
 * end) and only then specific owned dice (also from the end), so reducing a
 * count never discards an owned die while generic ones are still available to
 * give up. Dropped owned dice are reported back so the UI can name them —
 * losing a specific die is a destructive edit and must not happen silently.
 *
 * This is deliberately separate from `reconcileSourcesToEntryQuantity`, which
 * repairs already-persisted entries in declaration order; this is the policy
 * for a deliberate, user-driven quantity change.
 */
export function resizeRollSources(
  sources: RollSource[],
  targetQuantity: number,
): { sources: RollSource[]; droppedDieIds: string[] } {
  const target = clampQuantity(targetQuantity)
  const total = getTotalSourceQuantity(sources)

  if (target === total) return { sources: [...sources], droppedDieIds: [] }

  if (target > total) {
    const growth = target - total
    const last = sources[sources.length - 1]

    // Grow a trailing generic group in place rather than appending a new one:
    // repeated increments would otherwise accumulate one source per click, and
    // that bloat renders as a row of "1 generic" chips and persists to storage.
    // Only a skin-less group can absorb plain dice without relabelling them.
    if (last?.kind === 'anonymous' && last.skinId === undefined) {
      const merged = [...sources]
      merged[merged.length - 1] = createAnonymousRollSource(
        getRollSourceQuantity(last) + growth,
      )
      return { sources: merged, droppedDieIds: [] }
    }

    return {
      sources: [...sources, createAnonymousRollSource(growth)],
      droppedDieIds: [],
    }
  }

  let surplus = total - target
  const next = [...sources]
  const droppedDieIds: string[] = []

  // 1. Give up generic dice first, from the end.
  for (let i = next.length - 1; i >= 0 && surplus > 0; i--) {
    const source = next[i]
    if (source.kind !== 'anonymous') continue

    const quantity = getRollSourceQuantity(source)
    const removed = Math.min(quantity, surplus)
    surplus -= removed

    if (removed === quantity) {
      next.splice(i, 1)
    } else {
      next[i] = createAnonymousRollSource(quantity - removed, source.skinId)
    }
  }

  // 2. Only then drop specific owned dice, from the end.
  for (let i = next.length - 1; i >= 0 && surplus > 0; i--) {
    const source = next[i]
    if (source.kind !== 'specific') continue

    droppedDieIds.unshift(source.dieId)
    next.splice(i, 1)
    surplus -= 1
  }

  return { sources: next, droppedDieIds }
}

/**
 * Total physical dice a roll spawns on the table.
 *
 * Sums every entry's source quantity, which is exactly the number of dice
 * `expandDiceEntrySources` produces at execution time, so this is the value to
 * compare against `ROOM_DICE_CAPACITY`.
 */
export function getRollDiceCount(dice: DiceEntry[] | undefined): number {
  if (!Array.isArray(dice)) return 0
  return dice.reduce((total, entry) => total + getDiceEntrySourceQuantity(entry), 0)
}

export function expandDiceEntrySources(entry: DiceEntry): RollSource[] {
  return normalizeRollSources(entry).flatMap(source => {
    if (source.kind === 'specific') return [source]

    return Array.from({ length: getRollSourceQuantity(source) }, () =>
      createAnonymousRollSource(1, source.skinId)
    )
  })
}

export function getSpecificDieIds(entry: DiceEntry): string[] {
  return normalizeRollSources(entry)
    .filter((source): source is Extract<RollSource, { kind: 'specific' }> => source.kind === 'specific')
    .map(source => source.dieId)
}

export function withNormalizedRollSources(entry: DiceEntry): DiceEntry {
  return {
    ...entry,
    sources: normalizeRollSources(entry),
  }
}

export function withRollSources(entry: DiceEntry, sources: RollSource[]): DiceEntry {
  const normalized = normalizeRollSources(
    { ...entry, sources },
    { reconcileToEntryQuantity: false },
  )
  const sourceQuantity = getTotalSourceQuantity(normalized)

  return {
    ...entry,
    quantity: entry.rollCount && entry.rollCount > 0
      ? Math.min(entry.quantity, sourceQuantity)
      : sourceQuantity,
    rollCount: entry.rollCount && entry.rollCount > 0
      ? sourceQuantity
      : entry.rollCount,
    sources: normalized,
  }
}

export function normalizeSavedRollSources(roll: SavedRoll): SavedRoll {
  const dice = Array.isArray(roll.dice)
    ? roll.dice
      .filter(isRecord)
      .map(entry => withNormalizedRollSources(entry as unknown as DiceEntry))
    : []

  return {
    ...roll,
    dice,
  }
}

export function normalizePersistedSavedRoll(value: unknown): SavedRoll | null {
  if (!isRecord(value)) return null
  return normalizeSavedRollSources(value as unknown as SavedRoll)
}
