/**
 * Theme Registry
 *
 * Central registry for all available themes.
 * Used by ThemeProvider to load and manage themes.
 */

import {
  defaultTheme,
  fantasyTheme,
  critterForestTheme,
  dungeonCastleTheme,
  neonCyberCityTheme,
  type Theme,
} from './tokens'

/**
 * All available themes in the application
 */
export const THEME_REGISTRY: Theme[] = [
  defaultTheme,
  fantasyTheme,
  critterForestTheme,
  dungeonCastleTheme,
  neonCyberCityTheme,
]

/**
 * Get a theme by ID
 */
export function getThemeById(id: string): Theme | undefined {
  return THEME_REGISTRY.find((theme) => theme.id === id)
}

/**
 * Get all free themes
 */
export function getFreeThemes(): Theme[] {
  return THEME_REGISTRY.filter((theme) => theme.price === 0)
}

/**
 * Get all purchaseable themes
 */
export function getPurchaseableThemes(): Theme[] {
  return THEME_REGISTRY.filter((theme) => theme.price > 0)
}

/**
 * Validate theme structure
 */
export function validateTheme(theme: Theme): boolean {
  // Basic validation
  if (!theme.id || !theme.name || typeof theme.price !== 'number') {
    return false
  }

  // Check required token properties
  if (!theme.tokens.colors || !theme.tokens.typography || !theme.tokens.effects) {
    return false
  }

  // Check required asset properties
  if (!theme.assets.icons) {
    return false
  }

  return true
}
