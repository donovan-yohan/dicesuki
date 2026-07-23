import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { beforeAll, describe, expect, it } from 'vitest'

const migrationPath = resolve(
  process.cwd(),
  'supabase/migrations/0014_roll_ticket_ledger.sql',
)

let sql = ''

beforeAll(async () => {
  sql = await readFile(migrationPath, 'utf8')
})

function recordFunction(source: string) {
  return source.match(
    /create or replace function public\.record_roll_ticket_ledger_entry\([\s\S]*?\n\$\$;/i,
  )?.[0] ?? ''
}

describe('0014 roll-ticket ledger schema', () => {
  it('defines per-user, per-type nonnegative balances and a chained ledger', () => {
    expect(sql).toMatch(/create table public\.roll_ticket_balances/)
    expect(sql).toMatch(/primary key \(user_id, roll_type\)/)
    expect(sql).toMatch(
      /current_quantity\s+bigint\s+not null default 0 check \(current_quantity >= 0\)/,
    )
    expect(sql).toMatch(/create table public\.roll_ticket_ledger_entries/)
    expect(sql).toMatch(
      /user_id\s+uuid\s+not null references auth\.users \(id\) on delete restrict/g,
    )
    expect(sql).toMatch(/delta_quantity\s+bigint\s+not null check \(delta_quantity <> 0\)/)
    expect(sql).toMatch(/quantity_before\s+bigint\s+not null check \(quantity_before >= 0\)/)
    expect(sql).toMatch(/quantity_after\s+bigint\s+not null check \(quantity_after >= 0\)/)
    expect(sql).toMatch(
      /foreign key \(user_id, roll_type\)[\s\S]*?references public\.roll_ticket_balances \(user_id, roll_type\)[\s\S]*?on delete restrict/,
    )
    expect(sql).toMatch(
      /quantity_after::numeric = quantity_before::numeric \+ delta_quantity::numeric/,
    )
  })

  it('admits exactly the standard and premium roll types at every write seam', () => {
    const domainChecks = sql.match(
      /roll_type in \('standard_roll', 'premium_roll'\)/g,
    ) ?? []
    expect(domainChecks).toHaveLength(2)
    expect(recordFunction(sql)).toMatch(
      /p_roll_type not in \('standard_roll', 'premium_roll'\)/,
    )
    expect(sql).not.toMatch(/'standard'\s*,\s*'premium'/)
  })

  it('enforces update/delete/truncate immutability on ledger rows', () => {
    expect(sql).toMatch(
      /create trigger roll_ticket_ledger_entries_reject_update_delete[\s\S]*?before update or delete on public\.roll_ticket_ledger_entries/,
    )
    expect(sql).toMatch(
      /create trigger roll_ticket_ledger_entries_reject_truncate[\s\S]*?before truncate on public\.roll_ticket_ledger_entries/,
    )
    expect(sql).toMatch(/errcode = '55000'/)
    expect(sql).toMatch(
      /revoke all on function public\.reject_roll_ticket_history_mutation\(\)[\s\S]*?public, anon, authenticated, service_role/,
    )
  })

  it('makes idempotency user-scoped and rejects mismatched replays', () => {
    expect(sql).toMatch(/unique \(user_id, idempotency_key\)/)
    const fn = recordFunction(sql)
    expect(fn).toMatch(
      /where user_id = p_user_id\s+and idempotency_key = p_idempotency_key/,
    )
    const mismatchCheck = fn.match(
      /if existing_entry\.roll_type[\s\S]*?raise exception 'Idempotency key/,
    )?.[0] ?? ''
    expect(mismatchCheck).toMatch(/existing_entry\.roll_type <> p_roll_type/)
    expect(mismatchCheck).toMatch(/existing_entry\.delta_quantity <> p_delta_quantity/)
    expect(mismatchCheck).toMatch(/existing_entry\.reason_code <> p_reason_code/)
    expect(mismatchCheck).toMatch(/existing_entry\.provenance is distinct from p_provenance/)
    expect(fn).toMatch(/already used with a different roll-ticket payload/)
    expect(fn).toMatch(/return existing_entry/)
  })

  it('serializes records and rejects negative or overflowing results', () => {
    const fn = recordFunction(sql)
    expect(fn).not.toBe('')
    expect(fn).toMatch(/security definer/)
    expect(fn).toContain("set search_path = ''")
    expect(fn).toMatch(
      /from public\.wallet_accounts\s+where user_id = p_user_id\s+for update/,
    )
    const accountLock = fn.indexOf('from public.wallet_accounts')
    const idempotencyLookup = fn.indexOf('from public.roll_ticket_ledger_entries')
    const balanceMutation = fn.indexOf('insert into public.roll_ticket_balances')
    const ledgerMutation = fn.indexOf('insert into public.roll_ticket_ledger_entries')
    expect(accountLock).toBeGreaterThan(-1)
    expect(idempotencyLookup).toBeGreaterThan(accountLock)
    expect(balanceMutation).toBeGreaterThan(idempotencyLookup)
    expect(ledgerMutation).toBeGreaterThan(idempotencyLookup)
    expect(fn).toMatch(/resulting_quantity < 0/)
    expect(fn).toMatch(/resulting_quantity > 9223372036854775807::numeric/)
    expect(fn).toMatch(/insert into public\.roll_ticket_ledger_entries/)
    expect(fn).toMatch(/update public\.roll_ticket_balances/)
  })

  it('forces RLS and permits only own-ticket reads', () => {
    for (const table of ['roll_ticket_balances', 'roll_ticket_ledger_entries']) {
      expect(sql).toMatch(new RegExp(`alter table public\\.${table} enable row level security`, 'i'))
      expect(sql).toMatch(new RegExp(`alter table public\\.${table} force row level security`, 'i'))
      expect(sql).toMatch(new RegExp(
        `revoke all on table public\\.${table}[\\s\\S]*?from public, anon, authenticated, service_role`,
        'i',
      ))
    }
    const policies = sql.match(/create policy[\s\S]*?;/gi) ?? []
    expect(policies).toHaveLength(2)
    for (const table of ['roll_ticket_balances', 'roll_ticket_ledger_entries']) {
      const policy = policies.find((candidate) => (
        new RegExp(`on public\\.${table}\\b`, 'i').test(candidate)
      ))
      expect(policy).toBeDefined()
      expect(policy).toMatch(/for select\s+to authenticated/i)
      expect(policy).toMatch(/using \(\(select auth\.uid\(\)\) = user_id\)/i)
    }
    for (const policy of policies) {
      expect(policy).not.toMatch(/for (?:insert|update|delete|all)\b/i)
    }
    expect(sql).not.toMatch(
      /grant\s+(?:insert|update|delete|truncate|all)[^;]*on table public\.roll_ticket_/i,
    )
  })

  it('exposes only the record function to service_role and indexes ledger reads', () => {
    const signature = /public\.record_roll_ticket_ledger_entry\(\s*uuid, text, bigint, text, text, jsonb\s*\)/i
    expect(sql).toMatch(new RegExp(
      `revoke all on function ${signature.source}[\\s\\S]*?from public, anon, authenticated, service_role`,
      'i',
    ))
    expect(sql).toMatch(new RegExp(
      `grant execute on function ${signature.source}[\\s\\S]*?to service_role`,
      'i',
    ))
    expect(sql).not.toMatch(
      new RegExp(`grant execute on function ${signature.source}\\s+to (?:anon|authenticated)\\s*;`, 'i'),
    )
    for (const index of [
      'roll_ticket_ledger_entries_user_created_idx',
      'roll_ticket_ledger_entries_balance_fkey_idx',
    ]) {
      expect(sql).toMatch(new RegExp(`create index ${index}`, 'i'))
    }
  })

  it('bounds reason code, idempotency key, and provenance at the table and function seams', () => {
    expect(sql).toMatch(/char_length\(reason_code\) between 3 and 128/)
    expect(sql).toMatch(/reason_code ~ '\^\[a-z\]\[a-z0-9_\.:-\]\+\$'/)
    expect(sql).toMatch(/char_length\(idempotency_key\) between 8 and 200/)
    expect(sql).toMatch(/jsonb_typeof\(provenance\) = 'object'/)
    expect(sql).toMatch(/octet_length\(provenance::text\) <= 8192/)
    const fn = recordFunction(sql)
    expect(fn).not.toBe('')
    expect(fn).toMatch(/char_length\(p_reason_code\) not between 3 and 128/)
    expect(fn).toMatch(/p_reason_code !~ '\^\[a-z\]\[a-z0-9_\.:-\]\+\$'/)
    expect(fn).toMatch(/char_length\(p_idempotency_key\) not between 8 and 200/)
    expect(fn).toMatch(/jsonb_typeof\(p_provenance\) <> 'object'/)
    expect(fn).toMatch(/octet_length\(p_provenance::text\) > 8192/)
  })

  it('locks down the identity sequence and pins the reject trigger search_path', () => {
    expect(sql).toMatch(
      /revoke all on sequence public\.roll_ticket_ledger_entries_id_seq[\s\S]*?from public, anon, authenticated, service_role/,
    )
    expect(sql).toMatch(
      /create or replace function public\.reject_roll_ticket_history_mutation\(\)[\s\S]*?set search_path = ''/,
    )
  })

  it('does not add conversion, banner binding, pull, checkout, or entitlement paths', () => {
    expect(sql).not.toMatch(/create table public\.(?:pull|checkout|payment|entitlement)/i)
    expect(sql).not.toMatch(/insert into public\.wallet_ledger_entries/i)
    expect(sql).not.toMatch(/insert into public\.pull_/i)
    expect(sql).not.toMatch(/insert into public\.user_entitlements/i)
    expect(sql).not.toMatch(/160\s+(?:stars|roll)/i)
  })
})
