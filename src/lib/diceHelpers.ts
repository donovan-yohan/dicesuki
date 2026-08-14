/**
 * Dice Helper Functions
 *
 * Utility functions for dice mechanics, validation, and presets.
 */

import { DiceShape } from './geometries'
import {
  CompareMode,
  DiceEntry,
  KeepMode,
  SavedRoll,
  QuickPreset,
} from '../types/savedRolls'
import { getDiceEntrySourceQuantity, getSpecificDieIds } from './rollSources'
import { isPercentileEntry, PERCENTILE_MAX, PERCENTILE_MIN } from './percentileRolls'

/**
 * Get maximum value for a dice type.
 *
 * `d10tens` is the percentile TENS half (faces 00–90); on its own its ceiling is
 * 90. A whole percentile ENTRY tops out at 100 — see [`getEntryMax`], which is
 * what range/validation math should use.
 */
export function getDieMax(type: DiceShape): number {
  const maxValues: Record<DiceShape, number> = {
    d4: 4,
    d6: 6,
    d8: 8,
    d10: 10,
    d10tens: 90,
    d12: 12,
    d20: 20,
  }
  return maxValues[type]
}

/**
 * Get minimum value for a dice type
 */
export function getDieMin(type: DiceShape): number {
  void type
  return 1
}

/**
 * Max value contributed by ONE die of this entry. A percentile entry is a
 * tens+ones pair combined into a single 1–100 result, so it is 100 — not the
 * 90 ceiling of its tens half.
 */
export function getEntryMax(entry: DiceEntry): number {
  return isPercentileEntry(entry) ? PERCENTILE_MAX : getDieMax(entry.type)
}

/**
 * Min value contributed by ONE die of this entry (1 for every die today,
 * including a percentile pair — `00 + 0` reads 100, and `00 + 1` reads 1).
 */
export function getEntryMin(entry: DiceEntry): number {
  return isPercentileEntry(entry) ? PERCENTILE_MIN : getDieMin(entry.type)
}

/**
 * Check if a roll uses success counting mode
 */
export function isSuccessCountingRoll(roll: SavedRoll): boolean {
  return roll.dice.some((d) => d.countSuccesses !== undefined)
}

/**
 * Apply a quick preset to a dice entry
 */
export function applyQuickPreset(entry: DiceEntry, preset: QuickPreset): DiceEntry {
  switch (preset) {
    case 'advantage':
      return {
        ...entry,
        rollCount: 2,
        quantity: 1,
        keepMode: 'highest',
      }

    case 'disadvantage':
      return {
        ...entry,
        rollCount: 2,
        quantity: 1,
        keepMode: 'lowest',
      }

    case 'gwf': // Great Weapon Fighting
      return {
        ...entry,
        reroll: {
          condition: 'lessOrEqual',
          value: 2,
          maxRerolls: 1,
        },
      }

    case 'luck': // Halfling Luck
      return {
        ...entry,
        reroll: {
          condition: 'equals',
          value: 1,
          maxRerolls: 1,
        },
      }

    case 'elvenAccuracy':
      return {
        ...entry,
        rollCount: 3,
        quantity: 1,
        keepMode: 'highest',
      }

    default:
      return entry
  }
}

/**
 * Create a default saved roll
 */
export function createDefaultSavedRoll(): SavedRoll {
  return {
    id: `roll-${Date.now()}`,
    name: 'New Roll',
    dice: [],
    flatBonus: 0,
    createdAt: Date.now(),
  }
}

/**
 * Format a numeric bonus with a leading sign
 * Returns "+N" for positive, "-N" for negative, or "" for zero
 */
export function formatBonus(bonus: number): string {
  if (bonus > 0) return `+${bonus}`
  if (bonus < 0) return `${bonus}`
  return ''
}

/** Comparison operators as they appear in a reroll suffix (`r≤2`). */
const COMPARE_SYMBOLS: Record<CompareMode, string> = {
  equals: '=',
  lessThan: '<',
  lessOrEqual: '≤',
  greaterThan: '>',
  greaterOrEqual: '≥',
}

/**
 * Format a dice entry as readable text
 *
 * A per-die bonus puts the count OUTSIDE the parens and the die INSIDE them:
 * `4(d4+1)` reads as "four of (a d4, plus 1)" — i.e. roll 4d4 and add 1 to each.
 * A negative bonus renders the same way: `4(d4-1)`.
 * With no per-die bonus the plain form is kept: `4d4`.
 *
 * A percentile entry reads as its combined die, not its halves: `1d100`,
 * `4(d100+1)`.
 *
 * Advanced mechanics append in a fixed order so the same entry always reads the
 * same way: exploding binds tightly to the die (`4d6!`, or `4d6!5` for a
 * non-maximum trigger), then keep/drop (` kh1`), reroll (` r≤2`), success
 * counting (` ≥5`) and finally the owned-dice tally (` [2 specific]`).
 * Min/max clamps stay out of the formula — they are a badge, not notation.
 */
export function formatDiceEntry(entry: DiceEntry): string {
  let text = ''

  // Quantity and die type
  const rollCount = entry.rollCount || entry.quantity
  // A percentile entry rolls a tens+ones pair but READS as a single d100.
  const dieLabel = isPercentileEntry(entry) ? 'd100' : entry.type

  if (entry.perDieBonus !== 0) {
    text += `${rollCount}(${dieLabel}${formatBonus(entry.perDieBonus)})`
  } else {
    text += `${rollCount}${dieLabel}`
  }

  // A percentile pair cannot physically explode or reroll (half a pair is not
  // a result), so a legacy/hand-edited entry carrying either must not RENDER
  // them — the plan strips them too, and showing a suffix for something that
  // will not happen is worse than dropping it silently.
  const supportsPhysicalWaves = !isPercentileEntry(entry)

  // Exploding — attached, not spaced, so it reads as part of the die
  if (entry.exploding && supportsPhysicalWaves) {
    text += entry.exploding.on === 'max' ? '!' : `!${entry.exploding.on}`
  }

  // Keep/drop. An absent keepMode means "keep highest" (see KEEP_MODE_DEFAULT),
  // so the notation, the badges and the scoring all agree on advantage.
  if (entry.rollCount && entry.rollCount > entry.quantity) {
    const mode = entry.keepMode === 'lowest' ? 'kl' : 'kh'
    text += ` ${mode}${entry.quantity}`
  }

  // Reroll
  if (entry.reroll && supportsPhysicalWaves) {
    text += ` r${COMPARE_SYMBOLS[entry.reroll.condition]}${entry.reroll.value}`
  }

  // Success counting
  if (entry.countSuccesses) {
    text += ` ≥${entry.countSuccesses.targetNumber}`
  }

  const specificDieCount = getSpecificDieIds(entry).length
  if (specificDieCount > 0) {
    text += ` [${specificDieCount} specific]`
  }

  return text
}

/**
 * Format a complete saved roll as readable text
 * Example: "2d6+1 + 1d20 + 4"
 */
export function formatSavedRoll(roll: SavedRoll): string {
  const parts: string[] = []

  // Add each dice entry
  for (const entry of roll.dice) {
    parts.push(formatDiceEntry(entry))
  }

  // Add flat bonus (handle sign properly in join)
  if (roll.flatBonus !== 0) {
    if (roll.flatBonus > 0) {
      parts.push(`${roll.flatBonus}`)
    } else {
      // Negative bonus - will be displayed as "- 4" instead of "+ -4"
      parts.push(`${roll.flatBonus}`)
    }
  }

  // Join with proper operators
  if (parts.length === 0) return '0'
  if (parts.length === 1) return parts[0]
  
  // Join all parts, handling negative numbers correctly
  let result = parts[0]
  for (let i = 1; i < parts.length; i++) {
    const part = parts[i]
    if (part.startsWith('-')) {
      // Negative number: use minus operator
      result += ` - ${part.substring(1)}`
    } else {
      // Positive number: use plus operator
      result += ` + ${part}`
    }
  }
  return result
}

/**
 * Which dice a keep/drop entry keeps when the entry does not say.
 *
 * `keepMode` is optional on `DiceEntry`, so a hand-edited roll can reach
 * scoring without one. Defaulting here — rather than at each read site — keeps
 * the formula, the badges and the total from disagreeing about what a `2d20`
 * keep-1 entry actually does. Highest matches the builder's own default and
 * the far more common case, advantage.
 */
export const KEEP_MODE_DEFAULT: KeepMode = 'highest'

/**
 * Does this entry keep fewer dice than it rolls?
 *
 * `quantity` is the keep count and `rollCount` the rolled count, so keep/drop
 * is active exactly when a valid `rollCount` exceeds it.
 */
export function hasKeepDrop(entry: Pick<DiceEntry, 'quantity' | 'rollCount'>): boolean {
  return entry.rollCount !== undefined && entry.rollCount > entry.quantity
}

/** How many dice of an entry actually score, after keep/drop. */
export function getKeptDiceCount(entry: DiceEntry): number {
  return hasKeepDrop(entry) ? entry.quantity : getDiceEntrySourceQuantity(entry)
}

export interface DiceRange {
  min: number
  max: number
  /**
   * True when exploding makes the upper bound unreachable-by-construction, so
   * the UI renders `min - max+` instead of a closed interval.
   */
  open?: boolean
}

/**
 * Calculate expected value range for a dice entry
 *
 * Accounts for keep/drop (only kept dice score), min/max clamps (which pull the
 * per-face bounds in, never outside the die's own range), success counting
 * (the range becomes a range of success *counts*, not a sum) and exploding
 * (the sum is open-ended, so `max` is the no-explosion bound flagged `open`).
 * Rerolling does not move either bound: it re-rolls within the same faces.
 */
export function calculateDiceEntryRange(entry: DiceEntry): DiceRange {
  // Per-ENTRY bounds, not per-shape: a percentile pair reads 1-100, not the
  // 0-90 of its tens half.
  const dieMin = getEntryMin(entry)
  const dieMax = getEntryMax(entry)
  const quantity = getKeptDiceCount(entry)

  // Clamps narrow the face range; they can never widen it past the real die.
  const clampFace = (value: number) => Math.min(Math.max(value, dieMin), dieMax)
  const lowFace = clampFace(entry.minimum ?? dieMin)
  const highFace = Math.max(lowFace, clampFace(entry.maximum ?? dieMax))

  if (entry.countSuccesses) {
    // Successes are counted, not summed: every kept die contributes at most one
    // (two on a critical) and at worst zero (minus one on a botch).
    return {
      min: entry.countSuccesses.botchOn !== undefined ? -quantity : 0,
      max: entry.countSuccesses.criticalOn !== undefined ? quantity * 2 : quantity,
    }
  }

  const min = (lowFace + entry.perDieBonus) * quantity
  const max = (highFace + entry.perDieBonus) * quantity

  // Exploding is only open-ended while nothing caps the die total. A maximum
  // clamp applies to the whole chain, so the range closes again — and a
  // percentile entry never explodes at all (`createSavedRollPlan` strips it),
  // so a legacy row carrying the config must not advertise an open top end.
  const isOpen = entry.exploding !== undefined
    && entry.maximum === undefined
    && !isPercentileEntry(entry)
  return isOpen ? { min, max, open: true } : { min, max }
}

/**
 * Calculate expected value range for a complete saved roll
 *
 * The flat bonus is skipped when any entry counts successes, matching
 * `SavedRoll.flatBonus` and `aggregateSavedRollPlan`.
 */
export function calculateSavedRollRange(roll: SavedRoll): DiceRange {
  const includeFlatBonus = !isSuccessCountingRoll(roll)
  let min = includeFlatBonus ? roll.flatBonus : 0
  let max = includeFlatBonus ? roll.flatBonus : 0
  let open = false

  for (const entry of roll.dice) {
    const range = calculateDiceEntryRange(entry)
    min += range.min
    max += range.max
    open = open || range.open === true
  }

  return open ? { min, max, open: true } : { min, max }
}

/**
 * Get display badges for a dice entry's special mechanics
 */
export function getDiceEntryBadges(entry: DiceEntry): string[] {
  const badges: string[] = []

  // Advantage/Disadvantage
  if (hasKeepDrop(entry)) {
    badges.push(entry.keepMode === 'lowest' ? '⬇️ DIS' : '⬆️ ADV')
  }

  // Reroll and exploding are unavailable for a percentile pair (see
  // formatDiceEntry) — badging them would advertise a mechanic that is stripped
  // before it can run.
  const supportsPhysicalWaves = !isPercentileEntry(entry)

  // Reroll
  if (entry.reroll && supportsPhysicalWaves) {
    if (entry.reroll.condition === 'lessOrEqual' && entry.reroll.value === 2) {
      badges.push('⚔️ GWF')
    } else if (entry.reroll.condition === 'equals' && entry.reroll.value === 1) {
      badges.push('🍀 LUCK')
    } else {
      badges.push('♻️ Reroll')
    }
  }

  // Exploding
  if (entry.exploding && supportsPhysicalWaves) {
    badges.push('💥 Explode')
  }

  // Success counting
  if (entry.countSuccesses) {
    badges.push(`✓${entry.countSuccesses.targetNumber}+`)
  }

  // Min/max constraints
  if (entry.minimum !== undefined || entry.maximum !== undefined) {
    badges.push('🎯 Limits')
  }

  const specificDieCount = getSpecificDieIds(entry).length
  if (specificDieCount > 0) {
    badges.push(`${specificDieCount} Owned`)
  }

  return badges
}
