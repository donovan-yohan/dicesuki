/**
 * Crafting System Types
 *
 * Type definitions for the dice crafting system.
 * Players can combine duplicate dice to upgrade type or rarity.
 */

import { DiceShape } from '../lib/geometries'
import { DieRarity } from './inventory'

// ============================================================================
// Crafting Recipes
// ============================================================================

/**
 * Input requirement for a crafting recipe
 */
export interface CraftingInput {
  type: DiceShape
  rarity: DieRarity
  count: number
  setId?: string              // If undefined, any set works
}

/**
 * Output specification for a crafting recipe
 */
export interface CraftingOutput {
  type: DiceShape
  rarity: DieRarity
  setId: string | 'inherit'   // 'inherit' = takes setId from inputs
}

/**
 * Complete crafting recipe definition
 */
export interface CraftingRecipe {
  id: string
  name: string
  description: string

  // Input requirements
  inputs: CraftingInput[]

  // Output
  output: CraftingOutput

  // Additional costs
  coinCost?: number

  // Metadata
  category: 'upgrade-type' | 'upgrade-rarity' | 'special'
  isUnlocked?: boolean        // Future: unlock recipes via progression
}

// ============================================================================
// Crafting State
// ============================================================================

/**
 * Current crafting session state
 */
export interface CraftingSession {
  recipeId: string
  selectedDiceIds: string[]   // Dice selected as inputs
  isValid: boolean            // Can recipe be executed with selected dice?
  previewDie?: {              // Preview of output die
    type: DiceShape
    rarity: DieRarity
    setId: string
  }
}

/**
 * Result of a crafting operation
 */
export interface CraftingResult {
  success: boolean
  consumedDiceIds: string[]   // Dice that were consumed
  createdDieId?: string       // ID of newly created die
  error?: string              // Error message if failed
}

// ============================================================================
// Crafting Helpers
// ============================================================================

/**
 * Recipe validation result
 */
export interface RecipeValidation {
  canCraft: boolean
  reason?: string             // Why recipe can't be crafted
  missingInputs?: Array<{
    type: DiceShape
    rarity: DieRarity
    needed: number
    available: number
  }>
  insufficientCurrency?: {
    needed: number
    available: number
  }
}
