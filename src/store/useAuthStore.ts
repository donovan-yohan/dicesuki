import { create } from 'zustand'
import type { Session, User } from '@supabase/supabase-js'
import { getSupabaseClient, isSupabaseConfigured } from '../lib/supabaseClient'
import { fetchOrCreateProfile, type Profile } from '../lib/profile'
import { usePlayerIdentityStore } from './usePlayerIdentityStore'

/**
 * Auth domain store (issue #81, ADR 006 / Frontend-ADR-002).
 *
 * Owns session + profile state and the Discord OAuth flow. Guest mode is the
 * default unauthenticated state and the ONLY state when Supabase is not
 * configured. This store is intentionally NOT persisted: supabase-js already
 * manages its own token storage, and duplicating the session would risk drift.
 *
 * Profile → identity precedence: on sign-in the profile's display name/color
 * are pushed into {@link usePlayerIdentityStore} (the remembered join identity),
 * seeding/overriding it. The join form's own precedence still applies on top
 * (explicit `?name=` deep-link > solo default > remembered identity), so a
 * signed-in player's profile flows into the room join experience without
 * clobbering an explicit deep-link intent.
 */

export type AuthStatus = 'loading' | 'guest' | 'authenticated'

export interface AuthState {
  /** 'loading' until initialize resolves; then 'guest' or 'authenticated'. */
  status: AuthStatus
  /** True when Supabase env is present and auth features are available. */
  isConfigured: boolean
  /** The Supabase user, or null in guest mode. */
  user: User | null
  /** The player's profile, or null in guest mode / before it loads. */
  profile: Profile | null

  /** Bootstrap from any existing session and subscribe to auth changes. */
  initialize: () => Promise<void>
  /** Begin the Discord OAuth redirect flow. No-op when unconfigured. */
  signInWithDiscord: () => Promise<void>
  /** Sign out and return to guest mode. No-op when unconfigured. */
  signOut: () => Promise<void>
}

/** Push profile defaults into the remembered join identity (precedence: profile seeds identity). */
function seedIdentityFromProfile(profile: Profile): void {
  usePlayerIdentityStore.getState().setIdentity({
    displayName: profile.displayName,
    color: profile.color,
  })
}

let authSubscribed = false

/** Test-only: clear the one-time auth subscription guard between tests. */
export function resetAuthSubscriptionForTests(): void {
  authSubscribed = false
}

export const useAuthStore = create<AuthState>()((set) => ({
  status: isSupabaseConfigured() ? 'loading' : 'guest',
  isConfigured: isSupabaseConfigured(),
  user: null,
  profile: null,

  initialize: async () => {
    const client = getSupabaseClient()
    if (!client) {
      // Unconfigured: stay in guest mode, silently. No console noise.
      set({ status: 'guest', isConfigured: false, user: null, profile: null })
      return
    }

    const applySession = async (session: Session | null) => {
      if (!session?.user) {
        set({ status: 'guest', user: null, profile: null })
        return
      }
      const profile = await fetchOrCreateProfile(client, session.user)
      if (profile) seedIdentityFromProfile(profile)
      set({ status: 'authenticated', user: session.user, profile })
    }

    // Subscribe once so re-initialize (e.g. HMR) doesn't stack listeners.
    if (!authSubscribed) {
      authSubscribed = true
      client.auth.onAuthStateChange((_event, session) => {
        void applySession(session)
      })
    }

    try {
      const { data } = await client.auth.getSession()
      await applySession(data.session ?? null)
    } catch {
      // Transient failure — degrade to guest rather than crash.
      set({ status: 'guest', user: null, profile: null })
    }
  },

  signInWithDiscord: async () => {
    const client = getSupabaseClient()
    if (!client) return
    await client.auth.signInWithOAuth({
      provider: 'discord',
      options: {
        redirectTo: typeof window !== 'undefined' ? window.location.origin : undefined,
      },
    })
  },

  signOut: async () => {
    const client = getSupabaseClient()
    if (!client) return
    await client.auth.signOut()
    set({ status: 'guest', user: null, profile: null })
  },
}))
