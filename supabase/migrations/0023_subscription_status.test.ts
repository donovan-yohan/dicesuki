import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { beforeAll, describe, expect, it } from 'vitest'

const migrationPath = resolve(
  process.cwd(),
  'supabase/migrations/0023_subscription_status.sql',
)
const behavioralPath = resolve(
  process.cwd(),
  'supabase/tests/0023_subscription_status.test.sql',
)

let sql = ''
let behavioralSql = ''

beforeAll(async () => {
  [sql, behavioralSql] = await Promise.all([
    readFile(migrationPath, 'utf8'),
    readFile(behavioralPath, 'utf8'),
  ])
})

function functionSql(schema: 'public' | 'private', name: string) {
  return sql.match(
    new RegExp(
      `create or replace function ${schema}\\.${name}\\([\\s\\S]*?\\n\\$\\$;`,
      'i',
    ),
  )?.[0] ?? ''
}

describe('0023 subscription status', () => {
  it('defines an append-only subscription receipt with the documented Xsolla fields', () => {
    expect(sql).toMatch(/create table public\.subscription_events/i)
    expect(sql).toMatch(
      /user_id\s+uuid\s+not null references auth\.users \(id\) on delete restrict/i,
    )
    expect(sql).toMatch(/subscription_id\s+text\s+not null/i)
    expect(sql).toMatch(
      /notification_type in \(\s*'create_subscription',\s*'update_subscription',\s*'non_renewal_subscription',\s*'cancel_subscription',\s*'unknown'\s*\)/i,
    )
    for (const field of [
      'plan_id',
      'product_id',
      'date_create',
      'date_next_charge',
      'date_end',
      'raw_payload',
      'body_sha256',
      'received_at',
    ]) {
      expect(sql).toMatch(new RegExp(`\\b${field}\\b`, 'i'))
    }
    expect(sql).toMatch(/processed\s+boolean\s+not null/i)
    expect(sql).toMatch(
      /processed = \(notification_type <> 'unknown'\)/i,
    )
    expect(sql).toMatch(
      /notification_type = 'create_subscription'[\s\S]*?date_create is not null[\s\S]*?date_next_charge is not null and date_end is null/i,
    )
    expect(sql).toMatch(
      /notification_type = 'update_subscription'[\s\S]*?date_create is null[\s\S]*?date_next_charge is not null and date_end is null/i,
    )
    expect(sql).toMatch(
      /notification_type = 'non_renewal_subscription'[\s\S]*?date_create is null[\s\S]*?date_next_charge is not null and[\s\S]*?date_end is null/i,
    )
    expect(sql).toMatch(
      /notification_type = 'cancel_subscription'[\s\S]*?date_create is null and date_next_charge is null and[\s\S]*?date_end is not null/i,
    )
    expect(sql).toMatch(
      /create trigger subscription_events_reject_update_delete[\s\S]*?before update or delete on public\.subscription_events/i,
    )
    expect(sql).toMatch(
      /create trigger subscription_events_reject_truncate[\s\S]*?before truncate on public\.subscription_events/i,
    )
    expect(sql).toMatch(/errcode = '55000'/i)
  })

  it('uses the semantic Xsolla date and raw-body hash as the delivery key', () => {
    const dedupe = sql.match(
      /create unique index subscription_events_delivery_dedupe_idx[\s\S]*?body_sha256\s*\n\s*\);/i,
    )?.[0] ?? ''

    expect(dedupe).toMatch(/subscription_id/i)
    expect(dedupe).toMatch(/notification_type/i)
    expect(dedupe).toMatch(
      /when 'create_subscription' then date_create/i,
    )
    expect(dedupe).toMatch(
      /when 'update_subscription' then date_next_charge/i,
    )
    expect(dedupe).toMatch(
      /when 'non_renewal_subscription' then date_next_charge/i,
    )
    expect(dedupe).toMatch(
      /when 'cancel_subscription' then date_end/i,
    )
    expect(dedupe).toMatch(/'-infinity'::timestamptz/i)
    expect(dedupe).toMatch(/body_sha256/i)
    expect(sql).toMatch(/body_sha256 ~ '\^\[0-9a-f\]\{64\}\$'/i)
  })

  it('normalizes unknown notifications without projecting them', () => {
    const engine = functionSql('private', 'record_subscription_event')

    expect(engine).toMatch(
      /then p_notification_type\s+else 'unknown'\s+end/i,
    )
    expect(engine).toMatch(/normalized_type <> 'unknown'/i)
    expect(engine).toMatch(
      /if normalized_type = 'create_subscription'[\s\S]*?elsif normalized_type = 'cancel_subscription'[\s\S]*?end if;/i,
    )
    expect(engine).not.toMatch(
      /elsif normalized_type = 'unknown'[\s\S]*?(?:insert|update) public\.user_subscriptions/i,
    )
    expect(sql).toMatch(
      /verbatim source[\s\S]*?raw_payload[\s\S]*?processed=false/i,
    )
  })

  it('serializes, appends, and returns exact replays before projection', () => {
    const engine = functionSql('private', 'record_subscription_event')

    expect(engine).toMatch(/security definer/i)
    expect(engine).toContain("set search_path = ''")
    expect(engine).toMatch(
      /pg_catalog\.pg_advisory_xact_lock\(\s*pg_catalog\.hashtextextended/i,
    )
    expect(engine).toMatch(
      /pg_catalog\.hashtextextended\(\s*p_subscription_id,\s*0\s*\)/i,
    )
    expect(engine).not.toMatch(
      /hashtextextended\([\s\S]{0,120}p_user_id/i,
    )
    expect(engine).toMatch(
      /from public\.subscription_events[\s\S]*?body_sha256 = p_body_sha256/i,
    )
    expect(engine).toMatch(/return existing_event/i)
    expect(engine.indexOf('return existing_event')).toBeLessThan(
      engine.indexOf('insert into public.subscription_events'),
    )
    expect(engine.indexOf('insert into public.subscription_events')).toBeLessThan(
      engine.indexOf('insert into public.user_subscriptions'),
    )
    expect(engine).toMatch(
      /already used with a different parsed payload[\s\S]*?errcode = '22023'/i,
    )
    expect(engine).toMatch(
      /create_subscription requires plan_id, date_create, and date_next_charge, and forbids date_end[\s\S]*?errcode = '22023'/i,
    )
    expect(engine).toMatch(
      /update_subscription requires plan_id and date_next_charge, and forbids date_create and date_end[\s\S]*?errcode = '22023'/i,
    )
    expect(engine).toMatch(
      /non_renewal_subscription requires date_next_charge and forbids date_create and date_end[\s\S]*?errcode = '22023'/i,
    )
    expect(engine).toMatch(
      /cancel_subscription requires date_end and forbids date_create and date_next_charge[\s\S]*?errcode = '22023'/i,
    )
  })

  it('implements a monotone terminal-dominant projection', () => {
    const engine = functionSql('private', 'record_subscription_event')

    expect(sql).toMatch(/create table public\.user_subscriptions/i)
    expect(sql).toMatch(/primary key \(user_id, subscription_id\)/i)
    expect(sql).toMatch(/product_id\s+text/i)
    expect(sql).toMatch(
      /constraint user_subscriptions_product_id[\s\S]*?char_length\(product_id\) between 1 and 255/i,
    )
    expect(sql).toMatch(
      /status in \('active', 'non_renewing', 'canceled'\)/i,
    )
    expect(engine).toMatch(
      /normalized_type = 'create_subscription'[\s\S]*?where user_subscriptions\.status = 'active'/i,
    )
    expect(engine).toMatch(
      /normalized_type = 'update_subscription'[\s\S]*?where user_subscriptions\.status = 'active'/i,
    )
    expect(engine).toMatch(
      /normalized_type = 'non_renewal_subscription'[\s\S]*?set status = 'non_renewing'[\s\S]*?where \(\s*user_subscriptions\.status = 'active'[\s\S]*?\)\s*or \(\s*user_subscriptions\.status = 'non_renewing'/i,
    )
    expect(engine).toMatch(
      /normalized_type = 'cancel_subscription'[\s\S]*?set status = 'canceled'/i,
    )
    expect(engine).toMatch(
      /user_subscriptions\.status <> 'canceled'[\s\S]*?excluded\.date_end >= user_subscriptions\.date_end/i,
    )
    expect(engine).toMatch(
      /excluded\.date_next_charge >= user_subscriptions\.date_next_charge/i,
    )
    expect(engine).toMatch(
      /sequential delivery[\s\S]*?delayed stale event[\s\S]*?status = 'active'[\s\S]*?excluded\.date_next_charge >= user_subscriptions\.date_next_charge/i,
    )
  })

  it('exposes a NULL-safe service-or-self Lunar Pass predicate', () => {
    const predicate = functionSql('public', 'is_lunar_pass_active')

    expect(predicate).toMatch(/stable/i)
    expect(predicate).toMatch(/security definer/i)
    expect(predicate).toContain("set search_path = ''")
    expect(predicate).toMatch(
      /caller_claims ->> 'role' = 'service_role'/i,
    )
    expect(predicate).toMatch(/caller_id is distinct from p_user_id/i)
    expect(predicate).toMatch(/errcode = '42501'/i)
    expect(predicate).toMatch(
      /p_product_id text default null/i,
    )
    expect(predicate).toMatch(
      /p_product_id is null or\s+subscriptions\.product_id = p_product_id/i,
    )
    expect(predicate).toMatch(
      /subscriptions\.status = 'active'\s+or/i,
    )
    expect(predicate).toMatch(
      /subscriptions\.status = 'non_renewing'[\s\S]*?date_next_charge is not null[\s\S]*?p_at < subscriptions\.date_next_charge/i,
    )
    expect(predicate).toMatch(
      /subscriptions\.status = 'canceled'[\s\S]*?date_end is not null[\s\S]*?p_at < subscriptions\.date_end/i,
    )
    expect(predicate).toMatch(
      /if p_user_id is null or p_at is null then\s+return false/i,
    )
    expect(sql).toMatch(
      /Slice C daily claims MUST pass the Lunar product id once its SKU exists[\s\S]*?future second subscription product cannot leak entitlement/i,
    )
  })

  it('forces owner-read RLS, publishes only the snapshot, and exposes service-only writes', () => {
    for (const table of ['subscription_events', 'user_subscriptions']) {
      expect(sql).toMatch(
        new RegExp(
          `alter table public\\.${table} enable row level security`,
          'i',
        ),
      )
      expect(sql).toMatch(
        new RegExp(
          `alter table public\\.${table} force row level security`,
          'i',
        ),
      )
      expect(sql).toMatch(
        new RegExp(
          `using \\(\\(select auth\\.uid\\(\\)\\) = user_id\\)`,
          'i',
        ),
      )
    }
    expect(sql).toMatch(
      /alter publication supabase_realtime add table public\.user_subscriptions/i,
    )
    expect(sql).not.toMatch(
      /alter publication supabase_realtime add table public\.subscription_events/i,
    )
    expect(sql).toMatch(
      /revoke all on function private\.record_subscription_event\([\s\S]*?from public, anon, authenticated, service_role/i,
    )
    expect(sql).toMatch(
      /grant execute on function public\.record_subscription_event\([\s\S]*?\) to service_role/i,
    )
    expect(sql).not.toMatch(
      /grant execute on function public\.record_subscription_event\([\s\S]*?\) to (?:anon|authenticated)/i,
    )
    expect(sql).toMatch(
      /grant execute on function public\.is_lunar_pass_active\(uuid, timestamptz, text\)\s+to authenticated, service_role/i,
    )
    expect(sql).not.toMatch(
      /grant\s+(?:insert|update|delete|truncate|all)[^;]*on table public\.(?:subscription_events|user_subscriptions)/i,
    )
  })

  it('documents the dormant rail and current Xsolla subscription contract', () => {
    expect(sql).toMatch(/\[free\] DORMANT RAIL/i)
    expect(sql).toMatch(/issue #154[\s\S]*?subscription-law/i)
    for (const page of [
      'created-subscription',
      'updated-subscription',
      'nonrenewing-subscription',
      'canceled-subscription',
    ]) {
      expect(sql).toContain(
        `developers.xsolla.com/webhooks/subscriptions/${page}/`,
      )
    }
    expect(sql).toMatch(
      /p_user_id is the ALREADY-RESOLVED Supabase auth uid[\s\S]*?Xsolla user\.id to[\s\S]*?auth uid resolution happens upstream in the webhook handler \(slice B\)/i,
    )
    expect(sql).toMatch(
      /comment on column public\.subscription_events\.user_id is\s+'ALREADY-RESOLVED Supabase auth uid\.[\s\S]*?Xsolla user\.id[\s\S]*?upstream in the webhook handler\.'/i,
    )
    expect(sql).toMatch(
      /comment on function public\.record_subscription_event\([\s\S]*?\) is\s+'Service-only Xsolla subscription receipt boundary\. p_user_id is the ALREADY-RESOLVED Supabase auth uid;[\s\S]*?Xsolla user\.id upstream in the webhook handler\./i,
    )
    expect(sql).toMatch(
      /is_gift and trial deliberately stay in subscription_events\.raw_payload[\s\S]*?Future gift logic reparses that jsonb/i,
    )
  })

  it('ships a SQLSTATE-pinned behavioral suite for every required state-machine seam', () => {
    expect(behavioralSql).toMatch(/begin;[\s\S]*?rollback;/i)
    expect(behavioralSql).toMatch(
      /create_subscription[\s\S]*?update_subscription[\s\S]*?non_renewal_subscription[\s\S]*?cancel_subscription/i,
    )
    expect(behavioralSql).toMatch(/Cancel first, then deliver a late update/i)
    expect(behavioralSql).toMatch(/Create after cancel on the same subscription id/i)
    expect(behavioralSql).toMatch(/Exact dedupe replay/i)
    expect(behavioralSql).toMatch(/projection_ctid_before tid/i)
    expect(behavioralSql).toMatch(
      /select ctid into strict projection_ctid_before/i,
    )
    expect(behavioralSql).not.toMatch(/projection_updated_before/i)
    expect(behavioralSql).toMatch(
      /Stale active update appends a receipt but cannot roll plan\/date backward/i,
    )
    expect(behavioralSql).toMatch(
      /Stale non-renewal appends a receipt but cannot roll rank-one fields back/i,
    )
    expect(behavioralSql).toMatch(
      /Stale active-to-nonrenewal cannot shorten the projected entitlement date/i,
    )
    expect(behavioralSql).toMatch(
      /Earlier second cancellation appends a receipt but preserves the later end/i,
    )
    for (const invalidCase of [
      'create_subscription without date_create',
      'create_subscription with date_end',
      'update_subscription without date_next_charge',
      'update_subscription with date_create',
      'non_renewal_subscription without date_next_charge',
      'non_renewal_subscription with date_end',
      'cancel_subscription without date_end',
      'cancel_subscription with date_next_charge',
    ]) {
      expect(behavioralSql).toContain(invalidCase)
    }
    expect(behavioralSql).toMatch(
      /Rejected event shape changed receipt or projection state/i,
    )
    expect(behavioralSql).toMatch(/mystery_subscription/i)
    expect(behavioralSql).toMatch(/processed/i)
    expect(behavioralSql).toMatch(
      /active ignores dates[\s\S]*?nonrenewing boundary[\s\S]*?canceled boundary/i,
    )
    expect(behavioralSql).toMatch(
      /Product filter truth table: exact match is entitled, mismatch is not,[\s\S]*?explicit NULL retains any-subscription behavior/i,
    )
    expect(behavioralSql).toMatch(/reset role;/i)
    expect(behavioralSql).toMatch(/RLS leaked another user's subscription/i)
    expect(behavioralSql).toMatch(/exception when sqlstate '42501'/i)
    expect(behavioralSql).toMatch(/exception when insufficient_privilege/i)
    expect(behavioralSql).toMatch(/exception when sqlstate '55000'/i)
  })
})
