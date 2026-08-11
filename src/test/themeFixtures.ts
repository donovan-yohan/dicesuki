/**
 * Theme fixtures for component tests.
 */

import { defaultTheme, THEME_ICON_KEYS, type Theme, type ThemeIcons } from '../themes/tokens'

/**
 * Every icon slot explicitly `null` — the shape every non-default theme in the
 * registry currently has. Components must degrade to their emoji/text fallback
 * against this theme (Frontend-ADR-003 progressive enhancement).
 */
export const ICONLESS_THEME: Theme = {
  ...defaultTheme,
  id: 'test-iconless',
  assets: {
    ...defaultTheme.assets,
    icons: THEME_ICON_KEYS.reduce(
      (icons, key) => ({ ...icons, [key]: null }),
      {} as ThemeIcons
    ),
  },
}
