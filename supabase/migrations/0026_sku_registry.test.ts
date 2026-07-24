import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { beforeAll, describe, expect, it } from 'vitest'

const migrationPath = resolve(
  process.cwd(),
  'supabase/migrations/0026_sku_registry.sql',
)
const behavioralPath = resolve(
  process.cwd(),
  'supabase/tests/0026_sku_registry.test.sql',
)

let sql = ''
let executableBehavioralSql = ''

beforeAll(async () => {
  const [migrationSource, behavioralSource] = await Promise.all([
    readFile(migrationPath, 'utf8'),
    readFile(behavioralPath, 'utf8'),
  ])
  sql = migrationSource
  executableBehavioralSql = stripSqlComments(behavioralSource)
})

function stripSqlComments(source: string) {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/--[^\r\n]*/g, '')
}

function functionSql(schema: 'public' | 'private', name: string) {
  return (
    sql.match(
      new RegExp(
        `create or replace function ${schema}\\.${name}\\([\\s\\S]*?\\n\\$\\$;`,
        'i',
      ),
    )?.[0] ?? ''
  )
}

function roleBlockContaining(role: string, marker: string) {
  const blocks =
    executableBehavioralSql.match(
      new RegExp(`set local role ${role};[\\s\\S]*?reset role;`, 'gi'),
    ) ?? []

  return (
    blocks.find((block) =>
      block.toLowerCase().includes(marker.toLowerCase()),
    ) ?? ''
  )
}

describe('0026 non-die SKU registry', () => {
  it('defines a closed NULL-safe SKU class and field-shape union', () => {
    expect(sql).toMatch(/create table public\.store_skus/i)
    expect(sql).toMatch(/sku_id\s+text\s+primary key/i)
    expect(sql).toMatch(
      /sku_class\s+text\s+not null check \(\s*sku_class in \('star_bundle', 'subscription', 'die'\)/i,
    )
    expect(sql).toMatch(
      /price_usd_cents\s+integer\s+not null check \(price_usd_cents > 0\)/i,
    )
    expect(sql).toMatch(
      /catalog_item_id\s+text\s+references public\.catalog_items \(id\) on delete restrict/i,
    )
    expect(sql).toMatch(
      /status\s+text\s+not null default 'draft' check \(\s*status in \('draft', 'sandbox', 'live'\)/i,
    )

    const shape =
      sql.match(
        /constraint store_skus_class_field_shape check \([\s\S]*?\n\s*\),\n\s*constraint store_skus_star_amounts/i,
      )?.[0] ?? ''

    expect(shape).toMatch(
      /sku_class = 'star_bundle'[\s\S]*?star_raw is not null[\s\S]*?star_bonus is not null[\s\S]*?star_total is not null[\s\S]*?first_time_total is not null[\s\S]*?product_id is null[\s\S]*?catalog_item_id is null/i,
    )
    expect(shape).toMatch(
      /sku_class = 'subscription'[\s\S]*?star_raw is null[\s\S]*?star_bonus is null[\s\S]*?star_total is null[\s\S]*?first_time_total is null[\s\S]*?product_id is not null[\s\S]*?catalog_item_id is null/i,
    )
    expect(shape).toMatch(
      /sku_class = 'die'[\s\S]*?star_raw is null[\s\S]*?star_bonus is null[\s\S]*?star_total is null[\s\S]*?first_time_total is null[\s\S]*?product_id is null[\s\S]*?catalog_item_id is not null/i,
    )
  })

  it('enforces exact standard and first-time Star bundle arithmetic', () => {
    expect(sql).toMatch(
      /constraint store_skus_star_amounts check \([\s\S]*?sku_class <> 'star_bundle' or \([\s\S]*?star_raw is not null[\s\S]*?star_raw > 0[\s\S]*?star_bonus is not null[\s\S]*?star_bonus >= 0[\s\S]*?star_total is not null[\s\S]*?star_total = star_raw \+ star_bonus[\s\S]*?first_time_total is not null[\s\S]*?first_time_total = star_raw \* 2/i,
    )
  })

  it('seeds the six locked bundles and canonical Lunar SKU in sandbox', () => {
    for (const row of [
      ['stars_handful', 49, 60, 0, 60, 120],
      ['stars_pouch', 249, 300, 30, 330, 600],
      ['stars_bag', 749, 980, 110, 1090, 1960],
      ['stars_chest', 1499, 1980, 260, 2240, 3960],
      ['stars_vault', 2499, 3280, 600, 3880, 6560],
      ['stars_hoard', 4999, 6480, 1600, 8080, 12960],
    ] as const) {
      const [sku, price, raw, bonus, total, firstTime] = row
      expect(sql).toMatch(
        new RegExp(
          `\\('${sku}',\\s*'star_bundle',\\s*${price},\\s*${raw},\\s*${bonus},\\s*${total},\\s*${firstTime},\\s*null,\\s*null,\\s*'sandbox',\\s*1\\)`,
          'i',
        ),
      )
    }
    expect(sql).toMatch(
      /\('lunar_pass_monthly',\s*'subscription',\s*299,\s*null,\s*null,\s*null,\s*null,\s*'lunar-pass',\s*null,\s*'sandbox',\s*1\)/i,
    )
  })

  it('keeps identity and class immutable while requiring sequential versions and a server-owned timestamp', () => {
    const guard = functionSql('private', 'enforce_store_sku_update')

    expect(guard).toMatch(
      /new\.sku_id is distinct from old\.sku_id[\s\S]*?errcode = '22023'/i,
    )
    expect(guard).toMatch(
      /new\.sku_class is distinct from old\.sku_class[\s\S]*?errcode = '55000'/i,
    )
    expect(guard).toMatch(
      /new\.price_usd_cents,\s*new\.star_raw,\s*new\.star_bonus,\s*new\.star_total,\s*new\.first_time_total,\s*new\.product_id,\s*new\.catalog_item_id[\s\S]*?is distinct from[\s\S]*?old\.price_usd_cents,\s*old\.star_raw,\s*old\.star_bonus,\s*old\.star_total,\s*old\.first_time_total,\s*old\.product_id,\s*old\.catalog_item_id/i,
    )
    expect(guard).toMatch(
      /if sku_payload_changed then[\s\S]*?new\.value_version <> old\.value_version \+ 1/i,
    )
    expect(guard).toMatch(
      /elsif new\.value_version <> old\.value_version/i,
    )
    expect(guard).toMatch(/new\.updated_at := clock_timestamp\(\)/i)
    expect(sql).toMatch(
      /create trigger store_skus_enforce_update\s+before update on public\.store_skus[\s\S]*?private\.enforce_store_sku_update\(\)/i,
    )
  })

  it('adds an indexed exactly-one order binding without rewriting fulfillment', () => {
    const createOrderProbe = roleBlockContaining(
      'service_role',
      'public.create_payment_order',
    )

    expect(sql).toMatch(
      /alter table public\.payment_orders\s+alter column catalog_item_id drop not null,\s+add column sku_id text\s+references public\.store_skus \(sku_id\) on delete restrict/i,
    )
    expect(sql).toMatch(
      /constraint payment_orders_exactly_one_product_binding check \(\s*\(\s*catalog_item_id is not null and\s*sku_id is null\s*\) or \(\s*catalog_item_id is null and\s*sku_id is not null/i,
    )
    expect(sql).toMatch(
      /create index payment_orders_sku_idx\s+on public\.payment_orders \(sku_id\)\s+where sku_id is not null/i,
    )
    expect(sql).not.toMatch(
      /create or replace function public\.(?:create|fulfill|refund)_payment_order/i,
    )
    expect(sql).not.toMatch(/append_wallet_ledger_entry/i)
    expect(createOrderProbe).toMatch(
      /select \*\s+into strict created\s+from public\.create_payment_order\(\s*'c0260000-0000-4026-8026-000000000001',\s*'void-crystal\/d20\/legendary@1',\s*499,\s*'USD',\s*true\s*\)/i,
    )
    expect(createOrderProbe).toMatch(
      /if created\.sku_id is not null then\s+raise exception 'Post-0026 create_payment_order returned non-NULL sku_id'/i,
    )
    expect(createOrderProbe).toMatch(
      /if created\.catalog_item_id is distinct from 'void-crystal\/d20\/legendary@1' or\s+num_nonnulls\(created\.catalog_item_id, created\.sku_id\) <> 1 then\s+raise exception 'Post-0026 create_payment_order did not return exactly one die binding'/i,
    )
    expect(createOrderProbe).toMatch(
      /select count\(\*\)\s+from public\.payment_orders\s+where id = created\.id\s+and catalog_item_id is not null\s+and sku_id is null\s+\) <> 1 then\s+raise exception 'Post-0026 create_payment_order did not persist exactly one die order'/i,
    )
  })

  it('allows authenticated available-row reads and only service writes', () => {
    expect(sql).toMatch(
      /alter table public\.store_skus enable row level security/i,
    )
    expect(sql).toMatch(
      /alter table public\.store_skus force row level security/i,
    )
    expect(sql).toMatch(
      /create policy "authenticated users read available store skus"[\s\S]*?for select\s+to authenticated\s+using \(status in \('sandbox', 'live'\)\)/i,
    )
    expect(sql).toMatch(
      /revoke all on table public\.store_skus\s+from public, anon, authenticated, service_role/i,
    )
    expect(sql).toMatch(
      /grant select on table public\.store_skus\s+to authenticated, service_role/i,
    )
    expect(sql).toMatch(
      /grant insert, update on table public\.store_skus\s+to service_role/i,
    )
    expect(sql).not.toMatch(
      /grant (?:insert|update|delete|truncate|all)[^;]*public\.store_skus[^;]*to (?:anon|authenticated)/i,
    )
  })

  it('backs static contracts with runtime constraint, RLS, compatibility, and version probes', () => {
    const reclassProbe = roleBlockContaining(
      'service_role',
      "set sku_class = 'die'",
    )

    expect(reclassProbe).toMatch(
      /update public\.store_skus\s+set sku_class = 'die',\s+product_id = null,\s+catalog_item_id = 'void-crystal\/d20\/legendary@1',\s+value_version = value_version \+ 1\s+where sku_id = 'test_live_subscription'/i,
    )
    expect(reclassProbe).toMatch(
      /raise exception 'Store SKU reclass unexpectedly succeeded';\s+exception when sqlstate '55000' then\s+null;/i,
    )

    for (const evidence of [
      'Store SKU seed rows drifted from spec sections 2 and 3.1',
      'NULL star_raw hole unexpectedly succeeded',
      'Star bundle with catalog_item_id unexpectedly succeeded',
      'Subscription with catalog_item_id unexpectedly succeeded',
      'Die SKU with product_id unexpectedly succeeded',
      'Both payment-order bindings unexpectedly succeeded',
      'Neither payment-order binding unexpectedly succeeded',
      'Old-style catalog payment order was not preserved',
      'Post-0026 create_payment_order returned non-NULL sku_id',
      'Post-0026 create_payment_order did not return exactly one die binding',
      'Post-0026 create_payment_order did not persist exactly one die order',
      'Authenticated SKU read surface leaked draft or hid available rows',
      'Authenticated Store SKU update unexpectedly succeeded',
      'Store SKU reclass unexpectedly succeeded',
      'Same-version Store SKU retune unexpectedly succeeded',
      'Payload-free Store SKU version bump unexpectedly succeeded',
      'Store SKU retune/version/timestamp discipline drifted',
    ]) {
      expect(executableBehavioralSql).toContain(evidence)
    }
  })
})
