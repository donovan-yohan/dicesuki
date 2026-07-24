import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { beforeAll, describe, expect, it } from 'vitest'

const migrationPath = resolve(
  process.cwd(),
  'supabase/migrations/0020_dice_copy_inventory.sql',
)

let sql = ''

beforeAll(async () => {
  sql = await readFile(migrationPath, 'utf8')
})

function functionSql(schema: 'public' | 'private', name: string) {
  return sql.match(
    new RegExp(
      `create or replace function ${schema}\\.${name}\\([\\s\\S]*?\\n\\$\\$;`,
      'i',
    ),
  )?.[0] ?? ''
}

describe('0020 discrete dice-copy inventory', () => {
  it('stores one retained row per copy with bounded acquisition provenance', () => {
    expect(sql).toMatch(/create table public\.dice_copies/i)
    expect(sql).toMatch(
      /id\s+uuid\s+primary key default gen_random_uuid\(\)/i,
    )
    expect(sql).toMatch(
      /user_id\s+uuid\s+not null references auth\.users \(id\) on delete restrict/i,
    )
    expect(sql).toMatch(
      /catalog_item_id\s+text\s+not null references public\.catalog_items \(id\) on delete restrict/i,
    )
    expect(sql).toMatch(
      /source_kind in \('pull', 'craft', 'purchase', 'reward'\)/i,
    )
    expect(sql).toMatch(/source_reference\s+text\s+not null/i)
    expect(sql).toMatch(/acquired_at\s+timestamptz\s+not null default now\(\)/i)
    expect(sql).toMatch(/scrapped_at\s+timestamptz/i)
    expect(sql).toMatch(/scrapped_at is null or scrapped_at >= acquired_at/i)
  })

  it('makes live-copy counts cheap and preserves a unique first-ever latch', () => {
    expect(sql).toMatch(
      /create index dice_copies_live_count_idx\s+on public\.dice_copies \(user_id, catalog_item_id\)\s+where scrapped_at is null/i,
    )
    expect(sql).toMatch(
      /create unique index dice_copies_first_copy_latch_idx\s+on public\.dice_copies \(user_id, catalog_item_id\)\s+where is_first_copy/i,
    )
    const grant = functionSql('public', 'record_dice_copy_grant')
    expect(grant).toMatch(
      /first_ever := not exists \([\s\S]*?catalog_item_id = p_catalog_item_id[\s\S]*?and is_first_copy/i,
    )
    expect(grant).toMatch(/is_first_copy[\s\S]*?first_ever/i)
  })

  it('adds ordinary indexes for catalog FK checks and full user-item history', () => {
    expect(sql).toMatch(
      /create index dice_copies_catalog_item_id_fkey_idx\s+on public\.dice_copies \(catalog_item_id\);/i,
    )
    expect(sql).toMatch(
      /create index dice_copies_user_catalog_item_idx\s+on public\.dice_copies \(user_id, catalog_item_id\);/i,
    )
  })

  it('permits only one irreversible scrap transition and never deletes copies', () => {
    const guard = functionSql('private', 'enforce_dice_copy_transition')
    expect(guard).toMatch(/tg_op = 'TRUNCATE'/i)
    expect(guard).toMatch(/tg_op = 'DELETE'/i)
    expect(guard).toMatch(/old\.scrapped_at is not null/i)
    expect(guard).toMatch(/new\.scrapped_at is null/i)
    expect(guard).toMatch(/new\.is_first_copy is distinct from old\.is_first_copy/i)
    expect(sql).toMatch(
      /before update or delete on public\.dice_copies[\s\S]*?private\.enforce_dice_copy_transition\(\)/i,
    )
    expect(sql).toMatch(
      /before truncate on public\.dice_copies[\s\S]*?private\.enforce_dice_copy_transition\(\)/i,
    )
    expect(sql).not.toMatch(/delete from public\.dice_copies/i)
  })

  it('serializes and exactly replays service-only grants', () => {
    const grant = functionSql('public', 'record_dice_copy_grant')
    expect(grant).toMatch(/security definer/i)
    expect(grant).toContain("set search_path = ''")
    expect(grant).toMatch(
      /from public\.wallet_accounts\s+where user_id = p_user_id\s+for update/i,
    )
    expect(grant).toMatch(
      /where user_id = p_user_id\s+and grant_idempotency_key = p_idempotency_key/i,
    )
    expect(grant).toMatch(
      /existing_copy\.catalog_item_id <> p_catalog_item_id/i,
    )
    expect(grant).toMatch(/existing_copy\.source_kind <> p_source_kind/i)
    expect(grant).toMatch(
      /existing_copy\.source_reference <> p_source_reference/i,
    )
    expect(grant).toMatch(/return existing_copy/i)
    expect(sql).toMatch(
      /unique \(user_id, grant_idempotency_key\)/i,
    )
    expect(sql).toMatch(
      /grant execute on function public\.record_dice_copy_grant\([\s\S]*?\) to service_role/i,
    )
    expect(sql).not.toMatch(
      /grant execute on function public\.record_dice_copy_grant\([\s\S]*?\) to (?:anon|authenticated)/i,
    )
  })

  it('binds the marker-only scrap wrapper to auth.uid and rejects non-live copies', () => {
    const primitive = functionSql('private', 'record_dice_copy_scrap')
    const wrapper = functionSql('public', 'scrap_dice_copy_marker')
    expect(primitive).toMatch(/security definer/i)
    expect(primitive).toContain("set search_path = ''")
    expect(primitive).toMatch(
      /where id = p_copy_id\s+and user_id = p_user_id\s+for update/i,
    )
    expect(primitive).toMatch(/target_copy\.scrapped_at is not null/i)
    expect(primitive).toMatch(
      /set scrapped_at = now\(\),\s+scrap_idempotency_key = p_idempotency_key/i,
    )
    expect(wrapper).toMatch(/security definer/i)
    expect(wrapper).toMatch(/caller_id uuid := \(select auth\.uid\(\)\)/i)
    expect(wrapper).toMatch(
      /private\.record_dice_copy_scrap\(\s*caller_id,\s*p_copy_id,\s*p_idempotency_key/i,
    )
    expect(sql).toMatch(
      /grant execute on function public\.scrap_dice_copy_marker\(uuid, text\)\s+to authenticated/i,
    )
    expect(sql).not.toMatch(
      /insert into public\.wallet_ledger_entries|append_wallet_ledger_entry|duplicate_dust|craft_dice_copy/i,
    )
  })

  it('uses one user idempotency namespace across grants and scraps', () => {
    const grant = functionSql('public', 'record_dice_copy_grant')
    const scrap = functionSql('private', 'record_dice_copy_scrap')
    expect(sql).toMatch(
      /create unique index dice_copies_user_scrap_idempotency_idx[\s\S]*?\(user_id, scrap_idempotency_key\)[\s\S]*?where scrap_idempotency_key is not null/i,
    )
    expect(grant).toMatch(
      /scrap_idempotency_key = p_idempotency_key[\s\S]*?already used for dice-copy scrap/i,
    )
    expect(scrap).toMatch(
      /grant_idempotency_key = p_idempotency_key[\s\S]*?already used for a dice-copy grant/i,
    )
    expect(scrap).toMatch(
      /scrap_idempotency_key = p_idempotency_key[\s\S]*?existing_copy\.id <> p_copy_id[\s\S]*?return existing_copy/i,
    )
  })

  it('pins 0017 key hygiene in constraints and both trusted write paths', () => {
    const grant = functionSql('public', 'record_dice_copy_grant')
    const scrap = functionSql('private', 'record_dice_copy_scrap')
    const keyPattern = "'^[A-Za-z0-9][A-Za-z0-9._:-]+$'"

    const grantConstraint = sql.match(
      /constraint dice_copies_grant_idempotency_key[\s\S]*?\),/i,
    )?.[0] ?? ''
    const scrapConstraint = sql.match(
      /constraint dice_copies_scrap_idempotency_key[\s\S]*?\),/i,
    )?.[0] ?? ''

    expect(grantConstraint).toContain(
      `grant_idempotency_key ~ ${keyPattern}`,
    )
    expect(scrapConstraint).toContain(
      `scrap_idempotency_key ~ ${keyPattern}`,
    )
    expect(grant).toContain(`p_idempotency_key !~ ${keyPattern}`)
    expect(scrap).toContain(`p_idempotency_key !~ ${keyPattern}`)
  })

  it('forces owner-read RLS and gives API roles no direct DML', () => {
    expect(sql).toMatch(
      /alter table public\.dice_copies enable row level security/i,
    )
    expect(sql).toMatch(
      /alter table public\.dice_copies force row level security/i,
    )
    expect(sql).toMatch(
      /create policy "users read their own dice copies"[\s\S]*?for select\s+to authenticated[\s\S]*?using \(\(select auth\.uid\(\)\) = user_id\)/i,
    )
    expect(sql).toMatch(
      /revoke all on table public\.dice_copies\s+from public, anon, authenticated, service_role/i,
    )
    expect(sql).toMatch(
      /grant select on table public\.dice_copies\s+to authenticated, service_role/i,
    )
    expect(sql).not.toMatch(
      /grant\s+(?:insert|update|delete|truncate|all)[^;]*on table public\.dice_copies/i,
    )
  })

  it('is additive and leaves every existing consumer and backfill untouched', () => {
    expect(sql).not.toMatch(/alter table public\.(?!dice_copies)/i)
    expect(sql).not.toMatch(
      /insert into public\.(?:user_entitlements|pull_|sealed_pull_results)/i,
    )
    expect(sql).not.toMatch(
      /update public\.(?:user_entitlements|pull_|sealed_pull_results)/i,
    )
    expect(sql).not.toMatch(/from public\.user_entitlements/i)
    expect(sql).not.toMatch(/create or replace function public\.(?:prepare_pull|commit_pull_session|craft_dice_copy)\b/i)
  })
})
