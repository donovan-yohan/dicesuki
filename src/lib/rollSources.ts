import type { DiceEntry, RollSource, SavedRoll } from '../types/savedRolls'

function clampQuantity(quantity: number): number {
  return Math.max(1, Math.floor(quantity))
}

function isRollSource(value: RollSource | undefined): value is RollSource {
  if (!value) return false
  if (value.kind === 'anonymous') return value.quantity >= 1
  return value.dieId.trim().length > 0
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

export function normalizeRollSources(entry: DiceEntry): RollSource[] {
  const sources = entry.sources
    ?.map(source => source.kind === 'anonymous'
      ? createAnonymousRollSource(source.quantity, source.skinId ?? entry.skinId)
      : createSpecificDieRollSource(source.dieId, source.skinId ?? entry.skinId)
    )
    .filter(isRollSource)

  if (sources && sources.length > 0) {
    return sources
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
  const normalized = normalizeRollSources({ ...entry, sources })
  const sourceQuantity = normalized.reduce(
    (total, source) => total + getRollSourceQuantity(source),
    0
  )

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
