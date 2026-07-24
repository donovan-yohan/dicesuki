import { describe, expect, it, vi } from 'vitest'
import { openCheckoutOrder, unwrapPaymentOrderRow, type CheckoutOrderDeps } from './checkout.ts'
import type { CheckoutProduct } from './catalog.ts'

function deps(): CheckoutOrderDeps {
  return {
    createCatalogItemOrder: vi.fn(async () => ({
      data: { external_id: 'legacy-order' },
      error: null,
    })),
    createRegistrySkuOrder: vi.fn(async () => ({
      data: {
        external_id: 'registry-order',
        amount_minor: 49,
        currency: 'USD',
      },
      error: null,
    })),
  }
}

describe('openCheckoutOrder', () => {
  it('keeps a legacy die on create_payment_order-shaped arguments', async () => {
    const product: CheckoutProduct = {
      source: 'legacy_catalog',
      sku: 'void-crystal-d20',
      catalogItemId: 'void-crystal/d20/legendary@1',
      name: 'Void Crystal d20',
      amountMinor: 799,
      currency: 'USD',
    }
    const mocked = deps()

    await openCheckoutOrder(product, 'user-1', true, mocked)

    expect(mocked.createCatalogItemOrder).toHaveBeenCalledWith({
      userId: 'user-1',
      catalogItemId: 'void-crystal/d20/legendary@1',
      amountMinor: 799,
      currency: 'USD',
      dryRun: true,
    })
    expect(mocked.createRegistrySkuOrder).not.toHaveBeenCalled()
  })

  it('routes a registry non-die to create_sku_payment_order-shaped arguments without a client price', async () => {
    const product: CheckoutProduct = {
      source: 'registry',
      sku: 'stars_handful',
      skuClass: 'star_bundle',
      name: 'stars_handful',
      amountMinor: 49,
      currency: 'USD',
      productId: null,
    }
    const mocked = deps()

    const response = await openCheckoutOrder(product, 'user-2', true, mocked)

    expect(mocked.createRegistrySkuOrder).toHaveBeenCalledWith({
      userId: 'user-2',
      skuId: 'stars_handful',
      currency: 'USD',
      dryRun: true,
    })
    expect(mocked.createCatalogItemOrder).not.toHaveBeenCalled()
    expect(unwrapPaymentOrderRow(response.data)).toEqual({
      external_id: 'registry-order',
      amount_minor: 49,
      currency: 'USD',
    })
  })
})

describe('unwrapPaymentOrderRow', () => {
  it('normalizes object and array-wrapped PostgREST returns', () => {
    expect(unwrapPaymentOrderRow({ external_id: 'one' })).toEqual({ external_id: 'one' })
    expect(unwrapPaymentOrderRow([{ external_id: 'two' }])).toEqual({ external_id: 'two' })
    expect(unwrapPaymentOrderRow(null)).toBeNull()
  })
})
