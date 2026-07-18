import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import {
  createCheckoutSession,
  PurchaseError,
  startPurchase,
} from './paymentsClient'
import { PAYMENTS_STORAGE_KEY, usePaymentsStore } from '../store/usePaymentsStore'

/** Fake client whose `functions.invoke` resolves to `result`. */
function makeInvokeClient(result: { data: unknown; error: unknown }) {
  const invoke = vi.fn(async () => result)
  const client = { functions: { invoke } } as unknown as SupabaseClient
  return { client, invoke }
}

function readPersistedPendingOrder(): unknown {
  const raw = localStorage.getItem(PAYMENTS_STORAGE_KEY)
  if (!raw) return undefined
  return (JSON.parse(raw) as { state?: { pendingOrder?: unknown } }).state?.pendingOrder
}

describe('createCheckoutSession', () => {
  it('invokes create-checkout and returns the token + external_id', async () => {
    const { client, invoke } = makeInvokeClient({
      data: { token: 'tok-123', external_id: 'ext-abc' },
      error: null,
    })
    const result = await createCheckoutSession('cosmetic.devil_d6', { client })
    expect(result).toEqual({ token: 'tok-123', externalId: 'ext-abc' })
    // Client never sends a price — only the SKU (server-side price lookup).
    expect(invoke).toHaveBeenCalledWith('create-checkout', {
      body: { sku: 'cosmetic.devil_d6' },
    })
  })

  it('throws a checkout-failed PurchaseError when the function errors', async () => {
    const { client } = makeInvokeClient({ data: null, error: { message: 'boom' } })
    await expect(createCheckoutSession('sku', { client })).rejects.toMatchObject({
      reason: 'checkout-failed',
    })
  })

  it('throws when the function returns no token', async () => {
    const { client } = makeInvokeClient({ data: { external_id: 'ext' }, error: null })
    await expect(createCheckoutSession('sku', { client })).rejects.toBeInstanceOf(PurchaseError)
  })

  it('throws unconfigured when no client is available', async () => {
    await expect(createCheckoutSession('sku', { client: null })).rejects.toMatchObject({
      reason: 'unconfigured',
    })
  })
})

describe('startPurchase', () => {
  beforeEach(() => {
    localStorage.clear()
    usePaymentsStore.setState({ pendingOrder: null, status: 'unknown', error: null })
  })

  afterEach(() => {
    vi.unstubAllEnvs()
    vi.restoreAllMocks()
    localStorage.clear()
    usePaymentsStore.setState({ pendingOrder: null, status: 'unknown', error: null })
  })

  it('does nothing and never loads the SDK when the flag is OFF', async () => {
    // Arrange: flag absent (default).
    const openCheckout = vi.fn()
    const { client } = makeInvokeClient({
      data: { token: 't', external_id: 'e' },
      error: null,
    })

    // Act
    const result = await startPurchase('sku', { client, openCheckout })

    // Assert: refused, no checkout opened, no pending order persisted.
    expect(result).toEqual({ ok: false, reason: 'disabled', message: expect.any(String) })
    expect(openCheckout).not.toHaveBeenCalled()
    expect(usePaymentsStore.getState().pendingOrder).toBeNull()
  })

  it('persists the pending order BEFORE opening checkout (flag ON)', async () => {
    vi.stubEnv('VITE_PAYMENTS_ENABLED', 'true')
    const { client } = makeInvokeClient({
      data: { token: 'tok-xyz', external_id: 'ext-777' },
      error: null,
    })

    // The opener captures the persisted state at the moment it is invoked, proving
    // the localStorage write happened before the (SDK) handoff.
    let pendingAtOpenTime: unknown
    let persistedAtOpenTime: unknown
    const openCheckout = vi.fn(async () => {
      pendingAtOpenTime = usePaymentsStore.getState().pendingOrder
      persistedAtOpenTime = readPersistedPendingOrder()
    })

    const result = await startPurchase('sku', { client, openCheckout })

    expect(result).toEqual({ ok: true, externalId: 'ext-777' })
    expect(openCheckout).toHaveBeenCalledWith({ token: 'tok-xyz', sandbox: true })
    expect(pendingAtOpenTime).toMatchObject({ externalId: 'ext-777' })
    expect(persistedAtOpenTime).toMatchObject({ externalId: 'ext-777' })
  })

  it('reports checkout-failed and persists nothing when create-checkout fails', async () => {
    vi.stubEnv('VITE_PAYMENTS_ENABLED', 'true')
    const { client } = makeInvokeClient({ data: null, error: { message: 'declined' } })
    const openCheckout = vi.fn()

    const result = await startPurchase('sku', { client, openCheckout })

    expect(result).toMatchObject({ ok: false, reason: 'checkout-failed' })
    expect(openCheckout).not.toHaveBeenCalled()
    expect(usePaymentsStore.getState().pendingOrder).toBeNull()
    expect(usePaymentsStore.getState().error).toBe('declined')
  })

  it('keeps the pending order for reconciliation when the SDK handoff throws', async () => {
    vi.stubEnv('VITE_PAYMENTS_ENABLED', 'true')
    const { client } = makeInvokeClient({
      data: { token: 'tok', external_id: 'ext-keep' },
      error: null,
    })
    const openCheckout = vi.fn(async () => {
      throw new Error('sdk exploded')
    })

    const result = await startPurchase('sku', { client, openCheckout })

    expect(result).toMatchObject({ ok: false, reason: 'sdk-failed' })
    // The payment might still complete in a popup — do not drop the marker.
    expect(usePaymentsStore.getState().pendingOrder).toMatchObject({ externalId: 'ext-keep' })
  })
})
