import { create } from 'zustand'
import { persist, createJSONStorage } from 'zustand/middleware'

/**
 * Remembered player identity (issue #78).
 *
 * The join deep-link flow pre-fills the name/color from the player's last
 * session. This is *profile* state — durable, cross-room, and independent of any
 * live connection — so per Frontend-ADR-002 it lives in its own store rather
 * than being stuffed into the ephemeral `useMultiplayerStore` (connection domain).
 */

/** Fallback color for a first-time player (matches the historical join default). */
export const DEFAULT_PLAYER_COLOR = '#8B5CF6'

export interface PlayerIdentityState {
  /** Last-used display name, or empty string if never set. */
  displayName: string
  /** Last-used dice color as a hex string. */
  color: string
  /** Remember the identity for next time. Trims the name; ignores empty names. */
  setIdentity: (identity: { displayName?: string; color?: string }) => void
}

export const usePlayerIdentityStore = create<PlayerIdentityState>()(
  persist(
    (set) => ({
      displayName: '',
      color: DEFAULT_PLAYER_COLOR,
      setIdentity: ({ displayName, color }) =>
        set((state) => ({
          displayName:
            displayName !== undefined && displayName.trim()
              ? displayName.trim()
              : state.displayName,
          color: color ?? state.color,
        })),
    }),
    {
      name: 'dicesuki-player-identity',
      version: 1,
      storage: createJSONStorage(() => localStorage),
      partialize: (state) => ({
        displayName: state.displayName,
        color: state.color,
      }),
      migrate: (persisted) => {
        // v1 is the first schema; nothing to migrate yet. Guard against a
        // malformed/empty payload so a bad blob never breaks the join form.
        const p = (persisted ?? {}) as Partial<PlayerIdentityState>
        return {
          displayName: typeof p.displayName === 'string' ? p.displayName : '',
          color: typeof p.color === 'string' ? p.color : DEFAULT_PLAYER_COLOR,
        }
      },
    },
  ),
)
