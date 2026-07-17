import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest'

// Mock the supabase client wrapper at module level (Frontend-ADR-004) so no
// real client is constructed and configuration can be toggled per test.
const getSupabaseClientMock = vi.hoisted(() => vi.fn())
const isSupabaseConfiguredMock = vi.hoisted(() => vi.fn(() => true))
vi.mock('./supabaseClient', () => ({
  getSupabaseClient: getSupabaseClientMock,
  isSupabaseConfigured: isSupabaseConfiguredMock,
}))

import {
  startSync,
  stopSync,
  hydrateTarget,
  initDataSync,
  __resetDataSyncForTests,
  type SyncTarget,
} from './dataSync'
import { useInventoryStore } from '../store/useInventoryStore'
import { useSavedRollsStore } from '../store/useSavedRollsStore'
import { useAuthStore } from '../store/useAuthStore'

// ---------------------------------------------------------------------------
// A fake Supabase query builder / client whose row store is controllable.
// ---------------------------------------------------------------------------

interface FakeRow {
  data: Record<string, unknown>
  updated_at: string
}

function makeFakeClient(initialRows: Partial<Record<string, FakeRow>> = {}) {
  const rows: Record<string, FakeRow | undefined> = { ...initialRows }
  const upsertCalls: Array<{ table: string; row: Record<string, unknown> }> = []
  const rpc = vi.fn().mockResolvedValue({ data: null, error: null })

  const from = vi.fn((table: string) => {
    let mode: 'select' | 'upsert' = 'select'
    let pendingUpsertRow: Record<string, unknown> | null = null

    const builder: Record<string, unknown> = {
      select: vi.fn(() => builder),
      eq: vi.fn(() => builder),
      upsert: vi.fn((row: Record<string, unknown>) => {
        mode = 'upsert'
        pendingUpsertRow = row
        return builder
      }),
      maybeSingle: vi.fn(async () => {
        if (mode === 'upsert' && pendingUpsertRow) {
          const updated_at = new Date().toISOString()
          rows[table] = { data: pendingUpsertRow.data as Record<string, unknown>, updated_at }
          upsertCalls.push({ table, row: pendingUpsertRow })
          return { data: { updated_at }, error: null }
        }
        const existing = rows[table]
        return { data: existing ? { data: existing.data, updated_at: existing.updated_at } : null, error: null }
      }),
    }
    return builder
  })

  return { client: { from, rpc } as never, rows, upsertCalls, from, rpc }
}

function makeStubTarget(table: string, payloadRef: { value: Record<string, unknown> }): SyncTarget {
  const listeners = new Set<() => void>()
  return {
    table: table as SyncTarget['table'],
    getPayload: () => payloadRef.value,
    applyPayload: (data) => {
      payloadRef.value = (data as Record<string, unknown>) ?? {}
    },
    subscribe: (listener) => {
      listeners.add(listener)
      // Expose a trigger on the ref so tests can simulate a store change.
      ;(payloadRef as unknown as { fire: () => void }).fire = () =>
        listeners.forEach((l) => l())
      return () => listeners.delete(listener)
    },
  }
}

describe('dataSync', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    localStorage.clear()
    __resetDataSyncForTests()
    isSupabaseConfiguredMock.mockReturnValue(true)
  })

  afterEach(() => {
    __resetDataSyncForTests()
    vi.useRealTimers()
  })

  describe('hydrate on sign-in', () => {
    it('applies a newer remote row to the local store', async () => {
      const { client } = makeFakeClient({
        settings: { data: { v: 1, themeId: 'neon-cyber-city' }, updated_at: new Date().toISOString() },
      })
      const ref = { value: { v: 1, themeId: 'default' } }
      const target = makeStubTarget('settings', ref)

      await hydrateTarget(client, 'user-1', target)

      expect(ref.value).toEqual({ v: 1, themeId: 'neon-cyber-city' })
    })
  })

  describe('first-sign-in migration (idempotency)', () => {
    it('pushes local data up when no remote row exists, then re-applies without duplication', async () => {
      const fake = makeFakeClient() // no rows
      const ref = { value: { v: 1, savedRolls: [{ id: 'r1' }] } }
      const target = makeStubTarget('saved_rolls', ref)

      // First hydrate: no remote -> migrate local up.
      await hydrateTarget(fake.client, 'user-1', target)
      expect(fake.upsertCalls).toHaveLength(1)
      expect(fake.rows.saved_rolls?.data).toEqual({ v: 1, savedRolls: [{ id: 'r1' }] })

      // Second hydrate (idempotent): remote now exists & is >= local meta, so it
      // is re-applied; local is unchanged and NO second upsert occurs.
      await hydrateTarget(fake.client, 'user-1', target)
      expect(fake.upsertCalls).toHaveLength(1)
      expect(ref.value).toEqual({ v: 1, savedRolls: [{ id: 'r1' }] })
    })
  })

  describe('debounced push on local change', () => {
    it('pushes once after the debounce window when a store changes', async () => {
      vi.useFakeTimers()
      const fake = makeFakeClient({
        settings: { data: { v: 1, themeId: 'default' }, updated_at: new Date(0).toISOString() },
      })
      const ref = { value: { v: 1, themeId: 'default' } }
      const target = makeStubTarget('settings', ref)

      await startSync('user-1', { client: fake.client, targets: [target], debounceMs: 500 })
      fake.upsertCalls.length = 0 // ignore any hydrate-time push

      // Simulate a local change + store notification.
      ref.value = { v: 1, themeId: 'dungeon-castle' }
      ;(ref as unknown as { fire: () => void }).fire()
      ;(ref as unknown as { fire: () => void }).fire() // coalesced

      expect(fake.upsertCalls).toHaveLength(0) // debounced, not yet fired
      await vi.advanceTimersByTimeAsync(500)

      expect(fake.upsertCalls).toHaveLength(1)
      expect((fake.upsertCalls[0].row.data as Record<string, unknown>).themeId).toBe('dungeon-castle')
    })
  })

  describe('starter entitlement bootstrap', () => {
    it('calls only the server-fixed no-argument RPC before syncing', async () => {
      const fake = makeFakeClient()
      const ref = { value: { v: 1 } }
      const target = makeStubTarget('settings', ref)

      await startSync('user-1', { client: fake.client, targets: [target] })

      expect(fake.rpc).toHaveBeenCalledOnce()
      expect(fake.rpc).toHaveBeenCalledWith('ensure_starter_entitlements')
    })

    it('continues local-first sync when the starter RPC fails', async () => {
      const fake = makeFakeClient()
      fake.rpc.mockRejectedValueOnce(new Error('offline'))
      const ref = { value: { v: 1 } }
      const target = makeStubTarget('settings', ref)

      await expect(startSync('user-1', { client: fake.client, targets: [target] }))
        .resolves.toBeUndefined()
      expect(fake.upsertCalls).toHaveLength(1)
    })

    it('continues hydration after a bounded wait when the starter RPC hangs', async () => {
      vi.useFakeTimers()
      const fake = makeFakeClient()
      fake.rpc.mockReturnValueOnce(new Promise(() => undefined))
      const ref = { value: { v: 1 } }
      const target = makeStubTarget('settings', ref)

      const sync = startSync('user-1', {
        client: fake.client,
        targets: [target],
        starterTimeoutMs: 250,
      })

      await vi.advanceTimersByTimeAsync(249)
      expect(fake.upsertCalls).toHaveLength(0)
      await vi.advanceTimersByTimeAsync(1)
      await expect(sync).resolves.toBeUndefined()
      expect(fake.upsertCalls).toHaveLength(1)
    })

    it('does not resume an older user after switching accounts during the starter wait', async () => {
      vi.useFakeTimers()
      const first = makeFakeClient()
      first.rpc.mockReturnValueOnce(new Promise(() => undefined))
      const firstRef = { value: { v: 1, user: 'first' } }
      const firstTarget = makeStubTarget('settings', firstRef)
      const firstSubscribe = vi.spyOn(firstTarget, 'subscribe')

      const second = makeFakeClient()
      const secondRef = { value: { v: 1, user: 'second' } }
      const secondTarget = makeStubTarget('settings', secondRef)
      const secondSubscribe = vi.spyOn(secondTarget, 'subscribe')

      const firstStart = startSync('user-1', {
        client: first.client,
        targets: [firstTarget],
        starterTimeoutMs: 3000,
      })
      const secondStart = startSync('user-2', {
        client: second.client,
        targets: [secondTarget],
      })

      await expect(secondStart).resolves.toBeUndefined()
      expect(second.upsertCalls).toHaveLength(1)
      expect(secondSubscribe).toHaveBeenCalledOnce()
      expect(first.upsertCalls).toHaveLength(0)
      expect(firstSubscribe).not.toHaveBeenCalled()

      await vi.advanceTimersByTimeAsync(3000)
      await expect(firstStart).resolves.toBeUndefined()
      expect(first.upsertCalls).toHaveLength(0)
      expect(firstSubscribe).not.toHaveBeenCalled()
      expect(secondSubscribe).toHaveBeenCalledOnce()
    })

    it('shares one in-flight start for concurrent calls from the same user', async () => {
      const fake = makeFakeClient()
      let resolveStarter: (() => void) | undefined
      fake.rpc.mockReturnValueOnce(new Promise((resolve) => {
        resolveStarter = () => resolve({ data: null, error: null })
      }))
      const ref = { value: { v: 1 } }
      const target = makeStubTarget('settings', ref)
      const subscribe = vi.spyOn(target, 'subscribe')

      const first = startSync('user-1', { client: fake.client, targets: [target] })
      const second = startSync('user-1', { client: fake.client, targets: [target] })

      expect(second).toBe(first)
      expect(fake.rpc).toHaveBeenCalledOnce()
      expect(fake.upsertCalls).toHaveLength(0)
      expect(subscribe).not.toHaveBeenCalled()

      resolveStarter?.()
      await expect(Promise.all([first, second])).resolves.toEqual([undefined, undefined])
      expect(fake.upsertCalls).toHaveLength(1)
      expect(subscribe).toHaveBeenCalledOnce()
    })
  })

  describe('guest / unconfigured are untouched', () => {
    it('startSync is a no-op with no client (guest)', async () => {
      getSupabaseClientMock.mockReturnValue(null)
      const ref = { value: { v: 1 } }
      const target = makeStubTarget('settings', ref)
      // No client passed and getSupabaseClient returns null.
      await startSync('user-1', { targets: [target] })
      expect(ref.value).toEqual({ v: 1 }) // never applied anything
    })

    it('initDataSync is a no-op when Supabase is unconfigured', () => {
      isSupabaseConfiguredMock.mockReturnValue(false)
      const subscribeSpy = vi.spyOn(useAuthStore, 'subscribe')
      initDataSync()
      expect(subscribeSpy).not.toHaveBeenCalled()
      subscribeSpy.mockRestore()
    })
  })

  describe('real stores wiring smoke test', () => {
    it('hydrates the real inventory store from a remote blob', async () => {
      const remoteDie = { id: 'die-x', type: 'd20', rarity: 'rare', setId: 's', stats: {}, assignedToRolls: [] }
      const { client } = makeFakeClient({
        inventory: {
          data: { v: 2, dice: [remoteDie], currency: { coins: 42, gems: 0, standardTokens: 0, premiumTokens: 0 }, assignments: {} },
          updated_at: new Date().toISOString(),
        },
      })

      const targets = (await import('./dataSync')).createRealTargets()
      const inv = targets.find((t) => t.table === 'inventory')!
      await hydrateTarget(client, 'user-1', inv)

      expect(useInventoryStore.getState().dice).toHaveLength(1)
      expect(useInventoryStore.getState().currency.coins).toBe(42)
      // cleanup
      useInventoryStore.getState().reset()
      useSavedRollsStore.setState({ savedRolls: [] })
      stopSync()
    })
  })
})
