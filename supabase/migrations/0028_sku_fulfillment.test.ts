import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { beforeAll, describe, expect, it } from 'vitest'

const migrationPath = resolve(process.cwd(), 'supabase/migrations/0028_sku_fulfillment.sql')
const foundationPath = resolve(process.cwd(), 'supabase/migrations/0013_paid_checkout_foundation.sql')
const behavioralPath = resolve(process.cwd(), 'supabase/tests/0028_sku_fulfillment.test.sql')
const concurrencyPath = resolve(process.cwd(), 'supabase/tests/0028_sku_fulfillment.test.mjs')
const specPath = resolve(
  process.cwd(),
  'docs/exec-plans/active/2026-07-22-monetization-economy-spec.md',
)

let sql = ''
let foundationSql = ''
let behavioralSql = ''
let concurrencySource = ''
let spec = ''

beforeAll(async () => {
  [sql, foundationSql, behavioralSql, concurrencySource, spec] = await Promise.all([
    readFile(migrationPath, 'utf8'),
    readFile(foundationPath, 'utf8'),
    readFile(behavioralPath, 'utf8'),
    readFile(concurrencyPath, 'utf8'),
    readFile(specPath, 'utf8'),
  ])
})

function functionSql(source: string, schema: 'public' | 'private', name: string) {
  return (
    source.match(
      new RegExp(
        `create or replace function ${schema}\\.${name}\\([\\s\\S]*?\\n\\$\\$;`,
        'i',
      ),
    )?.[0] ?? ''
  )
}

function executable(source: string) {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/--[^\r\n]*/g, '')
}

function normalized(source: string) {
  return executable(source).replace(/\s+/g, ' ').trim()
}

function legacyEntitlementDml(source: string) {
  const fulfill = functionSql(source, 'public', 'fulfill_payment_order')
  return (
    fulfill.match(
      /insert into public\.user_entitlements \([\s\S]*?return result_order;/i,
    )?.[0] ?? ''
  )
}

describe('0028 SKU fulfillment', () => {
  it('models first purchase as a unique immutable anchor plus append-only events', () => {
    expect(sql).toMatch(/create table public\.star_bundle_first_purchases/i)
    expect(sql).toMatch(
      /constraint star_bundle_first_purchases_user_sku_unique\s+unique \(user_id, sku_id\)/i,
    )
    expect(sql).toMatch(
      /event_type\s+text\s+not null check \(event_type in \('granted', 'reversed'\)\)/i,
    )
    for (const table of [
      'star_bundle_first_purchases',
      'star_bundle_fulfillments',
      'star_bundle_first_purchase_events',
      'payment_refund_reversals',
      'unresolved_payment_reversals',
      'lunar_order_invoices',
      'payment_refund_intents',
    ]) {
      expect(sql).toMatch(
        new RegExp(
          `create trigger ${table}_reject_update_delete[\\s\\S]*?before update or delete on public\\.${table}`,
          'i',
        ),
      )
      expect(sql).toMatch(
        new RegExp(
          `create trigger ${table}_reject_truncate[\\s\\S]*?before truncate on public\\.${table}`,
          'i',
        ),
      )
    }
  })

  it('pins the amount/version/source ledger used by every bundle refund', () => {
    expect(sql).toMatch(
      /credited_stars\s+bigint\s+not null[\s\S]*?sku_value_version\s+integer\s+not null[\s\S]*?wallet_ledger_entry_id\s+bigint\s+not null unique/i,
    )
    const refund = functionSql(sql, 'public', 'refund_payment_order')
    expect(refund).toMatch(
      /-bundle_fulfillment\.credited_stars[\s\S]*?'sourceLedgerEntryId', bundle_fulfillment\.wallet_ledger_entry_id/i,
    )
    expect(refund).not.toMatch(/target_sku\.(?:star_total|first_time_total)/i)
    expect(sql).toMatch(
      /add column sku_value_version integer,[\s\S]*?add column sku_price_usd_cents integer,[\s\S]*?add column sku_star_total integer,[\s\S]*?add column sku_first_time_total integer,[\s\S]*?add column sku_product_id text/i,
    )
    expect(sql).toMatch(
      /create trigger payment_orders_preserve_sku_snapshot[\s\S]*?private\.preserve_payment_order_sku_snapshot\(\)/i,
    )
  })

  it('derives non-die order price/status in SQL and rejects draft or registry die rows', () => {
    const create = functionSql(sql, 'public', 'create_sku_payment_order')
    expect(create).toMatch(/from public\.store_skus\s+where sku_id = p_sku_id/i)
    expect(create).toMatch(/target_sku\.status not in \('sandbox', 'live'\)/i)
    expect(create).toMatch(/target_sku\.sku_class not in \('star_bundle', 'subscription'\)/i)
    expect(create).toMatch(
      /target_sku\.sku_id,\s*target_sku\.value_version,\s*target_sku\.price_usd_cents,\s*target_sku\.star_total,\s*target_sku\.first_time_total,\s*target_sku\.product_id,\s*target_sku\.price_usd_cents,\s*p_currency,\s*p_dry_run/i,
    )
    expect(sql).toMatch(
      /grant execute on function public\.create_sku_payment_order\(uuid, text, text, boolean\)\s+to service_role/i,
    )
  })

  it('credits first-time double raw once, standard thereafter, and restores eligibility on covered refund', () => {
    const fulfill = functionSql(sql, 'public', 'fulfill_payment_order')
    const refund = functionSql(sql, 'public', 'refund_payment_order')
    expect(fulfill).toMatch(
      /first_time_eligible := not exists[\s\S]*?event_type = 'granted'[\s\S]*?event_type = 'reversed'/i,
    )
    expect(fulfill).toMatch(
      /when first_time_eligible then target_order\.sku_first_time_total\s+else target_order\.sku_star_total/i,
    )
    expect(fulfill).toMatch(
      /'stars',\s*'paid',\s*stars_to_credit,\s*'purchase\.star_bundle'/i,
    )
    expect(refund).toMatch(
      /if bundle_fulfillment\.first_time_applied then[\s\S]*?'reversed'/i,
    )
  })

  it('admits only an exact bound paid refund through the canonical append guards', () => {
    const append = functionSql(sql, 'public', 'append_wallet_ledger_entry')
    expect(append).toMatch(
      /p_balance_bucket = 'paid' and p_delta_amount < 0[\s\S]*?p_reason_code is distinct from 'purchase\.refund'/i,
    )
    expect(append).toMatch(
      /from public\.payment_refund_intents as intent[\s\S]*?intent\.reversal_amount = p_delta_amount[\s\S]*?p_delta_amount = -fulfillment\.credited_stars[\s\S]*?sourceLedgerEntryId/i,
    )
    for (const guard of [
      'Idempotency key % was already used with a different wallet payload',
      'Insufficient %/% balance',
      'Wallet balance overflow',
      'Insufficient available %/% balance after active holds',
    ]) {
      expect(append).toContain(guard)
    }
    expect(sql).toMatch(
      /grant execute on function public\.append_wallet_ledger_entry\([\s\S]*?\)\s+to service_role/i,
    )
  })

  it('correlates every signed Lunar invoice and refunds one without poisoning the order', () => {
    const fulfill = functionSql(sql, 'public', 'fulfill_payment_order')
    const refund = functionSql(sql, 'public', 'refund_payment_order')
    const invoiceTable =
      sql.match(
        /create table public\.lunar_order_invoices \([\s\S]*?\n\);/i,
      )?.[0] ?? ''
    expect(invoiceTable).toMatch(
      /lunar_purchase_grant_id\s+bigint\s+not null unique/i,
    )
    expect(invoiceTable).not.toMatch(
      /lunar_purchase_grant_id[\s\S]*?references public\.lunar_purchase_star_grants/i,
    )
    expect(executable(sql)).not.toMatch(
      /alter table(?:\s+only)?\s+public\.lunar_order_invoices\b[^;]*\bforeign key\s*\(\s*lunar_purchase_grant_id\s*\)[^;]*\breferences\s+public\.lunar_purchase_star_grants\b[^;]*;/i,
    )
    expect(invoiceTable).toContain(
      'migration 0024 makes Lunar grant receipts\n  -- ordering-independent',
    )
    expect(fulfill).toMatch(/p_event_type <> 'payment'/i)
    expect(fulfill).toMatch(/p_raw_event #> '\{purchase,subscription\}'/i)
    expect(fulfill).toMatch(
      /lunar_grant := public\.grant_lunar_purchase_stars\(\s*target_order\.user_id,\s*p_xsolla_transaction_id,\s*lunar_subscription_id,\s*lunar_plan_id,\s*lunar_product_id/i,
    )
    expect(fulfill).toMatch(
      /insert into public\.lunar_order_invoices[\s\S]*?p_xsolla_transaction_id[\s\S]*?lunar_grant\.id/i,
    )
    expect(fulfill).toMatch(
      /if p_external_id is null then[\s\S]*?lunar_order_invoices[\s\S]*?subscription_id = lunar_subscription_id[\s\S]*?count\(distinct invoices\.order_id\) = 1/i,
    )
    expect(fulfill).toMatch(
      /target_order\.status = 'fulfilled'[\s\S]*?p_event_type = 'payment'[\s\S]*?return target_order/i,
    )
    expect(refund).toMatch(
      /from public\.lunar_order_invoices[\s\S]*?xsolla_transaction_id = p_xsolla_transaction_id[\s\S]*?lunar_invoice\.lunar_purchase_grant_id/i,
    )
    expect(refund).toMatch(
      /-lunar_grant\.credited_stars,\s*'lunar\.purchase\.refund'/i,
    )
    expect(refund).toMatch(
      /A refunded invoice does not poison the recurring subscription order[\s\S]*?return target_order/i,
    )
  })

  it('locks the first-purchase anchor before wallet state and has a two-session proof', () => {
    const refund = functionSql(sql, 'public', 'refund_payment_order')
    expect(refund).toMatch(
      /from public\.star_bundle_first_purchases[\s\S]*?for update;[\s\S]*?private\.available_wallet_balance_for_reversal/i,
    )
    expect(concurrencySource).toContain('Promise.all')
    expect(concurrencySource).toContain('Concurrent 0028 refund failed')
    expect(concurrencySource).toContain('Concurrent 0028 fulfillment failed')
    expect(concurrencySource).toContain('0028 anchor-wallet lock order drifted')
  })

  it('commits unresolved insolvency evidence with a non-aborting 55000 LOG path', () => {
    const refund = functionSql(sql, 'public', 'refund_payment_order')
    const unresolvedBranches =
      refund.match(
        /if available_stars < [\s\S]*?raise log[\s\S]*?using errcode = '55000';\s*return target_order;\s*end if;/gi,
      ) ?? []
    expect(unresolvedBranches).toHaveLength(2)
    for (const branch of unresolvedBranches) {
      expect(branch).toMatch(/insert into public\.unresolved_payment_reversals/i)
      expect(branch).not.toMatch(/raise exception/i)
    }
  })

  it('preserves the executable legacy entitlement DML from 0013', () => {
    const original = legacyEntitlementDml(foundationSql)
    const current = legacyEntitlementDml(sql)
    expect(original).not.toBe('')
    expect(current).not.toBe('')
    expect(normalized(current)).toBe(normalized(original))
    expect(functionSql(sql, 'public', 'refund_payment_order')).toMatch(
      /if target_order\.entitlement_created then\s+update public\.user_entitlements\s+set revoked_at = now\(\)\s+where id = target_order\.entitlement_id\s+and user_id = target_order\.user_id\s+and revoked_at is null;/i,
    )
  })

  it('backs the money-path regex contract with the required behavioral suite', () => {
    const behavior = executable(behavioralSql)
    for (const evidence of [
      'Registry checkout did not derive the sandbox SKU price and binding',
      'Draft Store SKU unexpectedly became sellable',
      'First bundle purchase did not credit double-raw paid Stars and flag exactly once',
      'Bundle fulfillment replay appended a second credit',
      'Subsequent bundle purchase did not use the standard Star total',
      'Covered refund did not reverse exact credit and first-purchase event',
      'Refunded first purchase did not restore double-raw eligibility',
      'Direct service paid reversal unexpectedly bypassed exact refund intent',
      'Insolvent refund did not remain durable, unresolved, and non-mutating',
      'Lunar payment did not grant exactly 300 once per invoice',
      'Distinct Lunar renewal invoice did not grant exactly once',
      'Lunar invoice refund did not reverse exactly 300 without poisoning the order',
      'Second Lunar reversal type re-reversed one invoice',
      'Refunded Lunar invoice poisoned a later renewal invoice',
      'Legacy die fulfillment changed under SKU branching',
      'Legacy die refund changed under SKU branching',
      'Registry retune changed an existing order fulfillment snapshot',
      'Payment order SKU snapshot mutation unexpectedly succeeded',
      'SKU fulfillment privilege boundary drifted',
      'Authenticated registry order creation unexpectedly succeeded',
      'First-purchase history update unexpectedly succeeded',
    ]) {
      expect(behavior).toContain(evidence)
    }
  })

  it('records covered-refund re-eligibility while leaving insolvency open in spec section 7', () => {
    expect(spec).toContain('First-time-bonus insolvent-refund semantics')
    expect(spec).toContain('later purchase of that SKU is first-time-eligible again')
    expect(spec).toContain('Still open:')
    expect(spec).toContain('immutable\n  unresolved reversal')
  })
})
