import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { beforeAll, describe, expect, it } from 'vitest'

let source = ''

beforeAll(async () => {
  source = await readFile(
    resolve(process.cwd(), 'supabase/functions/create-checkout/index.ts'),
    'utf8',
  )
})

describe('create-checkout registry wiring', () => {
  it('filters registry reads to non-die sandbox/live rows', () => {
    expect(source).toMatch(
      /\.from\('store_skus'\)[\s\S]*?\.eq\('sku_id', registrySku\)[\s\S]*?\.in\('sku_class', \['star_bundle', 'subscription'\]\)[\s\S]*?\.in\('status', \['sandbox', 'live'\]\)/,
    )
  })

  it('keeps the legacy RPC and routes registry SKUs through the derived-price RPC', () => {
    expect(source).toMatch(
      /service\.rpc\('create_payment_order', \{[\s\S]*?p_catalog_item_id: args\.catalogItemId[\s\S]*?p_amount_minor: args\.amountMinor/,
    )
    expect(source).toMatch(
      /service\.rpc\('create_sku_payment_order', \{[\s\S]*?p_sku_id: args\.skuId[\s\S]*?p_currency: args\.currency[\s\S]*?p_dry_run: args\.dryRun/,
    )
    expect(source).not.toMatch(
      /service\.rpc\('create_sku_payment_order', \{[\s\S]*?p_amount_minor/,
    )
  })

  it('mints registry checkout from the amount persisted and returned by SQL', () => {
    expect(source).toMatch(
      /if \(product\.source === 'registry'\)[\s\S]*?checkoutAmountMinor = orderRow\.amount_minor/,
    )
    expect(source).toMatch(/amount: minorToMajor\(checkoutAmountMinor\)/)
  })

  it('fails closed without the provider-owned Lunar plan and wires no invented id', () => {
    expect(source).toMatch(/Deno\.env\.get\('XSOLLA_LUNAR_PLAN_ID'\)/)
    expect(source).toMatch(
      /if \(!planId \|\| !product\.productId\)[\s\S]*?code: 'CATALOG_MISCONFIGURED'/,
    )
    expect(source).toMatch(
      /xsollaSubscription = \{ planId, productId: product\.productId \}/,
    )
    expect(source).toMatch(/subscription: xsollaSubscription/)
    expect(source).not.toMatch(/planId:\s*['"][^'"]+['"]/)
  })
})
