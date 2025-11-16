/**
 * Dice Helper Functions
 *
 * Utility functions for dice mechanics, validation, and presets.
 */

import { DiceShape } from './geometries'
import {
  DiceEntry,
  SavedRoll,
  QuickPreset,
} from '../types/savedRolls'

/**
 * Get maximum value for a dice type
 */
export function getDieMax(type: DiceShape): number {
  const maxValues: Record<DiceShape, number> = {
    d4: 4,
    d6: 6,
    d8: 8,
    d10: 10,
    d12: 12,
    d20: 20,
  }
  return maxValues[type]
}

/**
 * Get minimum value for a dice type
 */
export function getDieMin(_type: DiceShape): number {
  return 1
}

/**
 * Check if a roll uses success counting mode
 */
export function isSuccessCountingRoll(roll: SavedRoll): boolean {
  return roll.dice.some((d) => d.countSuccesses !== undefined)
}

/**
 * Validate a dice entry for logical consistency
 */
export function validateDiceEntry(entry: DiceEntry): void {
  // Basic validation
  if (entry.quantity < 1) {
    throw new Error('Quantity must be at least 1')
  }

  // rollCount validation
  if (entry.rollCount !== undefined) {
    if (entry.rollCount < entry.quantity) {
      throw new Error('Cannot keep more dice than you roll')
    }
    if (entry.rollCount > entry.quantity && !entry.keepMode) {
      throw new Error('keepMode required when rollCount > quantity')
    }
  }

  // Exploding validation
  if (entry.exploding) {
    const maxValue = getDieMax(entry.type)
    if (
      typeof entry.exploding.on === 'number' &&
      (entry.exploding.on < 1 || entry.exploding.on > maxValue)
    ) {
      throw new Error(`Exploding value must be between 1 and ${maxValue}`)
    }
  }

  // Success counting validation
  if (entry.countSuccesses) {
    const maxValue = getDieMax(entry.type)
    if (entry.countSuccesses.targetNumber > maxValue + entry.perDieBonus) {
      throw new Error('Target number cannot exceed die maximum + bonus')
    }
  }

  // Min/max validation
  if (entry.minimum !== undefined && entry.maximum !== undefined) {
    if (entry.minimum > entry.maximum) {
      throw new Error('Minimum cannot be greater than maximum')
    }
  }
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
 * Create a default dice entry
 */
export function createDefaultDiceEntry(type: DiceShape): DiceEntry {
  return {
    id: `dice-${Date.now()}-${Math.random().toString(36).substring(7)}`,
    type,
    quantity: 1,
    perDieBonus: 0,
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
 * Format a dice entry as readable text (e.g., "2d6+1")
 */
export function formatDiceEntry(entry: DiceEntry): string {
  let text = ''

  // Quantity and type
  const rollCount = entry.rollCount || entry.quantity
  text += `${rollCount}${entry.type}`

  // Per-die bonus
  if (entry.perDieBonus !== 0) {
    const sign = entry.perDieBonus > 0 ? '+' : ''
    text += `${sign}${entry.perDieBonus}`
  }

  // Keep/drop
  if (entry.rollCount && entry.rollCount > entry.quantity) {
    const mode = entry.keepMode === 'highest' ? 'kh' : 'kl'
    text += ` ${mode}${entry.quantity}`
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
 * Calculate expected value range for a dice entry
 */
export function calculateDiceEntryRange(entry: DiceEntry): { min: number; max: number } {
  const dieMin = getDieMin(entry.type)
  const dieMax = getDieMax(entry.type)

  // Apply per-die bonus
  const effectiveMin = Math.max(entry.minimum || dieMin, dieMin) + entry.perDieBonus
  const effectiveMax = Math.min(entry.maximum || dieMax, dieMax) + entry.perDieBonus

  // Multiply by kept quantity
  return {
    min: effectiveMin * entry.quantity,
    max: effectiveMax * entry.quantity,
  }
}

/**
 * Calculate expected value range for a complete saved roll
 */
export function calculateSavedRollRange(roll: SavedRoll): { min: number; max: number } {
  let min = roll.flatBonus
  let max = roll.flatBonus

  for (const entry of roll.dice) {
    const range = calculateDiceEntryRange(entry)
    min += range.min
    max += range.max
  }

  return { min, max }
}

/**
 * Get display badges for a dice entry's special mechanics
 */
export function getDiceEntryBadges(entry: DiceEntry): string[] {
  const badges: string[] = []

  // Advantage/Disadvantage
  if (entry.rollCount && entry.rollCount > entry.quantity) {
    if (entry.keepMode === 'highest') {
      badges.push('⬆️ ADV')
    } else if (entry.keepMode === 'lowest') {
      badges.push('⬇️ DIS')
    }
  }

  // Reroll
  if (entry.reroll) {
    if (entry.reroll.condition === 'lessOrEqual' && entry.reroll.value === 2) {
      badges.push('⚔️ GWF')
    } else if (entry.reroll.condition === 'equals' && entry.reroll.value === 1) {
      badges.push('🍀 LUCK')
    } else {
      badges.push('♻️ Reroll')
    }
  }

  // Exploding
  if (entry.exploding) {
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

  return badges
}
