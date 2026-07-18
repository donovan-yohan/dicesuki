// Webhook dispatch logic with mocked RPC/user deps. Pure module — no Deno.

import { describe, it, expect, vi } from 'vitest'
import {
  dispatchWebhook,
  coerceTransactionId,
  extractTransactionId,
  extractExternalId,
  extractDryRun,
  extractUserId,
  isDeliberateNoGrantError,
  RPC_DELIBERATE_NO_GRANT_SQLSTATE,
  type WebhookDeps,
  type OrderRpcResult,
} from './webhookDispatch.ts'

function makeDeps(overrides: Partial<WebhookDeps> = {}): WebhookDeps {
  return {
    userExists: vi.fn(async () => true),
    // The RPCs return the order ROW; the dep normalizes it to { ok, status }.
    fulfillOrder: vi.fn(async (): Promise<OrderRpcResult> => ({ ok: true, status: 'fulfilled' })),
    reverseOrder: vi.fn(async (): Promise<OrderRpcResult> => ({ ok: true, status: 'refunded' })),
    ...overrides,
  }
}

describe('extraction helpers', () => {
  it('coerceTransactionId accepts numbers and numeric strings', () => {
    expect(coerceTransactionId(42)).toBe(42)
    expect(coerceTransactionId('42')).toBe(42)
    expect(coerceTransactionId('')).toBeNull()
    expect(coerceTransactionId('abc')).toBeNull()
    expect(coerceTransactionId(undefined)).toBeNull()
    expect(coerceTransactionId(Number.NaN)).toBeNull()
  })

  it('extractTransactionId reads transaction.id then order.id', () => {
    expect(extractTransactionId({ transaction: { id: 7 } })).toBe(7)
    expect(extractTransactionId({ order: { id: '9' } })).toBe(9)
    expect(extractTransactionId({})).toBeNull()
  })

  it('extractExternalId checks transaction, order, then custom_parameters', () => {
    expect(extractExternalId({ transaction: { external_id: 'a' } })).toBe('a')
    expect(extractExternalId({ order: { external_id: 'b' } })).toBe('b')
    expect(extractExternalId({ custom_parameters: { external_id: 'c' } })).toBe('c')
    expect(extractExternalId({})).toBeNull()
  })

  it('extractDryRun detects dry_run 1/true and sandbox mode', () => {
    expect(extractDryRun({ transaction: { dry_run: 1 } })).toBe(true)
    expect(extractDryRun({ transaction: { dry_run: true } })).toBe(true)
    expect(extractDryRun({ order: { mode: 'sandbox' } })).toBe(true)
    expect(extractDryRun({ transaction: { dry_run: 0 } })).toBe(false)
    expect(extractDryRun({})).toBe(false)
  })

  it('extractUserId reads flat string and nested value', () => {
    expect(extractUserId({ user: { id: 'uuid-1' } })).toBe('uuid-1')
    expect(extractUserId({ user: { id: { value: 'uuid-2' } } })).toBe('uuid-2')
    expect(extractUserId({ user: {} })).toBeNull()
  })
})

describe('user_validation', () => {
  it('returns 200 when the Supabase user exists', async () => {
    const deps = makeDeps({ userExists: vi.fn(async () => true) })
    const res = await dispatchWebhook(
      { notification_type: 'user_validation', user: { id: 'uuid-1' } },
      deps,
    )
    expect(res.status).toBe(200)
    expect(deps.userExists).toHaveBeenCalledWith('uuid-1')
  })

  it('returns 400 INVALID_USER when the user does not exist', async () => {
    const deps = makeDeps({ userExists: vi.fn(async () => false) })
    const res = await dispatchWebhook(
      { notification_type: 'user_validation', user: { id: 'ghost' } },
      deps,
    )
    expect(res.status).toBe(400)
    expect(res.body).toMatchObject({ error: { code: 'INVALID_USER' } })
  })

  it('returns 400 when no user id is present', async () => {
    const deps = makeDeps()
    const res = await dispatchWebhook({ notification_type: 'user_validation', user: {} }, deps)
    expect(res.status).toBe(400)
    expect(deps.userExists).not.toHaveBeenCalled()
  })
})

describe('payment / order_paid fulfillment', () => {
  it('calls fulfillOrder with the transaction id, external id, and dry_run', async () => {
    const deps = makeDeps()
    const res = await dispatchWebhook(
      {
        notification_type: 'payment',
        transaction: { id: 555, external_id: 'ext-1', dry_run: 1 },
        user: { id: 'uuid-1' },
      },
      deps,
    )
    expect(res.status).toBe(200)
    expect(deps.fulfillOrder).toHaveBeenCalledTimes(1)
    expect(deps.fulfillOrder).toHaveBeenCalledWith(
      expect.objectContaining({
        xsollaTransactionId: 555,
        externalId: 'ext-1',
        dryRun: true,
        eventType: 'payment',
      }),
    )
  })

  it('handles order_paid envelope (order.id / order.external_id)', async () => {
    const deps = makeDeps()
    const res = await dispatchWebhook(
      {
        notification_type: 'order_paid',
        order: { id: 900, external_id: 'ext-2', mode: 'sandbox' },
      },
      deps,
    )
    expect(res.status).toBe(200)
    expect(deps.fulfillOrder).toHaveBeenCalledWith(
      expect.objectContaining({ xsollaTransactionId: 900, externalId: 'ext-2', dryRun: true }),
    )
  })

  it('maps a returned order row (grant OR idempotent replay) to a clean 200', async () => {
    // The RPC returns the order row on both a fresh grant and an idempotent
    // replay — they are indistinguishable and both a clean 200. The second
    // delivery of the SAME transaction id must never re-grant (the RPC gate's
    // job); dispatch just forwards the same idempotency key and returns 200.
    const fulfillOrder = vi
      .fn<WebhookDeps['fulfillOrder']>()
      .mockResolvedValue({ ok: true, status: 'fulfilled' })
    const deps = makeDeps({ fulfillOrder })
    const payload = {
      notification_type: 'payment',
      transaction: { id: 777, external_id: 'ext-3', dry_run: 1 },
    }
    const first = await dispatchWebhook(payload, deps)
    const second = await dispatchWebhook(payload, deps)
    expect(first.status).toBe(200)
    expect(first.body).toMatchObject({ ok: true, status: 'fulfilled' })
    expect(second.status).toBe(200)
    expect(second.body).toMatchObject({ ok: true, status: 'fulfilled' })
    // Both deliveries forward the SAME idempotency key to the RPC gate.
    expect(fulfillOrder.mock.calls[0][0].xsollaTransactionId).toBe(777)
    expect(fulfillOrder.mock.calls[1][0].xsollaTransactionId).toBe(777)
  })

  it('surfaces a deliberate-no-grant ack (acked:true) as a 200', async () => {
    // When the RPC raises a deliberate-no-grant SQLSTATE, the dep 200-acks with
    // { ok: false, acked: true } instead of throwing; dispatch echoes it as 200.
    const fulfillOrder = vi
      .fn<WebhookDeps['fulfillOrder']>()
      .mockResolvedValue({ ok: false, acked: true })
    const deps = makeDeps({ fulfillOrder })
    const res = await dispatchWebhook(
      { notification_type: 'payment', transaction: { id: 888, external_id: 'ext-4', dry_run: 1 } },
      deps,
    )
    expect(res.status).toBe(200)
    expect(res.body).toMatchObject({ ok: false, acked: true })
  })

  it('returns 400 when the transaction id is missing', async () => {
    const deps = makeDeps()
    const res = await dispatchWebhook({ notification_type: 'payment', transaction: {} }, deps)
    expect(res.status).toBe(400)
    expect(deps.fulfillOrder).not.toHaveBeenCalled()
  })
})

describe('refund / chargeback reversal', () => {
  it('calls reverseOrder with event_type=refund', async () => {
    const deps = makeDeps()
    const res = await dispatchWebhook(
      {
        notification_type: 'refund',
        transaction: { id: 321, external_id: 'ext-9', dry_run: 1 },
      },
      deps,
    )
    expect(res.status).toBe(200)
    expect(res.body).toMatchObject({ ok: true, status: 'refunded' })
    expect(deps.reverseOrder).toHaveBeenCalledWith(
      expect.objectContaining({ xsollaTransactionId: 321, eventType: 'refund' }),
    )
    expect(deps.fulfillOrder).not.toHaveBeenCalled()
  })

  it('routes chargeback to reverseOrder with event_type=chargeback', async () => {
    // refund_payment_order accepts 'refund' | 'chargeback'; both reverse.
    const deps = makeDeps()
    const res = await dispatchWebhook(
      {
        notification_type: 'chargeback',
        transaction: { id: 654, external_id: 'ext-10', dry_run: 1 },
      },
      deps,
    )
    expect(res.status).toBe(200)
    expect(deps.reverseOrder).toHaveBeenCalledWith(
      expect.objectContaining({ xsollaTransactionId: 654, eventType: 'chargeback' }),
    )
    expect(deps.fulfillOrder).not.toHaveBeenCalled()
  })

  it('returns 400 when a chargeback is missing its transaction id', async () => {
    const deps = makeDeps()
    const res = await dispatchWebhook({ notification_type: 'chargeback', transaction: {} }, deps)
    expect(res.status).toBe(400)
    expect(deps.reverseOrder).not.toHaveBeenCalled()
  })
})

describe('isDeliberateNoGrantError', () => {
  it('recognizes the invalid_parameter_value SQLSTATE (dry_run mismatch, etc.)', () => {
    expect(RPC_DELIBERATE_NO_GRANT_SQLSTATE).toBe('22023')
    expect(isDeliberateNoGrantError('22023')).toBe(true)
  })

  it('treats every other code (and missing codes) as retryable', () => {
    // 23503 (unknown order) and 55000 (order not yet fulfilled) can race with a
    // sibling webhook, so they stay retryable → 5xx.
    expect(isDeliberateNoGrantError('23503')).toBe(false)
    expect(isDeliberateNoGrantError('55000')).toBe(false)
    expect(isDeliberateNoGrantError(undefined)).toBe(false)
    expect(isDeliberateNoGrantError(null)).toBe(false)
  })
})

describe('unknown notification types', () => {
  it('acks unknown types with 200 (stops Xsolla retries)', async () => {
    const deps = makeDeps()
    const res = await dispatchWebhook({ notification_type: 'something_new' }, deps)
    expect(res.status).toBe(200)
    expect(res.body).toMatchObject({ ok: true, ignored: 'something_new' })
    expect(deps.fulfillOrder).not.toHaveBeenCalled()
    expect(deps.reverseOrder).not.toHaveBeenCalled()
  })
})
