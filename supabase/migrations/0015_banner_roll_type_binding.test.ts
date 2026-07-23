import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { beforeAll, describe, expect, it } from 'vitest'

const migrationPath = resolve(
  process.cwd(),
  'supabase/migrations/0015_banner_roll_type_binding.sql',
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

describe('0015 banner roll-type binding', () => {
  it('backfills legacy banners to standard with a NULL roll type and safe defaults', () => {
    expect(sql).toMatch(
      /alter table public\.pull_banner_versions[\s\S]*?add column banner_class text not null default 'standard'/i,
    )
    expect(sql).toMatch(/add column roll_type text null/i)
    expect(sql).not.toMatch(/update\s+public\.pull_banner_versions/i)
    expect(sql).toMatch(
      /check \(banner_class in \('standard', 'premium'\)\)/i,
    )
    expect(sql).toMatch(
      /check \(roll_type in \('standard_roll', 'premium_roll'\)\)/i,
    )
  })

  it('enforces the banner-class and roll-type pairing', () => {
    const pairing = sql.match(
      /add constraint pull_banner_versions_class_roll_type_pairing[\s\S]*?\n\s*\);/i,
    )?.[0] ?? ''

    expect(pairing).toMatch(
      /banner_class = 'standard'[\s\S]*?roll_type is null or roll_type = 'standard_roll'/i,
    )
    expect(pairing).toMatch(
      /banner_class = 'premium'[\s\S]*?roll_type is not null and roll_type = 'premium_roll'/i,
    )
    const standardArm = pairing.match(
      /banner_class = 'standard'[\s\S]*?\)\) or/i,
    )?.[0] ?? ''
    expect(standardArm).not.toContain("roll_type = 'premium_roll'")
  })

  it('reserves active same-type ticket holds without debiting at prepare', () => {
    const prepare = functionSql('private', 'prepare_pull_for_user')
    const ticketBranch = prepare.match(
      /else\s+if target_cost <> p_pull_count::bigint[\s\S]*?-- Preparation reserves tickets only\.[\s\S]*?end if;/i,
    )?.[0] ?? ''

    expect(prepare).not.toBe('')
    expect(prepare).toMatch(/if banner\.roll_type is null then/i)
    expect(ticketBranch).toMatch(
      /from public\.roll_ticket_balances as balances[\s\S]*?balances\.user_id = p_user_id[\s\S]*?balances\.roll_type = banner\.roll_type/i,
    )
    expect(ticketBranch).toMatch(
      /current_balance := coalesce\(current_balance, 0\)/i,
    )
    expect(ticketBranch).toMatch(
      /select coalesce\(sum\(sessions\.held_amount\), 0\) into active_holds[\s\S]*?join public\.pull_banner_versions as held_banners[\s\S]*?held_banners\.id = sessions\.banner_version_id[\s\S]*?held_banners\.roll_type = banner\.roll_type/i,
    )
    expect(ticketBranch).toMatch(
      /sessions\.user_id = p_user_id[\s\S]*?sessions\.prepared_at <= decision_at[\s\S]*?sessions\.expires_at > decision_at/i,
    )
    expect(ticketBranch).toMatch(
      /current_balance - active_holds < p_pull_count/i,
    )
    expect(ticketBranch).toContain(
      'Insufficient available % roll tickets after active holds',
    )
    expect(ticketBranch).toMatch(
      /future commit\/reveal boundary[\s\S]*?must debit them there without double-counting this active hold/i,
    )
    expect(prepare).not.toMatch(/public\.record_roll_ticket_ledger_entry\(/i)
    expect(ticketBranch).toMatch(
      /if target_cost <> p_pull_count::bigint then[\s\S]*?Ticket-funded offer cost must equal its pull count'[\s\S]*?errcode = '55000'/i,
    )
  })

  it('preserves the legacy NULL promotional-Stars hold path', () => {
    const prepare = functionSql('private', 'prepare_pull_for_user')
    const nullBranch = prepare.match(
      /if banner\.roll_type is null then[\s\S]*?\n\s*else/i,
    )?.[0] ?? ''

    expect(nullBranch).toMatch(
      /from public\.wallet_balances as balances[\s\S]*?banner\.currency_id[\s\S]*?banner\.balance_bucket/i,
    )
    expect(nullBranch).toMatch(
      /current_balance := coalesce\(current_balance, 0\)/i,
    )
    expect(nullBranch).toMatch(
      /select coalesce\(sum\(sessions\.held_amount\), 0\) into active_holds[\s\S]*?join public\.pull_banner_versions as held_banners[\s\S]*?held_banners\.id = sessions\.banner_version_id[\s\S]*?held_banners\.roll_type is null/i,
    )
    expect(nullBranch).toMatch(
      /sessions\.prepared_at <= decision_at[\s\S]*?sessions\.expires_at > decision_at/i,
    )
    expect(nullBranch).toMatch(/current_balance - active_holds < target_cost/i)
    expect(nullBranch).toContain(
      'Insufficient available promotional Stars after active holds',
    )
  })

  it('stores validated funding-sensitive hold units and needs no refund helper', () => {
    const prepare = functionSql('private', 'prepare_pull_for_user')
    const release = functionSql('private', 'release_roll_ticket_pull_hold')

    expect(prepare).toMatch(
      /banner\.balance_bucket,\s+target_cost,\s+p_idempotency_key/i,
    )
    expect(sql).not.toMatch(/drop constraint pull_sessions_offer_fkey/i)
    expect(release).toBe('')
    expect(sql).not.toMatch(/release_roll_ticket_pull_hold|pull\.ticket_hold_refund/i)
  })

  it('fails closed for premium banners inside preparation', () => {
    const prepare = functionSql('private', 'prepare_pull_for_user')
    const bannerLookup = prepare.indexOf(
      'from public.pull_banner_versions',
    )
    const premiumGuard = prepare.indexOf(
      "if banner.banner_class = 'premium'",
    )
    const accountLock = prepare.indexOf(
      'target_account := private.lock_wallet_account',
    )

    expect(premiumGuard).toBeGreaterThan(bannerLookup)
    expect(accountLock).toBeGreaterThan(premiumGuard)
    expect(prepare).toMatch(
      /Premium banner preparation is disabled pending issue #154'[\s\S]*?errcode = '55000'/i,
    )
  })

  it('does not reserve promotional Stars for ticket-funded sessions', () => {
    const balanceGuard = functionSql(
      'private',
      'preserve_active_pull_holds_on_balance_change',
    )
    const walletAppend = functionSql('public', 'append_wallet_ledger_entry')

    for (const fn of [balanceGuard, walletAppend]) {
      expect(fn).toMatch(
        /join public\.pull_banner_versions as banners[\s\S]*?banners\.id = sessions\.banner_version_id[\s\S]*?banners\.roll_type is null/i,
      )
    }
  })

  it('prevents later ticket debits from consuming active same-type holds', () => {
    const ticketBalanceGuard = functionSql(
      'private',
      'preserve_active_roll_ticket_holds_on_balance_change',
    )

    expect(ticketBalanceGuard).toMatch(
      /select coalesce\(sum\(sessions\.held_amount\), 0\) into active_holds/i,
    )
    expect(ticketBalanceGuard).toMatch(
      /join public\.pull_banner_versions as banners[\s\S]*?banners\.id = sessions\.banner_version_id[\s\S]*?banners\.roll_type = new\.roll_type/i,
    )
    expect(ticketBalanceGuard).toMatch(
      /sessions\.user_id = new\.user_id[\s\S]*?sessions\.prepared_at <= decision_at[\s\S]*?sessions\.expires_at > decision_at/i,
    )
    expect(ticketBalanceGuard).toMatch(
      /new\.current_quantity < active_holds[\s\S]*?errcode = '22003'/i,
    )
    expect(sql).toMatch(
      /create trigger roll_ticket_balances_preserve_active_pull_holds[\s\S]*?before update of current_quantity on public\.roll_ticket_balances[\s\S]*?execute function private\.preserve_active_roll_ticket_holds_on_balance_change\(\)/i,
    )
    expect(sql).toMatch(
      /revoke all on function private\.preserve_active_roll_ticket_holds_on_balance_change\(\)[\s\S]*?from public, anon, authenticated, service_role/i,
    )
  })

  it('consumes 0014 without redefining its schema or write boundary', () => {
    const boundarySql = sql
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/--.*$/gm, '')
    const protected0014Functions = [
      'public\\.record_roll_ticket_ledger_entry',
      'public\\.reject_roll_ticket_history_mutation',
    ]
    const protected0014Objects = [
      'public\\.roll_ticket_balances',
      'public\\.roll_ticket_ledger_entries',
      ...protected0014Functions,
    ]

    for (const target of protected0014Functions) {
      expect(boundarySql).not.toMatch(new RegExp(
        `\\bcreate\\s+(?:or\\s+replace\\s+)?function\\s+${target}\\b`,
        'i',
      ))
    }
    expect(boundarySql).not.toMatch(
      /create table public\.roll_ticket_(?:balances|ledger_entries)/i,
    )
    expect(boundarySql).not.toMatch(
      /alter table public\.roll_ticket_(?:balances|ledger_entries)/i,
    )
    expect(boundarySql).not.toMatch(/create trigger roll_ticket_ledger_entries_/i)

    for (const target of protected0014Objects) {
      expect(boundarySql).not.toMatch(new RegExp(
        `\\b(?:drop|alter|comment\\s+on|revoke|grant)\\b[^;]*?${target}`,
        'i',
      ))
    }

    // Reject PL/pgSQL dynamic statements without mistaking a trigger's
    // statement-oriented EXECUTE FUNCTION clause for dynamic SQL.
    expect(boundarySql).not.toMatch(
      /(?:^|[;\n])\s*execute\s+(?!function\b)/i,
    )

    expect(sql.match(
      /public\.record_roll_ticket_ledger_entry\(/gi,
    ) ?? []).toHaveLength(0)
  })
})
