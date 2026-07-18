// Server-side price catalog. Pure module — no Deno.

import { describe, it, expect } from 'vitest'
import { PRODUCT_CATALOG, lookupProduct, minorToMajor } from './catalog.ts'

describe('lookupProduct (server-side price source)', () => {
  it('returns the product for a known SKU', () => {
    const product = lookupProduct('celestial-gold-d20')
    expect(product).not.toBeNull()
    expect(product?.amountMinor).toBe(499)
    expect(product?.currency).toBe('USD')
    expect(product?.catalogItemId).toBe('celestial-gold/d20/epic@1')
  })

  it('returns null for unknown, empty, or non-string SKUs (never trusts client)', () => {
    expect(lookupProduct('does-not-exist')).toBeNull()
    expect(lookupProduct('')).toBeNull()
    expect(lookupProduct(undefined)).toBeNull()
    expect(lookupProduct(null)).toBeNull()
    expect(lookupProduct(42)).toBeNull()
    expect(lookupProduct({ sku: 'celestial-gold-d20' })).toBeNull()
  })

  it('every catalog entry maps to a versioned catalog_items id and has a positive price', () => {
    for (const [sku, product] of Object.entries(PRODUCT_CATALOG)) {
      expect(product.sku).toBe(sku)
      expect(product.catalogItemId).toMatch(/@\d+$/)
      expect(product.amountMinor).toBeGreaterThan(0)
      expect(product.currency).toMatch(/^[A-Z]{3}$/)
    }
  })

  it('the catalog is frozen (immutable server truth)', () => {
    expect(Object.isFrozen(PRODUCT_CATALOG)).toBe(true)
  })
})

describe('minorToMajor', () => {
  it('converts minor units (cents) to major units', () => {
    expect(minorToMajor(299)).toBe(2.99)
    expect(minorToMajor(500)).toBe(5)
    expect(minorToMajor(0)).toBe(0)
  })
})
