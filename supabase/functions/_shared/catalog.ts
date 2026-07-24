// Server-side store price catalog (invariant #5 — "never trust client-sent
// price/SKU mapping").
//
// The client sends only an opaque `sku`. THE SERVER decides the price. Legacy
// die SKUs remain in the reviewed code map below; non-die SKUs resolve from the
// `store_skus` registry through an injected database lookup.
//
// Every legacy `catalogItemId` below MUST exist in `catalog_items`;
// `create-checkout` re-validates existence before minting a token. Registry
// prices are re-derived atomically by `create_sku_payment_order`; the edge mints
// from the returned order amount so a concurrent registry retune cannot split
// provider and database truth.
//
// Pure module: no Deno globals, no URL imports — importable by both the Deno
// runtime and Vitest.

/** ISO-4217 currency code (uppercase). */
export type CurrencyCode = string

export interface StoreProduct {
  /** Client-facing stock keeping unit. Opaque to the client; keyed here. */
  readonly sku: string
  /** `catalog_items.id` granted on fulfillment. Must exist in the catalog. */
  readonly catalogItemId: string
  /** Human-readable name shown in the Xsolla checkout description. */
  readonly name: string
  /** Authoritative price in MINOR currency units (e.g. cents). Server truth. */
  readonly amountMinor: number
  /** ISO-4217 currency, uppercase. */
  readonly currency: CurrencyCode
}

export interface RegistryStoreProduct {
  readonly sku: string
  readonly name: string
  readonly amountMinor: number
  readonly currency: CurrencyCode
  readonly source: 'registry'
  readonly skuClass: 'star_bundle' | 'subscription'
  readonly productId: string | null
}

export type CheckoutProduct =
  | (StoreProduct & { readonly source: 'legacy_catalog' })
  | RegistryStoreProduct

export interface RegistrySkuRow {
  readonly sku_id: unknown
  readonly sku_class: unknown
  readonly price_usd_cents: unknown
  readonly status: unknown
  readonly product_id: unknown
}

export interface RegistryLookupResult {
  readonly data: RegistrySkuRow | null
  readonly error: unknown
}

export type RegistrySkuLookup = (sku: string) => Promise<RegistryLookupResult>

export interface CheckoutProductResolution {
  readonly product: CheckoutProduct | null
  readonly lookupError: unknown
}

/**
 * The sandbox store catalog. Keys are the SKUs the client may request.
 * Prices are illustrative sandbox values; go-live pricing is a legal/finance
 * decision tracked with the merchant agreement, not a code change here.
 */
export const PRODUCT_CATALOG: Readonly<Record<string, StoreProduct>> = Object.freeze({
  'dragon-jade-d20': Object.freeze({
    sku: 'dragon-jade-d20',
    catalogItemId: 'dragon-jade/d20/rare@1',
    name: 'Dragon Jade d20',
    amountMinor: 299,
    currency: 'USD',
  }),
  'celestial-gold-d20': Object.freeze({
    sku: 'celestial-gold-d20',
    catalogItemId: 'celestial-gold/d20/epic@1',
    name: 'Celestial Gold d20',
    amountMinor: 499,
    currency: 'USD',
  }),
  'void-crystal-d20': Object.freeze({
    sku: 'void-crystal-d20',
    catalogItemId: 'void-crystal/d20/legendary@1',
    name: 'Void Crystal d20',
    amountMinor: 799,
    currency: 'USD',
  }),
})

/**
 * Look up a SKU in the server-side catalog. Returns `null` for anything the
 * client sends that is not an exact, known SKU. Async-shaped on purpose so the
 * eventual DB-backed price book is a drop-in replacement.
 */
export function lookupProduct(sku: unknown): StoreProduct | null {
  if (typeof sku !== 'string' || sku.length === 0) return null
  return PRODUCT_CATALOG[sku] ?? null
}

/**
 * Resolve the legacy die map first, then the database-backed non-die registry.
 * The injected lookup must itself filter status to sandbox/live; the pure seam
 * repeats that check so a mocked or accidentally broadened lookup fails closed.
 */
export async function resolveCheckoutProduct(
  sku: unknown,
  lookupRegistrySku: RegistrySkuLookup,
): Promise<CheckoutProductResolution> {
  const legacy = lookupProduct(sku)
  if (legacy) {
    return {
      product: { ...legacy, source: 'legacy_catalog' },
      lookupError: null,
    }
  }
  if (typeof sku !== 'string' || sku.length === 0) {
    return { product: null, lookupError: null }
  }

  const { data, error } = await lookupRegistrySku(sku)
  if (error) return { product: null, lookupError: error }
  if (
    !data ||
    data.sku_id !== sku ||
    (data.sku_class !== 'star_bundle' && data.sku_class !== 'subscription') ||
    (data.status !== 'sandbox' && data.status !== 'live') ||
    typeof data.price_usd_cents !== 'number' ||
    !Number.isSafeInteger(data.price_usd_cents) ||
    data.price_usd_cents <= 0 ||
    (data.sku_class === 'subscription' &&
      (typeof data.product_id !== 'string' || data.product_id.length === 0)) ||
    (data.sku_class === 'star_bundle' && data.product_id !== null)
  ) {
    return { product: null, lookupError: null }
  }

  return {
    product: {
      sku,
      name: sku,
      amountMinor: data.price_usd_cents,
      currency: 'USD',
      source: 'registry',
      skuClass: data.sku_class,
      productId: typeof data.product_id === 'string' ? data.product_id : null,
    },
    lookupError: null,
  }
}

/** Convert minor units (cents) to the major-unit amount Xsolla expects. */
export function minorToMajor(amountMinor: number): number {
  return Math.round(amountMinor) / 100
}
