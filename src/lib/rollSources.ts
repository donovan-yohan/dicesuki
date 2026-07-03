import type { DiceEntry, RollSource, SavedRoll } from '../types/savedRolls'

function clampQuantity(quantity: number): number {
  if (!Number.isFinite(quantity)) return 1
  return Math.max(1, Math.floor(quantity))
}

function normalizeRollSource(value: RollSource | undefined, fallbackSkinId?: string): RollSource | null {
  if (!value) return null

  if (value.kind === 'anonymous') {
    return createAnonymousRollSource(value.quantity, value.skinId ?? fallbackSkinId)
  }

  if (value.kind === 'specific' && typeof value.dieId === 'string') {
    const dieId = value.dieId.trim()
    if (dieId.length > 0) {
      return createSpecificDieRollSource(dieId, value.skinId ?? fallbackSkinId)
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

  if (sources.every(source => source.kind === 'anonymous')) {
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
  const sources = entry.sources
    ?.map(source => normalizeRollSource(source, entry.skinId))
    .filter((source): source is RollSource => source !== null)

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
  return {
    ...roll,
    dice: roll.dice.map(withNormalizedRollSources),
  }
}
