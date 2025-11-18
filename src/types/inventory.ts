/**
 * Inventory System Types
 *
 * Type definitions for the player inventory system.
 * Each die is a unique collectible entity with stats and customization.
 */

import { DiceShape } from '../lib/geometries'

// ============================================================================
// Enums & Literals
// ============================================================================

export type DieRarity = 'common' | 'uncommon' | 'rare' | 'epic' | 'legendary' | 'mythic'

export type DieMaterial =
  | 'plastic'      // Basic, matte
  | 'resin'        // Semi-glossy
  | 'metal'        // High metalness
  | 'stone'        // Rough, natural
  | 'glass'        // Transparent
  | 'crystal'      // Refractive
  | 'wood'         // Organic texture
  | 'bone'         // Aged, creamy
  | 'obsidian'     // Black, glossy
  | 'celestial'    // Special shader (stars, nebula)

export type AcquisitionSource =
  | 'starter'         // New player gift
  | 'tutorial'        // Tutorial reward
  | 'daily'           // Daily login
  | 'event'           // Limited event
  | 'shop'            // Direct purchase
  | 'gacha_standard'  // Standard banner
  | 'gacha_premium'   // Premium/featured banner
  | 'crafting'        // Crafted from duplicates
  | 'achievement'     // Milestone reward
  | 'quest'           // Story/side quest

// ============================================================================
// Core Entities
// ============================================================================

/**
 * Visual appearance configuration for a die
 */
export interface DieAppearance {
  baseColor: string           // Primary color (hex)
  accentColor: string         // Numbers/pips color (hex)
  material: DieMaterial

  // Optional PBR properties
  texture?: string            // Texture URL/path
  metalness?: number          // 0-1 for PBR materials
  roughness?: number          // 0-1 for PBR materials
  emissive?: string           // Glow color (hex)
  emissiveIntensity?: number  // Glow strength
}

/**
 * VFX configuration for a die (rarity-dependent)
 */
export interface DieVFX {
  trailEffect?: string        // 'sparkles', 'fire', 'lightning', etc.
  impactEffect?: string       // Particle effect on collision
  rollSound?: string          // Custom sound effect ID
  criticalAnimation?: string  // Special animation on max roll
}

/**
 * Statistics tracked for each die
 */
export interface DieStats {
  timesRolled: number
  highestRoll?: number        // Highest natural roll (for this die type)
  lowestRoll?: number
  totalValue: number          // Sum of all rolls ever
  critsRolled: number         // Max value rolls
  failsRolled: number         // Min value rolls
}

/**
 * A single collectible die in player inventory
 * Each die is unique even if same type/rarity/set
 */
export interface InventoryDie {
  // Identity
  id: string                  // Unique: "die_1234567890"
  type: DiceShape             // 'd4', 'd6', 'd8', 'd10', 'd12', 'd20'

  // Core Properties
  setId: string               // Die set/collection: 'dragon-jade', 'celestial-gold'
  rarity: DieRarity

  // Visual Properties (defined by setId + rarity)
  appearance: DieAppearance

  // VFX Configuration (rarity-dependent)
  vfx: DieVFX

  // Player Customization
  name: string                // Player-assigned: "Lucky Persuasion Die"
  description?: string        // Optional flavor text
  isFavorite: boolean         // Star for quick access
  isLocked: boolean           // Prevent accidental deletion/crafting

  // Dev/Testing Flags
  isDev?: boolean             // Development/test dice (show badge, easy removal)
  devNotes?: string           // Internal notes for dev dice

  // Metadata
  acquiredAt: number          // Timestamp
  source: AcquisitionSource

  // Stats (for player engagement)
  stats: DieStats

  // Assignment tracking
  assignedToRolls: string[]   // SavedRoll IDs using this die

  // Custom dice (for artist-created models)
  customAsset?: {
    modelUrl: string            // Blob URL or path to GLB file
    metadata: any               // DiceMetadata from customDice types
  }
}

// ============================================================================
// Die Sets (Collections)
// ============================================================================

/**
 * Rarity variant configuration within a set
 */
export interface SetRarityVariant {
  appearance: DieAppearance
  vfx: DieVFX
}

/**
 * Defines a cohesive set of dice with shared aesthetic
 */
export interface DieSet {
  id: string                  // 'dragon-jade', 'celestial-gold'
  name: string                // "Dragon Jade Collection"
  description: string

  // Visual theme
  theme: {
    colorPalette: string[]    // Primary colors used
    materialType: DieMaterial
    visualStyle: string       // 'fantasy', 'scifi', 'horror', 'minimalist'
  }

  // Rarity configuration
  // A set can have dice at multiple rarities with different appearances
  rarityVariants: {
    [K in DieRarity]?: SetRarityVariant
  }

  // Availability
  availability: 'always' | 'limited' | 'seasonal' | 'retired'
  releaseDate: number
  endDate?: number            // For limited sets

  // Set completion bonus (future feature)
  setBonus?: {
    description: string       // "All dice glow when rolling together"
    effectId: string
  }
}

// ============================================================================
// Currency (Future)
// ============================================================================

/**
 * Player currency balances
 */
export interface Currency {
  coins: number               // Free currency (earnable)
  gems: number                // Premium currency (purchasable)
  standardTokens: number      // Standard gacha pulls
  premiumTokens: number       // Premium gacha pulls
}

// ============================================================================
// Utility Types
// ============================================================================

/**
 * Helper type for creating new dice (omits computed fields)
 */
export type NewInventoryDie = Omit<
  InventoryDie,
  'id' | 'acquiredAt' | 'stats' | 'assignedToRolls'
> & {
  id?: string                 // Optional - will be generated if not provided
  acquiredAt?: number         // Optional - will be set to Date.now()
  stats?: Partial<DieStats>   // Optional - will use defaults
  assignedToRolls?: string[]  // Optional - will default to []
}

/**
 * Partial die for updates
 */
export type DieUpdate = Partial<Pick<
  InventoryDie,
  'name' | 'description' | 'isFavorite' | 'isLocked' | 'assignedToRolls'
>>

/**
 * Set completion status
 */
export interface SetCompletion {
  total: number               // Total dice in set
  owned: number               // How many player owns
  missing: Array<{
    type: DiceShape
    rarity: DieRarity
  }>
}
