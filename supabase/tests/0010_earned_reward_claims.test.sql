begin;

insert into auth.users (id) values
  ('51111111-1111-4111-8111-111111111111'),
  ('52222222-2222-4222-8222-222222222222'),
  ('53333333-3333-4333-8333-333333333333'),
  ('54444444-4444-4444-8444-444444444444'),
  ('55555555-5555-4555-8555-555555555555'),
  ('56666666-6666-4666-8666-666666666666'),
  ('57777777-7777-4777-8777-777777777777'),
  ('58888888-8888-4888-8888-888888888888'),
  ('59999999-9999-4999-8999-999999999999'),
  ('70000000-0000-4000-8000-000000000000'),
  ('71111111-1111-4111-8111-111111111111');

do $$
begin
  if not exists (
    select 1
    from public.earned_reward_program_versions
    where id = 'earned-collection@1/rewards@1'
      and economy_edition_id = 'earned-collection@1'
      and source_config_sha256 = '6e198c0f3a3a96975ada45b27334583b5c17d84549db9eefe4e3671b296aba09'
      and week_start_isodow = 1
      and period_days = 7
      and maximum_rewarded_rolls = 10
      and roll_reward_stars = 160
      and passport_duration_weeks = 12
      and passport_claims_per_week = 1
      and passport_exhausted_dust = 2
      and community_interval_weeks = 4
      and community_exhausted_dust = 50
  ) then
    raise exception 'Normalized earned reward program drifted from earned-collection@1';
  end if;

  if (select count(*) from public.earned_reward_program_items where reward_kind = 'passport') <> 24 or
     (select count(*) from public.earned_reward_program_items where reward_kind = 'community') <> 6 then
    raise exception 'Normalized earned reward item pools are incomplete';
  end if;

  if exists (
    select 1
    from pg_class
    where oid in (
      'public.earned_reward_program_versions'::regclass,
      'public.earned_reward_program_items'::regclass,
      'public.authoritative_roll_completion_events'::regclass,
      'public.earned_reward_passport_enrollments'::regclass,
      'public.earned_reward_claim_outcomes'::regclass
    ) and (not relrowsecurity or not relforcerowsecurity)
  ) then
    raise exception 'Every earned reward table must force RLS';
  end if;

  if has_table_privilege('authenticated', 'public.authoritative_roll_completion_events', 'INSERT') or
     has_table_privilege('authenticated', 'public.earned_reward_claim_outcomes', 'INSERT') or
     has_table_privilege('service_role', 'public.authoritative_roll_completion_events', 'INSERT') or
     has_table_privilege('service_role', 'public.earned_reward_claim_outcomes', 'INSERT') or
     has_table_privilege('service_role', 'public.user_entitlements', 'INSERT') or
     has_column_privilege('service_role', 'public.user_entitlements', 'revoked_at', 'UPDATE') then
    raise exception 'Direct earned reward or entitlement DML leaked to an API role';
  end if;

  if not has_function_privilege(
       'service_role',
       'public.record_authoritative_roll_completion(uuid,text,text,timestamptz)',
       'EXECUTE'
     ) or
     has_function_privilege(
       'authenticated',
       'public.record_authoritative_roll_completion(uuid,text,text,timestamptz)',
       'EXECUTE'
     ) or
     has_function_privilege(
       'anon',
       'public.record_authoritative_roll_completion(uuid,text,text,timestamptz)',
       'EXECUTE'
     ) then
    raise exception 'Authoritative roll RPC grants are not service-role-only';
  end if;

  if not has_function_privilege('authenticated', 'public.get_earned_reward_status()', 'EXECUTE') or
     not has_function_privilege('authenticated', 'public.claim_new_collector_passport(text)', 'EXECUTE') or
     not has_function_privilege('authenticated', 'public.claim_community_die(text)', 'EXECUTE') or
     has_function_privilege('anon', 'public.claim_new_collector_passport(text)', 'EXECUTE') or
     has_function_privilege('service_role', 'public.claim_new_collector_passport(text)', 'EXECUTE') then
    raise exception 'Authenticated claim/status grants are incorrect';
  end if;
end;
$$;

-- Service-authoritative sequential proof: first ten arrivals earn exactly
-- 1600 promotional Stars, the eleventh is retained but uncredited, exact replay
-- returns the original row, and mismatched replay fails closed.
set local role service_role;

do $$
declare
  completion_time timestamptz := date_trunc('week', statement_timestamp()) + interval '12 hours';
  first_event_id bigint;
  replay_event_id bigint;
begin
  for slot in 1..11 loop
    perform public.record_authoritative_roll_completion(
      '51111111-1111-4111-8111-111111111111',
      'sequential-roll-' || lpad(slot::text, 2, '0'),
      repeat('a', 64),
      completion_time + (slot * interval '1 second')
    );
  end loop;

  select id into first_event_id
  from public.authoritative_roll_completion_events
  where server_event_id = 'sequential-roll-01';
  select (public.record_authoritative_roll_completion(
    '51111111-1111-4111-8111-111111111111',
    'sequential-roll-01',
    repeat('a', 64),
    completion_time + interval '1 second'
  )).id into replay_event_id;
  if replay_event_id <> first_event_id then
    raise exception 'Exact roll replay returned another event';
  end if;

  begin
    perform public.record_authoritative_roll_completion(
      '51111111-1111-4111-8111-111111111111',
      'sequential-roll-01',
      repeat('b', 64),
      completion_time + interval '1 second'
    );
    raise exception 'Mismatched roll replay unexpectedly succeeded';
  exception when sqlstate '22023' then
    null;
  end;

  if (select count(*) from public.authoritative_roll_completion_events where user_id = '51111111-1111-4111-8111-111111111111') <> 11 or
     (select count(*) from public.authoritative_roll_completion_events where user_id = '51111111-1111-4111-8111-111111111111' and credited_slot is not null) <> 10 or
     (select coalesce(sum(credited_stars), 0) from public.authoritative_roll_completion_events where user_id = '51111111-1111-4111-8111-111111111111') <> 1600 or
     (select current_balance from public.wallet_balances where user_id = '51111111-1111-4111-8111-111111111111' and currency_id = 'stars') <> 1600 then
    raise exception 'Sequential authoritative roll cap is not exactly ten/1600';
  end if;
end;
$$;

reset role;

-- First passport claim enrolls the caller, chooses the lowest canonical
-- never-granted item, and replays by idempotency key without a second grant.
set local "request.jwt.claims" = '{"sub":"52222222-2222-4222-8222-222222222222","is_anonymous":false}';
set local role authenticated;

do $$
declare
  first_claim public.earned_reward_claim_outcomes%rowtype;
  replay_claim public.earned_reward_claim_outcomes%rowtype;
  status jsonb;
begin
  first_claim := public.claim_new_collector_passport('passport:first:0001');
  replay_claim := public.claim_new_collector_passport('passport:first:0001');
  if first_claim.id <> replay_claim.id or
     first_claim.claim_index <> 1 or
     first_claim.outcome_kind <> 'entitlement' or
     first_claim.catalog_item_id <> 'adventurer-starter/d10/common@1' then
    raise exception 'First passport claim was not deterministic and idempotent';
  end if;
  if (select count(*) from public.user_entitlements where user_id = '52222222-2222-4222-8222-222222222222') <> 1 then
    raise exception 'Passport replay created more than one entitlement';
  end if;

  begin
    perform public.claim_community_die('passport:first:0001');
    raise exception 'Cross-kind idempotency-key reuse unexpectedly succeeded';
  exception when sqlstate '22023' then
    null;
  end;

  status := public.get_earned_reward_status();
  if status #>> '{passport,state}' <> 'active' or
     (status #>> '{passport,claimedCount}')::integer <> 1 or
     (status #>> '{passport,catchUpClaimCount}')::integer <> 0 then
    raise exception 'Derived first-week passport status is incorrect: %', status;
  end if;

  begin
    insert into public.earned_reward_claim_outcomes (
      id, program_id, account_id, user_id, claim_kind, claim_index,
      eligible_period_start, idempotency_key, outcome_kind, dust_amount, claimed_at
    ) values (
      gen_random_uuid(), 'earned-collection@1/rewards@1', gen_random_uuid(),
      '52222222-2222-4222-8222-222222222222', 'passport', 2,
      current_date, 'direct:dml:0001', 'dust', 2, now()
    );
    raise exception 'Authenticated direct claim insert unexpectedly succeeded';
  exception when insufficient_privilege then
    null;
  end;
end;
$$;

reset role;

-- Seed an enrollment eleven weeks in the past, then prove all twelve claims
-- are available without streak loss and transition to explicit completion.
insert into public.wallet_accounts (user_id)
values ('53333333-3333-4333-8333-333333333333');

insert into public.earned_reward_passport_enrollments (
  account_id, user_id, program_id, enrolled_period_start, enrolled_at
)
select
  id,
  user_id,
  'earned-collection@1/rewards@1',
  private.utc_monday_period_start(statement_timestamp()) - 77,
  statement_timestamp() - interval '77 days'
from public.wallet_accounts
where user_id = '53333333-3333-4333-8333-333333333333';

set local "request.jwt.claims" = '{"sub":"53333333-3333-4333-8333-333333333333","is_anonymous":false}';
set local role authenticated;

do $$
declare
  status jsonb;
begin
  for claim_number in 1..12 loop
    perform public.claim_new_collector_passport(
      'passport:catchup:' || lpad(claim_number::text, 2, '0')
    );
  end loop;
  begin
    perform public.claim_new_collector_passport('passport:catchup:13');
    raise exception 'Thirteenth passport claim unexpectedly succeeded';
  exception when sqlstate '55000' then
    null;
  end;

  status := public.get_earned_reward_status();
  if status #>> '{passport,state}' <> 'complete' or
     (status #>> '{passport,claimedCount}')::integer <> 12 or
     (status #>> '{passport,catchUpClaimCount}')::integer <> 0 or
     (select count(*) from public.user_entitlements where user_id = '53333333-3333-4333-8333-333333333333') <> 12 then
    raise exception 'Twelve-claim catch-up did not complete exactly: %', status;
  end if;
end;
$$;

reset role;

-- All passport items already have grant history: emit exactly two Dust and no
-- fake entitlement row.
insert into public.wallet_accounts (user_id)
values ('54444444-4444-4444-8444-444444444444');
insert into public.earned_reward_passport_enrollments (
  account_id, user_id, program_id, enrolled_period_start, enrolled_at
)
select id, user_id, 'earned-collection@1/rewards@1',
       private.utc_monday_period_start(statement_timestamp()), statement_timestamp()
from public.wallet_accounts
where user_id = '54444444-4444-4444-8444-444444444444';
insert into public.user_entitlements (user_id, catalog_item_id, grant_reason, grant_ref)
select
  '54444444-4444-4444-8444-444444444444',
  catalog_item_id,
  'test.preowned',
  'test:passport-preowned:' || canonical_order
from public.earned_reward_program_items
where reward_kind = 'passport';

set local "request.jwt.claims" = '{"sub":"54444444-4444-4444-8444-444444444444","is_anonymous":false}';
set local role authenticated;

do $$
declare
  claim public.earned_reward_claim_outcomes%rowtype;
begin
  claim := public.claim_new_collector_passport('passport:all-owned:0001');
  if claim.outcome_kind <> 'dust' or claim.dust_amount <> 2 or
     claim.catalog_item_id is not null or claim.entitlement_id is not null or
     claim.wallet_ledger_entry_id is null then
    raise exception 'All-owned passport outcome is not exact two-Dust fallback';
  end if;
  if (select count(*) from public.user_entitlements where user_id = '54444444-4444-4444-8444-444444444444') <> 24 or
     (select current_balance from public.wallet_balances where user_id = '54444444-4444-4444-8444-444444444444' and currency_id = 'dust') <> 2 then
    raise exception 'All-owned passport created a fake entitlement or wrong Dust balance';
  end if;
end;
$$;

reset role;

-- Community eligibility begins after four completed weeks from enrollment and
-- chooses the lowest canonical unowned mythic item.
insert into public.wallet_accounts (user_id)
values ('55555555-5555-4555-8555-555555555555');
insert into public.earned_reward_passport_enrollments (
  account_id, user_id, program_id, enrolled_period_start, enrolled_at
)
select id, user_id, 'earned-collection@1/rewards@1',
       private.utc_monday_period_start(statement_timestamp()) - 28,
       statement_timestamp() - interval '28 days'
from public.wallet_accounts
where user_id = '55555555-5555-4555-8555-555555555555';

set local "request.jwt.claims" = '{"sub":"55555555-5555-4555-8555-555555555555","is_anonymous":false}';
set local role authenticated;

do $$
declare
  claim public.earned_reward_claim_outcomes%rowtype;
begin
  claim := public.claim_community_die('community:first:0001');
  if claim.claim_index <> 1 or claim.outcome_kind <> 'entitlement' or
     claim.catalog_item_id <> 'infernal-obsidian/d10/mythic@1' then
    raise exception 'First Community Die was not the lowest canonical unowned item';
  end if;
  begin
    perform public.claim_community_die('community:early:0002');
    raise exception 'Second Community Die before week eight unexpectedly succeeded';
  exception when sqlstate '55000' then
    null;
  end;
end;
$$;

reset role;

-- All Community items owned: emit exactly fifty Dust.
insert into public.wallet_accounts (user_id)
values ('59999999-9999-4999-8999-999999999999');
insert into public.earned_reward_passport_enrollments (
  account_id, user_id, program_id, enrolled_period_start, enrolled_at
)
select id, user_id, 'earned-collection@1/rewards@1',
       private.utc_monday_period_start(statement_timestamp()) - 28,
       statement_timestamp() - interval '28 days'
from public.wallet_accounts
where user_id = '59999999-9999-4999-8999-999999999999';
insert into public.user_entitlements (user_id, catalog_item_id, grant_reason, grant_ref)
select
  '59999999-9999-4999-8999-999999999999',
  catalog_item_id,
  'test.preowned',
  'test:community-preowned:' || canonical_order
from public.earned_reward_program_items
where reward_kind = 'community';

set local "request.jwt.claims" = '{"sub":"59999999-9999-4999-8999-999999999999","is_anonymous":false}';
set local role authenticated;

do $$
declare
  claim public.earned_reward_claim_outcomes%rowtype;
begin
  claim := public.claim_community_die('community:all-owned:0001');
  if claim.outcome_kind <> 'dust' or claim.dust_amount <> 50 or
     claim.catalog_item_id is not null or claim.wallet_ledger_entry_id is null or
     (select current_balance from public.wallet_balances where user_id = '59999999-9999-4999-8999-999999999999' and currency_id = 'dust') <> 50 then
    raise exception 'All-owned Community claim is not exact fifty-Dust fallback';
  end if;
end;
$$;

reset role;

-- UTC boundaries do not drift with the database session timezone. Community
-- becomes eligible at the exact week-four Monday boundary, and passport claim
-- twelve becomes eligible only at the exact week-twelve boundary.
set local timezone = 'America/Los_Angeles';

do $$
begin
  if private.utc_monday_period_start('2026-07-19 23:59:59+00'::timestamptz) <> date '2026-07-13' or
     private.utc_monday_period_start('2026-07-20 00:00:00+00'::timestamptz) <> date '2026-07-20' then
    raise exception 'UTC Monday boundary drifted under a non-UTC session';
  end if;
end;
$$;

insert into public.wallet_accounts (user_id)
values
  ('70000000-0000-4000-8000-000000000000'),
  ('71111111-1111-4111-8111-111111111111');
insert into public.earned_reward_passport_enrollments (
  account_id, user_id, program_id, enrolled_period_start, enrolled_at
)
select
  id,
  user_id,
  'earned-collection@1/rewards@1',
  date '2026-01-05',
  '2026-01-05 00:00:00+00'::timestamptz
from public.wallet_accounts
where user_id in (
  '70000000-0000-4000-8000-000000000000',
  '71111111-1111-4111-8111-111111111111'
);

do $$
declare
  community_claim public.earned_reward_claim_outcomes%rowtype;
  passport_claim public.earned_reward_claim_outcomes%rowtype;
begin
  begin
    perform private.issue_earned_reward_claim(
      '70000000-0000-4000-8000-000000000000',
      'community',
      'community:boundary:early',
      '2026-02-01 23:59:59+00'::timestamptz
    );
    raise exception 'Community claim succeeded one second before week four';
  exception when sqlstate '55000' then
    null;
  end;
  community_claim := private.issue_earned_reward_claim(
    '70000000-0000-4000-8000-000000000000',
    'community',
    'community:boundary:exact',
    '2026-02-02 00:00:00+00'::timestamptz
  );
  if community_claim.claim_index <> 1 or
     community_claim.eligible_period_start <> date '2026-02-02' then
    raise exception 'Community week-four boundary did not resolve exactly';
  end if;

  for claim_number in 1..11 loop
    begin
      perform private.issue_earned_reward_claim(
        '71111111-1111-4111-8111-111111111111',
        'passport',
        'passport:boundary:' || lpad(claim_number::text, 2, '0'),
        (
          (date '2026-01-05' + ((claim_number - 1) * 7))::text
          || ' 00:00:00+00'
        )::timestamptz
      );
    exception when others then
      raise exception 'Passport boundary claim % failed: %', claim_number, sqlerrm;
    end;
  end loop;
  begin
    perform private.issue_earned_reward_claim(
      '71111111-1111-4111-8111-111111111111',
      'passport',
      'passport:boundary:12-early',
      '2026-03-22 23:59:59+00'::timestamptz
    );
    raise exception 'Passport claim twelve succeeded one second before week twelve';
  exception when sqlstate '55000' then
    null;
  end;
  passport_claim := private.issue_earned_reward_claim(
    '71111111-1111-4111-8111-111111111111',
    'passport',
    'passport:boundary:12-exact',
    '2026-03-23 00:00:00+00'::timestamptz
  );
  if passport_claim.claim_index <> 12 or
     passport_claim.eligible_period_start <> date '2026-03-23' then
    raise exception 'Passport week-twelve boundary did not resolve exactly';
  end if;
end;
$$;

set local timezone = 'UTC';

-- Force the final claim-history insert to fail after the Dust append. Catching
-- the error outside the RPC must still observe no ledger or claim residue.
insert into public.wallet_accounts (user_id)
values ('56666666-6666-4666-8666-666666666666');
insert into public.earned_reward_passport_enrollments (
  account_id, user_id, program_id, enrolled_period_start, enrolled_at
)
select id, user_id, 'earned-collection@1/rewards@1',
       private.utc_monday_period_start(statement_timestamp()), statement_timestamp()
from public.wallet_accounts
where user_id = '56666666-6666-4666-8666-666666666666';
insert into public.user_entitlements (user_id, catalog_item_id, grant_reason, grant_ref)
select
  '56666666-6666-4666-8666-666666666666',
  catalog_item_id,
  'test.preowned',
  'test:rollback-preowned:' || canonical_order
from public.earned_reward_program_items
where reward_kind = 'passport';

create function public.test_reject_earned_claim_insert()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'forced claim insert failure' using errcode = 'ZX001';
end;
$$;
create trigger test_reject_earned_claim_insert
  before insert on public.earned_reward_claim_outcomes
  for each row execute function public.test_reject_earned_claim_insert();

set local "request.jwt.claims" = '{"sub":"56666666-6666-4666-8666-666666666666","is_anonymous":false}';
set local role authenticated;

do $$
begin
  begin
    perform public.claim_new_collector_passport('passport:rollback:0001');
    raise exception 'Forced rollback claim unexpectedly succeeded';
  exception when sqlstate 'ZX001' then
    null;
  end;
end;
$$;

reset role;
drop trigger test_reject_earned_claim_insert on public.earned_reward_claim_outcomes;
drop function public.test_reject_earned_claim_insert();

do $$
begin
  if exists (
    select 1 from public.earned_reward_claim_outcomes
    where user_id = '56666666-6666-4666-8666-666666666666'
  ) or exists (
    select 1 from public.wallet_ledger_entries
    where user_id = '56666666-6666-4666-8666-666666666666'
  ) or exists (
    select 1 from public.wallet_balances
    where user_id = '56666666-6666-4666-8666-666666666666'
  ) then
    raise exception 'Failed claim left a partial claim, ledger, or balance projection';
  end if;
end;
$$;

-- Revoking service-role entitlement DML does not break the existing
-- authenticated SECURITY DEFINER starter RPC or its idempotent replay.
set local "request.jwt.claims" = '{"sub":"57777777-7777-4777-8777-777777777777","is_anonymous":false}';
set local role authenticated;

do $$
begin
  perform public.ensure_starter_entitlements();
  perform public.ensure_starter_entitlements();
  if (select count(*) from public.user_entitlements) <> 8 or
     (select count(distinct catalog_item_id) from public.user_entitlements) <> 8 then
    raise exception 'Starter entitlement RPC no longer grants exactly eight idempotent items';
  end if;
end;
$$;

reset role;

-- An authenticated anonymous session holds the same Postgres role but is
-- explicitly rejected by the JWT claim check.
set local "request.jwt.claims" = '{"sub":"58888888-8888-4888-8888-888888888888","is_anonymous":true}';
set local role authenticated;

do $$
begin
  begin
    perform public.claim_new_collector_passport('anonymous:claim:0001');
    raise exception 'Anonymous authenticated user unexpectedly claimed a reward';
  exception when invalid_authorization_specification then
    null;
  end;
end;
$$;

reset role;

-- RLS exposes only the caller's history, while direct authoritative DML and
-- RPC access remain denied to the authenticated role.
set local "request.jwt.claims" = '{"sub":"52222222-2222-4222-8222-222222222222","is_anonymous":false}';
set local role authenticated;

do $$
begin
  if (select count(*) from public.earned_reward_claim_outcomes) <> 1 or
     exists (
       select 1 from public.earned_reward_claim_outcomes
       where user_id <> '52222222-2222-4222-8222-222222222222'
     ) or
     (select count(*) from public.earned_reward_passport_enrollments) <> 1 or
     (select count(*) from public.authoritative_roll_completion_events) <> 0 then
    raise exception 'Earned reward RLS exposed another user history';
  end if;

  begin
    perform public.record_authoritative_roll_completion(
      '52222222-2222-4222-8222-222222222222',
      'client-roll-0001',
      repeat('c', 64),
      now()
    );
    raise exception 'Authenticated client invoked service-only roll ingest';
  exception when insufficient_privilege then
    null;
  end;

  begin
    insert into public.authoritative_roll_completion_events (
      server_event_id, payload_sha256, authority_kind, program_id,
      account_id, user_id, completed_at, period_start, credited_stars
    ) values (
      'client-roll-0002', repeat('c', 64), 'server-authoritative-room',
      'earned-collection@1/rewards@1', gen_random_uuid(),
      '52222222-2222-4222-8222-222222222222', now(), current_date, 0
    );
    raise exception 'Authenticated direct roll insert unexpectedly succeeded';
  exception when insufficient_privilege then
    null;
  end;
end;
$$;

reset role;
set local role service_role;

do $$
begin
  begin
    insert into public.user_entitlements (
      user_id, catalog_item_id, grant_reason, grant_ref
    ) values (
      '57777777-7777-4777-8777-777777777777',
      'adventurer-starter/d4/common@1',
      'test.direct',
      'test:service-direct'
    );
    raise exception 'service_role direct entitlement insert unexpectedly succeeded';
  exception when insufficient_privilege then
    null;
  end;

  begin
    update public.user_entitlements
    set revoked_at = statement_timestamp()
    where user_id = '57777777-7777-4777-8777-777777777777';
    raise exception 'service_role direct entitlement revocation unexpectedly succeeded';
  exception when insufficient_privilege then
    null;
  end;

  begin
    perform public.claim_new_collector_passport('service:claim:0001');
    raise exception 'service_role invoked authenticated claim RPC';
  exception when insufficient_privilege then
    null;
  end;
end;
$$;

reset role;
set local role anon;

do $$
begin
  if (select count(*) from public.earned_reward_program_versions) <> 1 or
     (select count(*) from public.earned_reward_program_items) <> 30 then
    raise exception 'Anonymous clients cannot read normalized public reward rules';
  end if;
  begin
    perform public.get_earned_reward_status();
    raise exception 'Anon role invoked authenticated status RPC';
  exception when insufficient_privilege then
    null;
  end;
end;
$$;

reset role;

-- Exact outcome links cannot point across users/items, and no historical row
-- admits UPDATE, DELETE, or TRUNCATE.
do $$
declare
  immutable_table text;
begin
  if exists (
    select 1
    from public.earned_reward_claim_outcomes as claims
    left join public.user_entitlements as entitlements
      on entitlements.id = claims.entitlement_id
     and entitlements.user_id = claims.user_id
     and entitlements.catalog_item_id = claims.catalog_item_id
    left join public.wallet_ledger_entries as ledger
      on ledger.id = claims.wallet_ledger_entry_id
     and ledger.account_id = claims.account_id
     and ledger.user_id = claims.user_id
    where (claims.outcome_kind = 'entitlement' and entitlements.id is null)
       or (claims.outcome_kind = 'dust' and ledger.id is null)
  ) then
    raise exception 'Claim outcome lost its exact entitlement or wallet link';
  end if;

  begin
    update public.earned_reward_program_versions set id = id;
    raise exception 'Reward version update unexpectedly succeeded';
  exception when sqlstate '55000' then null;
  end;
  begin
    update public.earned_reward_program_items set canonical_order = canonical_order;
    raise exception 'Reward item update unexpectedly succeeded';
  exception when sqlstate '55000' then null;
  end;
  begin
    update public.authoritative_roll_completion_events set payload_sha256 = payload_sha256;
    raise exception 'Roll event update unexpectedly succeeded';
  exception when sqlstate '55000' then null;
  end;
  begin
    update public.earned_reward_passport_enrollments set enrolled_at = enrolled_at;
    raise exception 'Enrollment update unexpectedly succeeded';
  exception when sqlstate '55000' then null;
  end;
  begin
    update public.earned_reward_claim_outcomes set claimed_at = claimed_at;
    raise exception 'Claim outcome update unexpectedly succeeded';
  exception when sqlstate '55000' then null;
  end;

  foreach immutable_table in array array[
    'earned_reward_program_versions',
    'earned_reward_program_items',
    'authoritative_roll_completion_events',
    'earned_reward_passport_enrollments',
    'earned_reward_claim_outcomes'
  ] loop
    begin
      execute format('delete from public.%I', immutable_table);
      raise exception 'Delete on % unexpectedly succeeded', immutable_table;
    exception when sqlstate '55000' then
      null;
    end;
    begin
      execute format('truncate table public.%I cascade', immutable_table);
      raise exception 'Truncate on % unexpectedly succeeded', immutable_table;
    exception when sqlstate '55000' then
      null;
    end;
  end loop;
end;
$$;

rollback;
