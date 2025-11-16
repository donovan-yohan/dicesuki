/**
 * Saved Rolls Types
 *
 * Comprehensive type definitions for the dice roll builder system.
 * Supports D&D 5e, Shadowrun, World of Darkness, and custom systems.
 */

import { DiceShape } from '../lib/geometries'

export type KeepMode = 'highest' | 'lowest'
export type CompareMode = 'equals' | 'lessThan' | 'lessOrEqual' | 'greaterThan' | 'greaterOrEqual'

/**
 * Exploding dice configuration
 * Dice "explode" (roll additional dice) when certain values are rolled
 */
export interface ExplodingConfig {
  on: number | 'max'    // Explode when die shows this value (or 'max' for highest face)
  limit?: number        // Max explosions per die (undefined = infinite)
}

/**
 * Reroll configuration
 * Allows rerolling dice that meet certain conditions
 */
export interface RerollConfig {
  condition: CompareMode
  value: number
  maxRerolls?: number   // Default: 1 (reroll once per die)
  recursive?: boolean   // Default: false (if true, keep rerolling until condition not met)
}

/**
 * Success counting configuration
 * Instead of summing dice, count how many meet a threshold
 */
export interface SuccessCountingConfig {
  targetNumber: number  // Success if die >= this (after modifiers)
  criticalOn?: number   // If die shows this, count as 2 successes
  botchOn?: number      // If die shows this, subtract 1 success
}

/**
 * Individual dice entry in a saved roll
 * Represents one group of dice with shared properties
 */
export interface DiceEntry {
  id: string
  type: DiceShape
  quantity: number        // How many dice to KEEP in final result
  perDieBonus: number     // Applied to each die individually (e.g., +1 in "d6+1")

  // Keep/Drop Mechanics
  rollCount?: number      // Total dice to roll (if > quantity, drop some)
  keepMode?: KeepMode     // Which dice to keep when rollCount > quantity

  // Exploding Dice
  exploding?: ExplodingConfig

  // Reroll Mechanics
  reroll?: RerollConfig

  // Value Constraints
  minimum?: number        // Treat any die result below this as this value
  maximum?: number        // Treat any die result above this as this value (rare)

  // Success Counting (alternative mode)
  countSuccesses?: SuccessCountingConfig

  // Future: specific dice skin/texture to use
  skinId?: string
}

/**
 * Complete saved roll configuration
 * Represents a saved "favorite" roll with metadata
 */
export interface SavedRoll {
  id: string
  name: string
  dice: DiceEntry[]
  flatBonus: number       // Added after all dice (ignored if all dice use countSuccesses)

  // Metadata
  createdAt: number
  lastUsed?: number
  description?: string
  tags?: string[]         // For organization: ['combat', 'spell', 'damage']
  damageType?: string     // 'fire', 'cold', 'slashing', etc.
  isFavorite?: boolean    // Star favorite for quick access
}

/**
 * Quick preset configurations for common mechanics
 */
export type QuickPreset = 'advantage' | 'disadvantage' | 'gwf' | 'luck' | 'elvenAccuracy'

/**
 * Result of rolling a single die (before keep/drop)
 */
export interface SingleDieRoll {
  value: number
  originalValue?: number  // If rerolled, what was the original?
  wasRerolled?: boolean
  explosions?: number[]   // Array of explosion values
  wasKept: boolean        // Was this die kept in the final result?
}

/**
 * Result of rolling all dice for one DiceEntry
 */
export interface DiceEntryResult {
  entryId: string
  diceType: DiceShape
  rolls: SingleDieRoll[]
  subtotal: number        // Sum of kept dice (after bonuses)
  successCount?: number   // If using success counting
  perDieBonus: number
}

/**
 * Complete result of executing a SavedRoll
 */
export interface SavedRollResult {
  rollId: string
  rollName: string
  diceResults: DiceEntryResult[]
  flatBonus: number
  total: number           // Final total (sum or success count)
  isSuccessCounting: boolean
  timestamp: number
}
