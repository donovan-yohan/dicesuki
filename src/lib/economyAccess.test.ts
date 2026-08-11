import { describe, expect, it, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { fetchEconomyAccess, NO_ECONOMY_ACCESS } from './economyAccess'

/**
 * A minimal PostgREST chain stub: `.from().select().eq().maybeSingle()`.
 * `maybeSingle` resolves with whatever the test hands it, or throws when the
 * test wants a transport failure.
 */
function makeClient(result: unknown, { throws = false } = {}) {
  const maybeSingle = vi.fn(() => {
    if (throws) throw new Error('network down')
    return Promise.resolve(result)
  })
  const eq = vi.fn(() => ({ maybeSingle }))
  const select = vi.fn(() => ({ eq }))
  const from = vi.fn(() => ({ select }))
  return { client: { from } as unknown as SupabaseClient, from, select, eq, maybeSingle }
}

describe('fetchEconomyAccess', () => {
  it('reads the flag and the grant timestamp for a flagged account', async () => {
    const { client, from, select, eq } = makeClient({
      data: { economy_access: true, economy_access_granted_at: '2026-08-10T12:00:00Z' },
      error: null,
    })

    await expect(fetchEconomyAccess(client, 'user-1')).resolves.toEqual({
      enabled: true,
      grantedAt: '2026-08-10T12:00:00Z',
    })
    expect(from).toHaveBeenCalledWith('user_economy_access')
    expect(select).toHaveBeenCalledWith('economy_access, economy_access_granted_at')
    expect(eq).toHaveBeenCalledWith('user_id', 'user-1')
  })

  it('treats an absent row as off — the overwhelmingly common case, not an error', async () => {
    const { client } = makeClient({ data: null, error: null })

    await expect(fetchEconomyAccess(client, 'user-1')).resolves.toEqual(NO_ECONOMY_ACCESS)
  })

  it('fails closed on a PostgREST error', async () => {
    const { client } = makeClient({ data: null, error: { message: 'permission denied' } })

    await expect(fetchEconomyAccess(client, 'user-1')).resolves.toEqual(NO_ECONOMY_ACCESS)
  })

  it('fails closed when the request throws', async () => {
    const { client } = makeClient(null, { throws: true })

    await expect(fetchEconomyAccess(client, 'user-1')).resolves.toEqual(NO_ECONOMY_ACCESS)
  })

  it('reports off when the flag is explicitly false but a grant timestamp survives', async () => {
    // Disable keeps `economy_access_granted_at` — it is the immutable passport
    // anchor. A stale timestamp must never be read as access.
    const { client } = makeClient({
      data: { economy_access: false, economy_access_granted_at: '2026-01-01T00:00:00Z' },
      error: null,
    })

    await expect(fetchEconomyAccess(client, 'user-1')).resolves.toEqual({
      enabled: false,
      grantedAt: '2026-01-01T00:00:00Z',
    })
  })

  it('treats a null flag as off rather than truthy-coercing it', async () => {
    const { client } = makeClient({
      data: { economy_access: null, economy_access_granted_at: null },
      error: null,
    })

    await expect(fetchEconomyAccess(client, 'user-1')).resolves.toEqual(NO_ECONOMY_ACCESS)
  })
})
