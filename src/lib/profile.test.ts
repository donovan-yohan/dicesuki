import { describe, expect, it, vi } from 'vitest'
import type { SupabaseClient, User } from '@supabase/supabase-js'
import { deriveProfileSeed, fetchOrCreateProfile } from './profile'
import { DEFAULT_PLAYER_COLOR } from '../store/usePlayerIdentityStore'

function makeUser(metadata: Record<string, unknown>): User {
  return { id: 'user-123', user_metadata: metadata } as unknown as User
}

/**
 * Build a fake Supabase query builder. `existingRow` is what a select resolves
 * to; `insertRow` is what the upsert resolves to. Errors can be injected.
 */
function makeClient(opts: {
  existingRow?: unknown
  selectError?: unknown
  insertRow?: unknown
  insertError?: unknown
}): SupabaseClient {
  const selectBuilder = {
    eq: vi.fn().mockReturnThis(),
    maybeSingle: vi.fn().mockResolvedValue({
      data: opts.existingRow ?? null,
      error: opts.selectError ?? null,
    }),
  }
  const upsertBuilder = {
    select: vi.fn().mockReturnThis(),
    maybeSingle: vi.fn().mockResolvedValue({
      data: opts.insertRow ?? null,
      error: opts.insertError ?? null,
    }),
  }
  const from = vi.fn(() => ({
    select: vi.fn(() => selectBuilder),
    upsert: vi.fn(() => upsertBuilder),
  }))
  return { from } as unknown as SupabaseClient
}

describe('deriveProfileSeed', () => {
  it('prefers full_name, then falls back through name/user_name', () => {
    expect(deriveProfileSeed(makeUser({ full_name: 'Gandalf' })).displayName).toBe('Gandalf')
    expect(deriveProfileSeed(makeUser({ user_name: 'mithrandir' })).displayName).toBe('mithrandir')
    expect(deriveProfileSeed(makeUser({})).displayName).toBe('Player')
  })

  it('extracts an avatar url when present, else null', () => {
    expect(deriveProfileSeed(makeUser({ avatar_url: 'http://x/a.png' })).avatarUrl).toBe('http://x/a.png')
    expect(deriveProfileSeed(makeUser({ picture: 'http://x/p.png' })).avatarUrl).toBe('http://x/p.png')
    expect(deriveProfileSeed(makeUser({})).avatarUrl).toBeNull()
  })
})

describe('fetchOrCreateProfile', () => {
  it('returns an existing profile unchanged (preserves user edits)', async () => {
    const client = makeClient({
      existingRow: { id: 'user-123', display_name: 'CustomName', avatar_url: null, color: '#123456' },
    })
    const profile = await fetchOrCreateProfile(client, makeUser({ full_name: 'Discord Name' }))
    expect(profile).toEqual({
      id: 'user-123',
      displayName: 'CustomName',
      avatarUrl: null,
      color: '#123456',
    })
  })

  it('seeds a new profile from the Discord identity on first sign-in', async () => {
    const client = makeClient({
      existingRow: null,
      insertRow: { id: 'user-123', display_name: 'Frodo', avatar_url: 'http://x/a.png', color: DEFAULT_PLAYER_COLOR },
    })
    const profile = await fetchOrCreateProfile(
      client,
      makeUser({ full_name: 'Frodo', avatar_url: 'http://x/a.png' }),
    )
    expect(profile).toEqual({
      id: 'user-123',
      displayName: 'Frodo',
      avatarUrl: 'http://x/a.png',
      color: DEFAULT_PLAYER_COLOR,
    })
  })

  it('falls back to the in-memory seed when both select and insert fail', async () => {
    const client = makeClient({
      selectError: { message: 'network' },
      insertError: { message: 'network' },
    })
    const profile = await fetchOrCreateProfile(client, makeUser({ full_name: 'Sam' }))
    expect(profile).toEqual({
      id: 'user-123',
      displayName: 'Sam',
      avatarUrl: null,
      color: DEFAULT_PLAYER_COLOR,
    })
  })
})
