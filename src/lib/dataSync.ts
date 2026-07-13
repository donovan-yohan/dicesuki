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
import { useInventoryStore } from '../store/useInventoryStore'
import { useSavedRollsStore, normalizePersistedSavedRollsState } from '../store/useSavedRollsStore'
import { useSettingsStore } from '../store/useSettingsStore'
import type { SupabaseClient } from '@supabase/supabase-js'

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
        return { v: 2, dice: s.dice, currency: s.currency, assignments: s.assignments }
      },
      applyPayload: (data) => {
        const d = asRecord(data)
        useInventoryStore.setState({
          dice: Array.isArray(d.dice) ? (d.dice as never[]) : [],
          currency: asRecord(d.currency) as never,
          assignments: asRecord(d.assignments) as never,
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
): Promise<void> {
  const payload = target.getPayload()
  const { data, error } = await client
    .from(target.table)
    .upsert({ user_id: userId, data: payload }, { onConflict: 'user_id' })
    .select('updated_at')
    .maybeSingle()

  if (error) return
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
): Promise<void> {
  const { data: row, error } = await client
    .from(target.table)
    .select('data, updated_at')
    .eq('user_id', userId)
    .maybeSingle()

  if (error) return

  if (!row) {
    // First sign-in for this account: migrate existing local data up.
    await pushTarget(client, userId, target)
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
}

const DEFAULT_DEBOUNCE_MS = 1000

let activeUserId: string | null = null
let unsubscribers: Array<() => void> = []
const pushTimers = new Map<SyncTable, ReturnType<typeof setTimeout>>()
const lastSerialized = new Map<SyncTable, string>()

/**
 * Begin syncing for a signed-in user: hydrate every domain, then wire debounced
 * push-on-change. No-op when Supabase is unconfigured or no client is available.
 */
export async function startSync(userId: string, options: StartOptions = {}): Promise<void> {
  const client = options.client ?? getSupabaseClient()
  if (!client || !userId) return
  if (activeUserId === userId) return // already syncing this user
  if (activeUserId) stopSync() // switch accounts cleanly

  activeUserId = userId
  const targets = options.targets ?? createRealTargets()
  const debounceMs = options.debounceMs ?? DEFAULT_DEBOUNCE_MS

  for (const target of targets) {
    await hydrateTarget(client, userId, target)
    // Seed the change-dedupe baseline from the post-hydrate payload so the
    // hydrate itself never triggers a redundant echo push.
    lastSerialized.set(target.table, JSON.stringify(target.getPayload()))

    const unsub = target.subscribe(() => {
      if (applyingRemote) return
      if (activeUserId !== userId) return
      const serialized = JSON.stringify(target.getPayload())
      if (serialized === lastSerialized.get(target.table)) return
      lastSerialized.set(target.table, serialized)

      const existing = pushTimers.get(target.table)
      if (existing) clearTimeout(existing)
      pushTimers.set(
        target.table,
        setTimeout(() => {
          pushTimers.delete(target.table)
          void pushTarget(client, userId, target)
        }, debounceMs),
      )
    })
    unsubscribers.push(unsub)
  }
}

/** Stop syncing and tear down subscriptions/timers. Leaves local cache intact. */
export function stopSync(): void {
  for (const unsub of unsubscribers) unsub()
  unsubscribers = []
  for (const timer of pushTimers.values()) clearTimeout(timer)
  pushTimers.clear()
  lastSerialized.clear()
  activeUserId = null
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
