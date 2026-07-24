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
 * - Conflict policy: last-write-wins keyed off the server `updated_at`
 *   timestamp. On hydrate, if the remote row is newer-or-equal to what this
 *   device last synced (tracked in `dicesuki-sync-meta`), the remote wins and is
 *   applied locally; otherwise the local state is pushed up. Because every meta
 *   timestamp is server-sourced, comparisons are consistent across devices.
 * - First sign-in migration: when NO remote row exists yet, the existing local
 *   data is pushed up (the "localStorage -> account" moment). This is idempotent
 *   — it upserts on `user_id`, and on any later run the now-present remote row
 *   (equal timestamp) is simply re-applied, so there is no loss or duplication.
 *
 * Not synced (device-local / ephemeral, by design): custom-dice binary models
 * (IndexedDB blobs), haptic/motion prefs and UI visibility (`useUIStore`), owned
 * themes (dev placeholder), and any live connection state.
 */

import { getSupabaseClient, isSupabaseConfigured } from './supabaseClient'
import { useAuthStore } from '../store/useAuthStore'
import {
  migratePersistedInventoryState,
  useInventoryStore,
} from '../store/useInventoryStore'
import { useSavedRollsStore, normalizePersistedSavedRollsState } from '../store/useSavedRollsStore'
import { useSettingsStore } from '../store/useSettingsStore'
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
  /** Apply a remote snapshot into the local store. */
  applyPayload: (data: unknown) => void
  /** Subscribe to local store changes; returns an unsubscribe fn. */
  subscribe: (listener: () => void) => () => void
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' ? (value as Record<string, unknown>) : {}
}

/** Build the real sync targets bound to the live Zustand stores. */
export function createRealTargets(): SyncTarget[] {
  return [
    {
      table: 'inventory',
      getPayload: () => {
        const s = useInventoryStore.getState()
        const localDice = s.serverCopiesActive ? s.localDice : s.dice
        const assignments = s.serverCopiesActive
          ? s.localAssignments
          : s.assignments
        return { v: 4, dice: localDice, currency: s.currency, assignments }
      },
      applyPayload: (data) => {
        const d = asRecord(data)
        const version = typeof d.v === 'number' ? d.v : 2
        const migrated = asRecord(migratePersistedInventoryState(d, version))
        useInventoryStore.setState({
          dice: Array.isArray(migrated.dice) ? (migrated.dice as never[]) : [],
          currency: asRecord(migrated.currency) as never,
          assignments: asRecord(migrated.assignments) as never,
        })
      },
      subscribe: (listener) => useInventoryStore.subscribe(listener),
    },
    {
      table: 'saved_rolls',
      getPayload: () => {
        const s = useSavedRollsStore.getState()
        return { v: 1, savedRolls: s.savedRolls }
      },
      applyPayload: (data) => {
        // Reuse the store's own normalizer so remote blobs are validated the
        // same way persisted localStorage blobs are (Frontend-ADR-002).
        const normalized = normalizePersistedSavedRollsState(data)
        useSavedRollsStore.setState({ savedRolls: normalized.savedRolls ?? [] })
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
      subscribe: (listener) => useSettingsStore.subscribe(listener),
    },
  ]
}

// ---------------------------------------------------------------------------
// Per-device sync metadata (last-synced server timestamp per table)
// ---------------------------------------------------------------------------

const SYNC_META_KEY = 'dicesuki-sync-meta'

type SyncMeta = Partial<Record<SyncTable, number>>

function readMeta(): SyncMeta {
  try {
    const raw = localStorage.getItem(SYNC_META_KEY)
    return raw ? (JSON.parse(raw) as SyncMeta) : {}
  } catch {
    return {}
  }
}

function getLocalMeta(table: SyncTable): number {
  return readMeta()[table] ?? 0
}

function setLocalMeta(table: SyncTable, updatedAt: number): void {
  try {
    const meta = readMeta()
    meta[table] = updatedAt
    localStorage.setItem(SYNC_META_KEY, JSON.stringify(meta))
  } catch {
    // Best-effort: a full/blocked localStorage just means LWW falls back to
    // "remote wins on next hydrate", which is safe.
  }
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
  setLocalMeta(target.table, Number.isNaN(updatedAt) ? Date.now() : updatedAt)
}

/**
 * Hydrate one domain on sign-in. Applies the remote row if it is newer-or-equal
 * to this device's last sync; otherwise pushes local up. When no remote row
 * exists, performs the first-sign-in migration (push local up).
 */
export async function hydrateTarget(
  client: SupabaseClient,
  userId: string,
  target: SyncTarget,
  isCurrent: () => boolean = () => true,
): Promise<void> {
  const { data: row, error } = await client
    .from(target.table)
    .select('data, updated_at')
    .eq('user_id', userId)
    .maybeSingle()

  if (error || !isCurrent()) return

  if (!row) {
    // First sign-in for this account: migrate existing local data up.
    await pushTarget(client, userId, target, isCurrent)
    return
  }

  const remoteUpdatedAt = row.updated_at ? Date.parse(row.updated_at as string) : 0
  const localUpdatedAt = getLocalMeta(target.table)

  if (remoteUpdatedAt >= localUpdatedAt) {
    applyingRemote = true
    try {
      target.applyPayload(row.data)
    } finally {
      applyingRemote = false
    }
    setLocalMeta(target.table, remoteUpdatedAt)
  } else {
    // Local is ahead of the server (offline edits) — push it up.
    await pushTarget(client, userId, target)
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

  for (const target of targets) {
    if (!isCurrent()) return
    await hydrateTarget(client, userId, target, isCurrent)
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

/** Stop syncing and tear down subscriptions/timers. Leaves local cache intact. */
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
