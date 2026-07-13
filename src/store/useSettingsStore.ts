import { create } from 'zustand'
import { persist, createJSONStorage } from 'zustand/middleware'
import { defaultTheme } from '../themes/tokens'

/**
 * Settings Store (issue #82, Frontend-ADR-002 / ADR 006).
 *
 * Durable, cross-device user preferences — currently the selected theme id.
 * Split into its own domain store (ADR-002) so the sync layer can hydrate it on
 * sign-in and observe local changes for debounced push, independent of the
 * ephemeral UI store (`useUIStore`, which owns device-ergonomic prefs such as
 * haptics/motion that are intentionally NOT synced across devices).
 *
 * Local-first: this store is the source of truth for the running app. When
 * signed in, {@link ../lib/dataSync} mirrors it to Supabase. Guest / offline /
 * unconfigured use is byte-identical to before — this is just a persisted store.
 *
 * Legacy migration: the theme id historically lived under the standalone
 * `dicesuki-current-theme` localStorage key written by `ThemeProvider`. On first
 * run (no `dicesuki-settings` blob yet) we import that value so an existing
 * player's chosen theme is preserved. This is idempotent — once the settings
 * blob exists, persist rehydration wins and the legacy read is never consulted.
 */

/** Legacy localStorage key ThemeProvider used before the settings store existed. */
export const LEGACY_THEME_KEY = 'dicesuki-current-theme'

function readLegacyThemeId(): string {
  try {
    return localStorage.getItem(LEGACY_THEME_KEY) || defaultTheme.id
  } catch {
    return defaultTheme.id
  }
}

export interface SettingsState {
  /** The selected theme id. Synced per-account when signed in. */
  themeId: string
  /** Set the selected theme id. */
  setThemeId: (themeId: string) => void
}

export const useSettingsStore = create<SettingsState>()(
  persist(
    (set) => ({
      // Seed from the legacy key on first run; persist rehydration overrides this
      // on every subsequent load once the `dicesuki-settings` blob exists.
      themeId: readLegacyThemeId(),
      setThemeId: (themeId: string) => set({ themeId }),
    }),
    {
      name: 'dicesuki-settings',
      version: 1,
      storage: createJSONStorage(() => localStorage),
      partialize: (state) => ({ themeId: state.themeId }),
      migrate: (persisted) => {
        // v1 is the first schema. Guard against a malformed payload so a bad
        // blob never blocks startup; fall back to the legacy/default theme.
        const p = (persisted ?? {}) as Partial<SettingsState>
        return {
          themeId: typeof p.themeId === 'string' && p.themeId ? p.themeId : readLegacyThemeId(),
        }
      },
    },
  ),
)
