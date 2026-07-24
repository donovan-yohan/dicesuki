// Webhook dispatch logic with mocked RPC/user deps. Pure module — no Deno.

import { describe, it, expect, expectTypeOf, vi } from 'vitest'
import {
  createRecordSubscriptionEventDep,
  dispatchWebhook,
  dispatchWebhookResponse,
  coerceTransactionId,
  extractTransactionId,
  extractExternalId,
  extractDryRun,
  extractUserId,
  coerceSubscriptionId,
  SUBSCRIPTION_RAW_PAYLOAD_MAX_BYTES,
  isDeliberateNoGrantError,
  RPC_DELIBERATE_NO_GRANT_SQLSTATE,
  type WebhookDeps,
  type OrderRpcResult,
} from './webhookDispatch.ts'

const bodySha256 = 'a'.repeat(64)

function makeDeps(overrides: Partial<WebhookDeps> = {}): WebhookDeps {
  return {
    userExists: vi.fn(async () => true),
    // The RPCs return the order ROW; the dep normalizes it to { ok, status }.
    fulfillOrder: vi.fn(async (): Promise<OrderRpcResult> => ({ ok: true, status: 'fulfilled' })),
    reverseOrder: vi.fn(async (): Promise<OrderRpcResult> => ({ ok: true, status: 'refunded' })),
    recordSubscriptionEvent: vi.fn(async () => ({ drainedInvalid: false })),
    ...overrides,
  }
}

it('requires bodySha256 in the dispatchWebhook type signature', () => {
  expectTypeOf<Parameters<typeof dispatchWebhook>>().toEqualTypeOf<
    [notification: unknown, deps: WebhookDeps, bodySha256: string]
  >()
})

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

  it('coerceSubscriptionId accepts only bounded strings and finite numbers', () => {
    expect(coerceSubscriptionId('sub-42')).toBe('sub-42')
    expect(coerceSubscriptionId(42)).toBe('42')
    expect(coerceSubscriptionId('')).toBeNull()
    expect(coerceSubscriptionId(Number.NaN)).toBeNull()
    expect(coerceSubscriptionId({ id: 42 })).toBeNull()
    expect(coerceSubscriptionId(['42'])).toBeNull()
    expect(coerceSubscriptionId(true)).toBeNull()
    expect(coerceSubscriptionId('x'.repeat(256))).toBeNull()
  })
})

describe('user_validation', () => {
  it('returns 200 when the Supabase user exists', async () => {
    const deps = makeDeps({ userExists: vi.fn(async () => true) })
    const res = await dispatchWebhook(
      { notification_type: 'user_validation', user: { id: 'uuid-1' } },
      deps,
      bodySha256,
    )
    expect(res.status).toBe(200)
    expect(deps.userExists).toHaveBeenCalledWith('uuid-1')
  })

  it('returns 400 INVALID_USER when the user does not exist', async () => {
    const deps = makeDeps({ userExists: vi.fn(async () => false) })
    const res = await dispatchWebhook(
      { notification_type: 'user_validation', user: { id: 'ghost' } },
      deps,
      bodySha256,
    )
    expect(res.status).toBe(400)
    expect(res.body).toMatchObject({ error: { code: 'INVALID_USER' } })
  })

  it('returns 400 when no user id is present', async () => {
    const deps = makeDeps()
    const res = await dispatchWebhook(
      { notification_type: 'user_validation', user: {} },
      deps,
      bodySha256,
    )
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
      bodySha256,
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
      bodySha256,
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
    const first = await dispatchWebhook(payload, deps, bodySha256)
    const second = await dispatchWebhook(payload, deps, bodySha256)
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
      bodySha256,
    )
    expect(res.status).toBe(200)
    expect(res.body).toMatchObject({ ok: false, acked: true })
  })

  it('returns 400 when the transaction id is missing', async () => {
    const deps = makeDeps()
    const res = await dispatchWebhook(
      { notification_type: 'payment', transaction: {} },
      deps,
      bodySha256,
    )
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
      bodySha256,
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
      bodySha256,
    )
    expect(res.status).toBe(200)
    expect(deps.reverseOrder).toHaveBeenCalledWith(
      expect.objectContaining({ xsollaTransactionId: 654, eventType: 'chargeback' }),
    )
    expect(deps.fulfillOrder).not.toHaveBeenCalled()
  })

  it('returns 400 when a chargeback is missing its transaction id', async () => {
    const deps = makeDeps()
    const res = await dispatchWebhook(
      { notification_type: 'chargeback', transaction: {} },
      deps,
      bodySha256,
    )
    expect(res.status).toBe(400)
    expect(deps.reverseOrder).not.toHaveBeenCalled()
  })
})

describe('subscription lifecycle dispatch', () => {
  const user = { id: '00000000-0000-4000-8000-000000000011' }
  const dates = {
    dateCreate: '2026-07-24T10:00:00Z',
    dateNextCharge: '2026-08-24T10:00:00Z',
    dateEnd: '2026-08-01T10:00:00Z',
  }

  it.each([
    {
      type: 'create_subscription',
      subscription: {
        subscription_id: 12345,
        plan_id: 'lunar-monthly',
        product_id: 'lunar-pass',
        date_create: dates.dateCreate,
        date_next_charge: dates.dateNextCharge,
      },
      expected: {
        subscriptionId: '12345',
        planId: 'lunar-monthly',
        productId: 'lunar-pass',
        dateCreate: dates.dateCreate,
        dateNextCharge: dates.dateNextCharge,
        dateEnd: null,
      },
    },
    {
      // Xsolla docs show non-UTC offsets (e.g. +04:00); they must pass verbatim.
      type: 'create_subscription',
      subscription: {
        subscription_id: 'sub-offset',
        plan_id: 'lunar-monthly',
        product_id: 'lunar-pass',
        date_create: '2026-07-24T19:25:25+04:00',
        date_next_charge: '2026-08-24T19:25:25+04:00',
      },
      expected: {
        subscriptionId: 'sub-offset',
        planId: 'lunar-monthly',
        productId: 'lunar-pass',
        dateCreate: '2026-07-24T19:25:25+04:00',
        dateNextCharge: '2026-08-24T19:25:25+04:00',
        dateEnd: null,
      },
    },
    {
      type: 'update_subscription',
      subscription: {
        subscription_id: 'sub-update',
        plan_id: 987,
        product_id: 'lunar-pass',
        date_next_charge: dates.dateNextCharge,
      },
      expected: {
        subscriptionId: 'sub-update',
        planId: '987',
        productId: 'lunar-pass',
        dateCreate: null,
        dateNextCharge: dates.dateNextCharge,
        dateEnd: null,
      },
    },
    {
      type: 'non_renewal_subscription',
      subscription: {
        subscription_id: 'sub-nonrenew',
        product_id: 'lunar-pass',
        date_create: dates.dateCreate,
        date_next_charge: dates.dateNextCharge,
      },
      expected: {
        subscriptionId: 'sub-nonrenew',
        planId: null,
        productId: 'lunar-pass',
        dateCreate: null,
        dateNextCharge: dates.dateNextCharge,
        dateEnd: null,
      },
    },
    {
      type: 'cancel_subscription',
      subscription: {
        subscription_id: 'sub-cancel',
        date_create: dates.dateCreate,
        date_end: dates.dateEnd,
      },
      expected: {
        subscriptionId: 'sub-cancel',
        planId: null,
        productId: null,
        dateCreate: null,
        dateNextCharge: null,
        dateEnd: dates.dateEnd,
      },
    },
  ])(
    'routes $type to the subscription RPC and returns 204',
    async ({ type, subscription, expected }) => {
      const deps = makeDeps()
      const payload = { notification_type: type, user, subscription }

      const res = await dispatchWebhook(payload, deps, bodySha256)

      expect(res).toEqual({ status: 204, body: null })
      expect(deps.userExists).toHaveBeenCalledWith(user.id)
      expect(deps.recordSubscriptionEvent).toHaveBeenCalledTimes(1)
      expect(deps.recordSubscriptionEvent).toHaveBeenCalledWith({
        userId: user.id,
        eventType: type,
        ...expected,
        rawPayload: payload,
        bodySha256,
      })
    },
  )

  it('rejects a calendar-invalid timestamp before calling the subscription RPC', async () => {
    const deps = makeDeps()
    const res = await dispatchWebhook(
      {
        notification_type: 'create_subscription',
        user,
        subscription: {
          subscription_id: 'sub-invalid-calendar',
          plan_id: 'lunar-monthly',
          date_create: '2026-02-30T10:00:00Z',
          date_next_charge: dates.dateNextCharge,
        },
      },
      deps,
      bodySha256,
    )

    expect(res.status).toBe(400)
    expect(res.body).toMatchObject({ error: { code: 'INVALID_PARAMETER' } })
    expect(deps.userExists).not.toHaveBeenCalled()
    expect(deps.recordSubscriptionEvent).not.toHaveBeenCalled()
  })

  it('rejects a payload over the RPC UTF-8 byte bound before calling the dep', async () => {
    const payload = {
      notification_type: 'cancel_subscription',
      user,
      subscription: {
        subscription_id: 'sub-oversized',
        date_end: dates.dateEnd,
        vendor_metadata: '💎'.repeat(16_384),
      },
    }
    const serializedPayload = JSON.stringify(payload)
    expect(serializedPayload.length).toBeLessThan(SUBSCRIPTION_RAW_PAYLOAD_MAX_BYTES)
    expect(new TextEncoder().encode(serializedPayload).byteLength).toBeGreaterThan(
      SUBSCRIPTION_RAW_PAYLOAD_MAX_BYTES,
    )
    const deps = makeDeps()

    const res = await dispatchWebhook(payload, deps, bodySha256)

    expect(res.status).toBe(400)
    expect(res.body).toMatchObject({ error: { code: 'INVALID_PARAMETER' } })
    expect(deps.userExists).not.toHaveBeenCalled()
    expect(deps.recordSubscriptionEvent).not.toHaveBeenCalled()
  })

  it.each([
    {
      type: 'create_subscription',
      subscription: {
        subscription_id: 'sub-create',
        plan_id: 'lunar-monthly',
        date_next_charge: dates.dateNextCharge,
      },
    },
    {
      type: 'update_subscription',
      subscription: {
        subscription_id: 'sub-update',
        date_next_charge: dates.dateNextCharge,
      },
    },
    {
      type: 'non_renewal_subscription',
      subscription: { subscription_id: 'sub-nonrenew' },
    },
    {
      type: 'cancel_subscription',
      subscription: { subscription_id: 'sub-cancel' },
    },
  ])('rejects $type when a required field is missing', async ({ type, subscription }) => {
    const deps = makeDeps()
    const res = await dispatchWebhook(
      { notification_type: type, user, subscription },
      deps,
      bodySha256,
    )

    expect(res.status).toBe(400)
    expect(res.body).toMatchObject({ error: { code: 'INVALID_PARAMETER' } })
    expect(deps.recordSubscriptionEvent).not.toHaveBeenCalled()
  })

  it.each([
    {
      type: 'create_subscription',
      subscription: {
        subscription_id: 'sub-create',
        plan_id: 'lunar-monthly',
        date_create: dates.dateCreate,
        date_next_charge: dates.dateNextCharge,
        date_end: dates.dateEnd,
      },
    },
    {
      type: 'update_subscription',
      subscription: {
        subscription_id: 'sub-update',
        plan_id: 'lunar-monthly',
        date_create: dates.dateCreate,
        date_next_charge: dates.dateNextCharge,
      },
    },
    {
      type: 'non_renewal_subscription',
      subscription: {
        subscription_id: 'sub-nonrenew',
        date_next_charge: dates.dateNextCharge,
        date_end: dates.dateEnd,
      },
    },
    {
      type: 'cancel_subscription',
      subscription: {
        subscription_id: 'sub-cancel',
        date_next_charge: dates.dateNextCharge,
        date_end: dates.dateEnd,
      },
    },
  ])(
    'rejects $type when a migration-forbidden date is present',
    async ({ type, subscription }) => {
      const deps = makeDeps()
      const res = await dispatchWebhook(
        { notification_type: type, user, subscription },
        deps,
        bodySha256,
      )

      expect(res.status).toBe(400)
      expect(res.body).toMatchObject({ error: { code: 'INVALID_PARAMETER' } })
      expect(deps.recordSubscriptionEvent).not.toHaveBeenCalled()
    },
  )

  it('rejects an invalid subscription_id shape without calling the RPC', async () => {
    const deps = makeDeps()
    const res = await dispatchWebhook(
      {
        notification_type: 'cancel_subscription',
        user,
        subscription: { subscription_id: { value: 'sub-invalid' }, date_end: dates.dateEnd },
      },
      deps,
      bodySha256,
    )

    expect(res.status).toBe(400)
    expect(res.body).toMatchObject({ error: { code: 'INVALID_PARAMETER' } })
    expect(deps.recordSubscriptionEvent).not.toHaveBeenCalled()
  })

  it('returns INVALID_USER and does not call the RPC when the user is unresolvable', async () => {
    const deps = makeDeps({ userExists: vi.fn(async () => false) })
    const res = await dispatchWebhook(
      {
        notification_type: 'cancel_subscription',
        user: { id: 'missing-user' },
        subscription: { subscription_id: 'sub-cancel', date_end: dates.dateEnd },
      },
      deps,
      bodySha256,
    )

    expect(res.status).toBe(400)
    expect(res.body).toMatchObject({ error: { code: 'INVALID_USER' } })
    expect(deps.recordSubscriptionEvent).not.toHaveBeenCalled()
  })

  it('lets RPC failures escape so the HTTP handler maps them to retryable 500', async () => {
    const deps = makeDeps({
      recordSubscriptionEvent: vi.fn(async () => {
        throw new Error('database unavailable')
      }),
    })

    await expect(
      dispatchWebhook(
        {
          notification_type: 'cancel_subscription',
          user,
          subscription: { subscription_id: 'sub-cancel', date_end: dates.dateEnd },
        },
        deps,
        bodySha256,
      ),
    ).rejects.toThrow('database unavailable')
  })

  it('maps a transient subscription RPC failure to an actual retryable 500', async () => {
    const onError = vi.fn()
    const drainedInvalidLog = vi.fn()
    const rpc = vi.fn(async () => ({
      error: { code: '08006', message: 'connection failure' },
    }))
    const deps = makeDeps({
      recordSubscriptionEvent: createRecordSubscriptionEventDep(rpc, drainedInvalidLog),
    })

    const response = await dispatchWebhookResponse(
      {
        notification_type: 'cancel_subscription',
        user,
        subscription: {
          subscription_id: 'sub-cancel',
          date_create: dates.dateCreate,
          date_end: dates.dateEnd,
        },
      },
      deps,
      bodySha256,
      onError,
    )

    expect(response.status).toBe(500)
    expect(response.headers.get('Content-Type')).toBe('application/json')
    await expect(response.json()).resolves.toEqual({
      error: { code: 'INTERNAL_ERROR', message: 'Processing failed, retry expected' },
    })
    expect(onError).toHaveBeenCalledWith(
      expect.objectContaining({
        message: 'record_subscription_event failed [08006]: connection failure',
      }),
    )
    expect(drainedInvalidLog).not.toHaveBeenCalled()
  })

  it.each(['22023', '22007', '22008', '22009'])(
    'drains deterministic RPC rejection %s with a loud marker and returns 204',
    async (code) => {
      const rpc = vi.fn(async () => ({
        error: { code, message: 'deterministically invalid subscription event' },
      }))
      const drainedInvalidLog = vi.fn()
      const deps = makeDeps({
        recordSubscriptionEvent: createRecordSubscriptionEventDep(
          rpc,
          drainedInvalidLog,
        ),
      })
      const payload = {
        notification_type: 'cancel_subscription',
        user,
        subscription: { subscription_id: 'sub-drain', date_end: dates.dateEnd },
      }

      const res = await dispatchWebhook(payload, deps, bodySha256)

      expect(res).toEqual({ status: 204, body: null, drainedInvalid: true })
      expect(rpc).toHaveBeenCalledWith(
        'record_subscription_event',
        expect.objectContaining({
          p_subscription_id: 'sub-drain',
          p_notification_type: 'cancel_subscription',
          p_raw_payload: payload,
          p_body_sha256: bodySha256,
        }),
      )
      expect(drainedInvalidLog).toHaveBeenCalledWith(
        expect.stringContaining('drained-invalid'),
        expect.objectContaining({
          outcome: 'drained-invalid',
          code,
          eventType: 'cancel_subscription',
          subscriptionId: 'sub-drain',
        }),
      )
    },
  )

  it('maps subscription success to an actual empty 204 Response', async () => {
    const deps = makeDeps()
    const response = await dispatchWebhookResponse(
      {
        notification_type: 'non_renewal_subscription',
        user,
        subscription: {
          subscription_id: 'sub-nonrenew',
          date_create: dates.dateCreate,
          date_next_charge: dates.dateNextCharge,
        },
      },
      deps,
      bodySha256,
      vi.fn(),
    )

    expect(response.status).toBe(204)
    await expect(response.text()).resolves.toBe('')
    expect(deps.recordSubscriptionEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        dateCreate: null,
        rawPayload: expect.objectContaining({
          subscription: expect.objectContaining({ date_create: dates.dateCreate }),
        }),
      }),
    )
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
    const res = await dispatchWebhook(
      { notification_type: 'something_new' },
      deps,
      bodySha256,
    )
    expect(res.status).toBe(200)
    expect(res.body).toMatchObject({ ok: true, ignored: 'something_new' })
    expect(deps.fulfillOrder).not.toHaveBeenCalled()
    expect(deps.reverseOrder).not.toHaveBeenCalled()
    expect(deps.recordSubscriptionEvent).not.toHaveBeenCalled()
  })
})
