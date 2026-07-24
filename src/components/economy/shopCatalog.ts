/**
 * Canonical client-side UI constants for the free roll conversion and the
 * PO-locked preview bundles.
 *
 * The server RPC remains authoritative for debit validation. The conversion
 * rate comes from monetization economy spec §1.3; bundle amounts and prices
 * come from §2.
 */
export const STARS_PER_STANDARD_ROLL = 160
/** Matches walletBalances.ts and the RPC's accepted p_roll_count range. */
export const MAX_STANDARD_ROLL_CONVERSION_COUNT = 100
export const STANDARD_ROLL_CONVERSION_AVAILABLE = true

export interface StarBundlePreview {
  sku: string
  name: string
  stars: number
  priceUsd: string
}

export const STAR_BUNDLE_PREVIEWS: readonly StarBundlePreview[] = [
  { sku: 'stars_handful', name: 'Handful', stars: 60, priceUsd: '0.49' },
  { sku: 'stars_pouch', name: 'Pouch', stars: 330, priceUsd: '2.49' },
  { sku: 'stars_bag', name: 'Bag', stars: 1090, priceUsd: '7.49' },
  { sku: 'stars_chest', name: 'Chest', stars: 2240, priceUsd: '14.99' },
  { sku: 'stars_vault', name: 'Vault', stars: 3880, priceUsd: '24.99' },
  { sku: 'stars_hoard', name: 'Hoard', stars: 8080, priceUsd: '49.99' },
] as const
