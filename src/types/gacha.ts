/**
 * Gacha/Banner System Types
 *
 * Type definitions for the gacha pull system (future implementation).
 * Follows Hoyoverse/Genshin Impact pattern with pity mechanics.
 */

import { DiceShape } from '../lib/geometries'
import { DieRarity } from './inventory'

// ============================================================================
// Banner & Pool Definitions
// ============================================================================

/**
 * Gacha pool configuration (rarity tier)
 */
export interface GachaPool {
  id: string
  rarity: DieRarity
  weight: number              // Relative probability

  // Items in this pool
  items: Array<{
    setId: string
    type: DiceShape
    weight: number            // Within this rarity tier
  }>
}

/**
 * Pull cost configuration
 */
export interface PullCost {
  single: {
    gems?: number
    tokens?: number
  }
  multi: {                    // 10-pull
    gems?: number
    tokens?: number
  }
}

/**
 * Pity system configuration
 */
export interface PityConfig {
  softPity: number            // Increased rates start here (e.g., 75)
  hardPity: number            // Guaranteed rare+ (e.g., 90)
  featuredPity: number        // Guaranteed featured item (e.g., 180)
  carryOver: boolean          // Does pity carry to next banner?
}

/**
 * Featured item configuration
 */
export interface FeaturedItem {
  setId: string
  rarity: DieRarity
  boostedRate: number         // Multiplier on base rate
}

/**
 * Complete gacha banner definition
 */
export interface GachaBanner {
  id: string
  name: string
  description: string
  type: 'standard' | 'premium' | 'event'

  // Visual
  bannerImage: string
  backgroundColor: string

  // Cost
  pullCost: PullCost

  // Drop rates
  pools: GachaPool[]

  // Pity system
  pity: PityConfig

  // Featured items (boosted rates)
  featured: FeaturedItem[]

  // Availability
  startDate: number
  endDate?: number
  isActive: boolean
}

// ============================================================================
// Pity State Tracking
// ============================================================================

/**
 * Pity state for a single banner
 */
export interface BannerPityState {
  pullsSinceLastRare: number      // Resets on rare+ pull
  pullsSinceLastFeatured: number  // Resets on featured pull
  guaranteedFeatured: boolean     // Lost 50/50, next is guaranteed
}

/**
 * Pity state for all banners
 */
export interface PityState {
  [bannerId: string]: BannerPityState
}

// ============================================================================
// Pull Results
// ============================================================================

/**
 * Single pull result
 */
export interface PullResult {
  dieId: string               // ID of die obtained
  setId: string
  type: DiceShape
  rarity: DieRarity
  isNew: boolean              // First time getting this die
  isFeatured: boolean         // Was this a featured item?
}

/**
 * Multi-pull result (10-pull)
 */
export interface MultiPullResult {
  pulls: PullResult[]
  guaranteedRare: boolean     // Was rare+ guaranteed in this 10-pull?
  pityTriggered: boolean      // Did pity activate?
}

// ============================================================================
// Gacha History
// ============================================================================

/**
 * Single entry in gacha history
 */
export interface GachaHistoryEntry {
  id: string
  bannerId: string
  timestamp: number
  pulls: PullResult[]
  totalCost: {
    gems?: number
    tokens?: number
  }
}
