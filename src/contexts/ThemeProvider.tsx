/**
 * Theme Provider
 *
 * Provides theme management across the application.
 * Handles theme switching, CSS variable updates, and asset preloading.
 */

import { useEffect, useState, type ReactNode } from 'react'
import { defaultTheme, type Theme } from '../themes/tokens'
import { THEME_REGISTRY, getThemeById } from '../themes/registry'
import { useDiceManagerStore } from '../store/useDiceManagerStore'
import { ThemeContext, type ThemeContextValue } from './ThemeContext'

const STORAGE_KEY_CURRENT_THEME = 'dicesuki-current-theme'
const STORAGE_KEY_OWNED_THEMES = 'dicesuki-owned-themes'

interface ThemeProviderProps {
  children: ReactNode
}

export function ThemeProvider({ children }: ThemeProviderProps) {
  const [currentTheme, setCurrentTheme] = useState<Theme>(() => {
    const savedThemeId = localStorage.getItem(STORAGE_KEY_CURRENT_THEME)
    if (savedThemeId) {
      const theme = getThemeById(savedThemeId)
      if (theme) return theme
    }
    return defaultTheme
  })

  // For now, all themes are owned by default for development/testing
  const [ownedThemes, setOwnedThemes] = useState<string[]>(() => {
    const saved = localStorage.getItem(STORAGE_KEY_OWNED_THEMES)
    if (saved) {
      try {
        const parsed = JSON.parse(saved)
        return Array.isArray(parsed) ? parsed : THEME_REGISTRY.map(t => t.id)
      } catch {
        return THEME_REGISTRY.map(t => t.id)
      }
    }
    return THEME_REGISTRY.map(t => t.id)
  })

  useEffect(() => {
    applyCSSVariables(currentTheme)
    preloadThemeAssets(currentTheme)
    // Keep dice synchronized in this effect. Deferring this update can let a
    // previous theme's async callback overwrite the newly selected theme.
    useDiceManagerStore.getState().updateDiceColors(currentTheme.id)

    localStorage.setItem(STORAGE_KEY_CURRENT_THEME, currentTheme.id)
  }, [currentTheme])

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY_OWNED_THEMES, JSON.stringify(ownedThemes))
  }, [ownedThemes])

  // Migration: ensure all themes are owned in development/testing.
  useEffect(() => {
    const allThemeIds = THEME_REGISTRY.map(t => t.id)
    const missingThemes = allThemeIds.filter(id => !ownedThemes.includes(id))

    if (missingThemes.length > 0) {
      console.log('[ThemeProvider] Granting access to all themes:', missingThemes)
      setOwnedThemes(allThemeIds)
    }
  }, [ownedThemes])

  const setTheme = (themeId: string) => {
    if (!ownedThemes.includes(themeId)) {
      console.warn(`Cannot switch to theme "${themeId}" - not owned by user`)
      return
    }

    const theme = getThemeById(themeId)
    if (!theme) {
      console.error(`Theme "${themeId}" not found in registry`)
      return
    }

    setCurrentTheme(theme)
  }

  const purchaseTheme = async (themeId: string): Promise<boolean> => {
    const theme = getThemeById(themeId)
    if (!theme) {
      console.error(`Theme "${themeId}" not found`)
      return false
    }

    if (theme.price === 0) {
      if (!ownedThemes.includes(themeId)) {
        setOwnedThemes([...ownedThemes, themeId])
      }
      return true
    }

    // TODO: Implement payment flow. For now, just add to owned themes.
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

function applyCSSVariables(theme: Theme) {
  const root = document.documentElement
  const { tokens } = theme

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

  root.style.setProperty('--spacing-unit', tokens.spacing.unit)

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
