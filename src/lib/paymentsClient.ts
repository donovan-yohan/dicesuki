/**
 * Buy-flow client (Packet C, issue #153).
 *
 * Orchestrates a sandbox purchase:
 *   1. Ask the `create-checkout` Supabase edge function for a Pay Station token
 *      and our `external_id` (the function does server-side price/SKU lookup and
 *      inserts the `pending` `payment_orders` row — the client never sends a
 *      price, invariant 5).
 *   2. Persist the pending order to localStorage (via the payments store) BEFORE
 *      opening checkout, so a redirect/relaunch mid-payment can be reconciled.
 *   3. Hand the token to the headless SDK (dynamic import — the only place the
 *      SDK is loaded).
 *
 * The whole entry point no-ops unless {@link isPaymentsEnabled}. Fulfillment is
 * NEVER inferred here — that is the webhook's job server-side (invariant 1).
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import { getSupabaseClient } from './supabaseClient'
import { isPaymentsEnabled, isPaymentsSandbox } from './paymentsConfig'
import { openHeadlessCheckout } from './paymentsCheckout'
import { usePaymentsStore } from '../store/usePaymentsStore'

/** Reasons a purchase could not even start (distinct from a payment failure). */
export type StartPurchaseReason =
  | 'disabled'
  | 'unconfigured'
  | 'checkout-failed'
  | 'sdk-failed'

export type StartPurchaseResult =
  | { ok: true; externalId: string }
  | { ok: false; reason: StartPurchaseReason; message: string }

export interface CreateCheckoutResult {
  /** Xsolla Pay Station access token. */
  token: string
  /** Our order idempotency key (uuid), echoed to reconcile later. */
  externalId: string
}

export interface StartPurchaseOptions {
  /** Injected Supabase client (tests); defaults to the memoized app client. */
  client?: SupabaseClient | null
  /** Injected checkout opener (tests); defaults to the real SDK boundary. */
  openCheckout?: typeof openHeadlessCheckout
}

interface EdgeInvokeResponse {
  token?: unknown
  external_id?: unknown
}

/**
 * Call the `create-checkout` edge function. Returns the token + external_id, or
 * throws with a machine-readable reason. Does not touch the store or the SDK.
 */
export async function createCheckoutSession(
  sku: string,
  options: { client?: SupabaseClient | null } = {},
): Promise<CreateCheckoutResult> {
  const client = options.client ?? getSupabaseClient()
  if (!client) {
    throw new PurchaseError('unconfigured', 'Supabase is not configured.')
  }

  const { data, error } = await client.functions.invoke('create-checkout', {
    body: { sku },
  })
  if (error) {
    throw new PurchaseError('checkout-failed', error.message ?? 'create-checkout failed.')
  }

  const response = (data ?? {}) as EdgeInvokeResponse
  const token = typeof response.token === 'string' ? response.token : ''
  const externalId =
    typeof response.external_id === 'string' ? response.external_id : ''
  if (!token || !externalId) {
    throw new PurchaseError('checkout-failed', 'create-checkout returned no token.')
  }
  return { token, externalId }
}

/**
 * Full buy flow: create the checkout session, persist the pending order, then
 * open the headless checkout. Persistence happens synchronously (localStorage)
 * BEFORE the async SDK handoff, so the order is durable the instant checkout
 * opens.
 */
export async function startPurchase(
  sku: string,
  options: StartPurchaseOptions = {},
): Promise<StartPurchaseResult> {
  if (!isPaymentsEnabled()) {
    return { ok: false, reason: 'disabled', message: 'Payments are disabled.' }
  }

  const store = usePaymentsStore.getState()
  let session: CreateCheckoutResult
  try {
    session = await createCheckoutSession(sku, { client: options.client })
  } catch (caught) {
    const err = asPurchaseError(caught, 'checkout-failed')
    store.setError(err.message)
    return { ok: false, reason: err.reason, message: err.message }
  }

  // Persist BEFORE handoff (invariant: reconcile-able on relaunch). This write
  // is synchronous localStorage, so it lands before the SDK is even imported.
  // The SKU rides along so a canceled purchase can be retried from the return route.
  store.beginPending({ externalId: session.externalId, createdAt: Date.now(), sku })

  const openCheckout = options.openCheckout ?? openHeadlessCheckout
  try {
    await openCheckout({ token: session.token, sandbox: isPaymentsSandbox() })
  } catch (caught) {
    const err = asPurchaseError(caught, 'sdk-failed')
    // Leave the pending order intact — the payment may still complete in a
    // popup/redirect; the return route reconciles from the persisted marker.
    store.setError(err.message)
    return { ok: false, reason: 'sdk-failed', message: err.message }
  }

  return { ok: true, externalId: session.externalId }
}

/** A typed buy-flow error carrying a machine-readable reason. */
export class PurchaseError extends Error {
  reason: StartPurchaseReason
  constructor(reason: StartPurchaseReason, message: string) {
    super(message)
    this.name = 'PurchaseError'
    this.reason = reason
  }
}

function asPurchaseError(
  caught: unknown,
  fallbackReason: StartPurchaseReason,
): PurchaseError {
  if (caught instanceof PurchaseError) return caught
  const message = caught instanceof Error ? caught.message : String(caught)
  return new PurchaseError(fallbackReason, message)
}
