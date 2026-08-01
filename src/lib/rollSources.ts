import type { DiceEntry, RollSource, SavedRoll } from '../types/savedRolls'
import { isPercentileEntry, type PercentileRole } from './percentileRolls'

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
 * Collapse a per-die SLOT list back into storage-shaped source groups.
 *
 * {@link expandDiceEntrySources} is lossless but emits one source per die.
 * Persisting that shape would bloat the stored roll and render as a row of
 * "1 generic" chips — the same bloat {@link resizeRollSources} avoids by
 * growing a trailing group in place. Merging ADJACENT anonymous slots that
 * share a skin keeps pin ORDER visible (a pinned die stays where the player put
 * it) while runs of plain dice collapse back to a single chip.
 *
 * Only adjacent slots merge: reordering would move a pinned die relative to the
 * generic dice around it, and slot order is what the picker shows the player.
 */
export function collapseRollSources(slots: readonly RollSource[]): RollSource[] {
  const collapsed: RollSource[] = []

  for (const slot of slots) {
    const last = collapsed[collapsed.length - 1]
    if (slot.kind === 'anonymous' && last?.kind === 'anonymous' && last.skinId === slot.skinId) {
      collapsed[collapsed.length - 1] = createAnonymousRollSource(
        getRollSourceQuantity(last) + getRollSourceQuantity(slot),
        slot.skinId,
      )
      continue
    }
    collapsed.push(slot)
  }

  return collapsed
}

/** How an entry's dice are divided between pinned owned dice and auto fill. */
export interface EntrySlotSummary {
  /** Dice this entry rolls — always `pinned + auto`. */
  total: number
  /** Slots pinned to a specific owned die. */
  pinned: number
  /**
   * Slots left to owned-first auto fill: any free owned die of the type, then a
   * basic die once they run out (`spawnEntry` in `savedRollExecution.ts`).
   */
  auto: number
}

/** Split an entry's slots into pinned and auto, for the picker's summary line. */
export function getEntrySlotSummary(entry: DiceEntry): EntrySlotSummary {
  const slots = expandDiceEntrySources(entry)
  const pinned = slots.filter((slot) => slot.kind === 'specific').length
  return { total: slots.length, pinned, auto: slots.length - pinned }
}

/**
 * Pin an owned die into this entry's first AUTO slot.
 *
 * Pinning NEVER changes how many dice the entry rolls — it only decides which
 * physical die fills a slot the entry already had. That invariant is what keeps
 * the picker out of the count/capacity rules S1 owns: an entry with no auto slot
 * left is returned unchanged (the caller disables the tile and says why) rather
 * than silently growing.
 *
 * Pinning the same die twice is a no-op: one inventory die is one physical die,
 * and `spawnEntry` marks it pending the moment it is sent, so a second slot
 * claiming it would quietly spawn a basic.
 */
export function pinDieToEntry(entry: DiceEntry, dieId: string): DiceEntry {
  const slots = expandDiceEntrySources(entry)
  if (slots.some((slot) => slot.kind === 'specific' && slot.dieId === dieId)) return entry

  const slotIndex = slots.findIndex((slot) => slot.kind === 'anonymous')
  if (slotIndex === -1) return entry

  const next = [...slots]
  next[slotIndex] = createSpecificDieRollSource(dieId)
  return withRollSources(entry, collapseRollSources(next))
}

/**
 * Release a pinned owned die back to auto fill, keeping the entry's dice count.
 *
 * The freed slot becomes a plain anonymous source with no skin — the same shape
 * {@link resizeRollSources} grows into — so an unpinned slot is indistinguishable
 * from one the player never pinned.
 */
export function unpinDieFromEntry(entry: DiceEntry, dieId: string): DiceEntry {
  const slots = expandDiceEntrySources(entry)
  const slotIndex = slots.findIndex((slot) => slot.kind === 'specific' && slot.dieId === dieId)
  if (slotIndex === -1) return entry

  const next = [...slots]
  next[slotIndex] = createAnonymousRollSource(1)
  return withRollSources(entry, collapseRollSources(next))
}

/**
 * Total physical dice a roll spawns on the table.
 *
 * Counts exactly what {@link expandDiceEntrySpawns} produces at execution time —
 * the SAME function the saved-roll executor iterates — so the builder's
 * validation and the execution guard can never disagree about how many dice a
 * roll needs. That equivalence is what makes this the value to compare against
 * `ROOM_DICE_CAPACITY`.
 *
 * Note this is physical dice, not roll sources: a percentile (d100) source is
 * two dice.
 */
export function getRollDiceCount(dice: DiceEntry[] | undefined): number {
  if (!Array.isArray(dice)) return 0
  return dice.reduce((total, entry) => total + expandDiceEntrySpawns(entry).length, 0)
}

/**
 * The LOGICAL roll sources of an entry, one per die the player asked for.
 *
 * A percentile entry has one source per d100 — use {@link expandDiceEntrySpawns}
 * when you need physical dice, since a d100 is spawned as two.
 */
export function expandDiceEntrySources(entry: DiceEntry): RollSource[] {
  return normalizeRollSources(entry).flatMap(source => {
    if (source.kind === 'specific') return [source]

    return Array.from({ length: getRollSourceQuantity(source) }, () =>
      createAnonymousRollSource(1, source.skinId)
    )
  })
}

/** One PHYSICAL die a roll entry puts on the table. */
export interface RollSpawn {
  /** The roll source this die comes from. */
  source: RollSource
  /**
   * Percentile (d100) pairing. Present only for percentile entries; the two
   * halves of one d100 share a `pairIndex`. The executor turns that index into
   * the `presentation.percentilePairId` both halves carry
   * (`src/lib/percentileRolls.ts`).
   */
  percentile?: { role: PercentileRole; pairIndex: number }
}

/**
 * Every PHYSICAL die an entry spawns, in spawn order.
 *
 * A d100 is not one die: it is a TENS die plus a ONES die, so a percentile entry
 * yields two spawns per source. Expanding here — rather than at the call site —
 * is what keeps {@link getRollDiceCount} (builder validation + the execution
 * capacity guard) and the executor's spawn loop counting the same dice.
 */
export function expandDiceEntrySpawns(entry: DiceEntry): RollSpawn[] {
  const sources = expandDiceEntrySources(entry)

  if (!isPercentileEntry(entry)) {
    return sources.map((source) => ({ source }))
  }

  return sources.flatMap((source, pairIndex) => [
    // The tens die is always a plain engine die — it can never be an owned die,
    // so it deliberately does NOT inherit the entry's (possibly specific) source.
    { source: createAnonymousRollSource(1), percentile: { role: 'tens' as const, pairIndex } },
    { source, percentile: { role: 'ones' as const, pairIndex } },
  ])
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
