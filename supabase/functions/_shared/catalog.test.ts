// Server-side price catalog. Pure module — no Deno.

import { describe, it, expect, vi } from 'vitest'
import {
  PRODUCT_CATALOG,
  lookupProduct,
  minorToMajor,
  resolveCheckoutProduct,
} from './catalog.ts'

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

describe('resolveCheckoutProduct', () => {
  it('preserves the legacy die map without querying the registry', async () => {
    const lookup = vi.fn()
    const resolved = await resolveCheckoutProduct('celestial-gold-d20', lookup)

    expect(resolved.lookupError).toBeNull()
    expect(resolved.product).toMatchObject({
      source: 'legacy_catalog',
      sku: 'celestial-gold-d20',
      catalogItemId: 'celestial-gold/d20/epic@1',
      amountMinor: 499,
    })
    expect(lookup).not.toHaveBeenCalled()
  })

  it.each(['sandbox', 'live'] as const)(
    'accepts a registry non-die row with %s status and exact row price',
    async (status) => {
      const lookup = vi.fn(async () => ({
        data: {
          sku_id: 'stars_handful',
          sku_class: 'star_bundle',
          price_usd_cents: 49,
          status,
          product_id: null,
        },
        error: null,
      }))

      const resolved = await resolveCheckoutProduct('stars_handful', lookup)

      expect(lookup).toHaveBeenCalledWith('stars_handful')
      expect(resolved).toEqual({
        product: {
          source: 'registry',
          sku: 'stars_handful',
          skuClass: 'star_bundle',
          name: 'stars_handful',
          amountMinor: 49,
          currency: 'USD',
          productId: null,
        },
        lookupError: null,
      })
    },
  )

  it('carries the registry Lunar product id without inventing a plan id', async () => {
    const resolved = await resolveCheckoutProduct(
      'lunar_pass_monthly',
      vi.fn(async () => ({
        data: {
          sku_id: 'lunar_pass_monthly',
          sku_class: 'subscription',
          price_usd_cents: 299,
          status: 'sandbox',
          product_id: 'lunar-pass',
        },
        error: null,
      })),
    )

    expect(resolved.product).toMatchObject({
      source: 'registry',
      skuClass: 'subscription',
      productId: 'lunar-pass',
      amountMinor: 299,
    })
    expect(resolved.product).not.toHaveProperty('planId')
  })

  it.each([
    {
      sku_id: 'stars_handful',
      sku_class: 'star_bundle',
      price_usd_cents: 49,
      status: 'draft',
      product_id: null,
    },
    {
      sku_id: 'registry-die',
      sku_class: 'die',
      price_usd_cents: 299,
      status: 'sandbox',
      product_id: null,
    },
    {
      sku_id: 'stars_handful',
      sku_class: 'star_bundle',
      price_usd_cents: 0,
      status: 'sandbox',
      product_id: null,
    },
  ])('fails closed for unavailable/malformed registry row %#', async (data) => {
    const resolved = await resolveCheckoutProduct(
      data.sku_id,
      vi.fn(async () => ({ data, error: null })),
    )
    expect(resolved).toEqual({ product: null, lookupError: null })
  })

  it('keeps registry lookup failures distinct from unknown SKUs', async () => {
    const error = { code: '08006', message: 'connection failure' }
    await expect(
      resolveCheckoutProduct(
        'stars_handful',
        vi.fn(async () => ({ data: null, error })),
      ),
    ).resolves.toEqual({ product: null, lookupError: error })
  })
})
