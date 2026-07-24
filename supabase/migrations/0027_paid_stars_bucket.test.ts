import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { beforeAll, describe, expect, it } from 'vitest'

const migrationPath = resolve(
  process.cwd(),
  'supabase/migrations/0027_paid_stars_bucket.sql',
)
const canonicalPath = resolve(
  process.cwd(),
  'supabase/migrations/0017_pull_commit_reveal.sql',
)
const conversionPath = resolve(
  process.cwd(),
  'supabase/migrations/0016_stars_to_standard_roll_conversion.sql',
)
const holdPath = resolve(
  process.cwd(),
  'supabase/migrations/0015_banner_roll_type_binding.sql',
)
const lunarPath = resolve(
  process.cwd(),
  'supabase/migrations/0024_lunar_pass_faucet.sql',
)
const scrapCraftPath = resolve(
  process.cwd(),
  'supabase/migrations/0022_scrap_craft_economy.sql',
)
const behavioralPath = resolve(
  process.cwd(),
  'supabase/tests/0027_paid_stars_bucket.test.sql',
)

let sql = ''
let canonicalSql = ''
let conversionSql = ''
let holdSql = ''
let lunarSql = ''
let scrapCraftSql = ''
let behavioralSql = ''

beforeAll(async () => {
  [
    sql,
    canonicalSql,
    conversionSql,
    holdSql,
    lunarSql,
    scrapCraftSql,
    behavioralSql,
  ] = await Promise.all([
    readFile(migrationPath, 'utf8'),
    readFile(canonicalPath, 'utf8'),
    readFile(conversionPath, 'utf8'),
    readFile(holdPath, 'utf8'),
    readFile(lunarPath, 'utf8'),
    readFile(scrapCraftPath, 'utf8'),
    readFile(behavioralPath, 'utf8'),
  ])
})

function functionSqlFrom(source: string, name: string) {
  return (
    source.match(
      new RegExp(
        `create or replace function public\\.${name}\\([\\s\\S]*?\\n\\$\\$;`,
        'i',
      ),
    )?.[0] ?? ''
  )
}

function stripSqlComments(source: string) {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/--[^\r\n]*/g, '')
}

describe('0027 dormant paid Stars bucket', () => {
  it('widens all four validation points to exactly one additional pair', () => {
    expect(sql.match(/-- \[#154\] GATE:/g)).toHaveLength(3)
    expect(sql).toMatch(
      /alter table public\.wallet_balances[\s\S]*?drop constraint wallet_balances_currency_bucket_pair,\s*-- \[#154\] GATE: widen the balance pair by exactly stars\/paid\.\s*add constraint wallet_balances_currency_bucket_pair\s+check \(\s*currency_id is not null and\s+balance_bucket is not null and\s+\(\s*\(currency_id = 'stars' and balance_bucket = 'promotional'\) or\s+\(currency_id = 'stars' and balance_bucket = 'paid'\) or\s+\(currency_id = 'dust' and balance_bucket = 'earned'\)/i,
    )
    expect(sql).toMatch(
      /drop constraint wallet_ledger_entries_balance_bucket_check,\s*-- \[#154\] GATE: make paid a legal ledger bucket for the paired check below\.\s*add constraint wallet_ledger_entries_balance_bucket_check\s+check \(\s*balance_bucket is not null and\s+balance_bucket in \('promotional', 'earned', 'paid'\)/i,
    )
    expect(sql).toMatch(
      /drop constraint wallet_ledger_entries_currency_bucket_pair,\s*-- \[#154\] GATE: widen the ledger pair by exactly stars\/paid\.\s*add constraint wallet_ledger_entries_currency_bucket_pair\s+check \(\s*currency_id is not null and\s+balance_bucket is not null and\s+\(\s*\(currency_id = 'stars' and balance_bucket = 'promotional'\) or\s+\(currency_id = 'stars' and balance_bucket = 'paid'\) or\s+\(currency_id = 'dust' and balance_bucket = 'earned'\)/i,
    )

    const append = functionSqlFrom(sql, 'append_wallet_ledger_entry')
    expect(append).toMatch(
      /p_currency_id is null or p_balance_bucket is null or not \(\s*\(p_currency_id = 'stars' and p_balance_bucket = 'promotional'\) or\s*\(p_currency_id = 'stars' and p_balance_bucket = 'paid'\) or\s*\(p_currency_id = 'dust' and p_balance_bucket = 'earned'\)/i,
    )
    expect(sql).not.toMatch(/balance_bucket\s*=\s*'premium'/i)
  })

  it('preserves the canonical 0017 append body outside the intentional gate delta', () => {
    const current = functionSqlFrom(sql, 'append_wallet_ledger_entry')
    const canonical = functionSqlFrom(
      canonicalSql,
      'append_wallet_ledger_entry',
    )
    const currentPairAndGate =
      current.match(
        / {2}-- Issue #154 delta 1:[\s\S]*?(?= {2}if p_reason_code is null)/,
      )?.[0] ?? ''
    const canonicalPair =
      canonical.match(
        / {2}if not \([\s\S]*?(?= {2}if p_reason_code is null)/,
      )?.[0] ?? ''

    expect(currentPairAndGate).not.toBe('')
    expect(canonicalPair).not.toBe('')
    expect(current.replace(currentPairAndGate, canonicalPair)).toBe(canonical)
  })

  it('permits service-role paid credits but keeps paid debits and callers dormant', () => {
    const append = functionSqlFrom(sql, 'append_wallet_ledger_entry')

    expect(append).toMatch(
      /if p_balance_bucket = 'paid' and p_delta_amount < 0 then[\s\S]*?Paid Stars debits remain disabled pending issue #154 activation[\s\S]*?errcode = '55000'/i,
    )
    expect(sql).toMatch(
      /revoke all on function public\.append_wallet_ledger_entry\([\s\S]*?\)\s+from public, anon, authenticated, service_role/i,
    )
    expect(sql).toMatch(
      /grant execute on function public\.append_wallet_ledger_entry\([\s\S]*?\)\s+to service_role/i,
    )
    expect(sql).not.toMatch(
      /create or replace function public\.(?!append_wallet_ledger_entry)/i,
    )
    expect(sql).toMatch(
      /paid participation in conversion, pull holds, and pull commit is deferred/i,
    )
  })

  it('keeps every existing Star spend and faucet path promotional-only', () => {
    const conversion = functionSqlFrom(
      conversionSql,
      'convert_stars_to_standard_roll',
    )
    const privateConversion =
      conversionSql.match(
        /create or replace function private\.convert_stars_to_standard_roll_for_user\([\s\S]*?\n\$\$;/i,
      )?.[0] ?? ''
    const lunarAppends =
      lunarSql.match(
        /public\.append_wallet_ledger_entry\([\s\S]*?\n {2}\);/gi,
      ) ?? []

    expect(conversion).not.toBe('')
    expect(privateConversion).toMatch(
      /public\.append_wallet_ledger_entry\(\s*p_user_id,\s*'stars',\s*'promotional',\s*-stars_to_debit/i,
    )
    expect(privateConversion).not.toContain("'paid'")
    expect(lunarAppends).toHaveLength(2)
    for (const append of lunarAppends) {
      expect(append).toMatch(
        /p_user_id,\s*'stars',\s*'promotional'/i,
      )
      expect(append).not.toContain("'paid'")
    }

    expect(holdSql).toMatch(
      /Insufficient available promotional Stars after active holds/i,
    )
    expect(canonicalSql).toMatch(
      /sessions\.currency_id = banner\.currency_id[\s\S]*?sessions\.balance_bucket = banner\.balance_bucket/i,
    )
  })

  it('keeps Scrap and craft wallet appends pinned to earned Dust', () => {
    const appends =
      scrapCraftSql.match(
        /public\.append_wallet_ledger_entry\([\s\S]*?\n {2}\);/gi,
      ) ?? []

    expect(appends.length).toBeGreaterThanOrEqual(3)
    for (const append of appends) {
      expect(append).toMatch(/p_user_id,\s*'dust',\s*'earned'/i)
      expect(append).not.toContain("'paid'")
    }
  })

  it('backs the static contract with all required behavioral probes', () => {
    const executable = stripSqlComments(behavioralSql)
    for (const evidence of [
      'Service-role paid-Star credit did not materialize exactly',
      'Paid-Star debit unexpectedly succeeded before issue #154 activation',
      'Authenticated paid-Star append unexpectedly succeeded',
      'Paid-only balance funded a standard-roll conversion',
      'Paid-only balance funded a legacy promotional-Star pull hold',
      'Lunar daily claim did not remain promotional-only',
      'Scrap credit or craft debit escaped earned Dust',
      'wallet_balances accepted an invalid currency/bucket pair',
      'wallet_ledger_entries accepted an invalid currency/bucket pair',
      'Canonical append accepted an invalid currency/bucket pair',
      'Service-role invalid append probes changed wallet state',
      'Runtime constraint definitions did not preserve the exact NULL-safe paid-pair widening',
      'NULL currency/bucket input escaped the canonical validator',
    ]) {
      expect(executable).toContain(evidence)
    }
  })
})
