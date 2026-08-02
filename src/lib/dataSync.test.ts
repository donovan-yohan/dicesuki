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
  pushTarget,
  initDataSync,
  createRealTargets,
  isLocalCacheOwnedBy,
  __resetDataSyncForTests,
  type SyncTarget,
} from './dataSync'
import { SAVED_ROLLS_BLOB_VERSION } from './savedRollsMerge'
import { useInventoryStore } from '../store/useInventoryStore'
import { useSavedRollsStore } from '../store/useSavedRollsStore'
import { useSettingsStore } from '../store/useSettingsStore'
import { useAuthStore } from '../store/useAuthStore'
import { defaultTheme } from '../themes/tokens'
import type { SavedRoll } from '../types/savedRolls'

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

    it('stamps the inventory payload at the store\'s current persist version', () => {
      // A blob written here is read back through the SAME migration chain, so a
      // stale stamp would re-run migrations that have already been applied.
      const targets = createRealTargets()
      const inv = targets.find((t) => t.table === 'inventory')!

      expect(inv.getPayload().v).toBe(5)
    })

    it('repairs saved rolls across the FULL target sequence, not just the inventory step', async () => {
      // A device that has not synced since the starter cleanup pushes back BOTH
      // a v4 inventory blob carrying starter dice AND a saved-rolls blob that
      // still pins one of them.
      //
      // The repair cannot live in the inventory target's `applyPayload`: the
      // saved_rolls target hydrates immediately after and applies its own
      // un-repaired remote snapshot wholesale, clobbering it. So this drives the
      // REAL target sequence through `startSync` — inventory, saved_rolls,
      // settings — and asserts the roll is still repaired once all of them have
      // landed. Hydrating the inventory target alone would pass either way.
      const pinnedRoll = {
        id: 'roll-remote',
        name: 'Pinned to a starter',
        flatBonus: 0,
        createdAt: 1,
        dice: [{
          id: 'entry-1',
          type: 'd4' as const,
          quantity: 1,
          perDieBonus: 0,
          sources: [{ kind: 'specific' as const, dieId: 'die_starter_remote' }],
        }],
      }
      const starter = {
        id: 'die_starter_remote',
        type: 'd4',
        rarity: 'common',
        setId: 'adventurer-starter',
        source: 'starter',
        stats: {},
        assignedToRolls: [],
      }
      useSavedRollsStore.setState({ savedRolls: [pinnedRoll], currentlyEditing: null })
      const updated_at = new Date().toISOString()
      const { client } = makeFakeClient({
        inventory: {
          data: {
            v: 4,
            dice: [starter],
            localDice: [starter],
            currency: { coins: 0, gems: 0, standardTokens: 0, premiumTokens: 0 },
            assignments: {},
          },
          updated_at,
        },
        // The blob that used to overwrite the repair.
        saved_rolls: { data: { v: 1, savedRolls: [pinnedRoll] }, updated_at },
      })

      await startSync('user-1', {
        client,
        targets: createRealTargets(),
        starterTimeoutMs: 0,
      })

      const targetTables = createRealTargets().map((t) => t.table)
      expect(targetTables).toEqual(['inventory', 'saved_rolls', 'settings'])
      // The starter row is gone…
      expect(useInventoryStore.getState().dice).toHaveLength(0)
      // …and the roll that pinned it survived BOTH hydrations, repaired.
      expect(useSavedRollsStore.getState().savedRolls).toHaveLength(1)
      expect(useSavedRollsStore.getState().savedRolls[0].dice[0].sources)
        .toEqual([{ kind: 'anonymous', quantity: 1 }])

      useInventoryStore.getState().reset()
      useSavedRollsStore.setState({ savedRolls: [], currentlyEditing: null })
      stopSync()
    })
  })

  // -------------------------------------------------------------------------
  // Saved rolls across devices (PO ask 2026-08-02)
  // -------------------------------------------------------------------------

  describe('saved rolls across devices', () => {
    function roll(id: string, overrides: Partial<SavedRoll> = {}): SavedRoll {
      return { id, name: id, dice: [], flatBonus: 0, createdAt: 1_000, ...overrides }
    }

    /**
     * Wipe everything that is DEVICE-local (persisted stores + sync meta) while
     * leaving the fake client's rows — the "server" — untouched. That is exactly
     * what walking over to a second device looks like.
     */
    function newDevice(savedRolls: SavedRoll[] = []): void {
      stopSync()
      localStorage.clear()
      __resetDataSyncForTests()
      useSavedRollsStore.setState({ savedRolls, currentlyEditing: null, deletedRolls: {} })
      useInventoryStore.getState().reset()
      useSettingsStore.getState().setThemeId(defaultTheme.id)
    }

    /**
     * Wrap a fake client so sync is torn down mid-flight after `afterReads`
     * round trips — a sign-out, a closed tab, a backgrounded PWA.
     */
    function makeInterruptingClient(
      fake: ReturnType<typeof makeFakeClient>,
      afterReads: number,
    ): never {
      let reads = 0
      const inner = fake.client as unknown as {
        from: (t: string) => Record<string, unknown>
        rpc: unknown
      }
      return {
        rpc: inner.rpc,
        from: (table: string) => {
          const builder = inner.from(table)
          const maybeSingle = builder.maybeSingle as () => Promise<unknown>
          builder.maybeSingle = async () => {
            const result = await maybeSingle()
            reads += 1
            if (reads === afterReads) stopSync()
            return result
          }
          return builder
        },
      } as never
    }

    function localRollIds(): string[] {
      return useSavedRollsStore.getState().savedRolls.map((r) => r.id)
    }

    /** Read a stored row through a call, so `delete` above does not narrow it away. */
    function serverRow(
      fake: ReturnType<typeof makeFakeClient>,
      table: string,
    ): FakeRow | undefined {
      return fake.rows[table]
    }

    function serverRollIds(fake: ReturnType<typeof makeFakeClient>): string[] {
      const rolls = (fake.rows.saved_rolls?.data.savedRolls ?? []) as SavedRoll[]
      return rolls.map((r) => r.id)
    }

    function savedRollsTarget(): SyncTarget {
      return createRealTargets().find((t) => t.table === 'saved_rolls')!
    }

    async function signIn(
      fake: ReturnType<typeof makeFakeClient>,
      userId: string,
      targets: SyncTarget[] = [savedRollsTarget()],
    ): Promise<void> {
      await startSync(userId, { client: fake.client, targets, starterTimeoutMs: 0 })
    }

    afterEach(() => {
      useSavedRollsStore.setState({ savedRolls: [], currentlyEditing: null, deletedRolls: {} })
      useInventoryStore.getState().reset()
    })

    it('carries a roll from device A to a fresh device B through the FULL target sequence', async () => {
      // The headline ask. Driven through `startSync` with every real target so
      // the saved-rolls step is exercised in its actual position — after the
      // inventory hydrate and its deferred cross-domain repair, which is where a
      // previous bug clobbered saved rolls.
      const fake = makeFakeClient()

      newDevice()
      useSavedRollsStore.getState().addRoll(roll('sneak-attack'))
      await signIn(fake, 'user-1', createRealTargets())
      expect(serverRollIds(fake)).toEqual(['sneak-attack'])

      newDevice()
      expect(localRollIds()).toEqual([])
      await signIn(fake, 'user-1', createRealTargets())

      expect(localRollIds()).toEqual(['sneak-attack'])
    })

    it('propagates an edit made on device B back to device A on its next hydration', async () => {
      const fake = makeFakeClient()

      newDevice()
      useSavedRollsStore.getState().addRoll(roll('fireball'))
      await signIn(fake, 'user-1')

      // Device B renames it and pushes.
      newDevice()
      await signIn(fake, 'user-1')
      useSavedRollsStore.getState().updateRoll('fireball', { name: 'Fireball (upcast)' })
      await pushTarget(fake.client, 'user-1', savedRollsTarget())

      // Device A hydrates again and sees B's revision.
      newDevice([roll('fireball', { name: 'Fireball' })])
      await signIn(fake, 'user-1')

      expect(useSavedRollsStore.getState().savedRolls[0].name).toBe('Fireball (upcast)')
    })

    it('MERGES a guest\'s rolls into an account that already has a row on a second device', async () => {
      // The clobber the PO called out: the "first sign-in pushes local up" path
      // only ever fired when NO remote row existed, so a guest signing in on a
      // second device had their work replaced by the account blob.
      const fake = makeFakeClient()

      newDevice()
      useSavedRollsStore.getState().addRoll(roll('account-roll'))
      await signIn(fake, 'user-1')

      newDevice()
      useSavedRollsStore.getState().addRoll(roll('guest-roll'))
      await signIn(fake, 'user-1')

      expect(localRollIds().sort()).toEqual(['account-roll', 'guest-roll'])
      // …and the merge is pushed back, so device A gets the guest roll too.
      expect(serverRollIds(fake).sort()).toEqual(['account-roll', 'guest-roll'])
    })

    it('keeps BOTH devices\' offline edits instead of letting one blob win', async () => {
      const fake = makeFakeClient()

      newDevice()
      useSavedRollsStore.getState().addRoll(roll('shared'))
      await signIn(fake, 'user-1')

      // Device B goes offline-ish: it adds a roll and pushes.
      newDevice()
      await signIn(fake, 'user-1')
      useSavedRollsStore.getState().addRoll(roll('from-b'))
      await pushTarget(fake.client, 'user-1', savedRollsTarget())

      // Device A never saw that, and made its own edit meanwhile.
      newDevice([roll('shared')])
      useSavedRollsStore.getState().addRoll(roll('from-a'))
      await signIn(fake, 'user-1')

      expect(localRollIds().sort()).toEqual(['from-a', 'from-b', 'shared'])
      expect(serverRollIds(fake).sort()).toEqual(['from-a', 'from-b', 'shared'])
    })

    it('rescues a local edit whose push never landed', async () => {
      // Offline, or simply a tab closed inside the ~1s debounce. The device's
      // last-synced stamp still equals the server's, so the old
      // "remote is newer-or-equal wins" branch replayed the server blob over the
      // top and the roll vanished.
      const fake = makeFakeClient()

      newDevice()
      useSavedRollsStore.getState().addRoll(roll('synced'))
      await signIn(fake, 'user-1')
      stopSync()

      useSavedRollsStore.getState().addRoll(roll('never-pushed'))
      await signIn(fake, 'user-1')

      expect(localRollIds().sort()).toEqual(['never-pushed', 'synced'])
      expect(serverRollIds(fake).sort()).toEqual(['never-pushed', 'synced'])
    })

    it('propagates a delete rather than resurrecting it from the other device', async () => {
      const fake = makeFakeClient()

      newDevice()
      useSavedRollsStore.getState().addRoll(roll('keep'))
      useSavedRollsStore.getState().addRoll(roll('drop'))
      await signIn(fake, 'user-1')

      // Device B deletes one and pushes the tombstone.
      newDevice()
      await signIn(fake, 'user-1')
      useSavedRollsStore.getState().deleteRoll('drop')
      await pushTarget(fake.client, 'user-1', savedRollsTarget())

      // Device A still holds its copy — the union must not hand it back.
      newDevice([roll('keep'), roll('drop')])
      await signIn(fake, 'user-1')

      expect(localRollIds()).toEqual(['keep'])
      expect(serverRollIds(fake)).toEqual(['keep'])
    })

    it('never merges or publishes a DIFFERENT account\'s cached rolls', async () => {
      // Sign-out deliberately leaves the cache in place. Before per-user sync
      // metadata this was a cross-account clobber: user B's stamp was user A's,
      // so B's older row looked "behind" and A's rolls were pushed into B's
      // account — destroying B's data and leaking A's.
      const fake = makeFakeClient()

      newDevice()
      useSavedRollsStore.getState().addRoll(roll('user-a-private'))
      await signIn(fake, 'user-1')
      stopSync()

      // A signs out; the cache stays. The server row for user-2 is OLDER than
      // the stamp user-1 left behind on this device.
      fake.rows.saved_rolls = {
        data: { v: 2, savedRolls: [roll('user-b-roll')], deletedRolls: {} },
        updated_at: new Date(Date.now() - 60_000).toISOString(),
      }

      await signIn(fake, 'user-2')

      expect(localRollIds()).toEqual(['user-b-roll'])
      expect(serverRollIds(fake)).toEqual(['user-b-roll'])
    })

    it('does not publish a previous account\'s rolls into a brand-new account', async () => {
      // Same leak by the other door: user B has no row at all, so the
      // first-sign-in migration would have uploaded whatever the browser held.
      const fake = makeFakeClient()

      newDevice()
      useSavedRollsStore.getState().addRoll(roll('user-a-private'))
      await signIn(fake, 'user-1')
      stopSync()

      fake.rows.saved_rolls = undefined
      await signIn(fake, 'user-2')

      expect(localRollIds()).toEqual([])
      expect(serverRollIds(fake)).toEqual([])
    })

    it('retains rolls locally after sign-out so a guest keeps playing', async () => {
      const fake = makeFakeClient()

      newDevice()
      useSavedRollsStore.getState().addRoll(roll('still-here'))
      await signIn(fake, 'user-1')
      stopSync()

      expect(localRollIds()).toEqual(['still-here'])
    })

    it('re-merges the same account\'s own cache on a later sign-in', async () => {
      // The flip side of the cross-account guard: signing back in must NOT treat
      // this device's own cache as foreign, or every sign-out would cost the
      // player any edit made since the last push.
      const fake = makeFakeClient()

      newDevice()
      useSavedRollsStore.getState().addRoll(roll('mine'))
      await signIn(fake, 'user-1')
      stopSync()

      useSavedRollsStore.getState().addRoll(roll('added-while-signed-out'))
      await signIn(fake, 'user-1')

      expect(localRollIds().sort()).toEqual(['added-while-signed-out', 'mine'])
      expect(serverRollIds(fake).sort()).toEqual(['added-while-signed-out', 'mine'])
    })

    it('claims ownership BEFORE hydrating, so an interrupted sign-in cannot leak into the next account', async () => {
      // Ownership used to be recorded only after the whole hydrate loop, and a
      // hydrate is one network round trip per domain. Anything that cut it short
      // left `owner` unset while the cache already held the signed-in user's
      // data — so the NEXT account treated it as a guest cache, merged it, and
      // published it.
      const updated_at = new Date().toISOString()
      const fake = makeFakeClient({
        // Present so the inventory target reads once and does not also push,
        // which keeps the read count aligned with the target sequence.
        inventory: {
          data: {
            v: 5,
            dice: [],
            currency: { coins: 0, gems: 0, standardTokens: 0, premiumTokens: 0 },
            assignments: {},
          },
          updated_at,
        },
        saved_rolls: {
          data: { v: 2, savedRolls: [roll('user-a-private')], deletedRolls: {} },
          updated_at,
        },
      })

      // Fresh guest browser (owner null). user-1's rolls land on read 2, then
      // read 3 (settings) is cut short before the run completes.
      newDevice()
      await startSync('user-1', {
        client: makeInterruptingClient(fake, 3),
        targets: createRealTargets(),
        starterTimeoutMs: 0,
      })
      expect(localRollIds()).toEqual(['user-a-private'])
      expect(isLocalCacheOwnedBy('user-1')).toBe(true)
      expect(isLocalCacheOwnedBy('user-2')).toBe(false)
      stopSync()

      // user-2 signs in on a brand-new account: the cache is foreign, so it is
      // dropped rather than merged and uploaded.
      fake.rows.saved_rolls = undefined
      await signIn(fake, 'user-2', createRealTargets())

      expect(localRollIds()).toEqual([])
      expect(serverRollIds(fake)).toEqual([])
    })

    it('does not publish a previous account\'s inventory or theme into a brand-new account', async () => {
      // Guest/custom dice, currency and the selected theme all survive sign-out
      // too, so saved rolls were only one of three doors onto the same leak.
      const guestDie = {
        id: 'guest-die', type: 'd20', rarity: 'rare', setId: 's', stats: {}, assignedToRolls: [],
      }
      const fake = makeFakeClient()

      newDevice()
      useInventoryStore.setState({
        dice: [guestDie] as never,
        localDice: [guestDie] as never,
        currency: { coins: 777, gems: 0, standardTokens: 0, premiumTokens: 0 } as never,
      })
      useSettingsStore.getState().setThemeId('neon-cyber-city')
      await signIn(fake, 'user-1', createRealTargets())
      expect((serverRow(fake, 'inventory')?.data.dice as unknown[]).length).toBe(1)
      stopSync()

      // Brand-new account — no rows at all, so every target takes the
      // first-sign-in migration path.
      delete fake.rows.inventory
      delete fake.rows.settings
      delete fake.rows.saved_rolls
      await signIn(fake, 'user-2', createRealTargets())

      const pushedInventory = serverRow(fake, 'inventory')?.data
      expect(pushedInventory?.dice).toEqual([])
      expect((pushedInventory?.currency as { coins: number }).coins).toBe(0)
      expect(serverRow(fake, 'settings')?.data.themeId).toBe(defaultTheme.id)
      expect(useInventoryStore.getState().dice).toEqual([])
      expect(useSettingsStore.getState().themeId).toBe(defaultTheme.id)
    })

    it('drops an in-progress edit when the roll list is replaced wholesale', () => {
      // Same leak class as the cached list itself: a wholesale replace means the
      // edit belongs to the state being discarded.
      useSavedRollsStore.setState({
        savedRolls: [],
        currentlyEditing: roll('being-edited'),
        deletedRolls: {},
      })

      savedRollsTarget().applyPayload({ v: 2, savedRolls: [roll('remote')], deletedRolls: {} })

      expect(useSavedRollsStore.getState().currentlyEditing).toBeNull()
      expect(localRollIds()).toEqual(['remote'])
    })

    it('DISCARDS a legacy flat sync-meta blob instead of adopting its stamps', async () => {
      // The pre-namespacing shape cannot be attributed to an account. Adopting
      // it makes local look "ahead" of the server, which pushes this browser's
      // cache into whichever account signs in next.
      newDevice()
      localStorage.setItem(
        'dicesuki-sync-meta',
        JSON.stringify({ settings: Date.now() + 60_000 }),
      )
      const fake = makeFakeClient({
        settings: { data: { v: 1, themeId: 'remote-theme' }, updated_at: new Date().toISOString() },
      })
      const ref = { value: { v: 1, themeId: 'local-theme' } }

      // A per-test user id: a stamp some earlier test left under a shared id
      // would satisfy the lookup and hide whether the legacy blob was consulted.
      await hydrateTarget(fake.client, 'legacy-meta-user', makeStubTarget('settings', ref))

      expect(ref.value).toEqual({ v: 1, themeId: 'remote-theme' })
      expect(fake.upsertCalls).toHaveLength(0)
    })

    it('namespaces sync stamps per user, so one account never looks "ahead" for another', async () => {
      newDevice()
      const fake = makeFakeClient()
      const ref = { value: { v: 1, themeId: 'user-1-theme' } }
      const target = makeStubTarget('settings', ref)

      // Per-test ids for the same reason as above.
      await hydrateTarget(fake.client, 'ns-user-a', target)
      expect(fake.upsertCalls).toHaveLength(1)

      // user-2's row is older than that stamp. Sharing one stamp map would make
      // user-2 look behind, and user-1's cached theme would be pushed into
      // user-2's account.
      fake.rows.settings = {
        data: { v: 1, themeId: 'user-2-theme' },
        updated_at: new Date(Date.now() - 60_000).toISOString(),
      }
      await hydrateTarget(fake.client, 'ns-user-b', target, () => true, true)

      expect(ref.value).toEqual({ v: 1, themeId: 'user-2-theme' })
      expect(fake.upsertCalls).toHaveLength(1)
    })

    it('upgrades a legacy v1 blob in place without losing its rolls', async () => {
      const fake = makeFakeClient({
        saved_rolls: {
          data: { v: 1, savedRolls: [roll('legacy')] },
          updated_at: new Date().toISOString(),
        },
      })

      newDevice()
      await signIn(fake, 'user-1')

      expect(localRollIds()).toEqual(['legacy'])
      // Rewritten at the current version so the account gains somewhere to
      // record deletions instead of serving a tombstone-less blob forever.
      expect(fake.rows.saved_rolls?.data.v).toBe(SAVED_ROLLS_BLOB_VERSION)
      expect(fake.rows.saved_rolls?.data.deletedRolls).toEqual({})
    })
  })
})
