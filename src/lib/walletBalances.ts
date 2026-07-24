import type { SupabaseClient } from '@supabase/supabase-js'
import { getSupabaseClient } from './supabaseClient'

export const LUNAR_PASS_PRODUCT_ID = 'lunar-pass' as const
export const WALLET_POLL_BACKOFF_MS: readonly number[] = [4000, 8000, 15000, 30000]

export interface WalletBalances {
  stars: {
    promotional: number
    paid?: number
  }
  dust: {
    earned: number
  }
}

export interface RollTicketBalances {
  standard_roll: number
  premium_roll: number
}

export interface WalletBalanceSnapshot {
  wallet: WalletBalances
  tickets: RollTicketBalances
}

export type SubscriptionStatus = 'active' | 'non_renewing' | 'canceled'

export interface LunarSubscriptionSnapshot {
  subscriptionId: string
  status: SubscriptionStatus
  planId: string | null
  productId: typeof LUNAR_PASS_PRODUCT_ID
  dateNextCharge: string | null
  dateEnd: string | null
}

export class WalletBalancesError extends Error {
  readonly operation: string
  readonly code?: string

  constructor(operation: string, message: string, code?: string) {
    super(`${operation} failed: ${message}`)
    this.name = 'WalletBalancesError'
    this.operation = operation
    this.code = code
  }
}

export type WalletConversionErrorKind =
  | 'invalid_request'
  | 'insufficient_funds'
  | 'rpc_failure'

export class WalletConversionError extends WalletBalancesError {
  readonly kind: WalletConversionErrorKind

  constructor(message: string, kind: WalletConversionErrorKind, code?: string) {
    super('convert_stars_to_standard_roll', message, code)
    this.name = 'WalletConversionError'
    this.kind = kind
  }
}

export interface StarsToStandardRollReceipt {
  walletLedgerEntryId: number
  rollTicketLedgerEntryId: number
  rollCount: number
  starsDebited: number
  promotionalStarsBalanceAfter: number
  standardRollTicketsCredited: number
  standardRollQuantityAfter: number
}

type UnknownRecord = Record<string, unknown>

function clientFor(operation: string, client?: SupabaseClient | null): SupabaseClient {
  const resolved = client === undefined ? getSupabaseClient() : client
  if (!resolved) throw new WalletBalancesError(operation, 'Supabase is not configured')
  return resolved
}

function object(value: unknown, label: string): UnknownRecord {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new WalletBalancesError(label, 'backend returned a malformed object')
  }
  return value as UnknownRecord
}

function nonEmptyString(value: unknown, label: string): string {
  if (typeof value !== 'string' || value.length === 0) {
    throw new WalletBalancesError(label, 'backend returned a malformed string')
  }
  return value
}

function nullableString(value: unknown, label: string): string | null {
  return value === null ? null : nonEmptyString(value, label)
}

function integer(value: unknown, label: string): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) {
    throw new WalletBalancesError(label, 'backend returned a malformed integer')
  }
  return value
}

function enumValue<T extends string>(
  value: unknown,
  allowed: readonly T[],
  label: string,
): T {
  if (typeof value !== 'string' || !allowed.includes(value as T)) {
    throw new WalletBalancesError(label, 'backend returned an unsupported enum value')
  }
  return value as T
}

async function rows(
  operation: string,
  query: PromiseLike<{ data: unknown; error: { message: string; code?: string } | null }>,
): Promise<unknown[]> {
  try {
    const { data, error } = await query
    if (error) throw new WalletBalancesError(operation, error.message, error.code)
    if (!Array.isArray(data)) {
      throw new WalletBalancesError(operation, 'backend returned a malformed row set')
    }
    return data
  } catch (error) {
    if (error instanceof WalletBalancesError) throw error
    throw new WalletBalancesError(
      operation,
      error instanceof Error ? error.message : 'unknown client failure',
    )
  }
}

export async function fetchWalletBalances(
  client?: SupabaseClient | null,
): Promise<WalletBalances> {
  const operation = 'fetch_wallet_balances'
  const resolved = clientFor(operation, client)
  const result: WalletBalances = {
    stars: { promotional: 0 },
    dust: { earned: 0 },
  }
  const seen = new Set<string>()
  const data = await rows(
    operation,
    resolved.from('wallet_balances').select(
      'currency_id, balance_bucket, current_balance',
    ),
  )

  for (const value of data) {
    const row = object(value, operation)
    const currency = enumValue(row.currency_id, ['stars', 'dust'] as const, operation)
    const bucket = enumValue(
      row.balance_bucket,
      ['promotional', 'earned', 'paid'] as const,
      operation,
    )
    const key = `${currency}:${bucket}`
    if (seen.has(key)) {
      throw new WalletBalancesError(operation, `backend returned duplicate ${key} rows`)
    }
    seen.add(key)
    const amount = integer(row.current_balance, operation)
    if (currency === 'stars' && bucket === 'promotional') result.stars.promotional = amount
    else if (currency === 'stars' && bucket === 'paid') result.stars.paid = amount
    else if (currency === 'dust' && bucket === 'earned') result.dust.earned = amount
    else {
      throw new WalletBalancesError(
        operation,
        `backend returned unsupported currency bucket ${key}`,
      )
    }
  }
  return result
}

export async function fetchRollTicketBalances(
  client?: SupabaseClient | null,
): Promise<RollTicketBalances> {
  const operation = 'fetch_roll_ticket_balances'
  const resolved = clientFor(operation, client)
  const result: RollTicketBalances = { standard_roll: 0, premium_roll: 0 }
  const seen = new Set<string>()
  const data = await rows(
    operation,
    resolved.from('roll_ticket_balances').select('roll_type, current_quantity'),
  )
  for (const value of data) {
    const row = object(value, operation)
    const rollType = enumValue(
      row.roll_type,
      ['standard_roll', 'premium_roll'] as const,
      operation,
    )
    if (seen.has(rollType)) {
      throw new WalletBalancesError(operation, `backend returned duplicate ${rollType} rows`)
    }
    seen.add(rollType)
    result[rollType] = integer(row.current_quantity, operation)
  }
  return result
}

async function fetchBalanceSnapshot(client: SupabaseClient): Promise<WalletBalanceSnapshot> {
  const [wallet, tickets] = await Promise.all([
    fetchWalletBalances(client),
    fetchRollTicketBalances(client),
  ])
  return { wallet, tickets }
}

/**
 * Watch both server-authoritative balance tables. The watcher performs an
 * initial fetch, refreshes on either Realtime table, and retains a session-long
 * polling fallback until explicit unsubscribe.
 */
export function subscribeWalletBalances(
  userId: string,
  onChange: (snapshot: WalletBalanceSnapshot) => void,
  client?: SupabaseClient | null,
): () => void {
  const resolved = client === undefined ? getSupabaseClient() : client
  if (!resolved || !userId) return () => {}

  let stopped = false
  let pollTimer: ReturnType<typeof setTimeout> | undefined
  let backoffIndex = 0
  let refreshInFlight: Promise<void> | null = null
  let refreshQueued = false

  const refresh = () => {
    if (stopped) return Promise.resolve()
    if (refreshInFlight) {
      refreshQueued = true
      return refreshInFlight
    }
    refreshInFlight = fetchBalanceSnapshot(resolved)
      .then(snapshot => {
        if (!stopped) onChange(snapshot)
      })
      .catch(() => {
        // Realtime and polling are best-effort; the store keeps its last snapshot.
      })
      .finally(() => {
        refreshInFlight = null
        if (refreshQueued && !stopped) {
          refreshQueued = false
          void refresh()
        }
      })
    return refreshInFlight
  }

  const channel = resolved
    .channel(`wallet_balances:${userId}`)
    .on(
      'postgres_changes',
      {
        event: '*',
        schema: 'public',
        table: 'wallet_balances',
        filter: `user_id=eq.${userId}`,
      },
      () => { void refresh() },
    )
    .on(
      'postgres_changes',
      {
        event: '*',
        schema: 'public',
        table: 'roll_ticket_balances',
        filter: `user_id=eq.${userId}`,
      },
      () => { void refresh() },
    )
    .subscribe()

  const scheduleNextPoll = () => {
    if (stopped) return
    const delay = WALLET_POLL_BACKOFF_MS[
      Math.min(backoffIndex, WALLET_POLL_BACKOFF_MS.length - 1)
    ]
    backoffIndex += 1
    pollTimer = setTimeout(() => {
      pollTimer = undefined
      void refresh().finally(scheduleNextPoll)
    }, delay)
  }

  function unsubscribe() {
    if (stopped) return
    stopped = true
    if (pollTimer !== undefined) clearTimeout(pollTimer)
    try {
      resolved!.removeChannel(channel)
    } catch {
      // Best-effort teardown must never make sign-out or unmount throw.
    }
  }

  void refresh()
  scheduleNextPoll()
  return unsubscribe
}

function parseSubscription(value: unknown): LunarSubscriptionSnapshot {
  const row = object(value, 'fetch_lunar_subscription')
  const productId = nonEmptyString(row.product_id, 'fetch_lunar_subscription.product_id')
  if (productId !== LUNAR_PASS_PRODUCT_ID) {
    throw new WalletBalancesError(
      'fetch_lunar_subscription',
      'backend returned a subscription for the wrong product',
    )
  }
  return {
    subscriptionId: nonEmptyString(
      row.subscription_id,
      'fetch_lunar_subscription.subscription_id',
    ),
    status: enumValue(
      row.status,
      ['active', 'non_renewing', 'canceled'] as const,
      'fetch_lunar_subscription.status',
    ),
    planId: nullableString(row.plan_id, 'fetch_lunar_subscription.plan_id'),
    productId: LUNAR_PASS_PRODUCT_ID,
    dateNextCharge: nullableString(
      row.date_next_charge,
      'fetch_lunar_subscription.date_next_charge',
    ),
    dateEnd: nullableString(row.date_end, 'fetch_lunar_subscription.date_end'),
  }
}

export async function fetchLunarSubscription(
  client?: SupabaseClient | null,
): Promise<LunarSubscriptionSnapshot | null> {
  const operation = 'fetch_lunar_subscription'
  const resolved = clientFor(operation, client)
  const data = await rows(
    operation,
    resolved
      .from('user_subscriptions')
      .select('subscription_id, status, plan_id, product_id, date_next_charge, date_end')
      .eq('product_id', LUNAR_PASS_PRODUCT_ID),
  )
  const subscriptions = data.map(parseSubscription)
  if (subscriptions.length === 0) return null
  const rank: Record<SubscriptionStatus, number> = {
    active: 0,
    non_renewing: 1,
    canceled: 2,
  }
  return subscriptions.sort((a, b) => rank[a.status] - rank[b.status])[0]
}

export function subscribeLunarSubscription(
  userId: string,
  onChange: () => void,
  client?: SupabaseClient | null,
): () => void {
  const resolved = client === undefined ? getSupabaseClient() : client
  if (!resolved || !userId) return () => {}
  const channel = resolved
    .channel(`lunar_subscription:${userId}`)
    .on(
      'postgres_changes',
      {
        event: '*',
        schema: 'public',
        table: 'user_subscriptions',
        filter: `user_id=eq.${userId}`,
      },
      (payload: {
        eventType?: string
        new?: { product_id?: unknown }
        old?: { product_id?: unknown }
      }) => {
        const productIdentityUnavailable =
          payload.new?.product_id === undefined &&
          payload.old?.product_id === undefined
        if (
          payload.new?.product_id === LUNAR_PASS_PRODUCT_ID ||
          payload.old?.product_id === LUNAR_PASS_PRODUCT_ID ||
          (payload.eventType === 'DELETE' && productIdentityUnavailable)
        ) {
          onChange()
        }
      },
    )
    .subscribe()
  return () => {
    try {
      resolved.removeChannel(channel)
    } catch {
      // Best-effort teardown.
    }
  }
}

export async function convertStarsToStandardRoll(
  count: number,
  client?: SupabaseClient | null,
  idempotencyKey?: string,
): Promise<StarsToStandardRollReceipt> {
  const operation = 'convert_stars_to_standard_roll'
  if (!Number.isSafeInteger(count) || count < 1 || count > 100) {
    throw new WalletConversionError(
      'roll count must be between one and one hundred',
      'invalid_request',
      '22023',
    )
  }
  const resolved = clientFor(operation, client)
  const stableIdempotencyKey =
    idempotencyKey ?? `client:${Date.now()}:${crypto.randomUUID()}`
  if (!stableIdempotencyKey) {
    throw new WalletConversionError(
      'idempotency key must not be empty',
      'invalid_request',
      '22023',
    )
  }
  let data: unknown
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const result = await resolved.rpc(operation, {
        p_roll_count: count,
        p_idempotency_key: stableIdempotencyKey,
      })
      if (result.error) {
        const kind: WalletConversionErrorKind = result.error.code === '22003'
          ? 'insufficient_funds'
          : result.error.code === '22023'
            ? 'invalid_request'
            : 'rpc_failure'
        throw new WalletConversionError(result.error.message, kind, result.error.code)
      }
      data = result.data
      break
    } catch (error) {
      if (error instanceof WalletConversionError) throw error
      // A thrown transport timeout may occur after the RPC committed. Retry
      // once with the same key so server idempotency returns the original truth.
      if (attempt === 0) continue
      throw new WalletConversionError(
        error instanceof Error ? error.message : 'unknown client failure',
        'rpc_failure',
      )
    }
  }
  const singleton = Array.isArray(data)
    ? data.length === 1
      ? data[0]
      : null
    : data
  if (!singleton) {
    throw new WalletConversionError('backend returned an unexpected row count', 'rpc_failure')
  }
  const row = object(singleton, operation)
  try {
    return {
      walletLedgerEntryId: integer(row.wallet_ledger_entry_id, operation),
      rollTicketLedgerEntryId: integer(row.roll_ticket_ledger_entry_id, operation),
      rollCount: integer(row.roll_count, operation),
      starsDebited: integer(row.stars_debited, operation),
      promotionalStarsBalanceAfter: integer(
        row.promotional_stars_balance_after,
        operation,
      ),
      standardRollTicketsCredited: integer(
        row.standard_roll_tickets_credited,
        operation,
      ),
      standardRollQuantityAfter: integer(row.standard_roll_quantity_after, operation),
    }
  } catch (error) {
    throw new WalletConversionError(
      error instanceof Error ? error.message : 'backend returned a malformed receipt',
      'rpc_failure',
    )
  }
}
