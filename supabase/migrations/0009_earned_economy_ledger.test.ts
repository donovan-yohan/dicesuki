import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { beforeAll, describe, expect, it } from 'vitest'

const migrationPath = resolve(
  process.cwd(),
  'supabase/migrations/0009_earned_economy_ledger.sql',
)

let sql = ''

beforeAll(async () => {
  sql = await readFile(migrationPath, 'utf8')
})

function stripCommentsAndEdition(source: string) {
  return source
    .replace(/-- BEGIN EARNED ECONOMY EDITION 0001[\s\S]*?-- END EARNED ECONOMY EDITION 0001/gi, '')
    .replace(/^\s*--.*$/gm, '')
}

function appendFunction(source: string) {
  return source.match(
    /create or replace function public\.append_wallet_ledger_entry\([\s\S]*?\n\$\$;/i,
  )?.[0] ?? ''
}

describe('0009 earned economy schema', () => {
  it('defines one immutable production edition and account-anchored wallet tables', () => {
    expect(sql).toMatch(/create table public\.economy_editions/)
    expect(sql).toMatch(/config_sha256\s+text\s+not null unique/)
    expect(sql).toMatch(/id = config ->> 'slug' \|\| '@' \|\| edition_version::text/)
    expect(sql).toMatch(/create table public\.wallet_accounts/)
    expect(sql).toMatch(
      /user_id\s+uuid\s+not null unique references auth\.users \(id\) on delete restrict/,
    )
    expect(sql).toMatch(/unique \(id, user_id\)/)
    expect(sql).toMatch(/create table public\.wallet_balances/)
    expect(sql).toMatch(/current_balance\s+bigint\s+not null default 0 check \(current_balance >= 0\)/)
    expect(sql).toMatch(/foreign key \(account_id, user_id\)[\s\S]*?on delete restrict/)
    expect(sql).toMatch(/create table public\.wallet_ledger_entries/)
    expect(sql).toMatch(/unique \(account_id, idempotency_key\)/)
    expect(sql).toMatch(/balance_after::numeric = balance_before::numeric \+ delta_amount::numeric/)
    expect(sql).toMatch(/economy_edition_id\s+text\s+not null references public\.economy_editions/)
  })

  it('keeps promotional Stars and earned Dust separate with no paid bucket', () => {
    const executable = stripCommentsAndEdition(sql)
    const pairChecks = executable.match(
      /currency_id = 'stars' and balance_bucket = 'promotional'[\s\S]*?currency_id = 'dust' and balance_bucket = 'earned'/gi,
    ) ?? []
    expect(pairChecks.length).toBeGreaterThanOrEqual(2)
    expect(appendFunction(sql)).toMatch(
      /p_currency_id = 'stars' and p_balance_bucket = 'promotional'[\s\S]*?p_currency_id = 'dust' and p_balance_bucket = 'earned'/i,
    )
    expect(executable).not.toMatch(/balance_bucket\s+in\s*\([^)]*'paid'/i)
    expect(executable).not.toMatch(/paid_balance|checkout|payment|price_cents/i)
  })

  it('enforces update/delete/truncate immutability on editions, accounts, and ledger rows', () => {
    for (const table of ['economy_editions', 'wallet_accounts', 'wallet_ledger_entries']) {
      expect(sql).toMatch(new RegExp(
        `create trigger ${table}_reject_update_delete[\\s\\S]*?before update or delete on public\\.${table}`,
        'i',
      ))
      expect(sql).toMatch(new RegExp(
        `create trigger ${table}_reject_truncate[\\s\\S]*?before truncate on public\\.${table}`,
        'i',
      ))
    }
    expect(sql).toMatch(/errcode = '55000'/)
    expect(sql).toMatch(
      /revoke all on function public\.reject_earned_economy_history_mutation\(\)[\s\S]*?public, anon, authenticated, service_role/,
    )
  })

  it('serializes per-account appends and fails closed on mismatched replay or overspend', () => {
    const fn = appendFunction(sql)
    expect(fn).not.toBe('')
    expect(fn).toMatch(/security definer/)
    expect(fn).toContain("set search_path = ''")
    expect(fn).toMatch(/where user_id = p_user_id\s+for update/)
    expect(fn).toMatch(/where account_id = target_account\.id\s+and idempotency_key = p_idempotency_key/)
    expect(fn).toMatch(/already used with a different wallet payload/)
    expect(fn).toMatch(/return existing_entry/)
    expect(fn).toMatch(/resulting_balance < 0/)
    expect(fn).toMatch(/resulting_balance > 9223372036854775807::numeric/)
    expect(fn).toMatch(/insert into public\.wallet_ledger_entries/)
    expect(fn).toMatch(/update public\.wallet_balances/)
  })

  it('forces RLS and permits only public-edition or own-wallet reads', () => {
    for (const table of [
      'economy_editions',
      'wallet_accounts',
      'wallet_balances',
      'wallet_ledger_entries',
    ]) {
      expect(sql).toMatch(new RegExp(`alter table public\\.${table} enable row level security`, 'i'))
      expect(sql).toMatch(new RegExp(`alter table public\\.${table} force row level security`, 'i'))
      expect(sql).toMatch(new RegExp(
        `revoke all on table public\\.${table}[\\s\\S]*?from public, anon, authenticated, service_role`,
        'i',
      ))
    }
    expect(sql).toMatch(/to anon, authenticated\s+using \(true\)/)
    expect(sql.match(/using \(\(select auth\.uid\(\)\) = user_id\)/g)).toHaveLength(3)
    expect(stripCommentsAndEdition(sql)).not.toMatch(
      /grant\s+(?:insert|update|delete|all)[^;]*on table public\.wallet_/i,
    )
  })

  it('exposes the mutation function only to service_role and indexes every FK/read seam', () => {
    const signature = /public\.append_wallet_ledger_entry\(\s*uuid, text, text, bigint, text, text, text, jsonb\s*\)/i
    expect(sql).toMatch(new RegExp(`revoke all on function ${signature.source}[\\s\\S]*?from public, anon, authenticated, service_role`, 'i'))
    expect(sql).toMatch(new RegExp(`grant execute on function ${signature.source}[\\s\\S]*?to service_role`, 'i'))
    for (const index of [
      'wallet_balances_user_idx',
      'wallet_ledger_entries_user_created_idx',
      'wallet_ledger_entries_balance_fkey_idx',
      'wallet_ledger_entries_economy_edition_id_idx',
    ]) {
      expect(sql).toMatch(new RegExp(`create index ${index}`, 'i'))
    }
  })

  it('does not create claims, pulls, outcomes, checkout, or entitlement mutation paths', () => {
    const executable = stripCommentsAndEdition(sql)
    expect(executable).not.toMatch(/public\.user_entitlements/i)
    expect(executable).not.toMatch(/create table public\.(?:claim|pull|result|checkout|payment)/i)
    expect(executable).not.toMatch(/insert into public\.catalog_/i)
  })
})
