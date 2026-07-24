import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { beforeAll, describe, expect, it } from 'vitest'

const migrationPath = resolve(
  process.cwd(),
  'supabase/migrations/0022_scrap_craft_economy.sql',
)
const behavioralPath = resolve(
  process.cwd(),
  'supabase/tests/0022_scrap_craft_economy.test.sql',
)

let sql = ''
let behavioralSql = ''

beforeAll(async () => {
  const loadedSql = await Promise.all([
    readFile(migrationPath, 'utf8'),
    readFile(behavioralPath, 'utf8'),
  ])
  sql = loadedSql[0]
  behavioralSql = loadedSql[1]
})

function functionSql(schema: 'public' | 'private', name: string) {
  return sql.match(
    new RegExp(
      `create or replace function ${schema}\\.${name}\\([\\s\\S]*?\\n\\$\\$;`,
      'i',
    ),
  )?.[0] ?? ''
}

describe('0022 Scrap Dust and owned-copy craft economy', () => {
  it('stores one retunable row for every actual catalog rarity', () => {
    expect(sql).toMatch(/create table public\.dice_economy_values/i)
    expect(sql).toMatch(/catalog_rarity\s+text\s+primary key/i)
    expect(sql).toMatch(/scrap_yield\s+bigint\s+not null check \(scrap_yield > 0\)/i)
    expect(sql).toMatch(
      /craft_cost\s+bigint\s+check \(\s*craft_cost is null or craft_cost > scrap_yield/i,
    )
    expect(sql).toMatch(
      /\('common',\s*'standard',\s*1,\s*210,\s*1,\s*'proposed-po-pending'\)/i,
    )
    expect(sql).toMatch(
      /\('uncommon',\s*'standard',\s*1,\s*210,\s*1,\s*'proposed-po-pending'\)/i,
    )
    expect(sql).toMatch(
      /\('rare',\s*'rare',\s*4,\s*220,\s*1,\s*'proposed-po-pending'\)/i,
    )
    expect(sql).toMatch(
      /\('epic',\s*'epic',\s*10,\s*615,\s*1,\s*'proposed-po-pending'\)/i,
    )
    expect(sql).toMatch(
      /\('legendary',\s*'signature',\s*25,\s*2500,\s*1,\s*'proposed-po-pending'\)/i,
    )
    expect(sql).toMatch(
      /\('mythic',\s*'mythic',\s*50,\s*null,\s*1,\s*'proposed-po-pending'\)/i,
    )
    expect(sql).toMatch(
      /PROPOSED \/ PO-pending values from the spec section 7 table[\s\S]*?DUST-SIM-REPORT\.md rev 2/i,
    )
    expect(sql).toMatch(
      /grant insert, update on table public\.dice_economy_values\s+to service_role/i,
    )
  })

  it('makes the value table public-read RLS with no client writes', () => {
    expect(sql).toMatch(
      /alter table public\.dice_economy_values enable row level security/i,
    )
    expect(sql).toMatch(
      /alter table public\.dice_economy_values force row level security/i,
    )
    expect(sql).toMatch(
      /create policy "economy values are publicly readable"[\s\S]*?for select\s+to anon, authenticated\s+using \(true\)/i,
    )
    expect(sql).toMatch(
      /revoke all on table public\.dice_economy_values\s+from public, anon, authenticated, service_role/i,
    )
    expect(sql).toMatch(
      /grant select on table public\.dice_economy_values\s+to anon, authenticated, service_role/i,
    )
    expect(sql).not.toMatch(
      /grant (?:insert|update|delete|truncate|all)[^;]*public\.dice_economy_values[^;]*to (?:anon|authenticated)/i,
    )
  })

  it('enforces immutable identities and meaningful sequential value versions', () => {
    const guard = functionSql(
      'private',
      'enforce_dice_economy_value_update',
    )

    expect(guard).toMatch(
      /new\.catalog_rarity is distinct from old\.catalog_rarity[\s\S]*?errcode = '22023'/i,
    )
    expect(guard).toMatch(
      /new\.economy_tier,\s*new\.scrap_yield,\s*new\.craft_cost[\s\S]*?is distinct from[\s\S]*?old\.economy_tier,\s*old\.scrap_yield,\s*old\.craft_cost/i,
    )
    expect(guard).toMatch(
      /economic_payload_changed[\s\S]*?new\.value_version <> old\.value_version \+ 1/i,
    )
    expect(guard).toMatch(
      /elsif new\.value_version <> old\.value_version/i,
    )
    expect(guard).toMatch(/new\.updated_at := clock_timestamp\(\)/i)
    expect(sql).toMatch(
      /`status` is governance metadata only[\s\S]*?status-only transition keeps the current version/i,
    )
    expect(sql).toMatch(
      /create trigger dice_economy_values_enforce_update\s+before update on public\.dice_economy_values[\s\S]*?private\.enforce_dice_economy_value_update\(\)/i,
    )
  })

  it('keeps every catalog rarity in a shared economy tier on one price', () => {
    const guard = functionSql(
      'private',
      'assert_dice_economy_tier_value_equality',
    )

    expect(guard).toMatch(
      /right_value\.economy_tier = left_value\.economy_tier[\s\S]*?left_value\.scrap_yield,\s*left_value\.craft_cost[\s\S]*?is distinct from[\s\S]*?right_value\.scrap_yield,\s*right_value\.craft_cost/i,
    )
    expect(guard).toMatch(
      /Every economy tier must use one Scrap yield and craft cost[\s\S]*?errcode = '55000'/i,
    )
    expect(sql).toMatch(
      /create trigger dice_economy_values_shared_tier_equality\s+after insert or update\s+on public\.dice_economy_values\s+for each statement\s+execute function private\.assert_dice_economy_tier_value_equality\(\)/i,
    )
    expect(sql).not.toMatch(
      /dice_economy_values_shared_tier_equality[\s\S]{0,160}deferrable/i,
    )
  })

  it('credits valued Scrap atomically through the canonical ledger append', () => {
    const engine = functionSql('private', 'scrap_dice_copy_for_user')
    const wrapper = functionSql('public', 'scrap_dice_copy')

    expect(engine).toMatch(/security definer/i)
    expect(engine).toContain("set search_path = ''")
    expect(engine).toMatch(
      /target_account := private\.lock_wallet_account\(p_user_id\)/i,
    )
    expect(engine).toMatch(
      /join public\.dice_economy_values as economy\s+on economy\.catalog_rarity = items\.rarity/i,
    )
    expect(engine).toMatch(
      /scrapped_copy := private\.record_dice_copy_scrap\([\s\S]*?wallet_entry := public\.append_wallet_ledger_entry\(\s*p_user_id,\s*'dust',\s*'earned',\s*economy_value\.scrap_yield,\s*'dice\.scrap\.dust\.credit'/i,
    )
    expect(engine).toMatch(
      /'scrap-dust:' \|\| encode\([\s\S]*?extensions\.digest\([\s\S]*?p_idempotency_key/i,
    )
    expect(engine).toMatch(
      /if has_wallet_entry then[\s\S]*?Scrap replay receipt drifted from its wallet append[\s\S]*?return private\.scrap_dice_copy_receipt\(existing_copy, wallet_entry\)/i,
    )
    expect(engine).toMatch(
      /Compatibility upgrade for a marker written before 0022 existed[\s\S]*?join public\.dice_economy_values as economy[\s\S]*?wallet_entry := public\.append_wallet_ledger_entry\([\s\S]*?economy_value\.scrap_yield/i,
    )
    expect(wrapper).toMatch(
      /caller_id := private\.require_non_anonymous_user\(\)[\s\S]*?private\.scrap_dice_copy_for_user\(\s*caller_id/i,
    )
    expect(sql).toMatch(
      /grant execute on function public\.scrap_dice_copy\(uuid, text\)\s+to authenticated/i,
    )
  })

  it('turns the legacy marker name into a valued compatibility path', () => {
    const compatibility = functionSql('public', 'scrap_dice_copy_marker')

    expect(compatibility).toMatch(
      /private\.scrap_dice_copy_for_user\(\s*caller_id,\s*p_copy_id,\s*p_idempotency_key/i,
    )
    expect(sql).toMatch(
      /Deprecated compatibility name\. Performs the full valued Scrap operation/i,
    )
  })

  it('crafts only an already-owned live die with a wallet-first debit', () => {
    const engine = functionSql('private', 'craft_dice_copy_for_user')

    expect(engine).toMatch(/security definer/i)
    expect(engine).toContain("set search_path = ''")
    expect(engine).toMatch(
      /target_account := private\.lock_wallet_account\(p_user_id\)/i,
    )
    expect(engine).toMatch(
      /craft_cost is null then[\s\S]*?errcode = '55000'/i,
    )
    expect(engine).toMatch(
      /from public\.dice_copies\s+where user_id = p_user_id\s+and catalog_item_id = p_catalog_item_id\s+and scrapped_at is null/i,
    )
    expect(engine).toMatch(
      /wallet_entry := public\.append_wallet_ledger_entry\(\s*p_user_id,\s*'dust',\s*'earned',\s*-economy_value\.craft_cost,\s*'dice\.craft\.dust\.debit'/i,
    )
    expect(engine).toMatch(
      /granted_copy := public\.record_dice_copy_grant\(\s*p_user_id,\s*p_catalog_item_id,\s*'craft'/i,
    )
    expect(engine.indexOf('append_wallet_ledger_entry'))
      .toBeLessThan(engine.indexOf('record_dice_copy_grant'))
    expect(sql).toMatch(
      /grant execute on function public\.craft_dice_copy\(text, text\)\s+to authenticated/i,
    )
  })

  it('replays immutable receipts and rejects payload drift', () => {
    const scrap = functionSql('private', 'scrap_dice_copy_for_user')
    const craft = functionSql('private', 'craft_dice_copy_for_user')

    expect(scrap).toMatch(
      /existing_copy\.id <> p_copy_id[\s\S]*?already used with a different dice-copy scrap payload/i,
    )
    expect(scrap).toMatch(
      /Scrap replay receipt drifted from its wallet append[\s\S]*?errcode = '55000'/i,
    )
    expect(scrap).toMatch(
      /return private\.scrap_dice_copy_receipt\(existing_copy, wallet_entry\)/i,
    )
    for (const [field, expected] of [
      ['operation', "'scrap'"],
      ['copy_id', 'p_copy_id::text'],
      ['catalog_item_id', 'existing_copy.catalog_item_id'],
      ['scrap_idempotency_key', 'p_idempotency_key'],
    ]) {
      expect(scrap).toMatch(
        new RegExp(
          `provenance ->> '${field}'\\s+is distinct from\\s+${expected.replaceAll('.', '\\.')}`,
          'i',
        ),
      )
    }
    for (const field of [
      'catalog_rarity',
      'economy_tier',
      'economy_value_version',
    ]) {
      expect(scrap).toMatch(
        new RegExp(`provenance ->> '${field}'\\s+is null`, 'i'),
      )
    }
    expect(scrap).not.toMatch(/provenance ->> '[^']+'\s*<>/i)
    expect(craft).toMatch(
      /if has_wallet_replay or has_copy_replay then[\s\S]*?Craft idempotency replay drifted from its original payload/i,
    )
    expect(craft).toMatch(
      /return private\.craft_dice_copy_receipt\(\s*existing_copy,\s*existing_wallet_entry/i,
    )
    for (const [field, expected] of [
      ['operation', "'craft'"],
      ['catalog_item_id', 'p_catalog_item_id'],
      ['craft_idempotency_key', 'p_idempotency_key'],
    ]) {
      expect(craft).toMatch(
        new RegExp(
          `provenance ->> '${field}'\\s+is distinct from\\s+${expected}`,
          'i',
        ),
      )
    }
    for (const field of [
      'catalog_rarity',
      'economy_tier',
      'economy_value_version',
    ]) {
      expect(craft).toMatch(
        new RegExp(`provenance ->> '${field}'\\s+is null`, 'i'),
      )
    }
    expect(craft).toMatch(
      /Craft idempotency replay drifted from its original payload[\s\S]*?errcode = '55000'/i,
    )
    expect(craft).not.toMatch(/provenance ->> '[^']+'\s*<>/i)
  })

  it('relies on the 0021 copy-insert freeze instead of changing pull paths', () => {
    const craft = functionSql('private', 'craft_dice_copy_for_user')

    expect(sql).toMatch(
      /record_dice_copy_grant's 0021 insert trigger automatically rejects the grant[\s\S]*?SQLSTATE 55000/i,
    )
    expect(craft).not.toMatch(/from public\.pull_sessions/i)
    expect(sql).not.toMatch(
      /create or replace function (?:public|private)\.(?:prepare_pull|prepare_pull_for_user|commit_pull_session|commit_pull_session_for_user|seal_pull)/i,
    )
    expect(sql).not.toMatch(
      /(?:insert into|update|delete from) public\.(?:pull_sessions|sealed_pull_results|pull_session_transitions)/i,
    )
  })

  it('ships behavioral coverage for every binding Scrap and craft case', () => {
    expect(behavioralSql).toMatch(
      /Scrap every catalog rarity, including both standard mappings and mythic/i,
    )
    expect(behavioralSql).toMatch(/Scrap exact replay drifted/i)
    expect(behavioralSql).toMatch(/Craft happy path or exact replay drifted/i)
    expect(behavioralSql).toMatch(/Zero-live-copy craft unexpectedly succeeded/i)
    expect(behavioralSql).toMatch(/Never-owned craft unexpectedly succeeded/i)
    expect(behavioralSql).toMatch(/Insufficient-Dust craft unexpectedly succeeded/i)
    expect(behavioralSql).toMatch(/Mythic craft unexpectedly succeeded/i)
    expect(behavioralSql).toMatch(/Craft during a live hold unexpectedly succeeded/i)
    expect(behavioralSql).toMatch(/Scrap during a live hold unexpectedly succeeded/i)
    expect(behavioralSql).toMatch(
      /Scrap after hold termination credited the wrong Dust/i,
    )
    expect(behavioralSql).toMatch(
      /Partial standard-tier retune unexpectedly succeeded/i,
    )
    expect(behavioralSql).toMatch(/Craft-then-scrap did not remain a net Dust sink/i)
    expect(behavioralSql).toMatch(
      /Legacy marker wrapper did not append Dust exactly once/i,
    )
    expect(behavioralSql).toMatch(
      /Corrupted legacy-marker replay unexpectedly succeeded/i,
    )
    expect(behavioralSql).toMatch(
      /Cross-owner Scrap changed a marker or credited Dust/i,
    )
    expect(behavioralSql).toMatch(
      /Scrap replay changed after a service retune/i,
    )
    expect(behavioralSql).toMatch(
      /Craft replay changed after a service retune/i,
    )
    expect(behavioralSql).toMatch(
      /Same-version economic retune unexpectedly succeeded/i,
    )
    expect(behavioralSql).toMatch(/reset role;/i)
  })
})
