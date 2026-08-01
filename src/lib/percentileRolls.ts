/**
 * Percentile (d100) roll semantics — the single source of truth for how a
 * TENS die + ONES die pair becomes one 1–100 result.
 *
 * ## Shape of a percentile roll
 * A d100 is not a hundred-sided solid: it is two physical dice.
 * - the TENS die (`d10tens`) reads `00, 10, … 90`
 * - the ONES die (`d10`) reads `0 … 9`
 * - the combined result is `tens + ones`, except `00 + 0` which reads **100**.
 *
 * ## Where the pairing lives: on the DICE, not on the roll
 * Which tens die belongs to which ones die is carried in each die's
 * `presentation` block (`percentilePairId` + `percentileRole`) — the
 * client→server display channel that Shared-ADR-005 already echoes back on
 * `dice_spawned` and `roll_complete.results[].presentation`.
 *
 * That placement is load-bearing, not incidental. Pairing held in transient
 * local roll state would be lost the moment the table is edited (adding a die
 * clears the active saved roll), would never reach REMOTE players, and would not
 * survive a refresh or reconnect — in all three cases the pair silently degrades
 * into two uncorrected halves. Because the pairing travels with the dice, every
 * client that can see the dice can reconstruct it.
 *
 * ## Server-total divergence (deliberate, display-only)
 * The room's `RollComplete.total` (`take_completed_rolls` in
 * `server/core/src/room.rs`) is a PLAIN sum of raw face values, and it stays that
 * way — the server treats `presentation` as opaque display metadata and must not
 * need to interpret it. For every percentile result except `00 + 0` the plain sum
 * already equals the combined value, so the server total is correct. Only the
 * `00 + 0` case diverges: the server reports 0 while the player sees 100. The
 * +100 correction lives here and is applied in the CLIENT aggregation paths
 * (result HUD + roll history), never server-side.
 */

import type { DiceEntry } from '../types/savedRolls'

/** Engine shape of the percentile tens die (faces 00–90). */
export const PERCENTILE_TENS_SHAPE = 'd10tens'

/** Engine shape of the percentile ones die (faces 0–9). */
export const PERCENTILE_ONES_SHAPE = 'd10'

/** Lowest possible percentile result. */
export const PERCENTILE_MIN = 1

/** Highest possible percentile result (`00 + 0`). */
export const PERCENTILE_MAX = 100

/** Which half of a percentile pair a die is. */
export type PercentileRole = 'tens' | 'ones'

/**
 * The percentile fields carried on a die's `presentation` block. Kept structural
 * so spawned dice, settled dice and history records all satisfy it without the
 * modules having to import each other.
 */
export interface PercentilePresentationFields {
  percentilePairId?: string
  percentileRole?: PercentileRole
}

/** Minimum shape this module needs to identify a die on the table. */
export interface PercentileDieRef {
  diceId: string
  presentation?: PercentilePresentationFields | null
}

/** A settled die: an identified die plus its face value. */
export interface PercentileSettledDie extends PercentileDieRef {
  value: number
}

/** A reconstructed percentile pairing. */
export interface PercentilePair {
  tensDieId: string
  onesDieId: string
}

/** Presentation fields marking a die as the TENS half of pair `pairId`. */
export function percentileTensPresentation(pairId: string): Required<PercentilePresentationFields> {
  return { percentilePairId: pairId, percentileRole: 'tens' }
}

/** Presentation fields marking a die as the ONES half of pair `pairId`. */
export function percentileOnesPresentation(pairId: string): Required<PercentilePresentationFields> {
  return { percentilePairId: pairId, percentileRole: 'ones' }
}

/**
 * Reconstruct the percentile pairings among `dice` from their presentation
 * blocks. A pairing only counts when BOTH halves are present with distinct
 * roles, so a half-visible pair (per-player filtering, a removed die, a stray
 * tens die) is simply not a pair: left uncorrected and ungrouped rather than
 * guessed at.
 *
 * Pairs are returned in the order their first half appears in `dice`.
 */
export function derivePercentilePairs(dice: readonly PercentileDieRef[]): PercentilePair[] {
  const byPairId = new Map<string, { tens?: string; ones?: string }>()
  const order: string[] = []

  for (const die of dice) {
    const pairId = die.presentation?.percentilePairId
    const role = die.presentation?.percentileRole
    if (!pairId || (role !== 'tens' && role !== 'ones')) continue

    let slot = byPairId.get(pairId)
    if (!slot) {
      slot = {}
      byPairId.set(pairId, slot)
      order.push(pairId)
    }
    // First writer wins, so a duplicated role can never silently re-pair a die.
    if (slot[role] === undefined) slot[role] = die.diceId
  }

  const pairs: PercentilePair[] = []
  for (const pairId of order) {
    const slot = byPairId.get(pairId)
    if (slot?.tens !== undefined && slot.ones !== undefined) {
      pairs.push({ tensDieId: slot.tens, onesDieId: slot.ones })
    }
  }
  return pairs
}

/**
 * Combine one tens face (0/10/…/90) and one ones face (0–9) into a 1–100 result.
 * `00 + 0` is 100 — the standard percentile convention.
 */
export function combinePercentile(tensFace: number, onesFace: number): number {
  const sum = tensFace + onesFace
  return sum === 0 ? PERCENTILE_MAX : sum
}

/**
 * The correction to add to a PLAIN face-value sum of `dice` so paired percentile
 * dice read 1–100. Every pair except `00 + 0` already sums correctly, so this is
 * `+100` per double-zero pair and 0 otherwise.
 */
export function percentileSumCorrection(dice: readonly PercentileSettledDie[]): number {
  const pairs = derivePercentilePairs(dice)
  if (pairs.length === 0) return 0

  const faces = new Map(dice.map((die) => [die.diceId, die.value]))
  let correction = 0
  for (const pair of pairs) {
    const tens = faces.get(pair.tensDieId)
    const ones = faces.get(pair.onesDieId)
    /* c8 ignore next -- unreachable: pairs only reference dice from this list */
    if (tens === undefined || ones === undefined) continue
    correction += combinePercentile(tens, ones) - (tens + ones)
  }
  return correction
}

/** A settled die, or a percentile pair collapsed into one combined result. */
export type PercentileResultGroup<T> =
  | { kind: 'die'; die: T }
  | { kind: 'percentile'; tens: T; ones: T; value: number }

/**
 * Group settled dice into percentile pairs and loose dice, preserving order.
 * Used by the result HUD and the history breakdown so a d100 shows as ONE
 * combined result instead of two meaningless halves.
 */
export function groupPercentileResults<T extends PercentileSettledDie>(
  dice: readonly T[],
): Array<PercentileResultGroup<T>> {
  const pairs = derivePercentilePairs(dice)
  if (pairs.length === 0) {
    return dice.map((die) => ({ kind: 'die', die }))
  }

  const byId = new Map(dice.map((die) => [die.diceId, die]))
  const pairedIds = new Map<string, PercentilePair>()
  for (const pair of pairs) {
    pairedIds.set(pair.tensDieId, pair)
    pairedIds.set(pair.onesDieId, pair)
  }

  const emitted = new Set<string>()
  const grouped: Array<PercentileResultGroup<T>> = []

  for (const die of dice) {
    if (emitted.has(die.diceId)) continue

    const pair = pairedIds.get(die.diceId)
    if (!pair) {
      grouped.push({ kind: 'die', die })
      emitted.add(die.diceId)
      continue
    }

    const tens = byId.get(pair.tensDieId)
    const ones = byId.get(pair.onesDieId)
    /* c8 ignore next 5 -- unreachable: pairs only reference dice from this list */
    if (!tens || !ones) {
      grouped.push({ kind: 'die', die })
      emitted.add(die.diceId)
      continue
    }

    grouped.push({ kind: 'percentile', tens, ones, value: combinePercentile(tens.value, ones.value) })
    emitted.add(tens.diceId)
    emitted.add(ones.diceId)
  }

  return grouped
}

/**
 * True when this entry rolls percentile pairs rather than plain dice.
 * A percentile entry keeps `type: 'd10'` (the ones half) so every legacy
 * consumer stays correct; the `percentile` flag is the only discriminator.
 */
export function isPercentileEntry(entry: DiceEntry): boolean {
  return entry.percentile === true
}

/** Face label drawn on a die face: the tens die is labelled `00`, `10`, … `90`. */
export function formatDieFaceLabel(shape: string, faceValue: number): string {
  return shape === PERCENTILE_TENS_SHAPE
    ? faceValue.toString().padStart(2, '0')
    : faceValue.toString()
}

/**
 * Human label for a die SHAPE in result/history chips.
 *
 * `d10tens` must NEVER surface raw: an unpaired stray tens die (partner removed,
 * filtered out by the per-player view, or spawned alone) still has to read as
 * something a player understands. Everything else is the uppercased shape.
 */
export function formatDiceShapeLabel(shape: string): string {
  return shape === PERCENTILE_TENS_SHAPE ? 'D100 (tens)' : shape.toUpperCase()
}
