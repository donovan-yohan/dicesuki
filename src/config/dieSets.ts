/**
 * Die Sets Configuration
 *
 * Defines all available die sets/collections.
 * Each set has a cohesive visual theme and can include dice at multiple rarities.
 */

import { DieSet } from '../types/inventory'

// ============================================================================
// Starter Set (Free - Always Available)
// ============================================================================

export const ADVENTURER_STARTER_SET: DieSet = {
  id: 'adventurer-starter',
  name: "Adventurer's Starter Set",
  description: 'A reliable set of dice for every aspiring adventurer. Simple, practical, and ready for any quest.',

  theme: {
    colorPalette: ['#3b82f6', '#1e40af', '#dbeafe'],
    materialType: 'plastic',
    visualStyle: 'minimalist'
  },

  rarityVariants: {
    common: {
      appearance: {
        baseColor: '#3b82f6',      // Blue-500
        accentColor: '#ffffff',     // White numbers
        material: 'plastic',
        roughness: 0.7,
        metalness: 0.0
      },
      vfx: {
        // No special effects for common starter dice
      }
    }
  },

  availability: 'always',
  releaseDate: 0
}

// ============================================================================
// Lucky Bronze Set (Uncommon - Tutorial Reward)
// ============================================================================

export const LUCKY_BRONZE_SET: DieSet = {
  id: 'lucky-bronze',
  name: 'Lucky Bronze Collection',
  description: 'Bronze dice with a subtle shimmer. Said to bring fortune to those who earn them through perseverance.',

  theme: {
    colorPalette: ['#cd7f32', '#8b5a00', '#ffd700'],
    materialType: 'metal',
    visualStyle: 'fantasy'
  },

  rarityVariants: {
    uncommon: {
      appearance: {
        baseColor: '#cd7f32',      // Bronze
        accentColor: '#ffd700',     // Gold numbers
        material: 'metal',
        metalness: 0.8,
        roughness: 0.3
      },
      vfx: {
        trailEffect: 'sparkles',
        rollSound: 'metal_light'
      }
    }
  },

  availability: 'always',
  releaseDate: 0
}

// ============================================================================
// Dragon Jade Set (Rare - Gacha/Shop)
// ============================================================================

export const DRAGON_JADE_SET: DieSet = {
  id: 'dragon-jade',
  name: 'Dragon Jade Collection',
  description: 'Carved from mystical jade, these dice pulse with ancient draconic energy. Each face tells a story of power and wisdom.',

  theme: {
    colorPalette: ['#10b981', '#064e3b', '#6ee7b7'],
    materialType: 'stone',
    visualStyle: 'fantasy'
  },

  rarityVariants: {
    common: {
      appearance: {
        baseColor: '#10b981',      // Emerald-500
        accentColor: '#ffffff',
        material: 'stone',
        roughness: 0.6
      },
      vfx: {}
    },
    uncommon: {
      appearance: {
        baseColor: '#059669',      // Emerald-600
        accentColor: '#fbbf24',    // Amber-400 (gold accents)
        material: 'stone',
        roughness: 0.5
      },
      vfx: {
        trailEffect: 'sparkles'
      }
    },
    rare: {
      appearance: {
        baseColor: '#047857',      // Emerald-700
        accentColor: '#fbbf24',
        material: 'stone',
        roughness: 0.4,
        emissive: '#10b981',
        emissiveIntensity: 0.2
      },
      vfx: {
        trailEffect: 'dragon-scales',
        impactEffect: 'jade-shatter',
        rollSound: 'stone_mystical',
        criticalAnimation: 'dragon-roar'
      }
    }
  },

  availability: 'always',
  releaseDate: 0
}

// ============================================================================
// Celestial Gold Set (Epic - Premium Gacha)
// ============================================================================

export const CELESTIAL_GOLD_SET: DieSet = {
  id: 'celestial-gold',
  name: 'Celestial Gold Collection',
  description: 'Forged from stardust and divine essence, these golden dice shimmer with otherworldly radiance.',

  theme: {
    colorPalette: ['#fbbf24', '#78350f', '#fef3c7'],
    materialType: 'metal',
    visualStyle: 'fantasy'
  },

  rarityVariants: {
    epic: {
      appearance: {
        baseColor: '#fbbf24',      // Amber-400
        accentColor: '#78350f',     // Amber-900 (dark accents)
        material: 'metal',
        metalness: 0.95,
        roughness: 0.15,
        emissive: '#fef3c7',
        emissiveIntensity: 0.3
      },
      vfx: {
        trailEffect: 'golden-sparkles',
        impactEffect: 'light-burst',
        rollSound: 'metal_divine',
        criticalAnimation: 'celestial-beam'
      }
    }
  },

  availability: 'always',
  releaseDate: 0
}

// ============================================================================
// Void Crystal Set (Legendary - Premium Gacha)
// ============================================================================

export const VOID_CRYSTAL_SET: DieSet = {
  id: 'void-crystal',
  name: 'Void Crystal Collection',
  description: 'Crystalline dice that reflect the infinite depths of the cosmos. Reality bends around them as they tumble.',

  theme: {
    colorPalette: ['#8b5cf6', '#1e1b4b', '#e9d5ff'],
    materialType: 'crystal',
    visualStyle: 'scifi'
  },

  rarityVariants: {
    legendary: {
      appearance: {
        baseColor: '#8b5cf6',      // Violet-500
        accentColor: '#e9d5ff',     // Violet-200
        material: 'crystal',
        metalness: 0.1,
        roughness: 0.05,
        emissive: '#8b5cf6',
        emissiveIntensity: 0.5
      },
      vfx: {
        trailEffect: 'void-particles',
        impactEffect: 'reality-crack',
        rollSound: 'crystal_ethereal',
        criticalAnimation: 'void-collapse'
      }
    }
  },

  availability: 'always',
  releaseDate: 0
}

// ============================================================================
// Infernal Obsidian Set (Mythic - Limited Event)
// ============================================================================

export const INFERNAL_OBSIDIAN_SET: DieSet = {
  id: 'infernal-obsidian',
  name: 'Infernal Obsidian Collection',
  description: 'Forged in the depths of the underworld, these dice burn with eternal flame. Only the bravest dare roll them.',

  theme: {
    colorPalette: ['#1f2937', '#ef4444', '#fca5a5'],
    materialType: 'obsidian',
    visualStyle: 'horror'
  },

  rarityVariants: {
    mythic: {
      appearance: {
        baseColor: '#1f2937',      // Gray-800 (near black)
        accentColor: '#ef4444',     // Red-500 (fiery red)
        material: 'obsidian',
        metalness: 0.9,
        roughness: 0.1,
        emissive: '#ef4444',
        emissiveIntensity: 0.7
      },
      vfx: {
        trailEffect: 'flame-trail',
        impactEffect: 'infernal-explosion',
        rollSound: 'obsidian_demonic',
        criticalAnimation: 'hellfire-eruption'
      }
    }
  },

  availability: 'limited',
  releaseDate: Date.now(),
  endDate: Date.now() + (30 * 24 * 60 * 60 * 1000), // 30 days from now

  setBonus: {
    description: 'When rolling a complete Infernal set, all dice leave scorched trails',
    effectId: 'infernal-synergy'
  }
}

// ============================================================================
// Registry
// ============================================================================

/**
 * All available die sets in the game
 */
// ============================================================================
// Custom Artist Set (Special - User-Created Content)
// ============================================================================

export const CUSTOM_ARTIST_SET: DieSet = {
  id: 'custom-artist',
  name: 'Custom Artist Collection',
  description: 'Unique dice created by talented artists in the community. Each die is a work of art.',

  theme: {
    colorPalette: ['#8b5cf6', '#a78bfa', '#c4b5fd'],
    materialType: 'plastic',
    visualStyle: 'fantasy'
  },

  rarityVariants: {
    rare: {
      appearance: {
        baseColor: '#8b5cf6',      // Violet-600
        accentColor: '#ffffff',     // White numbers
        material: 'plastic',
        roughness: 0.7,
        metalness: 0.0
      },
      vfx: {
        // Custom dice have simple effects
      }
    }
  },

  availability: 'always',
  releaseDate: 0
}

export const DIE_SETS: DieSet[] = [
  ADVENTURER_STARTER_SET,
  LUCKY_BRONZE_SET,
  DRAGON_JADE_SET,
  CELESTIAL_GOLD_SET,
  VOID_CRYSTAL_SET,
  INFERNAL_OBSIDIAN_SET,
  CUSTOM_ARTIST_SET
]

/**
 * Get a die set by ID
 */
export function getDieSetById(id: string): DieSet | undefined {
  return DIE_SETS.find(set => set.id === id)
}

/**
 * Get all sets by availability
 */
export function getDieSetsByAvailability(
  availability: DieSet['availability']
): DieSet[] {
  return DIE_SETS.filter(set => set.availability === availability)
}

/**
 * Get currently active limited sets
 */
export function getActiveLimitedSets(): DieSet[] {
  const now = Date.now()
  return DIE_SETS.filter(
    set =>
      set.availability === 'limited' &&
      set.releaseDate <= now &&
      (!set.endDate || set.endDate > now)
  )
}

/**
 * Check if a set supports a specific rarity
 */
export function setSupportsRarity(setId: string, rarity: string): boolean {
  const set = getDieSetById(setId)
  return set ? rarity in set.rarityVariants : false
}
