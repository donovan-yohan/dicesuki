// Xsolla webhook dispatch — the routing + fulfillment decisions, expressed as a
// PURE function over an already-parsed notification plus injected dependencies.
//
// Keeping this pure (no Deno globals, no network, no DB client) is what makes
// the invariants testable: signature verification (index), DB writes (deps), and
// dispatch logic (here) are separable. The DB idempotency gate lives inside
// `deps.fulfillOrder` / `deps.reverseOrder` (the SECURITY DEFINER RPC), so this
// layer is replay-safe by construction — it just decides WHICH dep to call.
//
// Pure module: importable by both the Deno runtime and Vitest.

export interface WebhookResult {
  status: number
  body: unknown
}

/**
 * Outcome of a fulfillment/reversal RPC call.
 *
 * The `create_payment_order` / `fulfill_payment_order` / `refund_payment_order`
 * boundaries each `returns public.payment_orders`, i.e. the order ROW — there is
 * no `{ ok, replay }` envelope. A returned row means the event was accepted:
 * either a fresh grant/reversal or an idempotent replay (both re-return the row,
 * indistinguishable by design, which is fine — Xsolla only needs a 2xx). `ok` is
 * therefore `true` whenever a row came back. `acked` is set only when the RPC
 * RAISED a deliberate-no-grant SQLSTATE that we 200-ack instead of retrying.
 */
export interface OrderRpcResult {
  /** True when the RPC returned an order row (grant/reversal or idempotent replay). */
  ok: boolean
  /** `status` column of the returned order row, when a row came back. */
  status?: string
  /** True when a deliberate-no-grant SQLSTATE was 200-acked (never retried). */
  acked?: boolean
}

/**
 * Postgres SQLSTATE the paid-checkout RPCs raise for an event that is
 * DELIBERATELY rejected and will never succeed on retry — `invalid_parameter_value`
 * (`22023`), which `fulfill_payment_order` / `refund_payment_order` raise for a
 * sandbox/production `dry_run` mismatch (and every other deterministic parameter
 * rejection). These are permanent, not transient, so the webhook 200-acks them
 * (with an audit log) to stop Xsolla's ~20-retry storm on a doomed event. Every
 * other SQLSTATE is treated as retryable and surfaces as 5xx.
 */
export const RPC_DELIBERATE_NO_GRANT_SQLSTATE = '22023'

/** True iff a Postgres error code marks a deliberate, non-retryable no-grant. */
export function isDeliberateNoGrantError(code: unknown): boolean {
  return code === RPC_DELIBERATE_NO_GRANT_SQLSTATE
}

export interface FulfillArgs {
  xsollaTransactionId: number
  externalId: string | null
  dryRun: boolean
  eventType: string
  rawEvent: unknown
}

export interface WebhookDeps {
  /** True iff a Supabase auth user with this id exists. */
  userExists(userId: string): Promise<boolean>
  /** Grant entitlement for a paid order (idempotent RPC). */
  fulfillOrder(args: FulfillArgs): Promise<OrderRpcResult>
  /** Reverse entitlement for a refunded order (idempotent RPC). */
  reverseOrder(args: FulfillArgs): Promise<OrderRpcResult>
}

/** Xsolla webhook types that grant an entitlement. Everything else is acked (200). */
const FULFILL_TYPES = new Set(['payment', 'order_paid'])

/**
 * Xsolla webhook types that reverse an entitlement. Both route to the single
 * `refund_payment_order` boundary, whose `p_event_type` check accepts exactly
 * these two values.
 */
const REVERSAL_TYPES = new Set(['refund', 'chargeback'])

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' ? (value as Record<string, unknown>) : {}
}

/** 200-ack body echoing the RPC outcome. Xsolla ignores the body on a 2xx. */
function ackBody(result: OrderRpcResult): Record<string, unknown> {
  const body: Record<string, unknown> = { ok: result.ok }
  if (typeof result.status === 'string') body.status = result.status
  if (result.acked) body.acked = true
  return body
}

/** Coerce an Xsolla id (number or numeric string) to a finite number, else null. */
export function coerceTransactionId(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string' && value.trim() !== '') {
    const n = Number(value)
    if (Number.isFinite(n)) return n
  }
  return null
}

/** The Xsolla transaction/order id lives under `transaction.id` or `order.id`. */
export function extractTransactionId(notification: Record<string, unknown>): number | null {
  const tx = asRecord(notification.transaction)
  const order = asRecord(notification.order)
  return coerceTransactionId(tx.id) ?? coerceTransactionId(order.id)
}

/**
 * Our `external_id` is echoed back from `settings.external_id`. Xsolla surfaces
 * it under `transaction.external_id` (payment/refund) or `order.external_id`
 * (order_paid); some flows only carry it in `custom_parameters`.
 */
export function extractExternalId(notification: Record<string, unknown>): string | null {
  const tx = asRecord(notification.transaction)
  const order = asRecord(notification.order)
  const custom = asRecord(notification.custom_parameters)
  const candidate = tx.external_id ?? order.external_id ?? custom.external_id
  return typeof candidate === 'string' && candidate.length > 0 ? candidate : null
}

/** Sandbox transactions carry `transaction.dry_run == 1` (or mode 'sandbox'). */
export function extractDryRun(notification: Record<string, unknown>): boolean {
  const tx = asRecord(notification.transaction)
  const order = asRecord(notification.order)
  if (tx.dry_run === 1 || tx.dry_run === true) return true
  if (order.dry_run === 1 || order.dry_run === true) return true
  if (typeof order.mode === 'string' && order.mode.toLowerCase() === 'sandbox') return true
  return false
}

/** The user id Xsolla validates is the `user.id.value` we minted the token with. */
export function extractUserId(notification: Record<string, unknown>): string | null {
  const user = asRecord(notification.user)
  // Xsolla sends the flat string it was given: user.id === "<supabase uuid>".
  if (typeof user.id === 'string' && user.id.length > 0) return user.id
  // Defensive: some payloads nest it as user.id.value.
  const nested = asRecord(user.id)
  if (typeof nested.value === 'string' && nested.value.length > 0) return nested.value
  return null
}

/**
 * Route a verified (signature already checked) Xsolla notification to the right
 * dependency and map the outcome to an HTTP result. Returns 2xx on handled
 * events; 400 only for `user_validation` failures (which Xsolla requires) and
 * malformed fulfillment payloads.
 */
export async function dispatchWebhook(
  notification: unknown,
  deps: WebhookDeps,
): Promise<WebhookResult> {
  const record = asRecord(notification)
  const type = typeof record.notification_type === 'string' ? record.notification_type : ''

  if (type === 'user_validation') {
    const userId = extractUserId(record)
    if (userId && (await deps.userExists(userId))) {
      // Xsolla accepts any 2xx with no body as "user is valid".
      return { status: 200, body: null }
    }
    return {
      status: 400,
      body: { error: { code: 'INVALID_USER', message: 'User not found' } },
    }
  }

  if (FULFILL_TYPES.has(type)) {
    const xsollaTransactionId = extractTransactionId(record)
    if (xsollaTransactionId === null) {
      return {
        status: 400,
        body: { error: { code: 'INVALID_PARAMETER', message: 'Missing transaction id' } },
      }
    }
    const result = await deps.fulfillOrder({
      xsollaTransactionId,
      externalId: extractExternalId(record),
      dryRun: extractDryRun(record),
      eventType: type,
      rawEvent: record,
    })
    // A returned order row (fresh grant OR idempotent replay) is a 200; a
    // deliberate-no-grant SQLSTATE is 200-acked by the dep; every other RPC
    // failure throws before we get here → 5xx → Xsolla retries (invariant #2).
    return { status: 200, body: ackBody(result) }
  }

  if (REVERSAL_TYPES.has(type)) {
    const xsollaTransactionId = extractTransactionId(record)
    if (xsollaTransactionId === null) {
      return {
        status: 400,
        body: { error: { code: 'INVALID_PARAMETER', message: 'Missing transaction id' } },
      }
    }
    // refund_payment_order locates the order by transaction id (no external_id
    // param) and accepts event_type 'refund' | 'chargeback'.
    const result = await deps.reverseOrder({
      xsollaTransactionId,
      externalId: extractExternalId(record),
      dryRun: extractDryRun(record),
      eventType: type,
      rawEvent: record,
    })
    return { status: 200, body: ackBody(result) }
  }

  // Unknown notification types are acknowledged so Xsolla stops retrying.
  return { status: 200, body: { ok: true, ignored: type || 'unknown' } }
}
