import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { beforeAll, describe, expect, it } from 'vitest'

const migrationPath = resolve(
  process.cwd(),
  'supabase/migrations/0011_earned_pull_preparation.sql',
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

describe('0011 sealed pull preparation', () => {
  it('appends normalized versioned config without copying an edition snapshot', () => {
    for (const table of [
      'pull_hold_policy_versions',
      'pull_banner_families',
      'pull_banner_versions',
      'pull_banner_offers',
      'pull_banner_tiers',
      'pull_banner_items',
    ]) {
      expect(sql).toMatch(new RegExp(`create table public\\.${table}`, 'i'))
    }
    expect(sql).toContain('6e198c0f3a3a96975ada45b27334583b5c17d84549db9eefe4e3671b296aba09')
    expect(sql).toMatch(/source_banner := source_edition\.config #> '\{acquisition,banner\}'/)
    expect(sql).toMatch(/jsonb_array_elements\(source_banner -> 'tiers'\)/)
    expect(sql).toMatch(/jsonb_array_elements_text\(tier_record\.tier -> 'catalogItemIds'\)/)
    expect(sql).toMatch(/total_items <> 4 or total_weight <> 100/)
    expect(sql).toMatch(/pull_banner_items[\s\S]*?<> 45/)
    expect(sql).toMatch(/tier_id = 'standard'\) <> 24/)
    expect(sql).toMatch(/tier_id = 'rare'\) <> 9/)
    expect(sql).toMatch(/tier_id = 'epic'\) <> 6/)
    expect(sql).toMatch(/tier_id = 'signature'\) <> 6/)
    expect(sql).not.toMatch(/BEGIN EARNED ECONOMY EDITION/)
  })

  it('freezes the exact costs, weights, guarantees, and new 120-second hold policy', () => {
    expect(sql).toMatch(/values \('pull-hold@1', 1, 120\)/)
    expect(sql).toMatch(/singlePullCost'\)::bigint <> 160/)
    expect(sql).toMatch(/tenPullCost'\)::bigint <> 1600/)
    expect(sql).toMatch(/'earned-collection-001@1', 1, \(source_currency ->> 'singlePullCost'\)::bigint/)
    expect(sql).toMatch(/'earned-collection-001@1', 10, \(source_currency ->> 'tenPullCost'\)::bigint/)
    expect(sql).toMatch(/rareOrBetter,hardGuaranteePull}'\)::integer <> 8/)
    expect(sql).toMatch(/epicOrBetter,hardGuaranteePull}'\)::integer <> 25/)
    expect(sql).toMatch(/selectedFeaturedUnowned,hardGuaranteePull}'\)::integer <> 20/)
    expect(sql).toMatch(/selectedFeaturedUnowned,selection}' <>[\s\S]*?'lowest-canonical-id-unowned'/)
    expect(sql).toMatch(/'selected-featured-unowned',[\s\S]*?'epic-or-better',[\s\S]*?'rare-or-better',[\s\S]*?'base'/)
    expect(sql).toMatch(/not economy-edition-derived/i)
  })

  it('normalizes appendable offers and binds every session to its versioned price', () => {
    expect(sql).toMatch(/create table public\.pull_banner_offers/)
    expect(sql).toMatch(/primary key \(banner_version_id, pull_count\)/)
    expect(sql).toMatch(/unique \(banner_version_id, pull_count, cost\)/)
    expect(sql).toMatch(/pull_count\s+smallint\s+not null check \(pull_count between 1 and 100\)/)
    expect(sql).toMatch(/foreign key \(banner_version_id, pull_count, held_amount\)[\s\S]*?references public\.pull_banner_offers \(banner_version_id, pull_count, cost\)/)
    expect(sql).toMatch(/create index pull_sessions_offer_idx[\s\S]*?\(banner_version_id, pull_count, held_amount\)/)
    expect(sql).not.toMatch(/single_pull_cost|ten_pull_cost|pull_sessions_exact_cost/)
  })

  it('stores immutable session metadata and hidden sealed result proofs', () => {
    expect(sql).toMatch(/create table public\.pull_sessions/)
    expect(sql).toMatch(/unique \(account_id, idempotency_key\)/)
    expect(sql).toMatch(/pull_count\s+smallint\s+not null check \(pull_count between 1 and 100\)/)
    expect(sql).toMatch(/expires_at = prepared_at \+ make_interval/)
    expect(sql).toMatch(/total_pulls_projected = total_pulls_before \+ pull_count/)
    expect(sql).toMatch(/commitment_scheme = 'sha256-result-v1\+sha256-root-v1'/)
    expect(sql).toMatch(/rng_scheme\s+text\s+not null/)
    expect(sql).toMatch(/rng_seed\s+bytea\s+not null check \(octet_length\(rng_seed\) = 32\)/)
    expect(sql).toMatch(/create table public\.sealed_pull_results/)
    expect(sql).toMatch(/nonce\s+bytea\s+not null check \(octet_length\(nonce\) = 32\)/)
    expect(sql).toMatch(/primary key \(session_id, result_position\)/)
    expect(sql).toMatch(/resolution_reason in \('base', 'rare-guarantee', 'epic-guarantee', 'selected-guarantee'\)/)
    expect(sql).toMatch(/is_duplicate\s+boolean\s+not null/)
    expect(sql).toMatch(/duplicate_dust_amount\s+bigint\s+not null/)
  })

  it('uses account-first exact replay and derives every sensitive input server-side', () => {
    const publicFn = functionSql('public', 'prepare_pull')
    const privateFn = functionSql('private', 'prepare_pull_for_user')
    expect(publicFn).toMatch(/\(\s*p_banner_version_id text,\s*p_pull_count smallint,\s*p_idempotency_key text\s*\)/)
    expect(publicFn).not.toMatch(/p_user_id|p_prepared_at|p_cost|p_nonce|p_result/)
    expect(publicFn).toMatch(/security definer/)
    expect(publicFn).toContain("set search_path = ''")
    expect(publicFn).toMatch(/private\.require_non_anonymous_user\(\)/)
    expect(publicFn).not.toMatch(/statement_timestamp\(\)|clock_timestamp\(\)|p_test_prepared_at/)
    expect(publicFn).toMatch(/p_idempotency_key,\s*null::timestamptz,\s*false/)
    expect(publicFn).toMatch(/returns table \([\s\S]*?session_id uuid[\s\S]*?commitment_root text[\s\S]*?rng_scheme text/)
    expect(publicFn).not.toMatch(/rng_seed|rare_misses|epic_misses|selected_misses|catalog_item_id|nonce|duplicate_dust/)

    expect(privateFn).toMatch(/target_account := private\.lock_wallet_account\(p_user_id\)/)
    expect(privateFn.indexOf('target_account := private.lock_wallet_account')).toBeLessThan(
      privateFn.indexOf('where account_id = target_account.id'),
    )
    expect(privateFn).toMatch(/where account_id = target_account\.id[\s\S]*?idempotency_key = p_idempotency_key/)
    expect(privateFn).toMatch(/return existing_session/)
    expect(privateFn).toMatch(/already used with a different request/)
    expect(privateFn.indexOf('return existing_session')).toBeLessThan(
      privateFn.indexOf('Insufficient available promotional Stars'),
    )
    expect(privateFn).toMatch(/decision_at := clock_timestamp\(\)/)
    expect(privateFn.indexOf('return existing_session')).toBeLessThan(
      privateFn.indexOf('decision_at := clock_timestamp()'),
    )
    expect(privateFn).toMatch(/session_prepared_at := coalesce\(p_test_prepared_at, decision_at\)/)
    expect(privateFn).toMatch(/prepared_at <= decision_at[\s\S]*?expires_at > decision_at/)
    expect(privateFn).toMatch(/select \* into offer[\s\S]*?pull_count = p_pull_count[\s\S]*?target_cost := offer\.cost/)
    expect(privateFn).toMatch(/perform public\.ensure_starter_entitlements\(\)/)
    expect(privateFn.indexOf('return existing_session')).toBeLessThan(
      privateFn.indexOf('perform public.ensure_starter_entitlements'),
    )
    expect(privateFn.indexOf('perform public.ensure_starter_entitlements')).toBeLessThan(
      privateFn.indexOf('from public.user_entitlements as entitlements'),
    )
  })

  it('reserves one live family session and counts all active holds without debiting', () => {
    const fn = functionSql('private', 'prepare_pull_for_user')
    expect(fn).toMatch(/banner_family_id = banner\.banner_family_id[\s\S]*?expires_at > decision_at/)
    expect(fn).toMatch(/sum\(sessions\.held_amount\)/)
    expect(fn).toMatch(/current_balance - active_holds < target_cost/)
    expect(fn).not.toMatch(/insert into public\.wallet_ledger_entries/)
    expect(fn).not.toMatch(/update public\.wallet_balances/)
    expect(fn).not.toMatch(/insert into public\.user_entitlements/)
    expect(fn).not.toMatch(/update public\.pull_guarantee_states/)
    expect(fn).not.toMatch(/insert into public\.pull_guarantee_states/)
  })

  it('uses pgcrypto rejection sampling and sequential selected-epic-rare-base resolution', () => {
    const random = functionSql('private', 'pull_seeded_uint32_below')
    const prepare = functionSql('private', 'prepare_pull_for_user')
    expect(prepare).toMatch(/pull_seed bytea := extensions\.gen_random_bytes\(32\)/)
    expect(random).toMatch(/extensions\.hmac\(/)
    expect(random).toMatch(/'dicesuki\.pull\.rng\.v1'/)
    expect(random).toMatch(/'attempt=' \|\| attempt::text/)
    expect(random).toMatch(/acceptance_limit := \(4294967296::bigint \/ p_upper_bound::bigint\) \* p_upper_bound::bigint/)
    expect(random).toMatch(/if random_value < acceptance_limit/)
    expect(random).not.toMatch(/\brandom\(\)/)
    expect(prepare).toMatch(/for position in 1\.\.p_pull_count loop/)
    expect(prepare).toMatch(/selected_cursor \+ 1 >= banner\.selected_hard_guarantee_pull/)
    expect(prepare).toMatch(/epic_cursor \+ 1 >= banner\.epic_hard_guarantee_pull/)
    expect(prepare).toMatch(/rare_cursor \+ 1 >= banner\.rare_hard_guarantee_pull/)
    expect(prepare.indexOf('if selected_due')).toBeLessThan(prepare.indexOf('if epic_due'))
    expect(prepare.indexOf('if epic_due')).toBeLessThan(prepare.indexOf('elsif rare_due'))
    expect(prepare).toMatch(/not \(items\.catalog_item_id = any\(projected_catalog_item_ids\)\)/)
    expect(prepare).toMatch(/where items\.banner_version_id = banner\.id[\s\S]*?items\.selected_featured[\s\S]*?order by items\.catalog_item_id[\s\S]*?limit 1/)
    expect(prepare).toMatch(/result_nonce := private\.pull_result_nonce\(/)
    expect(prepare).not.toMatch(/result_nonce := extensions\.gen_random_bytes/)
    expect(prepare).toMatch(/items\.selected_featured[\s\S]*?into target_item/)
    expect(prepare).toMatch(/result_selected_after := private\.pull_selected_misses_after\([\s\S]*?target_item\.selected_featured[\s\S]*?result_is_duplicate/)
    expect(prepare).toMatch(/selected_cursor := result_selected_after/)
    expect(prepare).not.toMatch(/target_item\.catalog_item_id = selected_item\.catalog_item_id then 0/)
  })

  it('binds every result and ordered root to explicit SHA-256 commitment fields', () => {
    const result = functionSql('private', 'pull_result_commitment')
    const root = functionSql('private', 'pull_commitment_root')
    expect(result).toMatch(/extensions\.digest\(/)
    expect(result).toMatch(/'dicesuki\.pull\.result\.v1'/)
    for (const label of [
      'session=', 'position=', 'catalogItemId=', 'tierId=', 'tierRank=', 'reason=',
      'rareBefore=', 'rareAfter=', 'epicBefore=', 'epicAfter=',
      'selectedBefore=', 'selectedAfter=', 'nonce=',
      'selectedTargetCatalogItemId=', 'duplicate=', 'duplicateDust=',
    ]) {
      expect(result).toContain(`'${label}'`)
    }
    expect(root).toMatch(/'dicesuki\.pull\.root\.v1'/)
    expect(root).toMatch(/string_agg\(entry\.ordinality::text \|\| ':' \|\| entry\.commitment/)
    expect(root).toMatch(/order by entry\.ordinality/)
  })

  it('preserves holds and ownership snapshots at the table boundary', () => {
    const balanceGuard = functionSql('private', 'preserve_active_pull_holds_on_balance_change')
    const ownershipGuard = functionSql('private', 'preserve_pull_ownership_snapshot')
    expect(balanceGuard).toMatch(/new\.current_balance < active_holds/)
    expect(balanceGuard).toMatch(/decision_at timestamptz := clock_timestamp\(\)/)
    expect(ownershipGuard).toMatch(/security definer/)
    expect(ownershipGuard).toContain("set search_path = ''")
    expect(ownershipGuard).toMatch(/target_account := private\.lock_wallet_account\(new\.user_id\)/)
    expect(ownershipGuard).toMatch(/decision_at := clock_timestamp\(\)/)
    expect(ownershipGuard).toMatch(/sessions\.account_id = target_account\.id/)
    expect(ownershipGuard).toMatch(/expires_at > decision_at/)
    expect(sql).toMatch(/before update of current_balance on public\.wallet_balances/)
    expect(sql).toMatch(/before insert on public\.user_entitlements/)

    const append = functionSql('public', 'append_wallet_ledger_entry')
    expect(append).toMatch(/p_delta_amount < 0/)
    expect(append).toMatch(/decision_at := clock_timestamp\(\)/)
    expect(append).toMatch(/resulting_balance < active_holds/)
    expect(append).not.toMatch(/statement_timestamp\(\)/)
  })

  it('forces RLS, denies direct DML/result reads, and grants only authenticated prepare', () => {
    for (const table of [
      'pull_hold_policy_versions',
      'pull_banner_families',
      'pull_banner_versions',
      'pull_banner_offers',
      'pull_banner_tiers',
      'pull_banner_items',
      'pull_guarantee_states',
      'pull_sessions',
      'sealed_pull_results',
    ]) {
      expect(sql).toMatch(new RegExp(`'${table}'`, 'i'))
    }
    expect(sql).toMatch(/alter table public\.%I enable row level security/)
    expect(sql).toMatch(/alter table public\.%I force row level security/)
    expect(sql).not.toMatch(/users read their own pull session metadata/)
    expect(sql).not.toMatch(/grant select on table public\.pull_sessions to authenticated/i)
    expect(sql).not.toMatch(/grant select on table public\.sealed_pull_results to (?:anon|authenticated)/i)
    expect(sql).not.toMatch(/grant\s+(?:insert|update|delete|truncate|all)[^;]*on table public\.(?:pull_|sealed_pull)/i)
    expect(sql).toMatch(/revoke all on function public\.prepare_pull\(text, smallint, text\)[\s\S]*?public, anon, authenticated, service_role/)
    expect(sql).toMatch(/grant execute on function public\.prepare_pull\(text, smallint, text\)[\s\S]*?to authenticated/)
    expect(sql).not.toMatch(/grant execute on function public\.prepare_pull\(text, smallint, text\)\s+to (?:anon|service_role)\s*;/i)
  })

  it('rejects update/delete/truncate history and includes every access/FK index', () => {
    for (const table of [
      'pull_hold_policy_versions',
      'pull_banner_families',
      'pull_banner_versions',
      'pull_banner_offers',
      'pull_banner_tiers',
      'pull_banner_items',
      'pull_sessions',
      'sealed_pull_results',
    ]) {
      expect(sql).toContain(`'${table}'`)
    }
    expect(sql).toMatch(/before update or delete on public\.%I/)
    expect(sql).toMatch(/before truncate on public\.%I/)
    expect(sql).toMatch(/pull_guarantee_states_reject_delete/)
    for (const index of [
      'pull_banner_versions_family_idx',
      'pull_banner_versions_economy_edition_idx',
      'pull_banner_versions_hold_policy_idx',
      'pull_banner_items_catalog_item_idx',
      'pull_guarantee_states_user_family_idx',
      'pull_sessions_user_prepared_idx',
      'pull_sessions_account_active_hold_idx',
      'pull_sessions_account_family_active_idx',
      'pull_sessions_offer_idx',
      'pull_sessions_hold_policy_idx',
      'sealed_pull_results_account_idx',
      'sealed_pull_results_user_idx',
      'sealed_pull_results_banner_item_idx',
    ]) {
      expect(sql).toMatch(new RegExp(`create index ${index}`, 'i'))
    }
  })
})
