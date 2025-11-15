/**
 * Theme System - Type Definitions and Token Structure
 *
 * Defines the structure for visual themes that can be purchased as cosmetic skins.
 * Each theme consists of design tokens (colors, typography, effects) and asset references.
 */

// ============================================================================
// Color Tokens
// ============================================================================

export interface ThemeColors {
  primary: string
  secondary: string
  accent: string
  background: string
  surface: string
  text: {
    primary: string
    secondary: string
    muted: string
  }
  dice: {
    highlight: string
    shadow: string
  }
}

// ============================================================================
// Typography Tokens
// ============================================================================

export interface ThemeTypography {
  fontFamily: {
    primary: string
    mono: string
  }
  fontSize: {
    xs: string
    sm: string
    base: string
    lg: string
    xl: string
    '2xl': string
    '3xl': string
  }
  fontWeight: {
    normal: string
    medium: string
    semibold: string
    bold: string
  }
}

// ============================================================================
// Spacing Tokens
// ============================================================================

export interface ThemeSpacing {
  unit: string // Base unit for spacing calculations (e.g., '0.25rem' = 4px)
}

// ============================================================================
// Effect Tokens
// ============================================================================

export interface ThemeEffects {
  borderRadius: {
    sm: string
    md: string
    lg: string
    full: string
  }
  shadows: {
    sm: string
    md: string
    lg: string
  }
  gradients: {
    primary: string
    secondary: string
  }
}

// ============================================================================
// Asset Manifest
// ============================================================================

export interface ThemeUIAssets {
  navbar: {
    background: string | null // SVG or image URL for navbar background
    pattern: string | null // Optional pattern overlay
  }
  buttons: {
    primary: string | null // Background asset for primary buttons
    secondary: string | null // Background asset for secondary buttons
  }
}

export interface ThemeBackgrounds {
  main: string | null // Main application background
  dice: string | null // Dice viewport background
}

export interface ThemeIcons {
  roll: string | null // Roll button icon
  dice: string | null // Dice management icon
  history: string | null // History icon
  settings: string | null // Settings icon
  profile: string | null // Profile/room icon
  uiToggle: string | null // UI visibility toggle icon
}

export interface ThemeSounds {
  roll?: string | null // Dice roll sound effect
  uiOpen?: string | null // UI panel open sound
  uiClose?: string | null // UI panel close sound
  buttonClick?: string | null // Generic button click
}

// ============================================================================
// Dice Customization
// ============================================================================

export interface DiceCustomization {
  // Default colors for each die type
  defaultColors: {
    d4: string
    d6: string
    d8: string
    d10: string
    d12: string
    d20: string
  }

  // Material properties for dice appearance
  materials: {
    roughness: number // 0 = smooth/glossy, 1 = rough/matte
    metalness: number // 0 = non-metal, 1 = metallic
    emissiveIntensity?: number // Optional glow effect
    opacity?: number // For translucent dice
  }

  // Numbering/pips appearance
  numbering: {
    color: string
    style: 'engraved' | 'painted' | 'inlaid' | 'embossed'
    depth?: number // For engraved/embossed styles
  }

  // Optional texture map URLs for advanced customization
  textures?: {
    diffuse?: string // Base color/pattern texture
    normal?: string // Surface detail (bumps, scratches)
    roughness?: string // Roughness map
    metalness?: string // Metallic map
  }
}

// ============================================================================
// Environment Customization (Dice Box)
// ============================================================================

export interface EnvironmentCustomization {
  // Floor configuration
  floor: {
    color: string
    texture?: string // URL to texture image (wood, felt, stone, etc.)
    material: {
      roughness: number
      metalness: number
    }
    receiveShadow?: boolean
  }

  // Wall configuration
  walls: {
    color: string
    texture?: string // URL to texture image
    material: {
      roughness: number
      metalness: number
    }
    visible: boolean // Option to hide walls for open environment
    height?: number // Wall height (default: 6)
  }

  // Ceiling configuration
  ceiling: {
    visible: boolean // Usually invisible unless specific theme needs it
    color?: string
  }

  // Lighting setup
  lighting: {
    ambient: {
      color: string
      intensity: number
    }
    directional: {
      color: string
      intensity: number
      position: [number, number, number] // [x, y, z]
    }
  }

  // Background/skybox
  background: {
    color: string
    texture?: string // Skybox or background image
    gradient?: {
      from: string
      to: string
      direction: 'vertical' | 'horizontal' | 'radial'
    }
  }
}

// ============================================================================
// Complete Theme Definition
// ============================================================================

export interface Theme {
  // Metadata
  id: string
  name: string
  description: string
  price: number // Price in cents (0 = free/default)
  preview?: string // Preview image URL
  category?: 'fantasy' | 'modern' | 'sci-fi' | 'retro' | 'minimal' | 'nature'

  // Design tokens
  tokens: {
    colors: ThemeColors
    typography: ThemeTypography
    spacing: ThemeSpacing
    effects: ThemeEffects
  }

  // Asset references
  assets: {
    ui: ThemeUIAssets
    backgrounds: ThemeBackgrounds
    icons: ThemeIcons
    sounds?: ThemeSounds
  }

  // Dice customization (NEW)
  dice: DiceCustomization

  // Environment customization (NEW)
  environment: EnvironmentCustomization
}

// ============================================================================
// User Customization Layer
// ============================================================================

/**
 * Allows users to override specific aspects of a theme
 * This enables mix-and-match customization while using a base theme
 */
export interface UserCustomization {
  activeThemeId: string

  overrides: {
    // Override specific dice properties
    dice?: Partial<DiceCustomization>

    // Override environment properties
    environment?: Partial<EnvironmentCustomization>

    // Override UI tokens
    ui?: {
      colors?: Partial<ThemeColors>
      typography?: Partial<ThemeTypography>
      effects?: Partial<ThemeEffects>
    }
  }
}

// ============================================================================
// Default Theme
// ============================================================================

export const defaultTheme: Theme = {
  id: 'default',
  name: 'Classic Dice',
  description: 'Clean, modern interface with timeless design',
  price: 0,
  category: 'modern',

  tokens: {
    colors: {
      primary: '#1f2937', // gray-800
      secondary: '#374151', // gray-700
      accent: '#fb923c', // orange-400
      background: '#000000',
      surface: '#1f2937',
      text: {
        primary: '#ffffff',
        secondary: '#d1d5db', // gray-300
        muted: '#9ca3af', // gray-400
      },
      dice: {
        highlight: '#fb923c',
        shadow: '#000000',
      },
    },

    typography: {
      fontFamily: {
        primary: 'system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
        mono: '"SF Mono", Monaco, "Cascadia Code", "Roboto Mono", Consolas, monospace',
      },
      fontSize: {
        xs: '0.75rem', // 12px
        sm: '0.875rem', // 14px
        base: '1rem', // 16px
        lg: '1.125rem', // 18px
        xl: '1.25rem', // 20px
        '2xl': '1.5rem', // 24px
        '3xl': '1.875rem', // 30px
      },
      fontWeight: {
        normal: '400',
        medium: '500',
        semibold: '600',
        bold: '700',
      },
    },

    spacing: {
      unit: '0.25rem', // 4px base unit
    },

    effects: {
      borderRadius: {
        sm: '0.25rem', // 4px
        md: '0.5rem', // 8px
        lg: '0.75rem', // 12px
        full: '9999px',
      },
      shadows: {
        sm: '0 1px 2px 0 rgba(0, 0, 0, 0.05)',
        md: '0 4px 6px -1px rgba(0, 0, 0, 0.1), 0 2px 4px -1px rgba(0, 0, 0, 0.06)',
        lg: '0 10px 15px -3px rgba(0, 0, 0, 0.1), 0 4px 6px -2px rgba(0, 0, 0, 0.05)',
      },
      gradients: {
        primary: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
        secondary: 'linear-gradient(135deg, #f093fb 0%, #f5576c 100%)',
      },
    },
  },

  assets: {
    ui: {
      navbar: {
        background: null,
        pattern: null,
      },
      buttons: {
        primary: null,
        secondary: null,
      },
    },
    backgrounds: {
      main: null,
      dice: null,
    },
    icons: {
      roll: null, // Future: '/icons/default/roll.svg'
      dice: null, // Future: '/icons/default/dice.svg'
      history: null, // Future: '/icons/default/history.svg'
      settings: null, // Future: '/icons/default/settings.svg'
      profile: null, // Future: '/icons/default/profile.svg'
      uiToggle: null, // Future: '/icons/default/eye.svg'
    },
  },

  dice: {
    defaultColors: {
      d4: '#ef4444', // red-500
      d6: '#3b82f6', // blue-500
      d8: '#10b981', // green-500
      d10: '#f59e0b', // amber-500
      d12: '#8b5cf6', // violet-500
      d20: '#ec4899', // pink-500
    },
    materials: {
      roughness: 0.3,
      metalness: 0.1,
    },
    numbering: {
      color: '#ffffff',
      style: 'engraved',
      depth: 0.05,
    },
  },

  environment: {
    floor: {
      color: '#444444',
      material: {
        roughness: 0.8,
        metalness: 0.0,
      },
      receiveShadow: true,
    },
    walls: {
      color: '#ffffff',
      material: {
        roughness: 0.9,
        metalness: 0.0,
      },
      visible: true,
      height: 6,
    },
    ceiling: {
      visible: true,
    },
    lighting: {
      ambient: {
        color: '#ffffff',
        intensity: 0.6,
      },
      directional: {
        color: '#ffffff',
        intensity: 0.8,
        position: [5, 10, 5],
      },
    },
    background: {
      color: '#000000',
    },
  },
}

// ============================================================================
// Fantasy Earth Theme
// ============================================================================

export const fantasyTheme: Theme = {
  id: 'fantasy-earth',
  name: 'Fantasy Earth',
  description: 'Mystical forest realm with magical creatures and enchanted elements',
  price: 299, // $2.99
  category: 'fantasy',

  tokens: {
    colors: {
      primary: '#2d5016', // Deep forest green
      secondary: '#4a7c2e', // Moss green
      accent: '#ffd700', // Gold
      background: '#1a2814', // Dark forest
      surface: '#2d5016',
      text: {
        primary: '#f5e6d3', // Parchment
        secondary: '#d4c4a8', // Aged parchment
        muted: '#8b7355', // Brown
      },
      dice: {
        highlight: '#ffd700',
        shadow: '#1a1a0f',
      },
    },

    typography: {
      fontFamily: {
        primary: '"Cinzel", "Trajan Pro", Georgia, serif',
        mono: '"Courier Prime", "Courier New", monospace',
      },
      fontSize: {
        xs: '0.75rem',
        sm: '0.875rem',
        base: '1rem',
        lg: '1.125rem',
        xl: '1.25rem',
        '2xl': '1.5rem',
        '3xl': '1.875rem',
      },
      fontWeight: {
        normal: '400',
        medium: '500',
        semibold: '600',
        bold: '700',
      },
    },

    spacing: {
      unit: '0.25rem',
    },

    effects: {
      borderRadius: {
        sm: '0.125rem', // Sharper corners for fantasy aesthetic
        md: '0.25rem',
        lg: '0.5rem',
        full: '9999px',
      },
      shadows: {
        sm: '0 2px 4px 0 rgba(26, 26, 15, 0.3)',
        md: '0 4px 8px -1px rgba(26, 26, 15, 0.4), 0 2px 4px -1px rgba(26, 26, 15, 0.3)',
        lg: '0 10px 20px -3px rgba(26, 26, 15, 0.5), 0 4px 8px -2px rgba(26, 26, 15, 0.4)',
      },
      gradients: {
        primary: 'linear-gradient(135deg, #4a7c2e 0%, #2d5016 100%)',
        secondary: 'linear-gradient(135deg, #ffd700 0%, #daa520 100%)',
      },
    },
  },

  assets: {
    ui: {
      navbar: {
        background: null, // Future: '/themes/fantasy-earth/ui/navbar-grass.svg'
        pattern: null, // Future: '/themes/fantasy-earth/ui/mushrooms-pattern.svg'
      },
      buttons: {
        primary: null, // Future: '/themes/fantasy-earth/ui/button-stone.svg'
        secondary: null, // Future: '/themes/fantasy-earth/ui/button-wood.svg'
      },
    },
    backgrounds: {
      main: null, // Future: '/themes/fantasy-earth/backgrounds/forest-bg.jpg'
      dice: null,
    },
    icons: {
      roll: null, // Future: '/themes/fantasy-earth/icons/wand.svg' - 🪄
      dice: null, // Future: '/themes/fantasy-earth/icons/rune-dice.svg' - 🎲
      history: null, // Future: '/themes/fantasy-earth/icons/scroll.svg' - 📜
      settings: null, // Future: '/themes/fantasy-earth/icons/crystal.svg' - 🔮
      profile: null, // Future: '/themes/fantasy-earth/icons/shield.svg' - 🛡️
      uiToggle: null, // Future: '/themes/fantasy-earth/icons/magic-eye.svg' - 👁️
    },
    sounds: {
      roll: null, // Future: '/themes/fantasy-earth/sounds/magic-roll.mp3'
      uiOpen: null, // Future: '/themes/fantasy-earth/sounds/page-turn.mp3'
      uiClose: null, // Future: '/themes/fantasy-earth/sounds/page-close.mp3'
      buttonClick: null, // Future: '/themes/fantasy-earth/sounds/stone-click.mp3'
    },
  },

  dice: {
    defaultColors: {
      d4: '#8b4513', // Earthy brown
      d6: '#4a7c2e', // Moss green
      d8: '#d2691e', // Chocolate
      d10: '#2e8b57', // Sea green
      d12: '#8b7355', // Burlywood
      d20: '#ffd700', // Gold
    },
    materials: {
      roughness: 0.7,
      metalness: 0.0,
    },
    numbering: {
      color: '#ffd700', // Gold numbers
      style: 'inlaid',
      depth: 0.08,
    },
  },

  environment: {
    floor: {
      color: '#2d5016', // Forest green floor
      material: {
        roughness: 0.9,
        metalness: 0.0,
      },
      receiveShadow: true,
    },
    walls: {
      color: '#4a7c2e', // Moss green walls
      material: {
        roughness: 0.95,
        metalness: 0.0,
      },
      visible: true,
      height: 6,
    },
    ceiling: {
      visible: false, // Open to sky
    },
    lighting: {
      ambient: {
        color: '#f5e6d3', // Warm parchment light
        intensity: 0.5,
      },
      directional: {
        color: '#ffd700', // Golden sunlight
        intensity: 0.7,
        position: [3, 8, 4],
      },
    },
    background: {
      color: '#1a2814',
      gradient: {
        from: '#1a2814',
        to: '#4a7c2e',
        direction: 'vertical',
      },
    },
  },
}

// ============================================================================
// Critter Forest Theme - Fantasy Cute
// ============================================================================

export const critterForestTheme: Theme = {
  id: 'critter-forest',
  name: 'Critter Forest',
  description: 'Adorable woodland creatures in a whimsical mushroom grove',
  price: 399, // $3.99
  category: 'fantasy',

  tokens: {
    colors: {
      primary: '#8b5a3c', // Warm brown
      secondary: '#a67c52', // Light brown
      accent: '#ff69b4', // Hot pink (cute!)
      background: '#4a7c59', // Forest green
      surface: '#8b5a3c',
      text: {
        primary: '#ffffff',
        secondary: '#ffe4e1', // Misty rose
        muted: '#d4a574', // Tan
      },
      dice: {
        highlight: '#ff69b4',
        shadow: '#2d3319',
      },
    },

    typography: {
      fontFamily: {
        primary: '"Comic Neue", "Quicksand", "Segoe UI", sans-serif',
        mono: '"Courier Prime", "Courier New", monospace',
      },
      fontSize: {
        xs: '0.75rem',
        sm: '0.875rem',
        base: '1rem',
        lg: '1.125rem',
        xl: '1.25rem',
        '2xl': '1.5rem',
        '3xl': '1.875rem',
      },
      fontWeight: {
        normal: '400',
        medium: '500',
        semibold: '600',
        bold: '700',
      },
    },

    spacing: {
      unit: '0.25rem',
    },

    effects: {
      borderRadius: {
        sm: '0.5rem', // Rounder for cute aesthetic
        md: '0.75rem',
        lg: '1rem',
        full: '9999px',
      },
      shadows: {
        sm: '0 2px 4px 0 rgba(139, 90, 60, 0.2)',
        md: '0 4px 8px -1px rgba(139, 90, 60, 0.3), 0 2px 4px -1px rgba(139, 90, 60, 0.2)',
        lg: '0 10px 20px -3px rgba(139, 90, 60, 0.4), 0 4px 8px -2px rgba(139, 90, 60, 0.3)',
      },
      gradients: {
        primary: 'linear-gradient(135deg, #ff69b4 0%, #ff1493 100%)',
        secondary: 'linear-gradient(135deg, #ffd700 0%, #ff69b4 100%)',
      },
    },
  },

  assets: {
    ui: {
      navbar: {
        background: null, // Future: mushroom cap pattern
        pattern: null, // Future: tiny flower pattern
      },
      buttons: {
        primary: null, // Future: acorn button
        secondary: null, // Future: leaf button
      },
    },
    backgrounds: {
      main: null, // Future: forest clearing with mushrooms
      dice: null,
    },
    icons: {
      roll: null, // Future: magic wand with sparkles
      dice: null, // Future: dice with cute face
      history: null, // Future: tiny book
      settings: null, // Future: flower
      profile: null, // Future: cute critter face
      uiToggle: null, // Future: blinking eye
    },
    sounds: {
      roll: null, // Future: cheerful chime
      uiOpen: null, // Future: pop sound
      uiClose: null, // Future: boop sound
      buttonClick: null, // Future: soft click
    },
  },

  dice: {
    defaultColors: {
      d4: '#ffb6c1', // Light pink
      d6: '#87ceeb', // Sky blue
      d8: '#98fb98', // Pale green
      d10: '#dda0dd', // Plum
      d12: '#f0e68c', // Khaki
      d20: '#ff69b4', // Hot pink
    },
    materials: {
      roughness: 0.4,
      metalness: 0.0,
      emissiveIntensity: 0.1, // Slight glow for magical feel
    },
    numbering: {
      color: '#ffffff',
      style: 'painted',
    },
  },

  environment: {
    floor: {
      color: '#7cb342', // Grass green
      material: {
        roughness: 0.95,
        metalness: 0.0,
      },
      receiveShadow: true,
    },
    walls: {
      color: '#d4a574', // Tan (tree bark color)
      material: {
        roughness: 0.9,
        metalness: 0.0,
      },
      visible: true,
      height: 6,
    },
    ceiling: {
      visible: false, // Open to sky
    },
    lighting: {
      ambient: {
        color: '#fffacd', // Lemon chiffon (warm sunlight)
        intensity: 0.7,
      },
      directional: {
        color: '#fff8dc', // Cornsilk (soft sunlight)
        intensity: 0.6,
        position: [4, 10, 3],
      },
    },
    background: {
      color: '#87ceeb',
      gradient: {
        from: '#87ceeb', // Sky blue
        to: '#7cb342', // Grass green
        direction: 'vertical',
      },
    },
  },
}

// ============================================================================
// Dungeon Castle Theme - Old School Diablo/DND
// ============================================================================

export const dungeonCastleTheme: Theme = {
  id: 'dungeon-castle',
  name: 'Dungeon Castle',
  description: 'Dark stone halls echoing with ancient magic and danger',
  price: 399, // $3.99
  category: 'fantasy',

  tokens: {
    colors: {
      primary: '#1a1a1a', // Deep black
      secondary: '#2d2d2d', // Dark gray
      accent: '#8b0000', // Dark red
      background: '#0a0a0a', // Almost black
      surface: '#1a1a1a',
      text: {
        primary: '#c0c0c0', // Silver
        secondary: '#8b8b8b', // Gray
        muted: '#696969', // Dim gray
      },
      dice: {
        highlight: '#8b0000',
        shadow: '#000000',
      },
    },

    typography: {
      fontFamily: {
        primary: '"Uncial Antiqua", "MedievalSharp", Georgia, serif',
        mono: '"Courier New", monospace',
      },
      fontSize: {
        xs: '0.75rem',
        sm: '0.875rem',
        base: '1rem',
        lg: '1.125rem',
        xl: '1.25rem',
        '2xl': '1.5rem',
        '3xl': '1.875rem',
      },
      fontWeight: {
        normal: '400',
        medium: '500',
        semibold: '600',
        bold: '700',
      },
    },

    spacing: {
      unit: '0.25rem',
    },

    effects: {
      borderRadius: {
        sm: '0.0rem', // Sharp corners for dungeon aesthetic
        md: '0.125rem',
        lg: '0.25rem',
        full: '9999px',
      },
      shadows: {
        sm: '0 2px 4px 0 rgba(139, 0, 0, 0.5)',
        md: '0 4px 8px -1px rgba(139, 0, 0, 0.6), 0 2px 4px -1px rgba(0, 0, 0, 0.8)',
        lg: '0 10px 20px -3px rgba(139, 0, 0, 0.7), 0 4px 8px -2px rgba(0, 0, 0, 0.9)',
      },
      gradients: {
        primary: 'linear-gradient(135deg, #1a1a1a 0%, #000000 100%)',
        secondary: 'linear-gradient(135deg, #8b0000 0%, #4b0000 100%)',
      },
    },
  },

  assets: {
    ui: {
      navbar: {
        background: null, // Future: stone texture
        pattern: null, // Future: cracks/runes
      },
      buttons: {
        primary: null, // Future: iron plate
        secondary: null, // Future: worn stone
      },
    },
    backgrounds: {
      main: null, // Future: dungeon corridor
      dice: null,
    },
    icons: {
      roll: null, // Future: crossed swords
      dice: null, // Future: skull dice
      history: null, // Future: ancient tome
      settings: null, // Future: iron gear
      profile: null, // Future: helmet
      uiToggle: null, // Future: torch
    },
    sounds: {
      roll: null, // Future: stone grinding
      uiOpen: null, // Future: heavy door creak
      uiClose: null, // Future: door slam
      buttonClick: null, // Future: metal clank
    },
  },

  dice: {
    defaultColors: {
      d4: '#8b0000', // Brighter dark red (was too dark)
      d6: '#708090', // Lighter slate gray (was too dark)
      d8: '#cd5c5c', // Indian red (brighter)
      d10: '#a9a9a9', // Lighter gray (was too dark)
      d12: '#696969', // Dim gray (lightened)
      d20: '#dc143c', // Crimson (brighter red)
    },
    materials: {
      roughness: 0.6, // Less rough for more reflection (was 0.8)
      metalness: 0.4, // More metallic shine (was 0.3)
      emissiveIntensity: 0.1, // Slight glow to help visibility
    },
    numbering: {
      color: '#ffffff', // Pure white for better contrast (was silver)
      style: 'engraved',
      depth: 0.1,
    },
  },

  environment: {
    floor: {
      color: '#6a6a6a', // Much lighter gray
      material: {
        roughness: 0.75,
        metalness: 0.1,
      },
      receiveShadow: true,
    },
    walls: {
      color: '#7a7a7a', // Much lighter gray
      material: {
        roughness: 0.8,
        metalness: 0.0,
      },
      visible: true,
      height: 6,
    },
    ceiling: {
      visible: true,
      color: '#4a4a4a',
    },
    lighting: {
      ambient: {
        color: '#ffcc88', // Bright warm light
        intensity: 1.2, // Very bright ambient
      },
      directional: {
        color: '#ffd699', // Very bright warm light
        intensity: 1.5, // Maximum brightness
        position: [2, 5, 3],
      },
    },
    background: {
      color: '#3a3a3a', // Much lighter background
    },
  },
}

// ============================================================================
// Neon Cyber City Theme - Pixel Art Neon
// ============================================================================

export const neonCyberCityTheme: Theme = {
  id: 'neon-cyber-city',
  name: 'Neon Cyber City',
  description: 'Retro-futuristic pixel art cityscape with vibrant neon lights',
  price: 499, // $4.99
  category: 'sci-fi',

  tokens: {
    colors: {
      primary: '#1a0033', // Deep purple
      secondary: '#2d1b69', // Dark purple
      accent: '#00ffff', // Cyan
      background: '#0d0221', // Very dark purple
      surface: '#1a0033',
      text: {
        primary: '#00ffff', // Cyan
        secondary: '#ff00ff', // Magenta
        muted: '#9d4edd', // Purple
      },
      dice: {
        highlight: '#00ffff',
        shadow: '#ff00ff',
      },
    },

    typography: {
      fontFamily: {
        primary: '"VT323", "Press Start 2P", "Courier New", monospace',
        mono: '"VT323", "Courier New", monospace',
      },
      fontSize: {
        xs: '0.75rem',
        sm: '0.875rem',
        base: '1rem',
        lg: '1.125rem',
        xl: '1.25rem',
        '2xl': '1.5rem',
        '3xl': '1.875rem',
      },
      fontWeight: {
        normal: '400',
        medium: '400', // Pixel fonts don't vary much
        semibold: '400',
        bold: '400',
      },
    },

    spacing: {
      unit: '0.25rem',
    },

    effects: {
      borderRadius: {
        sm: '0.0rem', // Pixel-perfect sharp edges
        md: '0.0rem',
        lg: '0.0rem',
        full: '0.0rem', // Even "round" elements are pixelated
      },
      shadows: {
        sm: '0 0 4px 0 rgba(0, 255, 255, 0.5)',
        md: '0 0 8px 2px rgba(0, 255, 255, 0.6), 0 0 12px 4px rgba(255, 0, 255, 0.4)',
        lg: '0 0 16px 4px rgba(0, 255, 255, 0.7), 0 0 24px 8px rgba(255, 0, 255, 0.5)',
      },
      gradients: {
        primary: 'linear-gradient(135deg, #00ffff 0%, #ff00ff 100%)',
        secondary: 'linear-gradient(135deg, #ff00ff 0%, #ff1493 100%)',
      },
    },
  },

  assets: {
    ui: {
      navbar: {
        background: null, // Future: pixelated grid pattern
        pattern: null, // Future: scanlines
      },
      buttons: {
        primary: null, // Future: pixel button with glow
        secondary: null, // Future: hologram effect
      },
    },
    backgrounds: {
      main: null, // Future: pixel cityscape
      dice: null,
    },
    icons: {
      roll: null, // Future: 8-bit dice icon
      dice: null, // Future: pixel cube
      history: null, // Future: pixel list
      settings: null, // Future: pixel gear
      profile: null, // Future: pixel avatar
      uiToggle: null, // Future: pixel eye
    },
    sounds: {
      roll: null, // Future: 8-bit blip
      uiOpen: null, // Future: power up sound
      uiClose: null, // Future: power down sound
      buttonClick: null, // Future: beep
    },
  },

  dice: {
    defaultColors: {
      d4: '#00ffff', // Cyan
      d6: '#ff00ff', // Magenta
      d8: '#00ff00', // Lime green
      d10: '#ffff00', // Yellow
      d12: '#ff1493', // Deep pink
      d20: '#00ffff', // Cyan
    },
    materials: {
      roughness: 0.1, // Very glossy/shiny
      metalness: 0.5,
      emissiveIntensity: 0.5, // Strong glow
    },
    numbering: {
      color: '#000000', // Black for contrast
      style: 'embossed',
    },
  },

  environment: {
    floor: {
      color: '#1a0033', // Dark purple
      material: {
        roughness: 0.2, // Shiny floor (like wet pavement)
        metalness: 0.3,
      },
      receiveShadow: true,
    },
    walls: {
      color: '#2d1b69', // Purple walls
      material: {
        roughness: 0.3,
        metalness: 0.2,
      },
      visible: true,
      height: 6,
    },
    ceiling: {
      visible: false, // Open to night sky
    },
    lighting: {
      ambient: {
        color: '#00ffff', // Cyan ambient
        intensity: 0.4,
      },
      directional: {
        color: '#ff00ff', // Magenta key light
        intensity: 0.8,
        position: [6, 8, 4],
      },
    },
    background: {
      color: '#0d0221',
      gradient: {
        from: '#0d0221', // Dark purple
        to: '#240046', // Purple
        direction: 'vertical',
      },
    },
  },
}
