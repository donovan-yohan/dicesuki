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

/** Outcome of a fulfillment/reversal RPC call. `replay` marks a no-op replay. */
export interface OrderRpcResult {
  ok: boolean
  replay?: boolean
  [key: string]: unknown
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

/** Xsolla webhook types we act on. Everything else is acked (200). */
const FULFILL_TYPES = new Set(['payment', 'order_paid'])

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' ? (value as Record<string, unknown>) : {}
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
    // Success AND idempotent replay both return 200 — never re-granting on
    // replay is the RPC's job (invariant #2).
    return { status: 200, body: { ok: result.ok, replay: result.replay ?? false } }
  }

  if (type === 'refund') {
    const xsollaTransactionId = extractTransactionId(record)
    if (xsollaTransactionId === null) {
      return {
        status: 400,
        body: { error: { code: 'INVALID_PARAMETER', message: 'Missing transaction id' } },
      }
    }
    const result = await deps.reverseOrder({
      xsollaTransactionId,
      externalId: extractExternalId(record),
      dryRun: extractDryRun(record),
      eventType: type,
      rawEvent: record,
    })
    return { status: 200, body: { ok: result.ok, replay: result.replay ?? false } }
  }

  // Unknown notification types are acknowledged so Xsolla stops retrying.
  return { status: 200, body: { ok: true, ignored: type || 'unknown' } }
}
