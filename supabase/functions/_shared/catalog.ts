// Server-side store price catalog (invariant #5 — "never trust client-sent
// price/SKU mapping").
//
// The client sends only an opaque `sku`. THE SERVER decides the price. This map
// is that authoritative price source: it lives in the edge function, is never
// influenced by request bodies, and maps each purchasable SKU to a fixed price
// and to the `catalog_items.id` it grants.
//
// Why a code constant (for now): `catalog_items` (migration 0004) carries
// identity/rarity but no money column, and this sandbox slice deliberately adds
// no store-pricing migration (Packet A / migration 0013 covers orders + ledger,
// not a price book). When a durable `store_prices` table lands, replace
// `lookupProduct` with a service-role SELECT — the call sites already treat this
// as an async-shaped lookup boundary. Until then, prices are pinned in code and
// reviewed here.
//
// Every `catalogItemId` below MUST exist in `catalog_items`; `create-checkout`
// re-validates existence against the DB with the service-role client before
// minting a token, so a typo here fails closed rather than selling a phantom.
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

/** Convert minor units (cents) to the major-unit amount Xsolla expects. */
export function minorToMajor(amountMinor: number): number {
  return Math.round(amountMinor) / 100
}
