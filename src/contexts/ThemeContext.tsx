/**
 * Theme Context and Provider
 *
 * Provides theme management across the application.
 * Handles theme switching, CSS variable updates, and asset preloading.
 */

import { createContext, useContext, useEffect, useState, ReactNode } from 'react'
import { defaultTheme, type Theme } from '../themes/tokens'
import { THEME_REGISTRY, getThemeById } from '../themes/registry'

// ============================================================================
// Context Definition
// ============================================================================

interface ThemeContextValue {
  currentTheme: Theme
  setTheme: (themeId: string) => void
  availableThemes: Theme[]
  ownedThemes: string[]
  purchaseTheme: (themeId: string) => Promise<boolean>
}

const ThemeContext = createContext<ThemeContextValue | null>(null)

// ============================================================================
// Local Storage Keys
// ============================================================================

const STORAGE_KEY_CURRENT_THEME = 'daisu-current-theme'
const STORAGE_KEY_OWNED_THEMES = 'daisu-owned-themes'

// ============================================================================
// Theme Provider Component
// ============================================================================

interface ThemeProviderProps {
  children: ReactNode
}

export function ThemeProvider({ children }: ThemeProviderProps) {
  // Load current theme from localStorage or default
  const [currentTheme, setCurrentTheme] = useState<Theme>(() => {
    const savedThemeId = localStorage.getItem(STORAGE_KEY_CURRENT_THEME)
    if (savedThemeId) {
      const theme = getThemeById(savedThemeId)
      if (theme) return theme
    }
    return defaultTheme
  })

  // Load owned themes from localStorage
  const [ownedThemes, setOwnedThemes] = useState<string[]>(() => {
    const saved = localStorage.getItem(STORAGE_KEY_OWNED_THEMES)
    if (saved) {
      try {
        const parsed = JSON.parse(saved)
        return Array.isArray(parsed) ? parsed : ['default']
      } catch {
        return ['default']
      }
    }
    return ['default']
  })

  // Apply CSS variables when theme changes
  useEffect(() => {
    applyCSSVariables(currentTheme)
    preloadThemeAssets(currentTheme)

    // Update dice colors to match new theme
    // Dynamically import to avoid circular dependency
    import('../store/useDiceManagerStore').then(({ useDiceManagerStore }) => {
      useDiceManagerStore.getState().updateDiceColors(currentTheme.id)
    })

    // Save current theme to localStorage
    localStorage.setItem(STORAGE_KEY_CURRENT_THEME, currentTheme.id)
  }, [currentTheme])

  // Save owned themes to localStorage when updated
  useEffect(() => {
    localStorage.setItem(STORAGE_KEY_OWNED_THEMES, JSON.stringify(ownedThemes))
  }, [ownedThemes])

  /**
   * Change the current theme
   * Only allows switching to owned themes
   */
  const setTheme = (themeId: string) => {
    // Check if user owns this theme
    if (!ownedThemes.includes(themeId)) {
      console.warn(`Cannot switch to theme "${themeId}" - not owned by user`)
      return
    }

    // Load theme from registry
    const theme = getThemeById(themeId)
    if (!theme) {
      console.error(`Theme "${themeId}" not found in registry`)
      return
    }

    setCurrentTheme(theme)
  }

  /**
   * Purchase a theme (placeholder for future integration)
   * In production, this would call a payment API
   */
  const purchaseTheme = async (themeId: string): Promise<boolean> => {
    const theme = getThemeById(themeId)
    if (!theme) {
      console.error(`Theme "${themeId}" not found`)
      return false
    }

    if (theme.price === 0) {
      // Free theme - just add to owned
      if (!ownedThemes.includes(themeId)) {
        setOwnedThemes([...ownedThemes, themeId])
      }
      return true
    }

    // TODO: Implement payment flow
    // For now, just add to owned themes (development mode)
    console.log(`[DEV] Simulating purchase of "${theme.name}" for $${theme.price / 100}`)

    if (!ownedThemes.includes(themeId)) {
      setOwnedThemes([...ownedThemes, themeId])
    }

    return true
  }

  const value: ThemeContextValue = {
    currentTheme,
    setTheme,
    availableThemes: THEME_REGISTRY,
    ownedThemes,
    purchaseTheme,
  }

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>
}

// ============================================================================
// Custom Hook
// ============================================================================

export function useTheme() {
  const context = useContext(ThemeContext)
  if (!context) {
    throw new Error('useTheme must be used within ThemeProvider')
  }
  return context
}

// ============================================================================
// CSS Variable Application
// ============================================================================

/**
 * Apply theme tokens as CSS variables to document root
 */
function applyCSSVariables(theme: Theme) {
  const root = document.documentElement
  const { tokens } = theme

  // Color tokens
  root.style.setProperty('--color-primary', tokens.colors.primary)
  root.style.setProperty('--color-secondary', tokens.colors.secondary)
  root.style.setProperty('--color-accent', tokens.colors.accent)
  root.style.setProperty('--color-background', tokens.colors.background)
  root.style.setProperty('--color-surface', tokens.colors.surface)
  root.style.setProperty('--color-text-primary', tokens.colors.text.primary)
  root.style.setProperty('--color-text-secondary', tokens.colors.text.secondary)
  root.style.setProperty('--color-text-muted', tokens.colors.text.muted)
  root.style.setProperty('--color-dice-highlight', tokens.colors.dice.highlight)
  root.style.setProperty('--color-dice-shadow', tokens.colors.dice.shadow)

  // Typography tokens
  root.style.setProperty('--font-family-primary', tokens.typography.fontFamily.primary)
  root.style.setProperty('--font-family-mono', tokens.typography.fontFamily.mono)

  root.style.setProperty('--font-size-xs', tokens.typography.fontSize.xs)
  root.style.setProperty('--font-size-sm', tokens.typography.fontSize.sm)
  root.style.setProperty('--font-size-base', tokens.typography.fontSize.base)
  root.style.setProperty('--font-size-lg', tokens.typography.fontSize.lg)
  root.style.setProperty('--font-size-xl', tokens.typography.fontSize.xl)
  root.style.setProperty('--font-size-2xl', tokens.typography.fontSize['2xl'])
  root.style.setProperty('--font-size-3xl', tokens.typography.fontSize['3xl'])

  root.style.setProperty('--font-weight-normal', tokens.typography.fontWeight.normal)
  root.style.setProperty('--font-weight-medium', tokens.typography.fontWeight.medium)
  root.style.setProperty('--font-weight-semibold', tokens.typography.fontWeight.semibold)
  root.style.setProperty('--font-weight-bold', tokens.typography.fontWeight.bold)

  // Spacing tokens
  root.style.setProperty('--spacing-unit', tokens.spacing.unit)

  // Effect tokens
  root.style.setProperty('--border-radius-sm', tokens.effects.borderRadius.sm)
  root.style.setProperty('--border-radius-md', tokens.effects.borderRadius.md)
  root.style.setProperty('--border-radius-lg', tokens.effects.borderRadius.lg)
  root.style.setProperty('--border-radius-full', tokens.effects.borderRadius.full)

  root.style.setProperty('--shadow-sm', tokens.effects.shadows.sm)
  root.style.setProperty('--shadow-md', tokens.effects.shadows.md)
  root.style.setProperty('--shadow-lg', tokens.effects.shadows.lg)

  root.style.setProperty('--gradient-primary', tokens.effects.gradients.primary)
  root.style.setProperty('--gradient-secondary', tokens.effects.gradients.secondary)
}

// ============================================================================
// Asset Preloading
// ============================================================================

/**
 * Preload theme assets (images, SVGs) for better performance
 */
function preloadThemeAssets(theme: Theme) {
  const imagesToPreload = [
    theme.assets.ui.navbar.background,
    theme.assets.ui.navbar.pattern,
    theme.assets.ui.buttons.primary,
    theme.assets.ui.buttons.secondary,
    theme.assets.backgrounds.main,
    theme.assets.backgrounds.dice,
    ...Object.values(theme.assets.icons),
  ].filter(Boolean) as string[]

  imagesToPreload.forEach((src) => {
    const img = new Image()
    img.src = src
  })
}
