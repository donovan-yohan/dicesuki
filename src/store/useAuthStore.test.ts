import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Profile } from '../lib/profile'

// Mock the supabase client wrapper (module-level, per Frontend-ADR-004) so no
// real Supabase client is ever constructed.
const getSupabaseClientMock = vi.hoisted(() => vi.fn())
const isSupabaseConfiguredMock = vi.hoisted(() => vi.fn(() => true))
vi.mock('../lib/supabaseClient', () => ({
  getSupabaseClient: getSupabaseClientMock,
  isSupabaseConfigured: isSupabaseConfiguredMock,
}))

const fetchOrCreateProfileMock = vi.hoisted(() => vi.fn())
vi.mock('../lib/profile', () => ({
  fetchOrCreateProfile: fetchOrCreateProfileMock,
}))

import { useAuthStore, resetAuthSubscriptionForTests } from './useAuthStore'
import { usePlayerIdentityStore, DEFAULT_PLAYER_COLOR } from './usePlayerIdentityStore'

const PROFILE: Profile = {
  id: 'user-123',
  displayName: 'Aragorn',
  avatarUrl: 'http://x/a.png',
  color: '#22C55E',
}

interface FakeAuthOptions {
  session?: { user: { id: string } } | null
}

function makeFakeClient({ session = null }: FakeAuthOptions = {}) {
  return {
    auth: {
      getSession: vi.fn().mockResolvedValue({ data: { session }, error: null }),
      onAuthStateChange: vi.fn(() => ({ data: { subscription: { unsubscribe: vi.fn() } } })),
      signInWithOAuth: vi.fn().mockResolvedValue({ data: {}, error: null }),
      signOut: vi.fn().mockResolvedValue({ error: null }),
    },
  }
}

describe('useAuthStore', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetAuthSubscriptionForTests()
    isSupabaseConfiguredMock.mockReturnValue(true)
    fetchOrCreateProfileMock.mockResolvedValue(PROFILE)
    useAuthStore.setState({ status: 'loading', isConfigured: true, user: null, profile: null })
    usePlayerIdentityStore.setState({ displayName: '', color: DEFAULT_PLAYER_COLOR })
  })

  it('degrades to guest mode with no crash when Supabase is unconfigured', async () => {
    getSupabaseClientMock.mockReturnValue(null)

    await useAuthStore.getState().initialize()

    const state = useAuthStore.getState()
    expect(state.status).toBe('guest')
    expect(state.isConfigured).toBe(false)
    expect(state.user).toBeNull()
    expect(state.profile).toBeNull()
  })

  it('signInWithDiscord is a no-op when unconfigured', async () => {
    getSupabaseClientMock.mockReturnValue(null)
    // Should not throw.
    await expect(useAuthStore.getState().signInWithDiscord()).resolves.toBeUndefined()
  })

  it('stays in guest mode when configured but no session exists', async () => {
    getSupabaseClientMock.mockReturnValue(makeFakeClient({ session: null }))

    await useAuthStore.getState().initialize()

    expect(useAuthStore.getState().status).toBe('guest')
    expect(fetchOrCreateProfileMock).not.toHaveBeenCalled()
  })

  it('transitions to authenticated and loads the profile when a session exists', async () => {
    getSupabaseClientMock.mockReturnValue(makeFakeClient({ session: { user: { id: 'user-123' } } }))

    await useAuthStore.getState().initialize()

    const state = useAuthStore.getState()
    expect(state.status).toBe('authenticated')
    expect(state.profile).toEqual(PROFILE)
    expect(fetchOrCreateProfileMock).toHaveBeenCalledOnce()
  })

  it('seeds the remembered join identity from the profile (profile → identity precedence)', async () => {
    usePlayerIdentityStore.setState({ displayName: 'OldGuestName', color: '#111111' })
    getSupabaseClientMock.mockReturnValue(makeFakeClient({ session: { user: { id: 'user-123' } } }))

    await useAuthStore.getState().initialize()

    const identity = usePlayerIdentityStore.getState()
    expect(identity.displayName).toBe('Aragorn') // profile overrides remembered guest name
    expect(identity.color).toBe('#22C55E')
  })

  it('subscribes to auth changes and applies a later sign-in', async () => {
    const client = makeFakeClient({ session: null })
    getSupabaseClientMock.mockReturnValue(client)

    await useAuthStore.getState().initialize()
    expect(useAuthStore.getState().status).toBe('guest')

    // The store registered exactly one auth-change listener; grab it and
    // simulate Supabase firing SIGNED_IN after the OAuth redirect completes.
    const capturedCallback = (client.auth.onAuthStateChange.mock.calls[0] as unknown[])[0] as (
      event: string,
      session: unknown,
    ) => void
    capturedCallback('SIGNED_IN', { user: { id: 'user-123' } })
    await vi.waitFor(() => {
      expect(useAuthStore.getState().status).toBe('authenticated')
    })
    expect(useAuthStore.getState().profile).toEqual(PROFILE)
  })

  it('returns to guest mode on sign out', async () => {
    const client = makeFakeClient({ session: { user: { id: 'user-123' } } })
    getSupabaseClientMock.mockReturnValue(client)
    await useAuthStore.getState().initialize()
    expect(useAuthStore.getState().status).toBe('authenticated')

    await useAuthStore.getState().signOut()

    expect(useAuthStore.getState().status).toBe('guest')
    expect(useAuthStore.getState().user).toBeNull()
    expect(useAuthStore.getState().profile).toBeNull()
    expect(client.auth.signOut).toHaveBeenCalledOnce()
  })
})
