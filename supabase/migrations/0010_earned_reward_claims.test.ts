import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { beforeAll, describe, expect, it } from 'vitest'

const migrationPath = resolve(
  process.cwd(),
  'supabase/migrations/0010_earned_reward_claims.sql',
)

let sql = ''

beforeAll(async () => {
  sql = await readFile(migrationPath, 'utf8')
})

function functionSql(name: string) {
  return sql.match(
    new RegExp(`create or replace function (?:public|private)\\.${name}\\([\\s\\S]*?\\n\\$\\$;`, 'i'),
  )?.[0] ?? ''
}

describe('0010 earned reward programs and claims', () => {
  it('normalizes one immutable reward version and item pools from earned-collection@1', () => {
    expect(sql).toMatch(/create table public\.earned_reward_program_versions/)
    expect(sql).toMatch(/economy_edition_id\s+text\s+not null unique[\s\S]*?references public\.economy_editions/)
    expect(sql).toMatch(/id = economy_edition_id \|\| '\/rewards@' \|\| program_version::text/)
    expect(sql).toMatch(/create table public\.earned_reward_program_items/)
    expect(sql).toMatch(/jsonb_array_elements_text\([\s\S]*?newCollectorPassport,eligibleCatalogItemIds/)
    expect(sql).toMatch(/jsonb_array_elements_text\([\s\S]*?communityDie,eligibleCatalogItemIds/)
    expect(sql).not.toMatch(/BEGIN EARNED ECONOMY EDITION/)
  })

  it('stores immutable authoritative events, enrollment anchors, and exact claim outcomes', () => {
    for (const table of [
      'authoritative_roll_completion_events',
      'earned_reward_passport_enrollments',
      'earned_reward_claim_outcomes',
    ]) {
      expect(sql).toMatch(new RegExp(`create table public\\.${table}`, 'i'))
    }
    expect(sql).toMatch(/foreign key \(wallet_ledger_entry_id, account_id, user_id\)[\s\S]*?wallet_ledger_entries \(id, account_id, user_id\)/)
    expect(sql).toMatch(/foreign key \(entitlement_id, user_id, catalog_item_id\)[\s\S]*?user_entitlements \(id, user_id, catalog_item_id\)/)
    expect(sql).toMatch(/unique \(account_id, idempotency_key\)/)
    expect(sql).toMatch(/unique \(account_id, program_id, claim_kind, claim_index\)/)
  })

  it('rejects update, delete, and truncate on every new historical table', () => {
    for (const table of [
      'earned_reward_program_versions',
      'earned_reward_program_items',
      'authoritative_roll_completion_events',
      'earned_reward_passport_enrollments',
      'earned_reward_claim_outcomes',
    ]) {
      expect(sql).toMatch(new RegExp(
        `create trigger ${table.replace('completion_events', 'events')}_reject_update_delete[\\s\\S]*?before update or delete on public\\.${table}`,
        'i',
      ))
      expect(sql).toMatch(new RegExp(
        `create trigger ${table.replace('completion_events', 'events')}_reject_truncate[\\s\\S]*?before truncate on public\\.${table}`,
        'i',
      ))
    }
  })

  it('records roll completions under an account-first lock with exact replay and a ten-slot cap', () => {
    const fn = functionSql('record_authoritative_roll_completion')
    expect(fn).not.toBe('')
    expect(fn).toMatch(/security definer/)
    expect(fn).toContain("set search_path = ''")
    expect(fn).toMatch(/target_account := private\.lock_wallet_account\(p_user_id\)/)
    expect(fn).toMatch(/where server_event_id = p_server_event_id/)
    expect(fn).toMatch(/already used with a different roll payload/)
    expect(fn).toMatch(/credited_count < program\.maximum_rewarded_rolls/)
    expect(fn).toMatch(/public\.append_wallet_ledger_entry\(/)
    expect(fn).toMatch(/'server-authoritative-room'/)
  })

  it('makes the trusted roll function service-only so local clients cannot earn', () => {
    const signature = /public\.record_authoritative_roll_completion\(uuid, text, text, timestamptz\)/i
    expect(sql).toMatch(new RegExp(`revoke all on function ${signature.source}[\\s\\S]*?from public, anon, authenticated, service_role`, 'i'))
    expect(sql).toMatch(new RegExp(`grant execute on function ${signature.source}[\\s\\S]*?to service_role`, 'i'))
    expect(sql).not.toMatch(new RegExp(`grant execute on function ${signature.source}\\s+to (?:anon|authenticated)`, 'i'))
  })

  it('exposes claims with only an idempotency key and derives non-anonymous auth.uid', () => {
    const auth = functionSql('require_non_anonymous_user')
    expect(auth).toMatch(/caller_user_id := \(select auth\.uid\(\)\)/)
    expect(auth).toMatch(/auth\.jwt\(\)/)
    expect(auth).toMatch(/is_anonymous/)
    for (const claim of ['claim_new_collector_passport', 'claim_community_die']) {
      const fn = functionSql(claim)
      expect(fn).toMatch(/\(p_idempotency_key text\)/)
      expect(fn).not.toMatch(/p_user_id|p_catalog_item_id|p_amount/)
      expect(fn).toMatch(/private\.require_non_anonymous_user\(\)/)
      expect(fn).toMatch(/statement_timestamp\(\)/)
    }
  })

  it('derives finite catch-up and deterministic lowest-unowned-or-Dust outcomes', () => {
    const fn = functionSql('issue_earned_reward_claim')
    expect(fn).toMatch(/least\([\s\S]*?program\.passport_duration_weeks/)
    expect(fn).toMatch(/New Collector Passport is complete after twelve claims/)
    expect(fn).toMatch(/program\.community_interval_weeks \* program\.period_days/)
    expect(fn).toMatch(/order by items\.catalog_item_id\s+limit 1/)
    expect(fn).toMatch(/on conflict \(user_id, catalog_item_id\) do nothing/)
    expect(fn).toMatch(/'dust'/)
    expect(fn).toMatch(/public\.append_wallet_ledger_entry\(/)
  })

  it('forces RLS, permits own-row reads, and grants no direct reward DML', () => {
    for (const table of [
      'earned_reward_program_versions',
      'earned_reward_program_items',
      'authoritative_roll_completion_events',
      'earned_reward_passport_enrollments',
      'earned_reward_claim_outcomes',
    ]) {
      expect(sql).toMatch(new RegExp(`alter table public\\.${table} enable row level security`, 'i'))
      expect(sql).toMatch(new RegExp(`alter table public\\.${table} force row level security`, 'i'))
      expect(sql).toMatch(new RegExp(`revoke all on table public\\.${table}[\\s\\S]*?from public, anon, authenticated, service_role`, 'i'))
    }
    expect(sql.match(/using \(\(select auth\.uid\(\)\) is not null and \(select auth\.uid\(\)\) = user_id\)/g)).toHaveLength(3)
    expect(sql).not.toMatch(/grant\s+(?:insert|update|delete|all)[^;]*on table public\.(?:earned_reward|authoritative_roll)/i)
    expect(sql).toMatch(/revoke insert on table public\.user_entitlements from service_role/)
  })

  it('keeps every security-definer function on an empty search path with explicit grants', () => {
    const securityDefiners = sql.match(
      /create or replace function (?:public|private)\.[\s\S]*?security definer[\s\S]*?\n\$\$;/gi,
    ) ?? []
    expect(securityDefiners.length).toBeGreaterThanOrEqual(4)
    for (const fn of securityDefiners) expect(fn).toContain("set search_path = ''")
    for (const name of [
      'record_authoritative_roll_completion',
      'get_earned_reward_status',
      'claim_new_collector_passport',
      'claim_community_die',
    ]) {
      expect(sql).toMatch(new RegExp(`revoke all on function public\\.${name}`, 'i'))
    }
  })
})
