/**
 * Dice Value Utilities
 *
 * Helper functions for working with dice values and critical detection.
 */

import type { DiceShape } from './geometries'

/**
 * Get the maximum face value for a given dice type
 */
export function getMaxValueForDice(diceType: DiceShape): number {
  switch (diceType) {
    case 'd4':
      return 4
    case 'd6':
      return 6
    case 'd8':
      return 8
    case 'd10':
      return 9 // D10 shows 0-9, so max is 9
    case 'd12':
      return 12
    case 'd20':
      return 20
    default:
      return 6
  }
}

/**
 * Get the minimum face value for a given dice type
 */
export function getMinValueForDice(diceType: DiceShape): number {
  switch (diceType) {
    case 'd10':
      return 0 // D10 shows 0-9
    default:
      return 1 // Most dice start at 1
  }
}

/**
 * Check if a value is a critical success for the given dice type
 */
export function isCriticalSuccess(diceType: DiceShape, value: number): boolean {
  return value === getMaxValueForDice(diceType)
}

/**
 * Check if a value is a critical failure for the given dice type
 */
export function isCriticalFailure(diceType: DiceShape, value: number): boolean {
  return value === getMinValueForDice(diceType)
}

/**
 * Check if a value is a critical (either success or failure)
 */
export function isCritical(diceType: DiceShape, value: number): boolean {
  return isCriticalSuccess(diceType, value) || isCriticalFailure(diceType, value)
}
