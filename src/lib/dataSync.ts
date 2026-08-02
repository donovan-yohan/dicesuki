/**
 * Data sync layer (issue #82, ADR 006 / Frontend-ADR-002).
 *
 * Local-first sync of durable user data (inventory, saved rolls, settings)
 * between the client's Zustand stores and Supabase Postgres.
 *
 * Design
 * ------
 * - The Zustand stores remain the SINGLE source of truth for the running app.
 *   Guest / offline / Supabase-unconfigured behavior is byte-identical to
 *   before: every code path here is gated behind {@link isSupabaseConfigured}
 *   and an authenticated session.
 * - On sign-in we HYDRATE each domain from Supabase, then SUBSCRIBE to local
 *   store changes and PUSH them back (debounced).
 * - Conflict policy (default): last-write-wins keyed off the server `updated_at`
 *   timestamp. On hydrate, if the remote row is newer-or-equal to what this
 *   device last synced (tracked in `dicesuki-sync-meta`), the remote wins and is
 *   applied locally; otherwise the local state is pushed up. Because every meta
 *   timestamp is server-sourced, comparisons are consistent across devices.
 * - Conflict policy (saved rolls): whole-blob LWW is only correct while at most
 *   one device has unsynced work, so `saved_rolls` merges PER ROLL instead —
 *   see {@link SyncTarget.mergePayload} and `src/lib/savedRollsMerge.ts`. That
 *   is what keeps an offline edit on one device and an offline edit on another
 *   from destroying each other.
 * - Cache ownership: `dicesuki-sync-meta` records which account the local stores
 *   currently hold, and its per-table stamps are namespaced by user id. Both
 *   exist because sign-out deliberately leaves the local cache in place: without
 *   them the next account to sign in on the same browser inherits the previous
 *   account's stamps and data.
 * - First sign-in migration: when NO remote row exists yet, the existing local
 *   data is pushed up (the "localStorage -> account" moment). This is idempotent
 *   — it upserts on `user_id`, and on any later run the now-present remote row
 *   (equal timestamp) is simply re-applied, so there is no loss or duplication.
 *   A guest signing in on a SECOND device (where a remote row already exists)
 *   is handled by the saved-rolls merge, not by this path.
 *
 * Not synced (device-local / ephemeral, by design): custom-dice binary models
 * (IndexedDB blobs), haptic/motion prefs and UI visibility (`useUIStore`), owned
 * themes (dev placeholder), and any live connection state.
 */

import { getSupabaseClient, isSupabaseConfigured } from './supabaseClient'
import { useAuthStore } from '../store/useAuthStore'
import {
  migratePersistedInventory,
  selectRetainedLocalInventory,
  useInventoryStore,
} from '../store/useInventoryStore'
import { pruneSavedRollsForRemovedDice } from './savedRollDieCleanup'
import { useSavedRollsStore, normalizePersistedSavedRollsState } from '../store/useSavedRollsStore'
import {
  mergeSavedRollsState,
  savedRollsStateMatchesRemote,
  SAVED_ROLLS_BLOB_VERSION,
  type SavedRollsSyncState,
} from './savedRollsMerge'
import { useSettingsStore } from '../store/useSettingsStore'
import { defaultTheme } from '../themes/tokens'
import type { SupabaseClient } from '@supabase/supabase-js'
import {
  ensureStarterEntitlements,
  fetchCatalogSnapshot,
  fetchMyEntitlements,
} from './collectibleCatalog'
import { fetchMyDiceCopies } from './diceCopies'
import { useWalletStore } from '../store/useWalletStore'

// ---------------------------------------------------------------------------
// Sync targets
// ---------------------------------------------------------------------------

export type SyncTable = 'inventory' | 'saved_rolls' | 'settings'

export interface SyncTarget {
  /** Supabase table name (one blob row per user). */
  table: SyncTable
  /** Serializable snapshot of this domain's local state. */
  getPayload: () => Record<string, unknown>
  /** Apply a remote snapshot into the local store, replacing what was there. */
  applyPayload: (data: unknown) => void
  /**
   * Optional per-item MERGE of a remote snapshot into the local state, used in
   * place of {@link applyPayload} whenever the local cache belongs to this user
   * (or to a guest who is signing in for the first time).
   *
   * Whole-blob replacement is only correct when at most one device has unsynced
   * work. A domain that can say something better — saved rolls are independent
   * objects with stable ids — implements this instead and keeps both sides.
   *
   * Returns true when the merged result differs from the remote snapshot and
   * therefore has to be pushed back up; without that push the merge would live
   * only on this device.
   */
  mergePayload?: (data: unknown) => boolean
  /**
   * Drop local state belonging to a DIFFERENT account.
   *
   * Only consulted when this device's cache is owned by another user and the
   * incoming account has no remote row yet — the one case where the
   * "first sign-in migrates local data up" path would otherwise publish one
   * player's data into another player's brand-new account.
   */
  resetLocal?: () => void
  /**
   * Optional repair that runs only AFTER every target has applied its payload.
   *
   * `applyPayload` runs per target inside the hydrate loop, so anything it
   * writes into ANOTHER domain's store is clobbered the moment that domain's
   * own target applies its (un-repaired) remote blob. Cross-domain fixes
   * therefore have to be deferred to here.
   */
  finalizeHydration?: () => void
  /** Subscribe to local store changes; returns an unsubscribe fn. */
  subscribe: (listener: () => void) => () => void
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' ? (value as Record<string, unknown>) : {}
}

/**
 * Read a remote `saved_rolls` blob into merge-ready state.
 *
 * Runs the store's OWN normalizer so a remote blob is validated exactly the way
 * a persisted localStorage blob is (Frontend-ADR-002) — a hostile or stale row
 * cannot introduce a shape the store would not have accepted from disk. The
 * objects it returns are the identities the merge compares against, so this must
 * be called once per hydrate and the result shared.
 */
function readRemoteSavedRolls(data: unknown): SavedRollsSyncState {
  const normalized = normalizePersistedSavedRollsState(data)
  return {
    savedRolls: normalized.savedRolls ?? [],
    deletedRolls: normalized.deletedRolls ?? {},
  }
}

/** Build the real sync targets bound to the live Zustand stores. */
export function createRealTargets(): SyncTarget[] {
  // Starter rows dropped while applying the inventory blob. Held until every
  // target has hydrated: the saved-rolls target applies its own remote snapshot
  // wholesale a moment later, so repairing saved rolls from inside the inventory
  // target's `applyPayload` would simply be overwritten.
  let pendingStarterRemovals: string[] = []

  return [
    {
      table: 'inventory',
      getPayload: () => {
        const s = useInventoryStore.getState()
        const retained = selectRetainedLocalInventory(s)
        return {
          // Tracks the inventory store's persist version: a blob written here is
          // read back through the SAME migration chain, so a stale stamp would
          // re-run migrations that have already been applied.
          v: 5,
          dice: retained.dice,
          currency: s.currency,
          assignments: retained.assignments,
        }
      },
      applyPayload: (data) => {
        const d = asRecord(data)
        const version = typeof d.v === 'number' ? d.v : 2
        // A blob written by another device can predate the v5 starter cleanup,
        // so it gets the same treatment as a local rehydrate: the seeded starter
        // rows are dropped AND the saved rolls that pinned them are repaired.
        // Skipping the second half would let a dangling reference ride back in
        // from a device that has not synced yet.
        const { state, removedStarterDieIds } = migratePersistedInventory(d, version)
        const migrated = asRecord(state)
        useInventoryStore.setState({
          dice: Array.isArray(migrated.dice) ? (migrated.dice as never[]) : [],
          currency: asRecord(migrated.currency) as never,
          assignments: asRecord(migrated.assignments) as never,
        })
        // Deferred, NOT applied here: `saved_rolls` hydrates after this target
        // and would overwrite the repair with the un-repaired remote blob.
        pendingStarterRemovals = removedStarterDieIds
      },
      finalizeHydration: () => {
        // Runs once every domain has applied its remote snapshot, so this is the
        // last word on the saved rolls. Keyed on the ids the migration actually
        // dropped — deriving "which dice are gone?" from the current inventory
        // instead would wipe references to authenticated server copies, which
        // are never persisted and are absent until the copy read lands.
        pruneSavedRollsForRemovedDice(pendingStarterRemovals)
        pendingStarterRemovals = []
      },
      resetLocal: () => {
        // Guest/custom dice, currency and assignments all survive sign-out, so
        // without this a brand-new account inherits the previous player's
        // collection AND publishes it as its own first-sign-in migration.
        useInventoryStore.getState().reset()
        pendingStarterRemovals = []
      },
      subscribe: (listener) => useInventoryStore.subscribe(listener),
    },
    {
      table: 'saved_rolls',
      getPayload: () => {
        const s = useSavedRollsStore.getState()
        return {
          v: SAVED_ROLLS_BLOB_VERSION,
          savedRolls: s.savedRolls,
          deletedRolls: s.deletedRolls,
        }
      },
      applyPayload: (data) => {
        const remote = readRemoteSavedRolls(data)
        useSavedRollsStore.setState({
          savedRolls: remote.savedRolls,
          deletedRolls: remote.deletedRolls,
          // Wholesale replacement means the in-progress edit belongs to the
          // state being discarded. Keeping it would carry one account's roll
          // across into another's session.
          currentlyEditing: null,
        })
      },
      mergePayload: (data) => {
        const remote = readRemoteSavedRolls(data)
        const local = useSavedRollsStore.getState()
        const merged = mergeSavedRollsState(
          { savedRolls: local.savedRolls, deletedRolls: local.deletedRolls },
          remote,
        )
        useSavedRollsStore.setState({
          savedRolls: merged.savedRolls,
          deletedRolls: merged.deletedRolls,
        })
        // A blob still on the old format is rewritten even when the merge itself
        // was a no-op, so the account stops serving a snapshot with nowhere to
        // record deletions.
        const remoteVersion = typeof asRecord(data).v === 'number' ? (asRecord(data).v as number) : 1
        return remoteVersion < SAVED_ROLLS_BLOB_VERSION
          || !savedRollsStateMatchesRemote(merged, remote)
      },
      resetLocal: () => {
        useSavedRollsStore.setState({ savedRolls: [], deletedRolls: {}, currentlyEditing: null })
      },
      subscribe: (listener) => useSavedRollsStore.subscribe(listener),
    },
    {
      table: 'settings',
      getPayload: () => {
        const s = useSettingsStore.getState()
        return { v: 1, themeId: s.themeId }
      },
      applyPayload: (data) => {
        const d = asRecord(data)
        if (typeof d.themeId === 'string' && d.themeId) {
          useSettingsStore.getState().setThemeId(d.themeId)
        }
      },
      resetLocal: () => {
        // The selected theme is a purchasable entitlement, so a new account must
        // not start out wearing (or publishing) the previous player's choice.
        useSettingsStore.getState().setThemeId(defaultTheme.id)
      },
      subscribe: (listener) => useSettingsStore.subscribe(listener),
    },
  ]
}

// ---------------------------------------------------------------------------
// Per-device sync metadata (last-synced server timestamp per table)
// ---------------------------------------------------------------------------

const SYNC_META_KEY = 'dicesuki-sync-meta'

type TableStamps = Partial<Record<SyncTable, number>>

/**
 * Per-device sync bookkeeping.
 *
 * `users` is keyed by user id. It used to be a flat `{ table: ts }` map shared
 * by every account that had ever signed in on the device, which was actively
 * dangerous: the stamps outlive sign-out, and so do the local stores. User A
 * syncs (stamp = T_A), signs out leaving A's data cached locally, then user B
 * signs in. B's row is older than T_A, so the "local is ahead of the server"
 * branch fired and pushed *A's* data into *B's* account — destroying B's rows
 * and leaking A's. Namespacing the stamps makes B's stamp 0, so B correctly
 * takes the server copy.
 *
 * `owner` records which account the local stores currently reflect (`null` = a
 * guest who has never signed in here). It is the difference between "these local
 * rolls are mine and must be merged up" and "these belong to someone else and
 * must not touch this account".
 */
interface SyncMeta {
  owner: string | null
  users: Record<string, TableStamps>
}

const EMPTY_META: SyncMeta = { owner: null, users: {} }

function readMeta(): SyncMeta {
  try {
    const raw = localStorage.getItem(SYNC_META_KEY)
    if (!raw) return { ...EMPTY_META }
    const parsed = JSON.parse(raw) as Partial<SyncMeta>
    // A pre-namespacing (flat) blob is deliberately DISCARDED rather than
    // adopted: its stamps cannot be attributed to an account, and guessing wrong
    // is the exact cross-account clobber this shape exists to prevent. Dropping
    // them degrades to "stamp 0" — the server copy wins, which is safe.
    if (!parsed || typeof parsed !== 'object' || typeof parsed.users !== 'object' || !parsed.users) {
      return { ...EMPTY_META }
    }
    return {
      owner: typeof parsed.owner === 'string' ? parsed.owner : null,
      users: parsed.users as Record<string, TableStamps>,
    }
  } catch {
    return { ...EMPTY_META }
  }
}

function writeMeta(meta: SyncMeta): void {
  try {
    localStorage.setItem(SYNC_META_KEY, JSON.stringify(meta))
  } catch {
    // Best-effort: a full/blocked localStorage just means LWW falls back to
    // "remote wins on next hydrate", which is safe.
  }
}

function getLocalMeta(userId: string, table: SyncTable): number {
  return readMeta().users[userId]?.[table] ?? 0
}

function setLocalMeta(userId: string, table: SyncTable, updatedAt: number): void {
  const meta = readMeta()
  meta.users[userId] = { ...meta.users[userId], [table]: updatedAt }
  writeMeta(meta)
}

/**
 * Is the locally cached data safe to merge into `userId`'s account?
 *
 * True for the account that last synced here (its own offline edits) and for a
 * never-signed-in guest (the localStorage -> account migration). False when the
 * cache belongs to a DIFFERENT account, in which case it is that account's data
 * sitting in a shared browser and must not be merged or pushed anywhere.
 */
export function isLocalCacheOwnedBy(userId: string): boolean {
  const owner = readMeta().owner
  return owner === null || owner === userId
}

/** Record that the local stores now reflect `userId`'s data. */
function setCacheOwner(userId: string): void {
  const meta = readMeta()
  if (meta.owner === userId) return
  meta.owner = userId
  writeMeta(meta)
}

// ---------------------------------------------------------------------------
// Core engine (client injected for testability)
// ---------------------------------------------------------------------------

/** Guard so applyPayload-driven store writes don't echo back as a push. */
let applyingRemote = false

/** Push the local snapshot up, returning the server `updated_at` (ms). */
export async function pushTarget(
  client: SupabaseClient,
  userId: string,
  target: SyncTarget,
  isCurrent: () => boolean = () => true,
): Promise<void> {
  const payload = target.getPayload()
  const { data, error } = await client
    .from(target.table)
    .upsert({ user_id: userId, data: payload }, { onConflict: 'user_id' })
    .select('updated_at')
    .maybeSingle()

  if (error || !isCurrent()) return
  const updatedAt = data?.updated_at ? Date.parse(data.updated_at as string) : Date.now()
  setLocalMeta(userId, target.table, Number.isNaN(updatedAt) ? Date.now() : updatedAt)
}

/** Run a store write without it echoing straight back out as a push. */
function applyingRemoteWrite<T>(write: () => T): T {
  applyingRemote = true
  try {
    return write()
  } finally {
    applyingRemote = false
  }
}

/**
 * Hydrate one domain on sign-in.
 *
 * Three outcomes, in priority order:
 *
 * 1. The cache belongs to ANOTHER account (`localIsOwn` false) — the remote row
 *    replaces it outright, and a target that can be reset is emptied rather than
 *    published when the account has no row yet. Never merge across accounts.
 * 2. The target can merge and the cache is this user's (or a guest's) — union
 *    the two sides and push the result back if it moved. This is what preserves
 *    offline edits and carries guest rolls up on a second device.
 * 3. Otherwise the legacy whole-blob rule: apply the remote row when it is
 *    newer-or-equal to this device's last sync, else push local up.
 */
export async function hydrateTarget(
  client: SupabaseClient,
  userId: string,
  target: SyncTarget,
  isCurrent: () => boolean = () => true,
  localIsOwn: boolean = isLocalCacheOwnedBy(userId),
): Promise<void> {
  const { data: row, error } = await client
    .from(target.table)
    .select('data, updated_at')
    .eq('user_id', userId)
    .maybeSingle()

  if (error || !isCurrent()) return

  if (!row) {
    // First sign-in for this account: migrate existing local data up — unless
    // that data is a previous user's, which must not be published here.
    if (!localIsOwn && target.resetLocal) {
      applyingRemoteWrite(() => target.resetLocal?.())
    }
    await pushTarget(client, userId, target, isCurrent)
    return
  }

  const remoteUpdatedAt = row.updated_at ? Date.parse(row.updated_at as string) : 0
  const localUpdatedAt = getLocalMeta(userId, target.table)

  if (target.mergePayload && localIsOwn) {
    const needsPush = applyingRemoteWrite(() => target.mergePayload!(row.data))
    setLocalMeta(userId, target.table, remoteUpdatedAt)
    if (needsPush) await pushTarget(client, userId, target, isCurrent)
    return
  }

  if (remoteUpdatedAt >= localUpdatedAt || !localIsOwn) {
    applyingRemoteWrite(() => target.applyPayload(row.data))
    setLocalMeta(userId, target.table, remoteUpdatedAt)
  } else {
    // Local is ahead of the server (offline edits) — push it up.
    await pushTarget(client, userId, target, isCurrent)
  }
}

// ---------------------------------------------------------------------------
// Lifecycle: start / stop sync for a signed-in user
// ---------------------------------------------------------------------------

interface StartOptions {
  client?: SupabaseClient | null
  targets?: SyncTarget[]
  debounceMs?: number
  starterTimeoutMs?: number
}

const DEFAULT_DEBOUNCE_MS = 1000
const DEFAULT_STARTER_TIMEOUT_MS = 3000

let activeUserId: string | null = null
let startingUserId: string | null = null
let startPromise: Promise<void> | null = null
let syncGeneration = 0
let unsubscribers: Array<() => void> = []
const pushTimers = new Map<SyncTable, ReturnType<typeof setTimeout>>()
const lastSerialized = new Map<SyncTable, string>()

/**
 * Begin syncing for a signed-in user: hydrate every domain, then wire debounced
 * push-on-change. No-op when Supabase is unconfigured or no client is available.
 */
async function startSyncGeneration(
  client: SupabaseClient,
  userId: string,
  generation: number,
  options: StartOptions,
): Promise<void> {
  const isCurrent = () => syncGeneration === generation && activeUserId === userId

  // Best effort: this no-argument RPC can only grant the server-fixed free
  // starter bundle. Failure, offline state, or a hung request must not block
  // local hydration or play indefinitely.
  const starterTimeoutMs = options.starterTimeoutMs ?? DEFAULT_STARTER_TIMEOUT_MS
  let starterTimeout: ReturnType<typeof setTimeout> | undefined
  try {
    await Promise.race([
      ensureStarterEntitlements(client),
      new Promise<void>((resolve) => {
        starterTimeout = setTimeout(resolve, starterTimeoutMs)
      }),
    ])
  } finally {
    if (starterTimeout) clearTimeout(starterTimeout)
  }
  if (!isCurrent()) return

  const targets = options.targets ?? createRealTargets()
  const debounceMs = options.debounceMs ?? DEFAULT_DEBOUNCE_MS

  // Resolved ONCE, before any target runs. Reading it per target would be wrong
  // the moment the first hydrate claimed ownership: every later target would see
  // `owner === userId` and treat a previous account's cache as this user's.
  const localIsOwn = isLocalCacheOwnedBy(userId)

  // A cache belonging to a DIFFERENT account is dropped up front, synchronously,
  // across every target — and ownership is claimed BEFORE the first await.
  //
  // Claiming it afterwards was a leak. A hydrate is a network round trip per
  // domain, and anything that cuts one short — signing out mid-flight, closing
  // the tab, a PWA being backgrounded — left `owner` still naming the PREVIOUS
  // user, so the next account to sign in adopted their cache and published it.
  // Ownership has to be a promise made before the work starts rather than a
  // receipt written after it finishes: a half-hydrated cache is genuinely this
  // user's, because everything foreign was already cleared.
  if (!localIsOwn) {
    applyingRemoteWrite(() => {
      for (const target of targets) target.resetLocal?.()
    })
  }
  setCacheOwner(userId)

  for (const target of targets) {
    if (!isCurrent()) return
    // Post-reset the cache is this user's — except for a target that had nothing
    // to reset with, which still holds whatever the previous account left.
    const targetIsOwn = localIsOwn || Boolean(target.resetLocal)
    await hydrateTarget(client, userId, target, isCurrent, targetIsOwn)
    if (!isCurrent()) return
    // Seed the change-dedupe baseline from the post-hydrate payload so the
    // hydrate itself never triggers a redundant echo push.
    lastSerialized.set(target.table, JSON.stringify(target.getPayload()))

    const unsub = target.subscribe(() => {
      if (applyingRemote) return
      if (!isCurrent()) return
      const serialized = JSON.stringify(target.getPayload())
      if (serialized === lastSerialized.get(target.table)) return
      lastSerialized.set(target.table, serialized)

      const existing = pushTimers.get(target.table)
      if (existing) clearTimeout(existing)
      pushTimers.set(
        target.table,
        setTimeout(() => {
          pushTimers.delete(target.table)
          if (!isCurrent()) return
          void pushTarget(client, userId, target, isCurrent)
        }, debounceMs),
      )
    })
    unsubscribers.push(unsub)
  }

  if (!isCurrent()) return

  // Cross-domain repairs, once every target has applied its own remote snapshot.
  // Deliberately after the whole loop: a fix one domain makes to another during
  // `applyPayload` is undone when that domain hydrates. Running after the
  // subscriptions are wired is also intentional — a repair is a real local
  // change and should push back up, so the server stops serving the bad blob.
  for (const target of targets) {
    if (!isCurrent()) return
    target.finalizeHydration?.()
  }

  if (!isCurrent()) return

  // Server-authoritative economy/catalog reads are best-effort so the existing
  // local-first domains still hydrate offline. Entitlements are fetched here
  // alongside the catalog as the ownership compatibility surface; dice_copies
  // is the authoritative signed-in playable copy list.
  useWalletStore.getState().setUserId(userId)
  const [entitlementsResult, catalogResult, copiesResult, walletResult] =
    await Promise.allSettled([
      fetchMyEntitlements(client),
      fetchCatalogSnapshot(client),
      fetchMyDiceCopies(client),
      useWalletStore.getState().refresh(client),
    ])
  if (!isCurrent()) return

  // Keeping this result explicit proves the existing entitlement reader is now
  // part of sign-in orchestration even though copy identity, not entitlement
  // rows, drives the playable inventory view.
  void entitlementsResult
  if (
    copiesResult.status === 'fulfilled' &&
    catalogResult.status === 'fulfilled' &&
    catalogResult.value !== null
  ) {
    useInventoryStore.getState().syncServerCopies(
      copiesResult.value,
      catalogResult.value,
    )
  }
  if (walletResult.status === 'rejected') {
    // refresh already marks the store stale; local play remains available.
  }

  // Realtime is an enhancement over the completed reads. Some injected/offline
  // clients intentionally have no channel implementation.
  if (typeof (client as unknown as { channel?: unknown }).channel === 'function') {
    try {
      unsubscribers.push(useWalletStore.getState().connectRealtime(userId, client))
    } catch {
      // Poll/read state remains usable when Realtime setup fails.
    }
  }
}

export function startSync(userId: string, options: StartOptions = {}): Promise<void> {
  const client = options.client ?? getSupabaseClient()
  if (!client || !userId) return Promise.resolve()
  if (startingUserId === userId && startPromise) return startPromise
  if (activeUserId === userId) return Promise.resolve()
  if (activeUserId || startPromise) stopSync() // switch accounts cleanly

  activeUserId = userId
  startingUserId = userId
  const generation = ++syncGeneration
  const pending = startSyncGeneration(client, userId, generation, options)
    .finally(() => {
      if (startPromise === pending) {
        startPromise = null
        startingUserId = null
      }
    })
  startPromise = pending
  return pending
}

/**
 * Stop syncing and tear down subscriptions/timers.
 *
 * Leaves the local cache intact — signing out drops back to guest mode, and a
 * guest is expected to keep playing with the rolls that are already on screen.
 * The `dicesuki-sync-meta` owner record survives too, which is what lets the
 * same account merge its own cache back on the next sign-in while a DIFFERENT
 * account correctly refuses to adopt it.
 */
export function stopSync(): void {
  syncGeneration += 1
  for (const unsub of unsubscribers) unsub()
  unsubscribers = []
  for (const timer of pushTimers.values()) clearTimeout(timer)
  pushTimers.clear()
  lastSerialized.clear()
  activeUserId = null
  startingUserId = null
  startPromise = null
  useInventoryStore.getState().clearServerCopies()
  useWalletStore.getState().resetOnSignOut()
}

// ---------------------------------------------------------------------------
// Wiring: react to auth state
// ---------------------------------------------------------------------------

let initialized = false

/**
 * Wire data sync to auth state. Call once at startup (alongside auth
 * initialize). No-op when Supabase is unconfigured — guests are untouched.
 */
export function initDataSync(): void {
  if (initialized) return
  if (!isSupabaseConfigured()) return
  initialized = true

  const react = (status: string, userId: string | null) => {
    if (status === 'authenticated' && userId) {
      void startSync(userId)
    } else if (status === 'guest') {
      stopSync()
    }
  }

  useAuthStore.subscribe((state) => react(state.status, state.user?.id ?? null))
  const s = useAuthStore.getState()
  react(s.status, s.user?.id ?? null)
}

/** Test-only: reset all module-level sync state. */
export function __resetDataSyncForTests(): void {
  stopSync()
  initialized = false
  applyingRemote = false
  try {
    localStorage.removeItem(SYNC_META_KEY)
  } catch {
    // ignore
  }
}
