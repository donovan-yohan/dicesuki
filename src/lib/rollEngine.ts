/**
 * Roll Engine
 *
 * Core logic for executing dice rolls with advanced mechanics.
 * Handles keep/drop, exploding, rerolls, success counting, and more.
 */

import { DiceShape } from './geometries'
import {
  DiceEntry,
  SavedRoll,
  DiceEntryResult,
  SavedRollResult,
  SingleDieRoll,
  CompareMode,
} from '../types/savedRolls'
import { getDieMax, getDieMin } from './diceHelpers'

/**
 * Roll a single die
 * Returns a value between min and max for the die type
 */
export function rollSingleDie(type: DiceShape): number {
  const min = getDieMin(type)
  const max = getDieMax(type)
  return Math.floor(Math.random() * (max - min + 1)) + min
}

/**
 * Check if a value meets a condition
 */
function meetsCondition(value: number, condition: CompareMode, target: number): boolean {
  switch (condition) {
    case 'equals':
      return value === target
    case 'lessThan':
      return value < target
    case 'lessOrEqual':
      return value <= target
    case 'greaterThan':
      return value > target
    case 'greaterOrEqual':
      return value >= target
    default:
      return false
  }
}

/**
 * Roll a single die with reroll logic
 */
function rollWithReroll(
  type: DiceShape,
  entry: DiceEntry
): { value: number; originalValue?: number; wasRerolled: boolean } {
  let value = rollSingleDie(type)
  const originalValue = value
  let rerollCount = 0
  let wasRerolled = false

  if (entry.reroll) {
    const maxRerolls = entry.reroll.maxRerolls ?? 1
    const recursive = entry.reroll.recursive ?? false

    while (rerollCount < maxRerolls && meetsCondition(value, entry.reroll.condition, entry.reroll.value)) {
      value = rollSingleDie(type)
      wasRerolled = true
      rerollCount++

      if (!recursive) {
        break
      }
    }
  }

  return {
    value,
    originalValue: wasRerolled ? originalValue : undefined,
    wasRerolled,
  }
}

/**
 * Apply value constraints (min/max) to a die value
 */
function applyConstraints(value: number, entry: DiceEntry): number {
  let constrained = value

  if (entry.minimum !== undefined) {
    constrained = Math.max(constrained, entry.minimum)
  }

  if (entry.maximum !== undefined) {
    constrained = Math.min(constrained, entry.maximum)
  }

  return constrained
}

/**
 * Roll a single die completely (with all mechanics)
 * Order of operations:
 * 1. Roll initial value
 * 2. Apply rerolls if needed
 * 3. Check for explosions
 * 4. Return complete result
 */
function rollDieCompletely(type: DiceShape, entry: DiceEntry): {
  value: number
  originalValue?: number
  wasRerolled: boolean
  explosions?: number[]
} {
  // Step 1 & 2: Roll with rerolls
  const rerollResult = rollWithReroll(type, entry)
  let value = rerollResult.value
  const explosions: number[] = []

  // Step 3: Check for explosions
  if (entry.exploding) {
    const explodeValue = entry.exploding.on === 'max' ? getDieMax(type) : entry.exploding.on
    const maxExplosions = entry.exploding.limit ?? Infinity
    let explosionCount = 0

    while (value === explodeValue && explosionCount < maxExplosions) {
      const explosion = rollSingleDie(type)
      explosions.push(explosion)
      value = explosion
      explosionCount++
    }
  }

  // Calculate total value (initial + all explosions)
  const totalValue = rerollResult.value + explosions.reduce((sum, exp) => sum + exp, 0)

  return {
    value: totalValue,
    originalValue: rerollResult.originalValue,
    wasRerolled: rerollResult.wasRerolled,
    explosions: explosions.length > 0 ? explosions : undefined,
  }
}

/**
 * Roll all dice for a dice entry
 */
export function rollDiceEntry(entry: DiceEntry): DiceEntryResult {
  const rollCount = entry.rollCount || entry.quantity
  const rolls: SingleDieRoll[] = []

  // Roll all dice
  for (let i = 0; i < rollCount; i++) {
    const dieResult = rollDieCompletely(entry.type, entry)

    // Apply constraints
    let value = applyConstraints(dieResult.value, entry)

    // Apply per-die bonus
    value += entry.perDieBonus

    rolls.push({
      value,
      originalValue: dieResult.originalValue,
      wasRerolled: dieResult.wasRerolled,
      explosions: dieResult.explosions,
      wasKept: false, // Will be updated after keep/drop logic
    })
  }

  // Sort and apply keep/drop logic
  if (rollCount > entry.quantity) {
    // Sort based on keep mode
    const sorted = [...rolls].sort((a, b) => {
      if (entry.keepMode === 'highest') {
        return b.value - a.value // Descending
      } else {
        return a.value - b.value // Ascending
      }
    })

    // Mark kept dice
    for (let i = 0; i < entry.quantity; i++) {
      const dieToKeep = sorted[i]
      const originalIndex = rolls.indexOf(dieToKeep)
      rolls[originalIndex].wasKept = true
    }
  } else {
    // Keep all dice
    rolls.forEach((roll) => {
      roll.wasKept = true
    })
  }

  // Calculate subtotal and success count
  let subtotal = 0
  let successCount = 0

  if (entry.countSuccesses) {
    // Success counting mode
    for (const roll of rolls) {
      if (!roll.wasKept) continue

      if (meetsCondition(roll.value, 'greaterOrEqual', entry.countSuccesses.targetNumber)) {
        // Check for critical
        if (entry.countSuccesses.criticalOn !== undefined && roll.value === entry.countSuccesses.criticalOn) {
          successCount += 2
        } else {
          successCount += 1
        }
      }

      // Check for botch
      if (entry.countSuccesses.botchOn !== undefined && roll.value === entry.countSuccesses.botchOn) {
        successCount -= 1
      }
    }
  } else {
    // Standard summing mode
    for (const roll of rolls) {
      if (roll.wasKept) {
        subtotal += roll.value
      }
    }
  }

  return {
    entryId: entry.id,
    diceType: entry.type,
    rolls,
    subtotal,
    successCount: entry.countSuccesses ? successCount : undefined,
    perDieBonus: entry.perDieBonus,
  }
}

/**
 * Execute a complete saved roll
 */
export function executeSavedRoll(roll: SavedRoll): SavedRollResult {
  const diceResults: DiceEntryResult[] = []
  let total = 0
  let isSuccessCounting = false

  // Roll each dice entry
  for (const entry of roll.dice) {
    const result = rollDiceEntry(entry)
    diceResults.push(result)

    if (result.successCount !== undefined) {
      isSuccessCounting = true
      total += result.successCount
    } else {
      total += result.subtotal
    }
  }

  // Add flat bonus (only if not success counting)
  if (!isSuccessCounting) {
    total += roll.flatBonus
  }

  return {
    rollId: roll.id,
    rollName: roll.name,
    diceResults,
    flatBonus: roll.flatBonus,
    total,
    isSuccessCounting,
    timestamp: Date.now(),
  }
}
