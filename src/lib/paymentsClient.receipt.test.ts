import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'

const order = { externalId: 'fixture-order', createdAt: 1700000000000, sku: 'fixture-sku' }

function makeClient() {
  const invoke = vi.fn(async () => ({
    data: { token: 'fixture-token', external_id: order.externalId },
    error: null,
  }))
  return { client: { functions: { invoke } } as unknown as SupabaseClient, invoke }
}

// Deliberately import only after storage is configured. No store or consumer mocks.
async function loadConsumer() {
  const { startPurchase } = await import('./paymentsClient')
  const { PAYMENTS_STORAGE_KEY, usePaymentsStore } = await import('../store/usePaymentsStore')
  return { startPurchase, PAYMENTS_STORAGE_KEY, usePaymentsStore }
}

beforeEach(() => {
  vi.resetModules()
  localStorage.clear()
  vi.stubEnv('VITE_PAYMENTS_ENABLED', 'true')
  vi.spyOn(Date, 'now').mockReturnValue(order.createdAt)
})

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllEnvs()
  localStorage.clear()
})

describe('checkout durable recovery receipt through the actual store', () => {
  it('refuses handoff when the localStorage getter is denied before store initialization', async () => {
    const getter = vi.spyOn(globalThis, 'localStorage', 'get').mockImplementation(() => {
      throw new DOMException('Storage access denied', 'SecurityError')
    })
    const { startPurchase, usePaymentsStore } = await loadConsumer()
    expect(getter).toHaveBeenCalled()
    const { client, invoke } = makeClient()
    const openCheckout = vi.fn()

    const result = await startPurchase(order.sku, { client, openCheckout })

    expect(invoke).toHaveBeenCalledTimes(1)
    expect(usePaymentsStore.getState().pendingOrder).toEqual(order)
    expect(usePaymentsStore.getState().status).toBe('pending')
    expect(result).toMatchObject({ ok: false, reason: 'storage-unavailable' })
    expect(openCheckout).not.toHaveBeenCalled()
  })

  it('does not mistake restored access for an initialized persistence adapter', async () => {
    const getter = vi.spyOn(globalThis, 'localStorage', 'get').mockImplementation(() => {
      throw new DOMException('Storage access denied', 'SecurityError')
    })
    const { startPurchase, usePaymentsStore, PAYMENTS_STORAGE_KEY } = await loadConsumer()
    getter.mockRestore()
    const { client } = makeClient()
    const openCheckout = vi.fn()

    const result = await startPurchase(order.sku, { client, openCheckout })

    expect(usePaymentsStore.getState().pendingOrder).toEqual(order)
    expect(localStorage.getItem(PAYMENTS_STORAGE_KEY)).toBeNull()
    expect(result).toMatchObject({ ok: false, reason: 'storage-unavailable' })
    expect(openCheckout).not.toHaveBeenCalled()
  })

  it('retains the in-memory order when the actual persistence write throws', async () => {
    const { startPurchase, usePaymentsStore } = await loadConsumer()
    const { client } = makeClient()
    const openCheckout = vi.fn()
    const write = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('Quota exceeded', 'QuotaExceededError')
    })

    const result = await startPurchase(order.sku, { client, openCheckout })

    expect(write).toHaveBeenCalled()
    expect(usePaymentsStore.getState().pendingOrder).toEqual(order)
    expect(result).toMatchObject({ ok: false, reason: 'storage-unavailable' })
    expect(openCheckout).not.toHaveBeenCalled()
  })

  it('refuses a silently dropped write rather than trusting a nonthrowing action', async () => {
    const { startPurchase, usePaymentsStore, PAYMENTS_STORAGE_KEY } = await loadConsumer()
    const { client } = makeClient()
    const openCheckout = vi.fn()
    const write = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {})

    const result = await startPurchase(order.sku, { client, openCheckout })

    expect(write).toHaveBeenCalled()
    expect(usePaymentsStore.getState().pendingOrder).toEqual(order)
    expect(localStorage.getItem(PAYMENTS_STORAGE_KEY)).toBeNull()
    expect(result).toMatchObject({ ok: false, reason: 'storage-unavailable' })
    expect(openCheckout).not.toHaveBeenCalled()
  })

  it.each([
    ['missing marker', null],
    ['different externalId', JSON.stringify({ state: { pendingOrder: { ...order, externalId: 'other' } }, version: 1 })],
    ['different timestamp', JSON.stringify({ state: { pendingOrder: { ...order, createdAt: 1 } }, version: 1 })],
    ['different SKU', JSON.stringify({ state: { pendingOrder: { ...order, sku: 'other' } }, version: 1 })],
    ['missing SKU', JSON.stringify({ state: { pendingOrder: { externalId: order.externalId, createdAt: order.createdAt } }, version: 1 })],
    ['different version', JSON.stringify({ state: { pendingOrder: order }, version: 2 })],
    ['malformed JSON', '{'],
    ['missing state', '{}'],
  ])('refuses SDK handoff after %s readback', async (_label, readback) => {
    const { startPurchase, usePaymentsStore } = await loadConsumer()
    const { client } = makeClient()
    const openCheckout = vi.fn()
    vi.spyOn(Storage.prototype, 'getItem').mockReturnValue(readback)

    const result = await startPurchase(order.sku, { client, openCheckout })

    expect(usePaymentsStore.getState().pendingOrder).toEqual(order)
    expect(result).toMatchObject({ ok: false, reason: 'storage-unavailable' })
    expect(openCheckout).not.toHaveBeenCalled()
  })

  it('refuses SDK handoff when readback throws after a successful write', async () => {
    const { startPurchase, usePaymentsStore } = await loadConsumer()
    const { client } = makeClient()
    const openCheckout = vi.fn()
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new DOMException('Storage access denied', 'SecurityError')
    })

    const result = await startPurchase(order.sku, { client, openCheckout })

    expect(usePaymentsStore.getState().pendingOrder).toEqual(order)
    expect(result).toMatchObject({ ok: false, reason: 'storage-unavailable' })
    expect(openCheckout).not.toHaveBeenCalled()
  })

  it('opens ordinary checkout only after the exact pending order is persisted', async () => {
    const { startPurchase, PAYMENTS_STORAGE_KEY, usePaymentsStore } = await loadConsumer()
    const { client } = makeClient()
    const openCheckout = vi.fn(async () => {
      expect(usePaymentsStore.getState().pendingOrder).toEqual(order)
      expect(JSON.parse(localStorage.getItem(PAYMENTS_STORAGE_KEY)!)).toEqual({
        state: { pendingOrder: order }, version: 1,
      })
    })

    await expect(startPurchase(order.sku, { client, openCheckout })).resolves.toEqual({
      ok: true, externalId: order.externalId,
    })
    expect(openCheckout).toHaveBeenCalledExactlyOnceWith({ token: 'fixture-token', sandbox: true })
  })
})
