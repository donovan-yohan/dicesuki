import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { beforeAll, describe, expect, it } from 'vitest'

const migrationPath = resolve(
  process.cwd(),
  'supabase/migrations/0024_lunar_pass_faucet.sql',
)
const behavioralPath = resolve(
  process.cwd(),
  'supabase/tests/0024_lunar_pass_faucet.test.sql',
)
const concurrencyPath = resolve(
  process.cwd(),
  'supabase/tests/0024_lunar_pass_faucet.test.mjs',
)

let sql = ''
let behavioralSql = ''
let concurrencySql = ''

beforeAll(async () => {
  const [migrationSql, behaviorSql, concurrencyHarnessSql] = await Promise.all([
    readFile(migrationPath, 'utf8'),
    readFile(behavioralPath, 'utf8'),
    readFile(concurrencyPath, 'utf8'),
  ])
  sql = migrationSql
  behavioralSql = behaviorSql
  concurrencySql = concurrencyHarnessSql
})

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

describe('0024 Lunar Pass daily faucet and purchase grant', () => {
  it('single-sources the Lunar product and both immutable grant amounts', () => {
    const productConstant = functionSql('private', 'lunar_pass_product_id')
    const dailyAmount = functionSql('private', 'lunar_daily_star_amount')
    const purchaseAmount = functionSql(
      'private',
      'lunar_purchase_star_amount',
    )
    const dailyEngine = functionSql(
      'private',
      'claim_lunar_daily_stars_for_user',
    )
    const purchaseEngine = functionSql(
      'public',
      'grant_lunar_purchase_stars',
    )

    expect(productConstant).toMatch(/returns text/i)
    expect(productConstant).toMatch(/immutable/i)
    expect(productConstant).toContain("select 'lunar-pass'::text")
    expect(
      (sql.match(/select 'lunar-pass'::text/gi) ?? []).length,
    ).toBe(1)
    expect(dailyEngine).toMatch(
      /public\.is_lunar_pass_active\([\s\S]*?private\.lunar_pass_product_id\(\)/i,
    )
    expect(dailyEngine).toMatch(
      /product_id = private\.lunar_pass_product_id\(\)/i,
    )
    expect(purchaseEngine).toMatch(
      /p_product_id is distinct from private\.lunar_pass_product_id\(\)[\s\S]*?errcode = '55000'/i,
    )
    for (const [amountFunction, literal] of [
      [dailyAmount, 90],
      [purchaseAmount, 300],
    ] as const) {
      expect(amountFunction).toMatch(/returns bigint/i)
      expect(amountFunction).toMatch(/immutable/i)
      expect(amountFunction).toContain(`select ${literal}::bigint`)
      expect(
        (sql.match(new RegExp(`select ${literal}::bigint`, 'gi')) ?? []).length,
      ).toBe(1)
    }
    expect(sql).toMatch(
      /credited_stars\s+bigint\s+not null\s+check \(credited_stars = private\.lunar_daily_star_amount\(\)\)/i,
    )
    expect(sql).toMatch(
      /credited_stars\s+bigint\s+not null\s+check \(credited_stars = private\.lunar_purchase_star_amount\(\)\)/i,
    )
    expect(dailyEngine).toMatch(
      /public\.append_wallet_ledger_entry\(\s*p_user_id,\s*'stars',\s*'promotional',\s*private\.lunar_daily_star_amount\(\)/i,
    )
    expect(dailyEngine).toMatch(
      /values \([\s\S]*?private\.lunar_daily_star_amount\(\),\s*ledger_entry\.id/i,
    )
    expect(purchaseEngine).toMatch(
      /public\.append_wallet_ledger_entry\(\s*p_user_id,\s*'stars',\s*'promotional',\s*private\.lunar_purchase_star_amount\(\)/i,
    )
    expect(purchaseEngine).toMatch(
      /values \([\s\S]*?private\.lunar_purchase_star_amount\(\),\s*ledger_entry\.id/i,
    )
    expect(sql).toMatch(
      /revoke all on function private\.lunar_pass_product_id\(\)[\s\S]*?from public, anon, authenticated, service_role/i,
    )
    expect(sql).toMatch(
      /revoke all on function private\.lunar_daily_star_amount\(\)[\s\S]*?from public, anon, authenticated, service_role/i,
    )
    expect(sql).toMatch(
      /revoke all on function private\.lunar_purchase_star_amount\(\)[\s\S]*?from public, anon, authenticated, service_role/i,
    )
  })

  it('stores append-only one-per-user UTC-day receipts with owner-read RLS', () => {
    expect(sql).toMatch(/create table public\.lunar_daily_star_claims/i)
    expect(sql).toMatch(
      /unique \(user_id, utc_day\)/i,
    )
    expect(sql).toMatch(
      /credited_stars\s+bigint\s+not null\s+check \(credited_stars = private\.lunar_daily_star_amount\(\)\)/i,
    )
    expect(sql).toMatch(
      /wallet_ledger_entry_id\s+bigint\s+not null unique[\s\S]*?references public\.wallet_ledger_entries \(id\) on delete restrict/i,
    )
    expect(sql).toMatch(
      /foreign key \(user_id, subscription_id\)[\s\S]*?references public\.user_subscriptions \(user_id, subscription_id\)/i,
    )
    expect(sql).toMatch(
      /utc_day = \(claimed_at at time zone 'UTC'\)::date/i,
    )
    expect(sql).toMatch(
      /lunar_daily_star_claims_reject_update_delete[\s\S]*?before update or delete/i,
    )
    expect(sql).toMatch(
      /lunar_daily_star_claims_reject_truncate[\s\S]*?before truncate/i,
    )
    expect(sql).toMatch(
      /alter table public\.lunar_daily_star_claims enable row level security[\s\S]*?force row level security/i,
    )
    expect(sql).toMatch(
      /create policy "users read their own Lunar daily claims"[\s\S]*?using \(\(select auth\.uid\(\)\) = user_id\)/i,
    )
  })

  it('stores immutable invoice-keyed purchase receipts without subscription-state FKs', () => {
    expect(sql).toMatch(/create table public\.lunar_purchase_star_grants/i)
    expect(sql).toMatch(
      /user_id\s+uuid\s+not null references auth\.users \(id\) on delete restrict/i,
    )
    expect(sql).toMatch(
      /xsolla_transaction_id\s+bigint\s+not null check \(xsolla_transaction_id > 0\)/i,
    )
    expect(sql).toMatch(
      /subscription_id\s+text\s+not null[\s\S]*?plan_id\s+text\s+not null[\s\S]*?product_id\s+text\s+not null/i,
    )
    expect(sql).toMatch(
      /credited_stars\s+bigint\s+not null\s+check \(credited_stars = private\.lunar_purchase_star_amount\(\)\)/i,
    )
    expect(sql).toMatch(
      /unique \(user_id, subscription_id, xsolla_transaction_id\)/i,
    )
    expect(sql).toMatch(
      /create index lunar_purchase_star_grants_user_invoice_idx\s+on public\.lunar_purchase_star_grants\s+using btree \(user_id, xsolla_transaction_id\)/i,
    )
    const purchaseTable =
      sql.match(
        /create table public\.lunar_purchase_star_grants \([\s\S]*?\n\);/i,
      )?.[0] ?? ''
    expect(purchaseTable).not.toMatch(
      /references public\.(?:subscription_events|user_subscriptions)/i,
    )
    expect(purchaseTable).not.toMatch(/billing_period|source_subscription_event/i)
    expect(sql).toMatch(
      /lunar_purchase_star_grants_reject_update_delete[\s\S]*?before update or delete/i,
    )
    expect(sql).toMatch(
      /lunar_purchase_star_grants_reject_truncate[\s\S]*?before truncate/i,
    )
    expect(sql).toMatch(
      /alter table public\.lunar_purchase_star_grants enable row level security[\s\S]*?force row level security/i,
    )
  })

  it('implements claim-or-lose UTC daily semantics in a private time seam', () => {
    const engine = functionSql(
      'private',
      'claim_lunar_daily_stars_for_user',
    )
    const wrapper = functionSql('public', 'claim_lunar_daily_stars')

    expect(engine).toMatch(/volatile/i)
    expect(engine).toMatch(/security definer/i)
    expect(engine).toContain("set search_path = ''")
    expect(engine).toMatch(
      /target_utc_day := \(p_effective_at at time zone 'UTC'\)::date/i,
    )
    expect(engine).toMatch(
      /target_account := private\.lock_wallet_account\(p_user_id\)/i,
    )
    expect(engine).toMatch(
      /from public\.lunar_daily_star_claims[\s\S]*?user_id = p_user_id[\s\S]*?utc_day = target_utc_day/i,
    )
    expect(engine).toMatch(/if found then\s+return existing_claim/i)
    expect(engine).not.toMatch(
      /generate_series|catch.?up|retroactive|missed_day/i,
    )
    expect(engine).toMatch(/limit 1\s+for share/i)
    expect(engine).toMatch(
      /public\.append_wallet_ledger_entry\(\s*p_user_id,\s*'stars',\s*'promotional',\s*private\.lunar_daily_star_amount\(\),\s*'lunar\.daily'/i,
    )
    expect(engine).toMatch(
      /'lunar-daily:' \|\| p_user_id::text \|\| ':' \|\| target_utc_day::text/i,
    )
    expect(engine).toContain("'earned-collection@1'")
    expect(wrapper).toMatch(
      /caller_user_id := private\.require_non_anonymous_user\(\)/i,
    )
    expect(wrapper).toMatch(
      /private\.claim_lunar_daily_stars_for_user\(\s*caller_user_id,\s*statement_timestamp\(\)/i,
    )
    expect(sql).toMatch(
      /grant execute on function public\.claim_lunar_daily_stars\(\)\s+to authenticated/i,
    )
    expect(sql).not.toMatch(
      /grant execute on function public\.claim_lunar_daily_stars\(\)\s+to (?:anon|service_role)/i,
    )
  })

  it('grants from verified payment invoice fields with replay and drift safety', () => {
    const engine = functionSql(
      'public',
      'grant_lunar_purchase_stars',
    )

    expect(engine).toMatch(/security definer/i)
    expect(engine).toContain("set search_path = ''")
    expect(engine).toMatch(
      /p_user_id uuid,\s*p_xsolla_transaction_id bigint,\s*p_subscription_id text,\s*p_plan_id text,\s*p_product_id text/i,
    )
    expect(engine).toMatch(
      /p_xsolla_transaction_id is null or p_xsolla_transaction_id <= 0/i,
    )
    expect(engine).toMatch(
      /p_product_id is distinct from private\.lunar_pass_product_id\(\)[\s\S]*?errcode = '55000'/i,
    )
    expect(engine).toMatch(
      /target_account := private\.lock_wallet_account\(p_user_id\)/i,
    )
    expect(engine).toMatch(
      /from public\.lunar_purchase_star_grants[\s\S]*?user_id = p_user_id[\s\S]*?xsolla_transaction_id = p_xsolla_transaction_id/i,
    )
    expect(engine).toMatch(
      /existing_grant\.subscription_id <> p_subscription_id[\s\S]*?existing_grant\.plan_id <> p_plan_id[\s\S]*?existing_grant\.product_id <> p_product_id[\s\S]*?existing_grant\.credited_stars <> private\.lunar_purchase_star_amount\(\)[\s\S]*?errcode = '22023'/i,
    )
    expect(engine).toMatch(
      /if found then[\s\S]*?return existing_grant/i,
    )
    expect(engine).toMatch(
      /ledger_key := 'lunar-purchase:' \|\| p_xsolla_transaction_id::text/i,
    )
    expect(engine).not.toMatch(
      /timestamptz\s*::\s*text|date_create|date_next_charge|billing_period/i,
    )
    expect(engine).not.toMatch(/subscription_events|user_subscriptions|is_lunar_pass_active/i)
    expect(engine).toMatch(
      /public\.append_wallet_ledger_entry\(\s*p_user_id,\s*'stars',\s*'promotional',\s*private\.lunar_purchase_star_amount\(\),\s*'lunar\.purchase'/i,
    )
    expect(engine).toMatch(
      /'subscriptionId', p_subscription_id[\s\S]*?'planId', p_plan_id[\s\S]*?'xsollaTransactionId', p_xsolla_transaction_id/i,
    )
    expect(sql).toMatch(
      /grant execute on function public\.grant_lunar_purchase_stars\(uuid, bigint, text, text, text\)\s+to service_role/i,
    )
    expect(sql).not.toMatch(
      /grant execute on function public\.grant_lunar_purchase_stars\(uuid, bigint, text, text, text\)\s+to (?:anon|authenticated)/i,
    )
    expect(sql).toMatch(
      /future payment-fulfill branch[\s\S]*?purchase\.subscription[\s\S]*?never be called from `update_subscription`/i,
    )
    expect(sql).toMatch(
      /paid invoice grants even after cancellation[\s\S]*?refunds reverse through the refund path/i,
    )
    expect(sql).toMatch(
      /no subscription-state read or FK[\s\S]*?independent of subscription-event delivery order/i,
    )
  })

  it('keeps private engines private and denies all direct API-role DML', () => {
    for (const signature of [
      'private\\.claim_lunar_daily_stars_for_user\\(uuid, timestamptz\\)',
    ]) {
      expect(sql).toMatch(
        new RegExp(
          `revoke all on function ${signature}\\s+from public, anon, authenticated, service_role`,
          'i',
        ),
      )
    }
    expect(sql).not.toMatch(
      /grant\s+(?:insert|update|delete|truncate|all)[^;]*on table public\.lunar_(?:daily_star_claims|purchase_star_grants)/i,
    )
    expect(sql).toMatch(
      /revoke all on table public\.lunar_daily_star_claims[\s\S]*?from public, anon, authenticated, service_role/i,
    )
    expect(sql).toMatch(
      /revoke all on table public\.lunar_purchase_star_grants[\s\S]*?from public, anon, authenticated, service_role/i,
    )
  })

  it('documents the spec decisions and intentionally ships no webhook wiring', () => {
    expect(sql).toMatch(/\[free\] DORMANT RAIL/i)
    expect(sql).toMatch(/issue #154[\s\S]*?subscription-law/i)
    expect(sql).toMatch(
      /spec section 3\.5[\s\S]*?Welkin-style claim-on-login-or-lose-it/i,
    )
    expect(sql).toMatch(
      /Section 3\.1 grants[\s\S]*?300 Stars on initial purchase and each renewal[\s\S]*?90 claimed daily/i,
    )
    expect(sql).toMatch(/no retroactive accrual and no bank/i)
    expect(sql).toMatch(/No webhook or client invokes these RPCs in this slice/i)
  })

  it('ships SQLSTATE-pinned behavioral coverage for every required seam', () => {
    expect(behavioralSql).toMatch(/begin;[\s\S]*?rollback;/i)
    expect(behavioralSql).toMatch(/UTC day boundary/i)
    expect(behavioralSql).toMatch(/Same-day replay/i)
    expect(behavioralSql).toMatch(/Different user isolation/i)
    expect(behavioralSql).toMatch(/Non-subscriber/i)
    expect(behavioralSql).toMatch(/Canceled past date_end/i)
    expect(behavioralSql).toMatch(/Non-renewing past date_next_charge/i)
    expect(behavioralSql).toMatch(/Product-filter mismatch/i)
    expect(behavioralSql).toMatch(/Same invoice replay/i)
    expect(behavioralSql).toMatch(/Distinct invoice in the same billing period/i)
    expect(behavioralSql).toMatch(/Plan-change update event has no grant path/i)
    expect(behavioralSql).toMatch(/Paid-after-cancel invoice grants/i)
    expect(behavioralSql).toMatch(/Same invoice subscription drift/i)
    expect(behavioralSql).toMatch(/Same invoice plan drift/i)
    expect(behavioralSql).toMatch(/Same invoice product drift/i)
    expect(behavioralSql).toMatch(/Same invoice amount drift/i)
    expect(behavioralSql).toMatch(/Payment-before-subscription ordering/i)
    expect(behavioralSql).toMatch(
      /Authenticated non-anonymous public daily claim success/i,
    )
    expect(behavioralSql).toMatch(/Authenticated purchase call rejected/i)
    expect(behavioralSql).toMatch(/Direct DML denial/i)
    expect(behavioralSql).toMatch(/RLS cross-user/i)
    expect(behavioralSql).toMatch(/reset role;/i)
    expect(behavioralSql).toMatch(/exception when sqlstate '55000'/i)
    expect(behavioralSql).toMatch(/exception when sqlstate '42501'/i)
    expect(behavioralSql).toMatch(/exception when insufficient_privilege/i)
  })

  it('ships executable account-lock concurrency coverage for invoice replay and drift', () => {
    expect(concurrencySql).toMatch(
      /export async function run\(\{ psql, psqlAsync \}\)/,
    )
    expect(concurrencySql).toMatch(/Concurrent identical invoice replay/i)
    expect(concurrencySql).toMatch(/Concurrent same-invoice subscription drift/i)
    expect(concurrencySql).toMatch(
      /insert into public\.wallet_accounts[\s\S]*?initialState !== '2:0:0:0'/i,
    )
    expect(concurrencySql).toMatch(
      /const blockerName = `0024-\$\{label\}-blocker`[\s\S]*?set application_name = '\$\{blockerName\}'[\s\S]*?for update;[\s\S]*?pg_sleep\(30\)/i,
    )
    expect(concurrencySql).toMatch(
      /racers\.push\(\s*psqlAsync\(grantSql\(firstName[\s\S]*?psqlAsync\(grantSql\(secondName/i,
    )
    expect(concurrencySql).toMatch(
      /waitForActivity\(\s*psql,\s*firstName,[\s\S]*?state\.includes\(':Lock:'\)[\s\S]*?waitForActivity\(\s*psql,\s*secondName,[\s\S]*?state\.includes\(':Lock:'\)/i,
    )
    expect(concurrencySql).toMatch(
      /blocker cleanup probe[\s\S]*?terminateBlocker\(psql, blockerName,[\s\S]*?Promise\.all\(\[blocker, \.\.\.racers\]\)/i,
    )
    expect(concurrencySql).toMatch(
      /new Set\(identical\.map\(result => result\.stdout\)\)\.size !== 1/i,
    )
    expect(concurrencySql).toMatch(
      /identical invoice replay state[\s\S]*?replayState !== '1:1:300'/i,
    )
    expect(concurrencySql).toMatch(
      /drift\.filter\(result => result\.status === 0\)\.length !== 1/i,
    )
    expect(concurrencySql).toMatch(
      /Xsolla transaction id was already used with different Lunar purchase semantics/i,
    )
    expect(concurrencySql).toMatch(
      /same-invoice drift state[\s\S]*?driftState !== '1:1:300'/i,
    )
  })
})
