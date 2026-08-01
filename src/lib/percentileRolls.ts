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
 * ## Server-total divergence (deliberate, display-only)
 * The room's `RollComplete.total` (`take_completed_rolls` in
 * `server/core/src/room.rs`) is a PLAIN sum of raw face values, and it stays that
 * way — the server must not need to know which dice were paired. For every
 * percentile result except `00 + 0` the plain sum already equals the combined
 * value, so the server total is correct. Only the `00 + 0` case diverges: the
 * server reports 0 while the player sees 100. The +100 correction lives here and
 * is applied in the CLIENT aggregation paths (result HUD + roll history), never
 * server-side.
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

/**
 * A percentile pairing recorded at spawn time: which tens die belongs to which
 * ones die. Without it a table holding several d100 rolls could not tell which
 * `0` ones die belongs to the `00` tens die.
 */
export interface PercentilePair {
  tensDieId: string
  onesDieId: string
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
 * The correction to add to a PLAIN face-value sum so paired percentile dice read
 * 1–100. Every pair except `00 + 0` already sums correctly, so this is
 * `+100` per double-zero pair and 0 otherwise.
 *
 * @param faceValues - face value by die id, for the dice being summed
 * @param pairs - percentile pairings for the active roll (may reference dice
 *   that are not in `faceValues`, e.g. filtered out per player — those are skipped)
 */
export function percentileSumCorrection(
  faceValues: ReadonlyMap<string, number>,
  pairs: readonly PercentilePair[] | undefined,
): number {
  if (!pairs || pairs.length === 0) return 0

  let correction = 0
  for (const pair of pairs) {
    const tens = faceValues.get(pair.tensDieId)
    const ones = faceValues.get(pair.onesDieId)
    // Both halves must be present and settled; a half-visible pair is left alone.
    if (tens === undefined || ones === undefined) continue
    correction += combinePercentile(tens, ones) - (tens + ones)
  }
  return correction
}

/**
 * Group settled dice into percentile pairs and loose dice, preserving order.
 * Used by the result HUD so a d100 shows as ONE `1d100` chip instead of two
 * meaningless halves.
 */
export function groupPercentileResults<T extends { diceId: string; value: number }>(
  dice: readonly T[],
  pairs: readonly PercentilePair[] | undefined,
): Array<
  | { kind: 'die'; die: T }
  | { kind: 'percentile'; tens: T; ones: T; value: number }
> {
  const byId = new Map(dice.map((die) => [die.diceId, die]))
  const pairedIds = new Map<string, PercentilePair>()

  for (const pair of pairs ?? []) {
    if (!byId.has(pair.tensDieId) || !byId.has(pair.onesDieId)) continue
    pairedIds.set(pair.tensDieId, pair)
    pairedIds.set(pair.onesDieId, pair)
  }

  const emitted = new Set<string>()
  const grouped: Array<
    | { kind: 'die'; die: T }
    | { kind: 'percentile'; tens: T; ones: T; value: number }
  > = []

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
    /* c8 ignore next 4 -- unreachable: pairedIds only holds fully-present pairs */
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
