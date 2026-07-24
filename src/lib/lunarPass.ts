import type { SupabaseClient } from '@supabase/supabase-js'
import { getSupabaseClient } from './supabaseClient'

const OPERATION = 'claim_lunar_daily_stars'

/** Monetization spec section 3.1; enforced by migration 0024. */
export const LUNAR_DAILY_STAR_AMOUNT = 90 as const

export type LunarPassClaimErrorKind =
  | 'not_entitled'
  | 'unauthenticated'
  | 'not_configured'
  | 'rpc_failure'

export interface LunarDailyStarsReceipt {
  id: number
  userId: string
  subscriptionId: string
  utcDay: string
  creditedStars: typeof LUNAR_DAILY_STAR_AMOUNT
  walletLedgerEntryId: number
  claimedAt: string
  /**
   * True when this immutable receipt existed before this wrapper invocation.
   * Migration 0024 returns that same row for a same-UTC-day replay.
   */
  alreadyClaimed: boolean
}

export class LunarPassClaimError extends Error {
  readonly operation = OPERATION
  readonly kind: LunarPassClaimErrorKind
  readonly code?: string

  constructor(message: string, kind: LunarPassClaimErrorKind, code?: string) {
    super(`${OPERATION} failed: ${message}`)
    this.name = 'LunarPassClaimError'
    this.kind = kind
    this.code = code
  }
}

type UnknownRecord = Record<string, unknown>

function object(value: unknown): UnknownRecord {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new LunarPassClaimError(
      'backend returned a malformed object',
      'rpc_failure',
    )
  }
  return value as UnknownRecord
}

function nonEmptyString(value: unknown): string {
  if (typeof value !== 'string' || value.length === 0) {
    throw new LunarPassClaimError(
      'backend returned a malformed string',
      'rpc_failure',
    )
  }
  return value
}

function positiveInteger(value: unknown): number {
  if (
    typeof value !== 'number' ||
    !Number.isSafeInteger(value) ||
    value <= 0
  ) {
    throw new LunarPassClaimError(
      'backend returned a malformed positive integer',
      'rpc_failure',
    )
  }
  return value
}

function utcDay(value: unknown): string {
  const day = nonEmptyString(value)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) {
    throw new LunarPassClaimError(
      'backend returned a malformed UTC day',
      'rpc_failure',
    )
  }
  const parsed = new Date(`${day}T00:00:00.000Z`)
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== day) {
    throw new LunarPassClaimError(
      'backend returned a malformed UTC day',
      'rpc_failure',
    )
  }
  return day
}

function timestamp(value: unknown): string {
  const result = nonEmptyString(value)
  if (Number.isNaN(Date.parse(result))) {
    throw new LunarPassClaimError(
      'backend returned a malformed timestamp',
      'rpc_failure',
    )
  }
  return result
}

function singleton(value: unknown): unknown {
  if (!Array.isArray(value)) return value
  if (value.length !== 1) {
    throw new LunarPassClaimError(
      'backend returned an unexpected row count',
      'rpc_failure',
    )
  }
  return value[0]
}

function errorKind(code?: string): LunarPassClaimErrorKind {
  if (code === '55000') return 'not_entitled'
  if (code === '28000' || code === '42501' || code === 'PGRST301') {
    return 'unauthenticated'
  }
  return 'rpc_failure'
}

function backendError(error: { message: string; code?: string }): LunarPassClaimError {
  return new LunarPassClaimError(
    error.message,
    errorKind(error.code),
    error.code,
  )
}

async function latestReceiptId(client: SupabaseClient): Promise<number | null> {
  const result = await client
    .from('lunar_daily_star_claims')
    .select('id')
    .order('utc_day', { ascending: false })
    .limit(1)

  if (result.error) throw backendError(result.error)
  if (!Array.isArray(result.data)) {
    throw new LunarPassClaimError(
      'backend returned a malformed receipt history',
      'rpc_failure',
    )
  }
  if (result.data.length === 0) return null
  if (result.data.length !== 1) {
    throw new LunarPassClaimError(
      'backend returned an unexpected receipt history count',
      'rpc_failure',
    )
  }
  return positiveInteger(object(result.data[0]).id)
}

function parseReceipt(
  value: unknown,
  previousReceiptId: number | null,
): LunarDailyStarsReceipt {
  const row = object(singleton(value))
  const id = positiveInteger(row.id)
  const receiptUtcDay = utcDay(row.utc_day)
  const claimedAt = timestamp(row.claimed_at)
  if (new Date(claimedAt).toISOString().slice(0, 10) !== receiptUtcDay) {
    throw new LunarPassClaimError(
      'backend returned an incoherent claim timestamp',
      'rpc_failure',
    )
  }
  if (row.credited_stars !== LUNAR_DAILY_STAR_AMOUNT) {
    throw new LunarPassClaimError(
      'backend Lunar daily amount does not match the client contract',
      'rpc_failure',
    )
  }

  return {
    id,
    userId: nonEmptyString(row.user_id),
    subscriptionId: nonEmptyString(row.subscription_id),
    utcDay: receiptUtcDay,
    creditedStars: LUNAR_DAILY_STAR_AMOUNT,
    walletLedgerEntryId: positiveInteger(row.wallet_ledger_entry_id),
    claimedAt,
    alreadyClaimed: previousReceiptId === id,
  }
}

/**
 * Claims today's self-only Lunar Pass grant.
 *
 * Migration 0024 deliberately returns the same immutable receipt on replay
 * instead of raising an "already claimed" error. The owner-readable preflight
 * lets the UI distinguish that replay without inventing entitlement or balance
 * state; the RPC remains the only operation that can create a claim.
 */
export async function claimLunarDailyStars(
  client?: SupabaseClient | null,
): Promise<LunarDailyStarsReceipt> {
  const resolved = client === undefined ? getSupabaseClient() : client
  if (!resolved) {
    throw new LunarPassClaimError(
      'Supabase is not configured',
      'not_configured',
    )
  }

  try {
    const previousReceiptId = await latestReceiptId(resolved)
    const result = await resolved.rpc(OPERATION)
    if (result.error) throw backendError(result.error)
    return parseReceipt(result.data, previousReceiptId)
  } catch (error) {
    if (error instanceof LunarPassClaimError) throw error
    throw new LunarPassClaimError(
      error instanceof Error ? error.message : 'unknown client failure',
      'rpc_failure',
    )
  }
}
