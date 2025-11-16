/**
 * Crafting Recipes Configuration
 *
 * Defines all available crafting recipes for combining dice.
 * Two main types: Type Upgrades (d6 -> d8) and Rarity Upgrades (common -> uncommon)
 */

import { CraftingRecipe } from '../types/crafting'
import { DieRarity } from '../types/inventory'

// ============================================================================
// Type Upgrade Recipes (Combine Same Type -> Higher Type)
// ============================================================================

/**
 * Generate type upgrade recipes for all rarities
 * Pattern: 2x smaller die -> 1x next die (same set & rarity)
 */
function generateTypeUpgradeRecipes(): CraftingRecipe[] {
  const upgrades: Array<{
    from: 'd4' | 'd6' | 'd8' | 'd10' | 'd12'
    to: 'd6' | 'd8' | 'd10' | 'd12' | 'd20'
  }> = [
    { from: 'd4', to: 'd6' },
    { from: 'd6', to: 'd8' },
    { from: 'd8', to: 'd10' },
    { from: 'd10', to: 'd12' },
    { from: 'd12', to: 'd20' }
  ]

  const rarities: DieRarity[] = ['common', 'uncommon', 'rare', 'epic', 'legendary', 'mythic']

  const recipes: CraftingRecipe[] = []

  for (const upgrade of upgrades) {
    for (const rarity of rarities) {
      recipes.push({
        id: `upgrade-${upgrade.from}-to-${upgrade.to}-${rarity}`,
        name: `${upgrade.from.toUpperCase()} → ${upgrade.to.toUpperCase()}`,
        description: `Combine two ${rarity} ${upgrade.from}s to create one ${rarity} ${upgrade.to} of the same set`,
        inputs: [
          {
            type: upgrade.from,
            rarity,
            count: 2,
            setId: undefined // Any set, but must be same
          }
        ],
        output: {
          type: upgrade.to,
          rarity,
          setId: 'inherit'
        },
        coinCost: getCoinCostForTypeUpgrade(rarity),
        category: 'upgrade-type'
      })
    }
  }

  return recipes
}

/**
 * Calculate coin cost for type upgrade based on rarity
 */
function getCoinCostForTypeUpgrade(rarity: DieRarity): number {
  const costs: Record<DieRarity, number> = {
    common: 50,
    uncommon: 100,
    rare: 250,
    epic: 500,
    legendary: 1000,
    mythic: 2500
  }
  return costs[rarity]
}

// ============================================================================
// Rarity Upgrade Recipes (Combine Same Die -> Higher Rarity)
// ============================================================================

/**
 * Generate rarity upgrade recipes for all die types
 * Pattern: 3x current rarity -> 1x next rarity (same set & type)
 */
function generateRarityUpgradeRecipes(): CraftingRecipe[] {
  const upgrades: Array<{
    from: DieRarity
    to: DieRarity
    count: number
  }> = [
    { from: 'common', to: 'uncommon', count: 3 },
    { from: 'uncommon', to: 'rare', count: 3 },
    { from: 'rare', to: 'epic', count: 3 },
    { from: 'epic', to: 'legendary', count: 3 },
    { from: 'legendary', to: 'mythic', count: 5 } // Mythic requires more
  ]

  const dieTypes = ['d4', 'd6', 'd8', 'd10', 'd12', 'd20'] as const

  const recipes: CraftingRecipe[] = []

  for (const dieType of dieTypes) {
    for (const upgrade of upgrades) {
      recipes.push({
        id: `rarity-${dieType}-${upgrade.from}-to-${upgrade.to}`,
        name: `Enhance ${dieType.toUpperCase()} to ${upgrade.to}`,
        description: `Combine ${upgrade.count} ${upgrade.from} ${dieType}s to create one ${upgrade.to} ${dieType} of the same set`,
        inputs: [
          {
            type: dieType,
            rarity: upgrade.from,
            count: upgrade.count,
            setId: undefined // Any set, but must be same
          }
        ],
        output: {
          type: dieType,
          rarity: upgrade.to,
          setId: 'inherit'
        },
        coinCost: getCoinCostForRarityUpgrade(upgrade.to),
        category: 'upgrade-rarity'
      })
    }
  }

  return recipes
}

/**
 * Calculate coin cost for rarity upgrade
 */
function getCoinCostForRarityUpgrade(targetRarity: DieRarity): number {
  const costs: Record<DieRarity, number> = {
    common: 0, // Can't upgrade to common
    uncommon: 100,
    rare: 300,
    epic: 750,
    legendary: 2000,
    mythic: 5000
  }
  return costs[targetRarity]
}

// ============================================================================
// Special Recipes (Future)
// ============================================================================

/**
 * Special crafting recipes that don't follow standard patterns
 * These could be unlocked through achievements or events
 */
export const SPECIAL_RECIPES: CraftingRecipe[] = [
  // Example: Set Conversion
  // {
  //   id: 'convert-to-jade',
  //   name: 'Jade Infusion',
  //   description: 'Convert any rare die into a Dragon Jade die',
  //   inputs: [
  //     { type: 'd20', rarity: 'rare', count: 1, setId: undefined }
  //   ],
  //   output: {
  //     type: 'd20',
  //     rarity: 'rare',
  //     setId: 'dragon-jade'
  //   },
  //   coinCost: 500,
  //   category: 'special',
  //   isUnlocked: false // Requires achievement
  // }
]

// ============================================================================
// Registry
// ============================================================================

/**
 * All available crafting recipes
 */
export const CRAFTING_RECIPES: CraftingRecipe[] = [
  ...generateTypeUpgradeRecipes(),
  ...generateRarityUpgradeRecipes(),
  ...SPECIAL_RECIPES
]

/**
 * Get recipe by ID
 */
export function getRecipeById(id: string): CraftingRecipe | undefined {
  return CRAFTING_RECIPES.find(recipe => recipe.id === id)
}

/**
 * Get all recipes for a specific category
 */
export function getRecipesByCategory(
  category: CraftingRecipe['category']
): CraftingRecipe[] {
  return CRAFTING_RECIPES.filter(recipe => recipe.category === category)
}

/**
 * Get applicable recipes for a specific die type and rarity
 */
export function getRecipesForDie(
  type: string,
  rarity: DieRarity
): CraftingRecipe[] {
  return CRAFTING_RECIPES.filter(recipe => {
    // Check if this die can be used as input
    return recipe.inputs.some(
      input => input.type === type && input.rarity === rarity
    )
  })
}

/**
 * Get recipes that output a specific die type and rarity
 */
export function getRecipesByOutput(
  type: string,
  rarity: DieRarity
): CraftingRecipe[] {
  return CRAFTING_RECIPES.filter(
    recipe => recipe.output.type === type && recipe.output.rarity === rarity
  )
}
