// Edge Function: xsolla-webhook (PUBLIC — server-to-server)
//
// Flow (exec plan Packet B.2 + non-negotiable invariants):
//   1. Read the RAW request body bytes (never re-serialized JSON).
//   2. Verify `Authorization: Signature <sha1(raw_body + secret)>`; 400 on
//      mismatch (invariant #3 — forged webhook fails closed).
//   3. Dispatch by notification_type:
//        - user_validation → 200 if the Supabase user exists, else 400
//        - payment / order_paid → fulfill_payment_order (idempotent grant)
//        - refund → fulfill_payment_order with event_type='refund' (reverse)
//        - unknown → 200 ack
//   4. Respond fast. 5xx makes Xsolla retry (~20 times / 12h); the DB
//      idempotency gate inside the RPC makes replays safe (invariants #1, #2).
//
// MUST be deployed public:
//   supabase functions deploy xsolla-webhook --project-ref nksxdfcjabgbxeefwkdc --no-verify-jwt
//
// ---------------------------------------------------------------------------
// RPC CONTRACT expected of migration 0013 (Packet A owns the definition):
//
//   fulfill_payment_order(
//     p_external_id            uuid,     -- our order key (may be null)
//     p_xsolla_transaction_id  bigint,   -- Xsolla transaction id (idempotency)
//     p_event_type             text,     -- 'payment' | 'order_paid' | 'refund'
//     p_dry_run                boolean,  -- sandbox transaction flag
//     p_raw_event              jsonb     -- bounded raw notification
//   ) returns jsonb  -- e.g. { "ok": true, "replay": false, "status": "fulfilled" }
//
// SECURITY DEFINER, service-role only. The (xsolla_transaction_id, event_type)
// payment_events row is the idempotency lock: a replay returns the prior result
// with "replay": true and never re-grants. The 'refund' branch reverses the
// entitlement + marks the ledger row (invariant #4).
// ---------------------------------------------------------------------------

import { createServiceRoleClient } from '../_shared/supabaseClient.ts'
import { verifyXsollaSignature } from '../_shared/xsollaSignature.ts'
import {
  dispatchWebhook,
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

/** Normalize the RPC return (jsonb object, row, or array) into OrderRpcResult. */
function normalizeRpcResult(data: unknown): OrderRpcResult {
  const row = Array.isArray(data) ? data[0] : data
  if (row && typeof row === 'object') {
    const rec = row as Record<string, unknown>
    // Normalized booleans win over raw fields (spread first).
    return {
      ...rec,
      ok: rec.ok !== false,
      replay: rec.replay === true,
    }
  }
  return { ok: true, replay: false }
}

function buildDeps(service: SupabaseClient): WebhookDeps {
  const callFulfill = async (args: FulfillArgs): Promise<OrderRpcResult> => {
    const { data, error } = await service.rpc('fulfill_payment_order', {
      p_external_id: args.externalId,
      p_xsolla_transaction_id: args.xsollaTransactionId,
      p_event_type: args.eventType,
      p_dry_run: args.dryRun,
      p_raw_event: args.rawEvent,
    })
    if (error) {
      // Throw → 500 → Xsolla retries. The idempotency gate keeps retries safe.
      throw new Error(`fulfill_payment_order failed: ${error.message}`)
    }
    return normalizeRpcResult(data)
  }

  return {
    async userExists(userId: string): Promise<boolean> {
      const { data, error } = await service.auth.admin.getUserById(userId)
      if (error) return false
      return Boolean(data?.user)
    },
    fulfillOrder: callFulfill,
    // Refund reuses the same RPC entry point; event_type='refund' selects the
    // reversal branch inside the SECURITY DEFINER function.
    reverseOrder: callFulfill,
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
    const result = await dispatchWebhook(notification, buildDeps(service))
    return jsonResponse(result.body, result.status)
  } catch (err) {
    console.error('xsolla-webhook dispatch error', err)
    return jsonResponse(
      { error: { code: 'INTERNAL_ERROR', message: 'Processing failed, retry expected' } },
      500,
    )
  }
})
