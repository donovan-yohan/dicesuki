/**
 * useEnvironmentTheme
 *
 * Resolves the theme that 3D scene ENVIRONMENT components (background, lighting,
 * floor/walls, tray) should render. In a multiplayer room the host sets a shared
 * `themeId` in room settings; every client applies that room theme to the
 * environment, while their personal dice skins (inventory identity) stay
 * per-player (#75).
 *
 * Solo/local play is unaffected: the loopback room leaves `themeId` unset, so the
 * player's own theme (from {@link useTheme}) is used. An unknown `themeId` falls
 * back to the default theme gracefully (see {@link resolveRoomEnvironmentTheme}).
 *
 * UI chrome (navbars, panels, buttons) intentionally keeps using {@link useTheme}
 * so each player's personal look is preserved outside the shared scene.
 */
import { useTheme } from '../contexts/ThemeContext'
import { useMultiplayerStore } from '../store/useMultiplayerStore'
import { getRoomThemeId } from '../lib/multiplayerMessages'
import { resolveRoomEnvironmentTheme } from '../themes/registry'
import type { Theme } from '../themes/tokens'

export function useEnvironmentTheme(): Theme {
  const { currentTheme } = useTheme()
  const roomThemeId = useMultiplayerStore((s) => getRoomThemeId(s.roomSettings))
  return resolveRoomEnvironmentTheme(roomThemeId, currentTheme)
}
