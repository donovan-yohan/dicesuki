// Edge Function: xsolla-webhook (PUBLIC — server-to-server)
//
// Flow (exec plan Packet B.2 + non-negotiable invariants):
//   1. Read the RAW request body bytes (never re-serialized JSON).
//   2. Verify `Authorization: Signature <sha1(raw_body + secret)>`; 400 on
//      mismatch (invariant #3 — forged webhook fails closed).
//   3. Dispatch by notification_type:
//        - user_validation → 200 if the Supabase user exists, else 400
//        - payment / order_paid → fulfill_payment_order (idempotent grant)
//        - refund / chargeback → refund_payment_order (idempotent reversal)
//        - subscription lifecycle → record_subscription_event (204)
//        - unknown → 200 ack
//   4. Respond fast. 5xx makes Xsolla retry (~20 times / 12h); the DB
//      idempotency gate inside the RPC makes replays safe (invariants #1, #2).
//
// MUST be deployed public:
//   supabase functions deploy xsolla-webhook --project-ref nksxdfcjabgbxeefwkdc --no-verify-jwt
//
// ---------------------------------------------------------------------------
// RPC CONTRACT (migration 0013 / feat/xsolla-paid-checkout-schema owns it).
// Both boundaries are SECURITY DEFINER, service-role EXECUTE only, and each
// `returns public.payment_orders` — the order ROW, NOT a { ok, replay } jsonb.
//
//   fulfill_payment_order(
//     p_external_id            uuid,     -- locates the pending order (required)
//     p_xsolla_transaction_id  bigint,   -- Xsolla transaction id (idempotency)
//     p_event_type             text,     -- 'payment' | 'order_paid'
//     p_dry_run                boolean,  -- sandbox transaction flag
//     p_raw_event              jsonb     -- bounded raw notification
//   ) returns public.payment_orders
//
//   refund_payment_order(               -- NO p_external_id: found by tx id
//     p_xsolla_transaction_id  bigint,   -- locates the fulfilled order
//     p_event_type             text,     -- 'refund' | 'chargeback'
//     p_dry_run                boolean,
//     p_raw_event              jsonb
//   ) returns public.payment_orders
//
// The (xsolla_transaction_id, event_type) payment_events row is the idempotency
// lock: an exact replay (or out-of-order type on an already-advanced order)
// re-returns the prior order row and never re-grants/re-revokes. On any hard
// failure the RPC RAISEs — we let that become a 5xx so Xsolla retries — EXCEPT a
// deliberate-no-grant SQLSTATE (invalid_parameter_value, e.g. a sandbox/production
// dry_run mismatch), which we 200-ack + audit-log so Xsolla stops retrying a
// permanently-rejected event (invariants #1, #2, #4).
// ---------------------------------------------------------------------------

import { createServiceRoleClient } from '../_shared/supabaseClient.ts'
import { verifyXsollaSignature } from '../_shared/xsollaSignature.ts'
import {
  createRecordSubscriptionEventDep,
  dispatchWebhookResponse,
  isDeliberateNoGrantError,
  type FulfillArgs,
  type OrderRpcResult,
  type WebhookDeps,
} from '../_shared/webhookDispatch.ts'
import type { SupabaseClient } from 'npm:@supabase/supabase-js@2'

function jsonResponse(body: unknown, status: number): Response {
  return new Response(body === null ? null : JSON.stringify(body), {
    status,
    headers: body === null ? {} : { 'Content-Type': 'application/json' },
  })
}

/**
 * Normalize the RPC return into an OrderRpcResult. Each boundary
 * `returns public.payment_orders`, so PostgREST hands back the order ROW as an
 * object (array-wrapped for a SETOF-shaped return). A returned row means the
 * event was accepted — a fresh grant/reversal or an idempotent replay, which are
 * indistinguishable and both a clean 200.
 */
function normalizeRpcResult(data: unknown): OrderRpcResult {
  const row = Array.isArray(data) ? data[0] : data
  if (row && typeof row === 'object') {
    const status = (row as Record<string, unknown>).status
    return { ok: true, status: typeof status === 'string' ? status : undefined }
  }
  return { ok: true }
}

async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', bytes)
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('')
}

/** Shape of a Supabase RPC error we branch on (subset of PostgrestError). */
interface RpcError {
  code?: string
  message: string
}

function buildDeps(service: SupabaseClient): WebhookDeps {
  const callOrderRpc = async (
    fn: 'fulfill_payment_order' | 'refund_payment_order',
    params: Record<string, unknown>,
    args: FulfillArgs,
  ): Promise<OrderRpcResult> => {
    const { data, error } = await service.rpc(fn, params)
    if (error) {
      const rpcError = error as RpcError
      if (isDeliberateNoGrantError(rpcError.code)) {
        // Deliberate no-grant (e.g. sandbox/production dry_run mismatch): this
        // event can NEVER succeed on retry. 200-ack so Xsolla stops its retry
        // storm; audit-log so the permanently-rejected event stays observable.
        console.warn('xsolla-webhook deliberate no-grant (200-ack, no retry)', {
          fn,
          code: rpcError.code,
          message: rpcError.message,
          eventType: args.eventType,
          xsollaTransactionId: args.xsollaTransactionId,
          externalId: args.externalId,
        })
        return { ok: false, acked: true }
      }
      // Any other failure → throw → 500 → Xsolla retries. The idempotency gate
      // (unique payment_events key) keeps those retries safe.
      throw new Error(`${fn} failed [${rpcError.code ?? 'unknown'}]: ${rpcError.message}`)
    }
    return normalizeRpcResult(data)
  }

  return {
    async userExists(userId: string): Promise<boolean> {
      const { data, error } = await service.auth.admin.getUserById(userId)
      if (error) return false
      return Boolean(data?.user)
    },
    fulfillOrder: (args: FulfillArgs) =>
      callOrderRpc(
        'fulfill_payment_order',
        {
          p_external_id: args.externalId,
          p_xsolla_transaction_id: args.xsollaTransactionId,
          p_event_type: args.eventType,
          p_dry_run: args.dryRun,
          p_raw_event: args.rawEvent,
        },
        args,
      ),
    // Refunds/chargebacks go through the dedicated reversal boundary, which
    // locates the fulfilled order by transaction id (NO external_id param) and
    // accepts event_type 'refund' | 'chargeback'.
    reverseOrder: (args: FulfillArgs) =>
      callOrderRpc(
        'refund_payment_order',
        {
          p_xsolla_transaction_id: args.xsollaTransactionId,
          p_event_type: args.eventType,
          p_dry_run: args.dryRun,
          p_raw_event: args.rawEvent,
        },
        args,
      ),
    recordSubscriptionEvent: createRecordSubscriptionEventDep(
      async (fn, params) => {
        const { error } = await service.rpc(fn, params)
        return { error }
      },
      (message, context) => console.error(message, context),
    ),
  }
}

Deno.serve(async (req: Request): Promise<Response> => {
  if (req.method !== 'POST') {
    return jsonResponse({ error: { code: 'METHOD_NOT_ALLOWED', message: 'Use POST' } }, 405)
  }

  // 1. RAW body bytes — the exact bytes Xsolla signed. Do NOT re-serialize.
  const rawBody = new Uint8Array(await req.arrayBuffer())

  // 2. Signature check (fail closed).
  const secret = Deno.env.get('XSOLLA_WEBHOOK_SECRET') ?? ''
  const authHeader = req.headers.get('Authorization')
  const signatureValid = await verifyXsollaSignature(rawBody, secret, authHeader)
  if (!signatureValid) {
    return jsonResponse(
      { error: { code: 'INVALID_SIGNATURE', message: 'Signature verification failed' } },
      400,
    )
  }

  // Parse the already-verified bytes.
  let notification: unknown
  try {
    notification = JSON.parse(new TextDecoder().decode(rawBody))
  } catch {
    return jsonResponse(
      { error: { code: 'INVALID_REQUEST', message: 'Body is not valid JSON' } },
      400,
    )
  }

  // 3. Dispatch. Exceptions (e.g. RPC failure) → 500 so Xsolla retries.
  try {
    const service = createServiceRoleClient()
    // Compute the receipt hash only here, while the exact signed bytes exist.
    const bodySha256 = await sha256Hex(rawBody)
    return await dispatchWebhookResponse(
      notification,
      buildDeps(service),
      bodySha256,
      (error) => console.error('xsolla-webhook dispatch error', error),
    )
  } catch (err) {
    console.error('xsolla-webhook dispatch error', err)
    return jsonResponse(
      { error: { code: 'INTERNAL_ERROR', message: 'Processing failed, retry expected' } },
      500,
    )
  }
})
