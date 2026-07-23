import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { beforeAll, describe, expect, it } from 'vitest'

const migrationPath = resolve(
  process.cwd(),
  'supabase/migrations/0016_stars_to_standard_roll_conversion.sql',
)

let sql = ''

beforeAll(async () => {
  sql = await readFile(migrationPath, 'utf8')
})

function functionSql(schema: 'public' | 'private', name: string) {
  return sql.match(
    new RegExp(`create or replace function ${schema}\\.${name}\\([\\s\\S]*?\\n\\$\\$;`, 'i'),
  )?.[0] ?? ''
}

describe('0016 Stars-to-standard-roll conversion', () => {
  it('defines the spec rate once as a named constant and applies the bounded count', () => {
    const engine = functionSql('private', 'convert_stars_to_standard_roll_for_user')
    const executableSql = sql.replace(/--.*$/gm, '')

    expect(engine).toMatch(
      /160 Stars ≡ 1 roll; matches singlePullCost/i,
    )
    expect(executableSql.match(
      /stars_per_standard_roll constant bigint := 160/g,
    ) ?? []).toHaveLength(1)
    expect(engine).toMatch(
      /stars_per_standard_roll constant bigint := 160/,
    )
    expect(engine).toMatch(
      /stars_to_debit := stars_per_standard_roll \* p_roll_count::bigint/,
    )
    expect(engine).toMatch(/p_roll_count not between 1 and 100/)
    expect(engine).toMatch(
      /Roll count must be between one and one hundred'[\s\S]*?errcode = '22023'/,
    )
    expect(engine).toMatch(/caps one request at 16,000 Stars/i)
  })

  it('uses promotional Stars only and credits only standard-roll tickets', () => {
    const engine = functionSql('private', 'convert_stars_to_standard_roll_for_user')

    expect(engine).toMatch(
      /public\.append_wallet_ledger_entry\(\s*p_user_id,\s*'stars',\s*'promotional',\s*-stars_to_debit,\s*'conversion\.stars_to_standard_roll\.debit',\s*wallet_idempotency_key,\s*economy_edition_id,\s*conversion_provenance\s*\)/i,
    )
    expect(engine).toMatch(
      /public\.record_roll_ticket_ledger_entry\(\s*p_user_id,\s*'standard_roll',\s*p_roll_count::bigint,/i,
    )
    expect(sql).toMatch(/Premium conversion remains legally gated by issue #154/i)
    expect(sql).not.toMatch(/premium_roll/i)
    expect(sql).not.toMatch(/\bpaid\b/i)
  })

  it('derives distinct wallet and ticket keys from the bounded client key', () => {
    const engine = functionSql('private', 'convert_stars_to_standard_roll_for_user')

    expect(engine).toMatch(
      /wallet_idempotency_key constant text :=\s*'stars-to-standard-roll:wallet:' \|\| p_idempotency_key/,
    )
    expect(engine).toMatch(
      /ticket_idempotency_key constant text :=\s*'stars-to-standard-roll:ticket:' \|\| p_idempotency_key/,
    )
    expect(engine).toMatch(
      /char_length\(p_idempotency_key\) not between 8 and 160/,
    )
    expect(engine).toMatch(
      /p_idempotency_key !~ '\^\[A-Za-z0-9\]\[A-Za-z0-9\._:-\]\+\$'/,
    )
    expect(engine).toMatch(/wallet_idempotency_key,[\s\S]*?ticket_idempotency_key,/)
  })

  it('locks wallet_accounts before both canonical ledger appends', () => {
    const engine = functionSql('private', 'convert_stars_to_standard_roll_for_user')
    const accountLock = engine.indexOf(
      'target_account := private.lock_wallet_account(p_user_id)',
    )
    const walletAppend = engine.indexOf('public.append_wallet_ledger_entry(')
    const ticketAppend = engine.indexOf('public.record_roll_ticket_ledger_entry(')

    expect(accountLock).toBeGreaterThan(-1)
    expect(walletAppend).toBeGreaterThan(accountLock)
    expect(ticketAppend).toBeGreaterThan(walletAppend)
    expect(engine).not.toMatch(/insert into public\.wallet_/i)
    expect(engine).not.toMatch(/update public\.wallet_/i)
    expect(engine).not.toMatch(/insert into public\.roll_ticket_/i)
    expect(engine).not.toMatch(/update public\.roll_ticket_/i)
  })

  it('makes exact replay observable and payload mismatch fail closed through both appends', () => {
    const engine = functionSql('private', 'convert_stars_to_standard_roll_for_user')

    expect(engine).toMatch(/conversion_provenance := jsonb_build_object\(/)
    expect(engine).toMatch(/'conversion_idempotency_key', p_idempotency_key/)
    expect(engine).toMatch(/'roll_count', p_roll_count/)
    expect(engine).toMatch(
      /return query values \(\s*wallet_entry\.id,\s*ticket_entry\.id,\s*p_roll_count,\s*-wallet_entry\.delta_amount,\s*wallet_entry\.balance_after,\s*ticket_entry\.delta_quantity,\s*ticket_entry\.quantity_after/i,
    )
    expect(engine).toMatch(/Either append rejects payload drift with 22023/i)
    expect(engine).toMatch(
      /single transaction[\s\S]*?retrying the conversion key reconstructs[\s\S]*?same distinct inner keys/i,
    )
  })

  it('exposes only a self-derived authenticated wrapper', () => {
    const wrapper = functionSql('public', 'convert_stars_to_standard_roll')

    expect(wrapper).not.toBe('')
    expect(wrapper).toMatch(/security definer/i)
    expect(wrapper).toContain("set search_path = ''")
    expect(wrapper).not.toMatch(/p_user_id uuid/i)
    expect(wrapper).toMatch(
      /caller_user_id := private\.require_non_anonymous_user\(\)/,
    )
    expect(wrapper).toMatch(
      /private\.convert_stars_to_standard_roll_for_user\(\s*caller_user_id,\s*p_roll_count,\s*p_idempotency_key/i,
    )
  })

  it('applies exact definer and execute privilege hygiene', () => {
    const engine = functionSql('private', 'convert_stars_to_standard_roll_for_user')
    const wrapper = functionSql('public', 'convert_stars_to_standard_roll')

    expect(engine).toContain("set search_path = ''")
    expect(engine).not.toMatch(/security definer/i)
    expect(wrapper).toMatch(/security definer/i)
    expect(wrapper).toContain("set search_path = ''")
    expect(sql).toMatch(
      /revoke all on function private\.convert_stars_to_standard_roll_for_user\(\s*uuid, integer, text\s*\)[\s\S]*?from public, anon, authenticated, service_role/i,
    )
    expect(sql).toMatch(
      /revoke all on function public\.convert_stars_to_standard_roll\(integer, text\)[\s\S]*?from public, anon, authenticated, service_role/i,
    )
    expect(sql).toMatch(
      /grant execute on function public\.convert_stars_to_standard_roll\(integer, text\)\s+to authenticated/i,
    )
    expect(sql).not.toMatch(
      /grant execute on function private\.convert_stars_to_standard_roll_for_user\(\s*uuid, integer, text\s*\)[^;]*\bto\s+(?:public|anon|authenticated|service_role)\b/i,
    )
    expect(sql).not.toMatch(
      /grant execute on function (?:private\.)?convert_stars_to_standard_roll[^;]*to (?:public|anon|service_role)/i,
    )
  })
})
