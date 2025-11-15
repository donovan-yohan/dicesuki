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
// Complete Theme Definition
// ============================================================================

export interface Theme {
  // Metadata
  id: string
  name: string
  description: string
  price: number // Price in cents (0 = free/default)
  preview?: string // Preview image URL

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
}

// ============================================================================
// Default Theme
// ============================================================================

export const defaultTheme: Theme = {
  id: 'default',
  name: 'Classic Dice',
  description: 'Clean, modern interface with timeless design',
  price: 0,

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
}

// ============================================================================
// Fantasy Earth Theme
// ============================================================================

export const fantasyTheme: Theme = {
  id: 'fantasy-earth',
  name: 'Fantasy Earth',
  description: 'Mystical forest realm with magical creatures and enchanted elements',
  price: 299, // $2.99

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
}
