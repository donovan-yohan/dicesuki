/**
 * Theme Registry
 *
 * Central registry for all available themes.
 * Used by ThemeProvider to load and manage themes.
 */

import { defaultTheme, type Theme } from './tokens'
import { sunlitGladeCelTheme } from './woodland'
import { cyberpunkCutlineTheme, monsterDungeonTheme } from './worlds'

/**
 * All available themes in the application
 */
export const THEME_REGISTRY: Theme[] = [
  defaultTheme,
  sunlitGladeCelTheme,
  cyberpunkCutlineTheme,
  monsterDungeonTheme,
]

// Resolve retired selections at read time. Keep stored settings and ownership
// history intact, while exposing only the current worlds in pickers.
const LEGACY_THEME_IDS = new Map<string, string>([
  ['fantasy-earth', 'sunlit-glade-cel'],
  ['critter-forest', 'sunlit-glade-cel'],
  ['sunlit-glade', 'sunlit-glade-cel'],
  ['dungeon-castle', 'monster-dungeon'],
  ['neon-cyber-city', 'cyberpunk-cutline'],
])

/**
 * Get an active theme by ID, including known retired aliases.
 */
export function getThemeById(id: string): Theme | undefined {
  const canonicalId = LEGACY_THEME_IDS.get(id) ?? id
  return THEME_REGISTRY.find((theme) => theme.id === canonicalId)
}

/**
 * Resolve the theme a client should apply to the room ENVIRONMENT (scene
 * background, lighting, floor/walls, tray). In a multiplayer room the host sets
 * a shared `themeId`; every client renders the room's environment from it while
 * their personal dice skins (inventory identity) stay per-player (#75).
 *
 * - `roomThemeId == null` (host hasn't chosen one — includes solo rooms and
 *   fresh multiplayer rooms): fall back to the player's own `personalTheme`.
 * - `roomThemeId` is a known theme: use it.
 * - `roomThemeId` is unknown (not in the registry): fall back to the default
 *   theme gracefully rather than erroring, so a newer/removed theme id from
 *   another client never breaks the scene.
 */
export function resolveRoomEnvironmentTheme(
  roomThemeId: string | null | undefined,
  personalTheme: Theme
): Theme {
  if (!roomThemeId) return personalTheme
  return getThemeById(roomThemeId) ?? defaultTheme
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
