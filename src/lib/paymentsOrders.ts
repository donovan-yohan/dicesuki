/**
 * Payment order status model + read/subscribe helpers (Packet C, issue #153).
 *
 * This module is the STATUS-ONLY view of a purchase. It never grants anything:
 * fulfillment truth is the Xsolla webhook writing `payment_orders` server-side
 * (invariant 1). The client only reads its own row (RLS-scoped SELECT) to show
 * the buyer where their purchase is, via an initial fetch, a Supabase Realtime
 * subscription, and a polling fallback (the hook layer wires those together).
 *
 * No Pay Station SDK import lives here — this is the safe, always-loadable half
 * of payments. The SDK-touching buy flow is isolated in `paymentsCheckout.ts`.
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import { getSupabaseClient } from './supabaseClient'

/**
 * Server-side `payment_orders.status` state machine (migration 0013, Packet A):
 * `pending → paid → fulfilled | canceled | refunded`. The client only reads it.
 */
export type PaymentDbStatus =
  | 'pending'
  | 'paid'
  | 'fulfilled'
  | 'refunded'
  | 'canceled'

/**
 * UI-facing status. `paid` (Xsolla took the money) maps to `confirming` because
 * the entitlement is not granted until the `fulfill_payment_order` RPC flips the
 * row to `fulfilled`; the buyer sees "confirming" in that window. `unknown`
 * covers a not-yet-visible row (realtime lag) or an unrecognized value.
 */
export type PaymentUiStatus =
  | 'pending'
  | 'confirming'
  | 'fulfilled'
  | 'refunded'
  | 'canceled'
  | 'unknown'

/** A purchase-in-progress marker persisted before checkout handoff. */
export interface PendingOrder {
  /** Our idempotency key (uuid), minted server-side and sent to Xsolla. */
  externalId: string
  /** ms epoch when the order was created client-side (for relaunch reconcile). */
  createdAt: number
  /** Catalog SKU, retained so a canceled purchase can be retried from the return route. */
  sku?: string
}

const TERMINAL_STATUSES: ReadonlySet<PaymentUiStatus> = new Set([
  'fulfilled',
  'refunded',
  'canceled',
])

/** Terminal states stop polling/subscription — the order will not change again. */
export function isTerminalStatus(status: PaymentUiStatus): boolean {
  return TERMINAL_STATUSES.has(status)
}

/** Project a raw DB status to the UI status. Unknown/absent → `'unknown'`. */
export function mapDbStatusToUi(status: string | null | undefined): PaymentUiStatus {
  switch (status) {
    case 'pending':
      return 'pending'
    case 'paid':
      return 'confirming'
    case 'fulfilled':
      return 'fulfilled'
    case 'refunded':
      return 'refunded'
    case 'canceled':
      return 'canceled'
    default:
      return 'unknown'
  }
}

interface ClientOption {
  /** Injected Supabase client (tests); defaults to the memoized app client. */
  client?: SupabaseClient | null
}

/**
 * Read the buyer's own order status once. Returns `null` when the row is not
 * visible yet, on any error, or when Supabase is unconfigured — callers treat
 * `null` as "keep waiting", never as failure-to-fulfill.
 */
export async function fetchOrderStatus(
  externalId: string,
  options: ClientOption = {},
): Promise<PaymentUiStatus | null> {
  const client = options.client ?? getSupabaseClient()
  if (!client || !externalId) return null
  try {
    const { data, error } = await client
      .from('payment_orders')
      .select('status')
      .eq('external_id', externalId)
      .maybeSingle()
    if (error || !data) return null
    return mapDbStatusToUi((data as { status?: string | null }).status)
  } catch {
    return null
  }
}

/**
 * Subscribe to the buyer's own order row via Supabase Realtime
 * (`postgres_changes`). Invokes `onStatus` with the mapped UI status on every
 * insert/update. Returns an unsubscribe function; a no-op when unconfigured.
 *
 * This is a best-effort push channel — the hook layer ALWAYS pairs it with a
 * polling fallback so a dropped socket never strands the buyer on "pending".
 */
export function subscribeOrderStatus(
  externalId: string,
  onStatus: (status: PaymentUiStatus) => void,
  options: ClientOption = {},
): () => void {
  const client = options.client ?? getSupabaseClient()
  if (!client || !externalId) return () => {}

  const channel = client
    .channel(`payment_order:${externalId}`)
    .on(
      'postgres_changes',
      {
        event: '*',
        schema: 'public',
        table: 'payment_orders',
        filter: `external_id=eq.${externalId}`,
      },
      (payload: { new?: { status?: string | null } | null }) => {
        onStatus(mapDbStatusToUi(payload?.new?.status))
      },
    )
    .subscribe()

  return () => {
    try {
      client.removeChannel(channel)
    } catch {
      // Best-effort teardown; a failed removeChannel must never throw on unmount.
    }
  }
}
