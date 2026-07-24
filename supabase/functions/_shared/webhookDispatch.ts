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
  /** Internal observability marker; HTTP 204 responses still have no body. */
  drainedInvalid?: boolean
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

export interface SubscriptionEventArgs {
  userId: string
  subscriptionId: string
  eventType: string
  planId: string | null
  productId: string | null
  dateCreate: string | null
  dateNextCharge: string | null
  dateEnd: string | null
  rawPayload: Record<string, unknown>
  bodySha256: string
}

export interface SubscriptionRpcResult {
  /** True when a deterministic RPC rejection was deliberately drained. */
  drainedInvalid: boolean
}

export interface WebhookDeps {
  /** True iff a Supabase auth user with this id exists. */
  userExists(userId: string): Promise<boolean>
  /** Grant entitlement for a paid order (idempotent RPC). */
  fulfillOrder(args: FulfillArgs): Promise<OrderRpcResult>
  /** Reverse entitlement for a refunded order (idempotent RPC). */
  reverseOrder(args: FulfillArgs): Promise<OrderRpcResult>
  /** Append and project an idempotent Xsolla subscription event. */
  recordSubscriptionEvent(args: SubscriptionEventArgs): Promise<SubscriptionRpcResult>
}

/** Xsolla webhook types that grant an entitlement. Everything else is acked (200). */
const FULFILL_TYPES = new Set(['payment', 'order_paid'])

/**
 * Xsolla webhook types that reverse an entitlement. Both route to the single
 * `refund_payment_order` boundary, whose `p_event_type` check accepts exactly
 * these two values.
 */
const REVERSAL_TYPES = new Set(['refund', 'chargeback'])

/** The four subscription lifecycle notifications documented by Xsolla. */
const SUBSCRIPTION_TYPES = new Set([
  'create_subscription',
  'update_subscription',
  'non_renewal_subscription',
  'cancel_subscription',
])

/** Mirrors migration 0023's `octet_length(p_raw_payload::text) <= 65536`. */
export const SUBSCRIPTION_RAW_PAYLOAD_MAX_BYTES = 65_536

/**
 * SQLSTATE class 22 (data exception) is deterministic by definition — the same
 * bytes yield the same rejection on every retry, and Xsolla's sequential
 * delivery would otherwise stall the whole subscription queue behind one
 * doomed event. Draining the entire class (not an allowlist of members) also
 * covers e.g. 22009 invalid_time_zone_displacement_value, which a JS-valid but
 * Postgres-out-of-range offset could raise past the TS gate.
 */
const SUBSCRIPTION_DETERMINISTIC_REJECTION_SQLSTATE_CLASS = '22'

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
 * Xsolla documents subscription_id as both an integer and a string. Preserve a
 * string verbatim and stringify only finite numbers; reject every other shape.
 */
export function coerceSubscriptionId(value: unknown): string | null {
  const id =
    typeof value === 'string'
      ? value
      : typeof value === 'number' && Number.isFinite(value)
        ? String(value)
        : null
  return id !== null && id.length >= 1 && id.length <= 255 ? id : null
}

/** Optional Xsolla text identifiers use the same bounded scalar representation. */
function coerceOptionalId(value: unknown): string | null {
  if (value === null || value === undefined) return null
  return coerceSubscriptionId(value)
}

/**
 * Return a valid RFC 3339 timestamp, or null for absent/invalid values.
 *
 * `Date.parse` alone normalizes impossible calendar dates (for example,
 * 2026-02-30) instead of rejecting them. Round-trip the source calendar fields
 * independently of their UTC offset so the gate agrees with timestamptz casts.
 */
function coerceDate(value: unknown): string | null {
  if (typeof value !== 'string' || value.length === 0) return null
  const match =
    /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,6}))?(Z|[+-]\d{2}:\d{2})$/.exec(
      value,
    )
  if (!match) return null

  const [, year, month, day, hour, minute, second, fraction = '', zone] = match
  const millisecond = fraction.padEnd(3, '0').slice(0, 3)
  const calendarSource =
    `${year}-${month}-${day}T${hour}:${minute}:${second}.${millisecond}Z`
  const calendarDate = new Date(calendarSource)
  if (
    Number.isNaN(calendarDate.getTime()) ||
    calendarDate.toISOString() !== calendarSource
  ) {
    return null
  }

  // The independent calendar round-trip catches rollover; parsing the original
  // value additionally validates its supplied offset.
  const parsed = new Date(
    `${year}-${month}-${day}T${hour}:${minute}:${second}` +
      `${fraction ? `.${fraction}` : ''}${zone}`,
  )
  return Number.isNaN(parsed.getTime()) ? null : value
}

function invalidParameter(message: string): WebhookResult {
  return {
    status: 400,
    body: { error: { code: 'INVALID_PARAMETER', message } },
  }
}

/** True iff retrying the same subscription RPC input can never succeed. */
export function isDeterministicSubscriptionRejectionError(code: unknown): boolean {
  return (
    typeof code === 'string' &&
    code.length === 5 &&
    code.startsWith(SUBSCRIPTION_DETERMINISTIC_REJECTION_SQLSTATE_CLASS)
  )
}

interface SubscriptionRpcError {
  code?: unknown
  message?: unknown
}

interface SubscriptionRpcResponse {
  error: unknown
}

type SubscriptionRpcCall = (
  fn: 'record_subscription_event',
  params: Record<string, unknown>,
) => Promise<SubscriptionRpcResponse>

type DrainedInvalidLogger = (
  message: string,
  context: Record<string, unknown>,
) => void

/**
 * Build the subscription receipt dependency around an injected RPC call.
 *
 * Xsolla delivers subscription notifications sequentially. A deterministically
 * doomed event must therefore drain with a loud audit marker; throwing it would
 * retry forever and block every later lifecycle event. All other failures keep
 * throwing so the HTTP boundary returns 500 and Xsolla retries.
 */
export function createRecordSubscriptionEventDep(
  callRpc: SubscriptionRpcCall,
  logDrainedInvalid: DrainedInvalidLogger,
): WebhookDeps['recordSubscriptionEvent'] {
  return async (args: SubscriptionEventArgs): Promise<SubscriptionRpcResult> => {
    const { error } = await callRpc('record_subscription_event', {
      p_user_id: args.userId,
      p_subscription_id: args.subscriptionId,
      p_notification_type: args.eventType,
      p_plan_id: args.planId,
      p_product_id: args.productId,
      p_date_create: args.dateCreate,
      p_date_next_charge: args.dateNextCharge,
      p_date_end: args.dateEnd,
      p_raw_payload: args.rawPayload,
      p_body_sha256: args.bodySha256,
    })
    if (!error) return { drainedInvalid: false }

    const rpcError = error as SubscriptionRpcError
    const code = typeof rpcError.code === 'string' ? rpcError.code : 'unknown'
    const message =
      typeof rpcError.message === 'string' ? rpcError.message : 'Unknown RPC error'
    if (isDeterministicSubscriptionRejectionError(code)) {
      logDrainedInvalid(
        'xsolla-webhook subscription drained-invalid (204 ack, no retry)',
        {
          outcome: 'drained-invalid',
          code,
          message,
          eventType: args.eventType,
          subscriptionId: args.subscriptionId,
          userId: args.userId,
        },
      )
      return { drainedInvalid: true }
    }

    throw new Error(`record_subscription_event failed [${code}]: ${message}`)
  }
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
  bodySha256: string,
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

  if (SUBSCRIPTION_TYPES.has(type)) {
    const serializedPayload = JSON.stringify(record)
    const serializedPayloadBytes = new TextEncoder().encode(serializedPayload).byteLength
    if (serializedPayloadBytes > SUBSCRIPTION_RAW_PAYLOAD_MAX_BYTES) {
      return invalidParameter('Subscription payload exceeds 65536 UTF-8 bytes')
    }

    const subscription = asRecord(record.subscription)
    const subscriptionId = coerceSubscriptionId(subscription.subscription_id)
    if (subscriptionId === null) {
      return invalidParameter('Missing or invalid subscription_id')
    }

    const planId = coerceOptionalId(subscription.plan_id)
    const productId = coerceOptionalId(subscription.product_id)
    if (
      (subscription.plan_id !== null &&
        subscription.plan_id !== undefined &&
        planId === null) ||
      (subscription.product_id !== null &&
        subscription.product_id !== undefined &&
        productId === null)
    ) {
      return invalidParameter('Invalid subscription identifier field')
    }

    // Xsolla includes date_create in canonical non-renewal/cancel envelopes,
    // while migration 0023 deliberately stores NULL for those event types.
    // Keep the vendor field in rawPayload, but do not forward it as parsed state.
    const ignoresDateCreate =
      type === 'non_renewal_subscription' || type === 'cancel_subscription'
    const parsedDateCreate = coerceDate(subscription.date_create)
    const dateCreate = ignoresDateCreate ? null : parsedDateCreate
    const dateNextCharge = coerceDate(subscription.date_next_charge)
    const dateEnd = coerceDate(subscription.date_end)
    const hasSuppliedDateCreate =
      subscription.date_create !== null && subscription.date_create !== undefined
    const hasDateCreate =
      !ignoresDateCreate && hasSuppliedDateCreate
    const hasDateNextCharge =
      subscription.date_next_charge !== null && subscription.date_next_charge !== undefined
    const hasDateEnd = subscription.date_end !== null && subscription.date_end !== undefined

    const invalidDates =
      (hasSuppliedDateCreate && parsedDateCreate === null) ||
      (hasDateNextCharge && dateNextCharge === null) ||
      (hasDateEnd && dateEnd === null)
    if (invalidDates) {
      return invalidParameter('Invalid subscription date field')
    }

    if (
      type === 'create_subscription' &&
      (planId === null ||
        dateCreate === null ||
        dateNextCharge === null ||
        hasDateEnd)
    ) {
      return invalidParameter(
        'create_subscription requires plan_id, date_create, and date_next_charge, and forbids date_end',
      )
    }
    if (
      type === 'update_subscription' &&
      (planId === null || hasDateCreate || dateNextCharge === null || hasDateEnd)
    ) {
      return invalidParameter(
        'update_subscription requires plan_id and date_next_charge, and forbids date_create and date_end',
      )
    }
    if (
      type === 'non_renewal_subscription' &&
      (dateNextCharge === null || hasDateEnd)
    ) {
      return invalidParameter(
        'non_renewal_subscription requires date_next_charge and forbids date_end',
      )
    }
    if (
      type === 'cancel_subscription' &&
      (hasDateNextCharge || dateEnd === null)
    ) {
      return invalidParameter(
        'cancel_subscription requires date_end and forbids date_next_charge',
      )
    }

    const userId = extractUserId(record)
    if (!userId || !(await deps.userExists(userId))) {
      return {
        status: 400,
        body: { error: { code: 'INVALID_USER', message: 'User not found' } },
      }
    }

    const result = await deps.recordSubscriptionEvent({
      userId,
      subscriptionId,
      eventType: type,
      planId,
      productId,
      dateCreate,
      dateNextCharge,
      dateEnd,
      rawPayload: record,
      bodySha256,
    })
    // A deterministic rejection is deliberately drained by the dependency so
    // sequential delivery can advance. Transient failures still throw through
    // this seam and become retryable 500s at the HTTP boundary.
    return result.drainedInvalid
      ? { status: 204, body: null, drainedInvalid: true }
      : { status: 204, body: null }
  }

  // Unknown notification types are acknowledged so Xsolla stops retrying.
  return { status: 200, body: { ok: true, ignored: type || 'unknown' } }
}

function webhookResponse(body: unknown, status: number): Response {
  return new Response(body === null ? null : JSON.stringify(body), {
    status,
    headers: body === null ? {} : { 'Content-Type': 'application/json' },
  })
}

/**
 * Testable Web-standard HTTP boundary for verified, parsed notifications.
 * Dispatch remains independently testable and lets dependency failures throw;
 * this seam converts them to the retryable 500 used by the Edge entrypoint.
 */
export async function dispatchWebhookResponse(
  notification: unknown,
  deps: WebhookDeps,
  bodySha256: string,
  onError: (error: unknown) => void,
): Promise<Response> {
  try {
    const result = await dispatchWebhook(notification, deps, bodySha256)
    return webhookResponse(result.body, result.status)
  } catch (error) {
    onError(error)
    return webhookResponse(
      { error: { code: 'INTERNAL_ERROR', message: 'Processing failed, retry expected' } },
      500,
    )
  }
}
