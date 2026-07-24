import type { CheckoutProduct } from './catalog.ts'

export interface PaymentOrderRow {
  readonly external_id?: unknown
  readonly amount_minor?: unknown
  readonly currency?: unknown
}

export interface PaymentOrderRpcResponse {
  readonly data: PaymentOrderRow | PaymentOrderRow[] | null
  readonly error: unknown
}

export interface CheckoutOrderDeps {
  createCatalogItemOrder(args: {
    userId: string
    catalogItemId: string
    amountMinor: number
    currency: string
    dryRun: boolean
  }): Promise<PaymentOrderRpcResponse>
  createRegistrySkuOrder(args: {
    userId: string
    skuId: string
    currency: string
    dryRun: boolean
  }): Promise<PaymentOrderRpcResponse>
}

/** Route one trusted product to exactly one database order boundary. */
export function openCheckoutOrder(
  product: CheckoutProduct,
  userId: string,
  dryRun: boolean,
  deps: CheckoutOrderDeps,
): Promise<PaymentOrderRpcResponse> {
  if (product.source === 'legacy_catalog') {
    return deps.createCatalogItemOrder({
      userId,
      catalogItemId: product.catalogItemId,
      amountMinor: product.amountMinor,
      currency: product.currency,
      dryRun,
    })
  }

  return deps.createRegistrySkuOrder({
    userId,
    skuId: product.sku,
    currency: product.currency,
    dryRun,
  })
}

export function unwrapPaymentOrderRow(
  data: PaymentOrderRpcResponse['data'],
): PaymentOrderRow | null {
  const row = Array.isArray(data) ? data[0] : data
  return row && typeof row === 'object' ? row : null
}
