# Daisu UI Overhaul & Theming System Design

**Version**: 1.0
**Date**: 2025-11-14
**Status**: Design Phase

---

## Executive Summary

This document outlines the architectural design for transforming Daisu from a website-like interface into a game-like experience with purchaseable cosmetic skins. The design focuses on creating a flexible theming system that supports visual customization while maintaining consistent functionality.

### Key Design Goals
1. **Game-like Experience**: Transform UI from website to immersive game interface
2. **Cosmetic Flexibility**: Support purchaseable skins with varying visual themes
3. **Performance**: Maintain 60fps physics simulation with themed UI
4. **Developer Experience**: Make creating new themes straightforward and type-safe
5. **Future-Ready**: Architecture supports monetization and content delivery

---

## Current State Analysis

### Existing Component Structure
```
UI Components:
├── HamburgerMenu (top-left) → Dice management
├── HistoryDisplay (top-right) → Roll history flyout
├── RollButton (bottom-center) → Trigger rolls
├── SettingsButton (bottom-right) → Motion toggle
├── ResultDisplay (top-center) → Current roll results
└── DeviceMotionButton (deprecated)

State Management:
├── useDiceStore → Dice state, rolls, history
├── useDiceManagerStore → Dice collection management
└── useUIStore → Motion mode toggle
```

### Current Tech Stack
- **Styling**: Tailwind CSS (utility-first)
- **3D**: React Three Fiber + Rapier Physics
- **State**: Zustand
- **Build**: Vite + TypeScript

### Pain Points
- Inline Tailwind classes make theming difficult
- No centralized design token system
- Hard-coded visual properties scattered across components
- No animation system for UI transitions

---

## Theming System Architecture

### Option Analysis: CSS-in-JS vs Tailwind Theming

#### Option 1: Tailwind + CSS Variables (RECOMMENDED ✅)
**Pros:**
- Minimal bundle size impact (no runtime CSS-in-JS)
- Already using Tailwind (zero migration cost)
- Excellent performance (compile-time CSS)
- Simple theme switching via CSS variable updates
- TypeScript support via tailwind.config.ts

**Cons:**
- Less flexibility for complex dynamic styles
- SVG/image assets require separate loading system

**Verdict**: Best fit for this project due to existing Tailwind usage and performance requirements.

#### Option 2: Styled-Components
**Pros:**
- Full dynamic theming capability
- Component-scoped styles
- Popular, well-documented

**Cons:**
- Runtime CSS generation (~7kb bundle)
- Potential performance impact with many components
- Complete rewrite of existing Tailwind code

#### Option 3: Vanilla-Extract
**Pros:**
- Zero-runtime CSS-in-JS
- TypeScript-first design tokens
- Excellent performance

**Cons:**
- Complete rewrite required
- Steeper learning curve
- Smaller ecosystem

---

## Recommended Theming Approach

### Architecture: Hybrid Tailwind + Asset System

```typescript
// Theme structure
interface Theme {
  id: string
  name: string
  description: string
  price: number // 0 for default theme

  // Design tokens (CSS variables)
  tokens: {
    colors: ThemeColors
    typography: ThemeTypography
    spacing: ThemeSpacing
    effects: ThemeEffects
  }

  // Asset manifest
  assets: {
    ui: ThemeUIAssets
    backgrounds: ThemeBackgrounds
    sounds?: ThemeSounds // Future
  }
}

// Design tokens
interface ThemeColors {
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

interface ThemeEffects {
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

// Asset manifest
interface ThemeUIAssets {
  navbar: {
    background: string | null // SVG or image URL
    pattern: string | null
  }
  buttons: {
    primary: string | null
    secondary: string | null
  }
  icons: {
    roll: string
    dice: string
    history: string
    settings: string
    profile: string
  }
}
```

### Implementation Strategy

#### Phase 1: Design Token System (Week 1)
```typescript
// src/themes/tokens.ts
export const defaultTheme: Theme = {
  id: 'default',
  name: 'Classic Dice',
  description: 'Clean, modern interface',
  price: 0,

  tokens: {
    colors: {
      primary: '#1f2937',      // gray-800
      secondary: '#374151',    // gray-700
      accent: '#fb923c',       // orange-400
      background: '#000000',
      surface: '#1f2937',
      text: {
        primary: '#ffffff',
        secondary: '#d1d5db',  // gray-300
        muted: '#9ca3af'       // gray-400
      },
      dice: {
        highlight: '#fb923c',
        shadow: '#000000'
      }
    },
    typography: {
      fontFamily: {
        primary: 'system-ui, sans-serif',
        mono: 'monospace'
      },
      fontSize: {
        xs: '0.75rem',
        sm: '0.875rem',
        base: '1rem',
        lg: '1.125rem',
        xl: '1.25rem',
        '2xl': '1.5rem',
        '3xl': '1.875rem'
      }
    },
    spacing: {
      unit: '0.25rem', // 4px base unit
    },
    effects: {
      borderRadius: {
        sm: '0.25rem',
        md: '0.5rem',
        lg: '0.75rem',
        full: '9999px'
      },
      shadows: {
        sm: '0 1px 2px 0 rgb(0 0 0 / 0.05)',
        md: '0 4px 6px -1px rgb(0 0 0 / 0.1)',
        lg: '0 10px 15px -3px rgb(0 0 0 / 0.1)'
      },
      gradients: {
        primary: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
        secondary: 'linear-gradient(135deg, #f093fb 0%, #f5576c 100%)'
      }
    }
  },

  assets: {
    ui: {
      navbar: { background: null, pattern: null },
      buttons: { primary: null, secondary: null }
    },
    backgrounds: { main: null, dice: null },
    icons: {
      roll: '/icons/default/roll.svg',
      dice: '/icons/default/dice.svg',
      history: '/icons/default/history.svg',
      settings: '/icons/default/settings.svg',
      profile: '/icons/default/profile.svg'
    }
  }
}

// Example themed variant
export const fantasyTheme: Theme = {
  id: 'fantasy-earth',
  name: 'Fantasy Earth',
  description: 'Mystical forest with magical creatures',
  price: 299, // cents

  tokens: {
    colors: {
      primary: '#2d5016',      // deep forest green
      secondary: '#4a7c2e',    // moss green
      accent: '#ffd700',       // gold
      background: '#1a2814',   // dark forest
      surface: '#2d5016',
      text: {
        primary: '#f5e6d3',    // parchment
        secondary: '#d4c4a8',
        muted: '#8b7355'
      },
      dice: {
        highlight: '#ffd700',
        shadow: '#1a1a0f'
      }
    },
    // ... other tokens customized for fantasy theme
  },

  assets: {
    ui: {
      navbar: {
        background: '/themes/fantasy/navbar-grass.svg',
        pattern: '/themes/fantasy/mushrooms-pattern.svg'
      },
      buttons: {
        primary: '/themes/fantasy/button-stone.svg',
        secondary: '/themes/fantasy/button-wood.svg'
      }
    },
    backgrounds: {
      main: '/themes/fantasy/forest-bg.jpg',
      dice: null
    },
    icons: {
      roll: '/themes/fantasy/icons/wand.svg',
      dice: '/themes/fantasy/icons/rune-dice.svg',
      history: '/themes/fantasy/icons/scroll.svg',
      settings: '/themes/fantasy/icons/crystal.svg',
      profile: '/themes/fantasy/icons/shield.svg'
    }
  }
}
```

#### Phase 2: Tailwind Configuration (Week 1)
```javascript
// tailwind.config.js
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        // CSS variable references
        'theme-primary': 'var(--color-primary)',
        'theme-secondary': 'var(--color-secondary)',
        'theme-accent': 'var(--color-accent)',
        'theme-bg': 'var(--color-background)',
        'theme-surface': 'var(--color-surface)',
        'theme-text': 'var(--color-text-primary)',
        'theme-text-secondary': 'var(--color-text-secondary)',
        'theme-text-muted': 'var(--color-text-muted)',
      },
      fontFamily: {
        'theme-primary': 'var(--font-family-primary)',
        'theme-mono': 'var(--font-family-mono)',
      },
      borderRadius: {
        'theme-sm': 'var(--border-radius-sm)',
        'theme-md': 'var(--border-radius-md)',
        'theme-lg': 'var(--border-radius-lg)',
        'theme-full': 'var(--border-radius-full)',
      },
      boxShadow: {
        'theme-sm': 'var(--shadow-sm)',
        'theme-md': 'var(--shadow-md)',
        'theme-lg': 'var(--shadow-lg)',
      }
    }
  },
  plugins: []
}
```

#### Phase 3: Theme Provider & Hook (Week 1)
```typescript
// src/contexts/ThemeContext.tsx
import { createContext, useContext, useEffect, useState, ReactNode } from 'react'
import { defaultTheme, type Theme } from '../themes/tokens'

interface ThemeContextValue {
  currentTheme: Theme
  setTheme: (themeId: string) => void
  availableThemes: Theme[]
  ownedThemes: string[] // IDs of purchased themes
}

const ThemeContext = createContext<ThemeContextValue | null>(null)

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [currentTheme, setCurrentTheme] = useState<Theme>(defaultTheme)
  const [ownedThemes, setOwnedThemes] = useState<string[]>(['default'])

  // Apply CSS variables when theme changes
  useEffect(() => {
    const root = document.documentElement
    const { tokens } = currentTheme

    // Apply color tokens
    root.style.setProperty('--color-primary', tokens.colors.primary)
    root.style.setProperty('--color-secondary', tokens.colors.secondary)
    root.style.setProperty('--color-accent', tokens.colors.accent)
    root.style.setProperty('--color-background', tokens.colors.background)
    root.style.setProperty('--color-surface', tokens.colors.surface)
    root.style.setProperty('--color-text-primary', tokens.colors.text.primary)
    root.style.setProperty('--color-text-secondary', tokens.colors.text.secondary)
    root.style.setProperty('--color-text-muted', tokens.colors.text.muted)

    // Apply typography tokens
    root.style.setProperty('--font-family-primary', tokens.typography.fontFamily.primary)
    root.style.setProperty('--font-family-mono', tokens.typography.fontFamily.mono)

    // Apply effect tokens
    root.style.setProperty('--border-radius-sm', tokens.effects.borderRadius.sm)
    root.style.setProperty('--border-radius-md', tokens.effects.borderRadius.md)
    root.style.setProperty('--border-radius-lg', tokens.effects.borderRadius.lg)
    root.style.setProperty('--border-radius-full', tokens.effects.borderRadius.full)

    root.style.setProperty('--shadow-sm', tokens.effects.shadows.sm)
    root.style.setProperty('--shadow-md', tokens.effects.shadows.md)
    root.style.setProperty('--shadow-lg', tokens.effects.shadows.lg)

    // Preload theme assets
    preloadThemeAssets(currentTheme)
  }, [currentTheme])

  const setTheme = (themeId: string) => {
    // Load theme from registry
    // Check if user owns theme
    // Apply theme
  }

  return (
    <ThemeContext.Provider value={{ currentTheme, setTheme, availableThemes: [], ownedThemes }}>
      {children}
    </ThemeContext.Provider>
  )
}

export function useTheme() {
  const context = useContext(ThemeContext)
  if (!context) throw new Error('useTheme must be used within ThemeProvider')
  return context
}

// Asset preloading utility
function preloadThemeAssets(theme: Theme) {
  const imagesToPreload = [
    theme.assets.ui.navbar.background,
    theme.assets.ui.navbar.pattern,
    theme.assets.ui.buttons.primary,
    theme.assets.ui.buttons.secondary,
    theme.assets.backgrounds.main,
    ...Object.values(theme.assets.icons)
  ].filter(Boolean) as string[]

  imagesToPreload.forEach(src => {
    const img = new Image()
    img.src = src
  })
}
```

---

## New UI Layout Design

### Layout Structure

```
┌─────────────────────────────────────────────────┐
│  ⚙️                                       👤   │ Top corners
│  Settings                              Profile │
│                                                 │
│                                                 │
│              3D Dice Viewport                   │
│                                                 │
│                                                 │
│                                                 │
│                                                 │
│  ┌───────────────────────────────────────────┐ │
│  │  👁️   🎲   ⚫   📜   📱  │ Bottom navbar  │
│  │  UI  Dice  ROLL Hist Mobile              │ │
│  └───────────────────────────────────────────┘ │
└─────────────────────────────────────────────────┘

UI Hidden State:
┌─────────────────────────────────────────────────┐
│                                                 │
│                                                 │
│                                                 │
│              3D Dice Viewport                   │
│              (Full Screen)                      │
│                                                 │
│                                                 │
│                                                 │
│  👁️                                             │ UI toggle only
└─────────────────────────────────────────────────┘
```

### Component Specifications

#### 1. Bottom Navigation Bar (`BottomNav.tsx`)

```typescript
interface BottomNavProps {
  isVisible: boolean
  onToggleUI: () => void
  isMobile: boolean
}

/**
 * Bottom navigation bar with 5 primary actions
 *
 * Layout (left to right):
 * 1. UI Toggle (eye icon)
 * 2. Dice Manager (hamburger/dice icon)
 * 3. Roll Button (large circular center)
 * 4. History (scroll icon)
 * 5. Motion Toggle (mobile only, gesture icon)
 *
 * Features:
 * - Fixed positioning at bottom
 * - Themed background with asset support
 * - Slide-down animation on hide
 * - Responsive spacing
 */
export function BottomNav({ isVisible, onToggleUI, isMobile }: BottomNavProps) {
  // Implementation
}
```

**Design Specs:**
- Height: 80px (mobile), 100px (desktop)
- Background: Themed asset or gradient
- Border: 2px themed border with glow effect
- Spacing: Evenly distributed with center emphasis
- Animation: 300ms ease-in-out slide

#### 2. Center Roll Button (`CenterRollButton.tsx`)

```typescript
interface CenterRollButtonProps {
  onClick: () => void
  disabled: boolean
  isRolling: boolean
}

/**
 * Large circular roll button - centerpiece of bottom nav
 *
 * Features:
 * - 80px diameter (mobile), 100px (desktop)
 * - Elevated above nav bar (z-index + shadow)
 * - Themed icon/background
 * - Pulse animation when ready
 * - Spin animation when rolling
 * - Haptic feedback on mobile
 */
export function CenterRollButton({ onClick, disabled, isRolling }: CenterRollButtonProps) {
  // Implementation
}
```

**Design Specs:**
- Diameter: 80px (mobile), 100px (desktop)
- Position: Centered in nav, elevated 20px above
- States:
  - Ready: Pulsing glow, themed accent color
  - Rolling: Spinning animation, muted color
  - Disabled: Grayscale, no animation
- Icon: Themed dice or custom SVG

#### 3. Corner Icons (`CornerIcon.tsx`)

```typescript
interface CornerIconProps {
  position: 'top-left' | 'top-right'
  icon: string // Themed icon path
  onClick: () => void
  label: string
  isVisible: boolean
}

/**
 * Reusable corner icon component
 *
 * Top-Left: Settings
 * Top-Right: Profile/Room
 *
 * Features:
 * - Themed background (floating card)
 * - Slide-out animation when UI hidden
 * - Hover effects
 * - Tooltip on hover
 */
export function CornerIcon({ position, icon, onClick, label, isVisible }: CornerIconProps) {
  // Implementation
}
```

**Design Specs:**
- Size: 56px × 56px
- Position: 16px from edges
- Background: Themed surface with shadow
- Animation: Slide out/in based on position
- Timing: 300ms ease-in-out, staggered with nav

#### 4. UI Toggle Mini Button (`UIToggleMini.tsx`)

```typescript
/**
 * Minimal UI toggle shown when main UI is hidden
 *
 * Features:
 * - Bottom-left corner
 * - Semi-transparent themed background
 * - Eye icon
 * - Fade-in when UI hidden
 */
export function UIToggleMini({ onClick }: { onClick: () => void }) {
  // Implementation
}
```

**Design Specs:**
- Size: 48px × 48px
- Position: 16px from bottom-left
- Opacity: 0.7 default, 1.0 on hover
- Animation: Fade-in 200ms after nav hides

---

## Animation System

### Animation Specifications

```typescript
// src/animations/ui-transitions.ts

export const UI_ANIMATIONS = {
  // Bottom nav show/hide
  navBar: {
    show: {
      y: 0,
      opacity: 1,
      transition: { duration: 0.3, ease: 'easeInOut' }
    },
    hide: {
      y: 100, // Slide down offscreen
      opacity: 0,
      transition: { duration: 0.3, ease: 'easeInOut' }
    }
  },

  // Corner icons show/hide
  topLeftIcon: {
    show: {
      x: 0,
      opacity: 1,
      transition: { duration: 0.3, ease: 'easeInOut', delay: 0.1 }
    },
    hide: {
      x: -100, // Slide left offscreen
      opacity: 0,
      transition: { duration: 0.3, ease: 'easeInOut' }
    }
  },

  topRightIcon: {
    show: {
      x: 0,
      opacity: 1,
      transition: { duration: 0.3, ease: 'easeInOut', delay: 0.1 }
    },
    hide: {
      x: 100, // Slide right offscreen
      opacity: 0,
      transition: { duration: 0.3, ease: 'easeInOut' }
    }
  },

  // Mini toggle fade
  miniToggle: {
    show: {
      opacity: 0.7,
      scale: 1,
      transition: { duration: 0.2, delay: 0.4 }
    },
    hide: {
      opacity: 0,
      scale: 0.8,
      transition: { duration: 0.2 }
    }
  },

  // Roll button states
  rollButton: {
    ready: {
      scale: [1, 1.05, 1],
      boxShadow: [
        '0 0 20px var(--color-accent)',
        '0 0 30px var(--color-accent)',
        '0 0 20px var(--color-accent)'
      ],
      transition: {
        duration: 2,
        repeat: Infinity,
        ease: 'easeInOut'
      }
    },
    rolling: {
      rotate: 360,
      transition: {
        duration: 1,
        repeat: Infinity,
        ease: 'linear'
      }
    },
    disabled: {
      scale: 0.95,
      opacity: 0.5
    }
  }
}
```

### Animation Library: Framer Motion

**Recommended**: Install `framer-motion` for declarative animations

```bash
npm install framer-motion
```

**Rationale**:
- React-first animation library
- Declarative API matches component model
- Excellent performance (GPU-accelerated)
- Spring physics for natural motion
- Gesture support for mobile interactions
- Small bundle size (~30kb)

---

## Implementation Phases

### Phase 1: Foundation (Week 1)
**Goal**: Establish theming system and update existing components

Tasks:
- [ ] Install framer-motion
- [ ] Create theme token system (`src/themes/tokens.ts`)
- [ ] Build ThemeProvider and useTheme hook
- [ ] Update Tailwind config for CSS variables
- [ ] Create default theme with current design
- [ ] Refactor 2-3 existing components to use theme tokens

**Deliverables**:
- Working theme system
- At least one component fully themed
- Documentation for creating themes

### Phase 2: New Layout Components (Week 2)
**Goal**: Build new UI layout structure

Tasks:
- [ ] Create BottomNav component
- [ ] Create CenterRollButton component
- [ ] Create CornerIcon component
- [ ] Create UIToggleMini component
- [ ] Implement animation system
- [ ] Add UI visibility state to useUIStore

**Deliverables**:
- All new UI components built
- Smooth UI toggle animations
- Mobile-responsive layout

### Phase 3: Component Migration (Week 2)
**Goal**: Migrate existing UI to new layout

Tasks:
- [ ] Migrate HamburgerMenu to bottom nav slot
- [ ] Migrate HistoryDisplay to bottom nav slot
- [ ] Migrate RollButton to CenterRollButton
- [ ] Migrate SettingsButton to top-left corner
- [ ] Add placeholder profile icon (top-right)
- [ ] Remove old component implementations

**Deliverables**:
- Complete UI migration
- Functional parity with old layout
- Clean up deprecated components

### Phase 4: Fantasy Theme (Week 3)
**Goal**: Create first purchaseable theme as proof-of-concept

Tasks:
- [ ] Design fantasy earth theme tokens
- [ ] Create fantasy theme assets (SVGs, backgrounds)
- [ ] Implement theme in theme registry
- [ ] Build theme preview UI
- [ ] Add theme selection UI
- [ ] Test theme switching performance

**Deliverables**:
- Complete fantasy earth theme
- Theme marketplace UI (basic)
- Theme persistence in localStorage

### Phase 5: Polish & Optimization (Week 4)
**Goal**: Optimize performance and add finishing touches

Tasks:
- [ ] Optimize asset loading (lazy load, compression)
- [ ] Add transitions between themes
- [ ] Implement theme purchase flow (placeholder)
- [ ] Add sound effects (optional)
- [ ] Performance testing (maintain 60fps)
- [ ] Cross-browser testing
- [ ] Mobile device testing

**Deliverables**:
- Production-ready theming system
- 60fps maintained during animations
- Documentation for theme creators

---

## File Structure

```
src/
├── themes/
│   ├── tokens.ts              # Theme type definitions and default theme
│   ├── registry.ts            # Theme registry and loader
│   ├── default/               # Default theme assets
│   │   └── icons/
│   ├── fantasy-earth/         # Fantasy theme assets
│   │   ├── icons/
│   │   ├── ui/
│   │   └── backgrounds/
│   └── dungeon-dark/          # Future theme
│       └── ...
│
├── contexts/
│   ├── ThemeContext.tsx       # Theme provider and hook
│   └── ...
│
├── components/
│   ├── layout/                # New layout components
│   │   ├── BottomNav.tsx
│   │   ├── CenterRollButton.tsx
│   │   ├── CornerIcon.tsx
│   │   └── UIToggleMini.tsx
│   ├── themed/                # Themed reusable components
│   │   ├── ThemedButton.tsx
│   │   ├── ThemedPanel.tsx
│   │   └── ThemedIcon.tsx
│   └── ...
│
├── animations/
│   └── ui-transitions.ts      # Animation configurations
│
├── store/
│   ├── useUIStore.ts          # Updated with UI visibility state
│   └── useThemeStore.ts       # Theme ownership and selection
│
└── hooks/
    ├── useTheme.ts            # Re-export from context
    └── useThemedAsset.ts      # Helper for loading themed assets
```

---

## Theme Creation Workflow

### For Developers Creating New Themes

1. **Define Theme Tokens**
```typescript
export const myTheme: Theme = {
  id: 'my-theme-id',
  name: 'My Theme Name',
  description: 'Theme description',
  price: 399,
  tokens: { /* ... */ },
  assets: { /* ... */ }
}
```

2. **Create Asset Directory**
```bash
mkdir -p src/themes/my-theme-id/{icons,ui,backgrounds}
```

3. **Design Assets**
- Icons: 64×64px SVG
- UI elements: SVG with viewBox for scaling
- Backgrounds: WebP or JPG, optimized

4. **Register Theme**
```typescript
// src/themes/registry.ts
import { myTheme } from './my-theme-id/tokens'

export const THEME_REGISTRY = [
  defaultTheme,
  fantasyTheme,
  myTheme  // Add new theme
]
```

5. **Test Theme**
```typescript
// In dev mode, add theme to owned list
setOwnedThemes([...ownedThemes, 'my-theme-id'])
setTheme('my-theme-id')
```

---

## Technical Considerations

### Performance

**Target**: Maintain 60fps physics simulation while animating UI

**Optimizations**:
- Use `transform` and `opacity` for animations (GPU-accelerated)
- Lazy-load theme assets
- Preload next likely theme during idle time
- Use `will-change` CSS property strategically
- Compress images (WebP with fallback)
- SVG optimization with SVGO

### Bundle Size Impact

**Estimated Additions**:
- Framer Motion: ~30kb gzipped
- Theme system: ~5kb gzipped
- Per theme (assets): ~50-200kb (lazy-loaded)

**Total impact**: ~35kb base + per-theme assets (loaded on demand)

### Mobile Considerations

**Bottom Nav**:
- Larger touch targets (min 48×48px)
- Proper spacing between buttons
- Haptic feedback on button press
- Safe area insets for iPhone notch

**Animations**:
- Respect `prefers-reduced-motion`
- Faster animations on lower-end devices
- Gesture-based interactions (swipe to hide UI)

### Accessibility

**Requirements**:
- ARIA labels on all interactive elements
- Keyboard navigation support
- Focus visible styles themed
- Sufficient color contrast in all themes (WCAG AA)
- Screen reader announcements for state changes

---

## Future Enhancements

### Phase 6+: Advanced Features

1. **Dynamic Theme Generation**
   - User-customizable themes
   - Color picker interface
   - Save and share custom themes

2. **Seasonal Themes**
   - Holiday themes (Halloween, Christmas, etc.)
   - Limited-time themes
   - Event-based themes

3. **Interactive Theme Elements**
   - Animated backgrounds
   - Particle effects
   - Interactive UI creatures (fantasy theme)

4. **Sound Design**
   - Themed sound effects
   - Background music per theme
   - Spatial audio for dice rolls

5. **Advanced Asset System**
   - CDN hosting for theme assets
   - Progressive image loading
   - Theme asset versioning
   - Automatic updates

6. **Monetization Integration**
   - In-app purchase flow
   - Theme bundles and sales
   - Season pass system
   - Theme preview before purchase

---

## Migration Strategy

### Backward Compatibility

During migration, maintain old components alongside new ones:

```typescript
// Feature flag system
const USE_NEW_UI = import.meta.env.VITE_NEW_UI === 'true'

export function Scene() {
  return USE_NEW_UI ? <NewUILayout /> : <LegacyUILayout />
}
```

### Rollout Plan

1. **Alpha** (Internal): New UI with feature flag
2. **Beta** (Early Users): A/B test new vs old UI
3. **GA** (All Users): Full rollout, remove old components

---

## Success Metrics

### Technical Metrics
- [ ] 60fps maintained during all animations
- [ ] Theme switch time < 200ms
- [ ] Bundle size increase < 50kb base
- [ ] Mobile performance (60fps on iPhone 12+)

### UX Metrics
- [ ] UI toggle usage (% of sessions)
- [ ] Theme engagement (purchases, switches)
- [ ] User satisfaction survey
- [ ] Accessibility audit passing

### Business Metrics
- [ ] Theme conversion rate
- [ ] Average revenue per user (ARPU)
- [ ] Theme marketplace GMV
- [ ] User retention impact

---

## Questions & Decisions

### Open Questions
1. Should we support user-uploaded theme assets?
2. What payment provider for theme purchases?
3. How to handle theme refunds/returns?
4. Should themes affect dice textures too?

### Technical Decisions
- [x] Theming approach: Tailwind + CSS Variables
- [x] Animation library: Framer Motion
- [ ] Asset hosting: Local vs CDN
- [ ] Theme format: JSON vs TypeScript
- [ ] Versioning strategy: Semantic versioning?

---

## Appendix

### Reference Links
- [Framer Motion Docs](https://www.framer.com/motion/)
- [Tailwind CSS Variables](https://tailwindcss.com/docs/customizing-colors#using-css-variables)
- [Web Performance](https://web.dev/performance/)

### Design Inspiration
- Hearthstone UI (card game themes)
- D&D Beyond (fantasy theme)
- Tabletop Simulator (game-like interface)

---

**Next Steps**: Review this design document, discuss any changes, then proceed with Phase 1 implementation.
