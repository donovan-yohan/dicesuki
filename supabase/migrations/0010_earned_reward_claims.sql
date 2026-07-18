-- Migration: 0010_earned_reward_claims
-- Issue #148 PR2 — authoritative earned rewards and deterministic claims
--
-- This migration normalizes the reward programs already frozen in the
-- immutable earned-collection@1 economy edition. It does not duplicate that
-- edition JSON, add a paid balance, implement pulls/RNG, or trust local WASM
-- solo rolls. Only a service-role RPC records authoritative room-server roll
-- completions; signed-in, non-anonymous users may query status and claim the
-- deterministic passport/community rewards made available by that history.

create schema if not exists private;
revoke all on schema private from public, anon, authenticated, service_role;

-- Exact composite links let downstream reward rows prove that their wallet
-- or entitlement target belongs to the same account/user/item. These are
-- additive constraints on the immutable schemas published by 0004 and 0009.
alter table public.wallet_ledger_entries
  add constraint wallet_ledger_entries_reward_link_unique
  unique (id, account_id, user_id);

alter table public.user_entitlements
  add constraint user_entitlements_reward_link_unique
  unique (id, user_id, catalog_item_id);

-- All entitlement creation now has a reviewed RPC boundary. The authenticated
-- starter RPC remains functional because it is SECURITY DEFINER; service_role
-- no longer needs direct grant/revocation DML.
revoke insert on table public.user_entitlements from service_role;
revoke update on table public.user_entitlements from service_role;
revoke update (revoked_at) on table public.user_entitlements from service_role;

-- ---------------------------------------------------------------------------
-- Immutable normalized reward program and canonical item pools.
-- ---------------------------------------------------------------------------
create table public.earned_reward_program_versions (
  id                            text        primary key,
  program_version               integer     not null check (program_version > 0),
  economy_edition_id            text        not null unique
    references public.economy_editions (id) on delete restrict,
  source_config_sha256          text        not null check (source_config_sha256 ~ '^[0-9a-f]{64}$'),
  week_start_isodow             smallint    not null check (week_start_isodow = 1),
  period_days                   smallint    not null check (period_days = 7),
  maximum_rewarded_rolls        smallint    not null check (maximum_rewarded_rolls > 0),
  roll_reward_stars             bigint      not null check (roll_reward_stars > 0),
  passport_duration_weeks       smallint    not null check (passport_duration_weeks > 0),
  passport_claims_per_week      smallint    not null check (passport_claims_per_week = 1),
  passport_exhausted_dust       bigint      not null check (passport_exhausted_dust > 0),
  community_interval_weeks      smallint    not null check (community_interval_weeks > 0),
  community_exhausted_dust      bigint      not null check (community_exhausted_dust > 0),
  created_at                    timestamptz not null default now(),

  constraint earned_reward_program_versions_id
    check (id = economy_edition_id || '/rewards@' || program_version::text),
  constraint earned_reward_program_versions_period_reward
    check (maximum_rewarded_rolls::bigint * roll_reward_stars <= 9223372036854775807::bigint)
);

comment on table public.earned_reward_program_versions is
  'Immutable normalized earned-reward rules anchored to one immutable economy edition. UTC Monday is ISO day 1.';

create table public.earned_reward_program_items (
  program_id       text     not null
    references public.earned_reward_program_versions (id) on delete restrict,
  reward_kind      text     not null check (reward_kind in ('passport', 'community')),
  canonical_order  integer  not null check (canonical_order > 0),
  catalog_item_id  text     not null references public.catalog_items (id) on delete restrict,

  primary key (program_id, reward_kind, canonical_order),
  constraint earned_reward_program_items_item_unique
    unique (program_id, reward_kind, catalog_item_id)
);

create index earned_reward_program_items_catalog_item_idx
  on public.earned_reward_program_items (catalog_item_id);

comment on table public.earned_reward_program_items is
  'Immutable program item membership expanded from the economy-edition pools. Selection always orders by catalog_item_id, never mutable catalog state.';

-- ---------------------------------------------------------------------------
-- Immutable authoritative roll events and claim history.
-- ---------------------------------------------------------------------------
create table public.authoritative_roll_completion_events (
  id                      bigint      generated always as identity primary key,
  server_event_id         text        not null unique,
  payload_sha256          text        not null check (payload_sha256 ~ '^[0-9a-f]{64}$'),
  authority_kind          text        not null check (authority_kind = 'server-authoritative-room'),
  program_id              text        not null
    references public.earned_reward_program_versions (id) on delete restrict,
  account_id              uuid        not null,
  user_id                 uuid        not null,
  completed_at            timestamptz not null,
  period_start            date        not null,
  credited_slot           smallint,
  credited_stars          bigint      not null,
  wallet_ledger_entry_id  bigint,
  recorded_at             timestamptz not null default now(),

  constraint authoritative_roll_events_account_fkey
    foreign key (account_id, user_id)
    references public.wallet_accounts (id, user_id)
    on delete restrict,
  constraint authoritative_roll_events_wallet_fkey
    foreign key (wallet_ledger_entry_id, account_id, user_id)
    references public.wallet_ledger_entries (id, account_id, user_id)
    on delete restrict,
  constraint authoritative_roll_events_event_id
    check (
      char_length(server_event_id) between 8 and 160 and
      server_event_id ~ '^[A-Za-z0-9][A-Za-z0-9._:-]+$'
    ),
  constraint authoritative_roll_events_credit_shape
    check (
      (credited_slot is not null and credited_slot between 1 and 10 and
       credited_stars > 0 and wallet_ledger_entry_id is not null) or
      (credited_slot is null and credited_stars = 0 and wallet_ledger_entry_id is null)
    ),
  constraint authoritative_roll_events_period_slot_unique
    unique (account_id, period_start, credited_slot)
);

create index authoritative_roll_events_user_period_idx
  on public.authoritative_roll_completion_events (user_id, period_start, completed_at, id);
create index authoritative_roll_events_program_idx
  on public.authoritative_roll_completion_events (program_id);
create index authoritative_roll_events_wallet_idx
  on public.authoritative_roll_completion_events (wallet_ledger_entry_id)
  where wallet_ledger_entry_id is not null;

comment on table public.authoritative_roll_completion_events is
  'Immutable trusted room-server completion events. The first ten arrivals in each UTC-Monday period receive promotional Stars; local WASM solo has no write path.';

create table public.earned_reward_passport_enrollments (
  account_id             uuid        not null,
  user_id                uuid        not null,
  program_id             text        not null
    references public.earned_reward_program_versions (id) on delete restrict,
  enrolled_period_start  date        not null,
  enrolled_at            timestamptz not null,

  primary key (account_id, program_id),
  constraint earned_reward_passport_enrollments_identity_unique
    unique (account_id, user_id, program_id),
  constraint earned_reward_passport_enrollments_account_fkey
    foreign key (account_id, user_id)
    references public.wallet_accounts (id, user_id)
    on delete restrict
);

create index earned_reward_passport_enrollments_user_idx
  on public.earned_reward_passport_enrollments (user_id, program_id);

comment on table public.earned_reward_passport_enrollments is
  'Immutable first-passport-claim enrollment anchor. Completion and catch-up availability are derived from immutable claims and UTC-Monday periods.';

create table public.earned_reward_claim_outcomes (
  id                      uuid        primary key,
  program_id              text        not null
    references public.earned_reward_program_versions (id) on delete restrict,
  account_id              uuid        not null,
  user_id                 uuid        not null,
  claim_kind              text        not null check (claim_kind in ('passport', 'community')),
  claim_index             integer     not null check (claim_index > 0),
  eligible_period_start   date        not null,
  idempotency_key         text        not null,
  outcome_kind            text        not null check (outcome_kind in ('entitlement', 'dust')),
  catalog_item_id         text,
  entitlement_id          uuid,
  wallet_ledger_entry_id  bigint,
  dust_amount             bigint      not null default 0,
  claimed_at              timestamptz not null,

  constraint earned_reward_claim_outcomes_enrollment_fkey
    foreign key (account_id, user_id, program_id)
    references public.earned_reward_passport_enrollments (account_id, user_id, program_id)
    on delete restrict,
  constraint earned_reward_claim_outcomes_program_item_fkey
    foreign key (program_id, claim_kind, catalog_item_id)
    references public.earned_reward_program_items (program_id, reward_kind, catalog_item_id)
    on delete restrict,
  constraint earned_reward_claim_outcomes_entitlement_fkey
    foreign key (entitlement_id, user_id, catalog_item_id)
    references public.user_entitlements (id, user_id, catalog_item_id)
    on delete restrict,
  constraint earned_reward_claim_outcomes_wallet_fkey
    foreign key (wallet_ledger_entry_id, account_id, user_id)
    references public.wallet_ledger_entries (id, account_id, user_id)
    on delete restrict,
  constraint earned_reward_claim_outcomes_account_key_unique
    unique (account_id, idempotency_key),
  constraint earned_reward_claim_outcomes_slot_unique
    unique (account_id, program_id, claim_kind, claim_index),
  constraint earned_reward_claim_outcomes_idempotency_key
    check (char_length(idempotency_key) between 8 and 160),
  constraint earned_reward_claim_outcomes_passport_limit
    check (claim_kind <> 'passport' or claim_index <= 12),
  constraint earned_reward_claim_outcomes_exact_target
    check (
      (outcome_kind = 'entitlement' and catalog_item_id is not null and
       entitlement_id is not null and wallet_ledger_entry_id is null and dust_amount = 0) or
      (outcome_kind = 'dust' and catalog_item_id is null and
       entitlement_id is null and wallet_ledger_entry_id is not null and dust_amount > 0)
    ),
  constraint earned_reward_claim_outcomes_exact_dust
    check (
      outcome_kind <> 'dust' or
      (claim_kind = 'passport' and dust_amount = 2) or
      (claim_kind = 'community' and dust_amount = 50)
    )
);

create index earned_reward_claim_outcomes_user_created_idx
  on public.earned_reward_claim_outcomes (user_id, claimed_at desc, id);
create index earned_reward_claim_outcomes_program_item_idx
  on public.earned_reward_claim_outcomes (program_id, claim_kind, catalog_item_id)
  where catalog_item_id is not null;
create index earned_reward_claim_outcomes_entitlement_idx
  on public.earned_reward_claim_outcomes (entitlement_id)
  where entitlement_id is not null;
create index earned_reward_claim_outcomes_wallet_idx
  on public.earned_reward_claim_outcomes (wallet_ledger_entry_id)
  where wallet_ledger_entry_id is not null;

comment on table public.earned_reward_claim_outcomes is
  'Immutable passport/community claim outcomes with one exact entitlement or Dust-ledger target. Claims are account-idempotent and monotonically indexed.';

-- ---------------------------------------------------------------------------
-- Immutability helpers, including TRUNCATE rejection.
-- ---------------------------------------------------------------------------
create or replace function private.reject_earned_reward_history_mutation()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception '% on %.% is forbidden; append a new immutable row instead',
    tg_op, tg_table_schema, tg_table_name
    using errcode = '55000';
end;
$$;

create trigger earned_reward_program_versions_reject_update_delete
  before update or delete on public.earned_reward_program_versions
  for each row execute function private.reject_earned_reward_history_mutation();
create trigger earned_reward_program_versions_reject_truncate
  before truncate on public.earned_reward_program_versions
  for each statement execute function private.reject_earned_reward_history_mutation();

create trigger earned_reward_program_items_reject_update_delete
  before update or delete on public.earned_reward_program_items
  for each row execute function private.reject_earned_reward_history_mutation();
create trigger earned_reward_program_items_reject_truncate
  before truncate on public.earned_reward_program_items
  for each statement execute function private.reject_earned_reward_history_mutation();

create trigger authoritative_roll_events_reject_update_delete
  before update or delete on public.authoritative_roll_completion_events
  for each row execute function private.reject_earned_reward_history_mutation();
create trigger authoritative_roll_events_reject_truncate
  before truncate on public.authoritative_roll_completion_events
  for each statement execute function private.reject_earned_reward_history_mutation();

create trigger earned_reward_passport_enrollments_reject_update_delete
  before update or delete on public.earned_reward_passport_enrollments
  for each row execute function private.reject_earned_reward_history_mutation();
create trigger earned_reward_passport_enrollments_reject_truncate
  before truncate on public.earned_reward_passport_enrollments
  for each statement execute function private.reject_earned_reward_history_mutation();

create trigger earned_reward_claim_outcomes_reject_update_delete
  before update or delete on public.earned_reward_claim_outcomes
  for each row execute function private.reject_earned_reward_history_mutation();
create trigger earned_reward_claim_outcomes_reject_truncate
  before truncate on public.earned_reward_claim_outcomes
  for each statement execute function private.reject_earned_reward_history_mutation();

revoke all on function private.reject_earned_reward_history_mutation()
  from public, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Normalize the exact earned-collection@1 reward config.
-- ---------------------------------------------------------------------------
do $seed$
declare
  source_edition public.economy_editions%rowtype;
  passport_count integer;
  community_count integer;
begin
  select * into strict source_edition
  from public.economy_editions
  where id = 'earned-collection@1';

  if (source_edition.config #>> '{rewards,weeklyAuthoritativeRolls,periodDays}')::integer <> 7 or
     (source_edition.config #>> '{rewards,weeklyAuthoritativeRolls,maximumRewardedRolls}')::integer <> 10 or
     (source_edition.config #>> '{rewards,weeklyAuthoritativeRolls,rewardPerCompletedRoll,amount}')::bigint <> 160 or
     (source_edition.config #>> '{rewards,newCollectorPassport,durationWeeks}')::integer <> 12 or
     (source_edition.config #>> '{rewards,newCollectorPassport,claimsPerWeek}')::integer <> 1 or
     (source_edition.config #>> '{rewards,newCollectorPassport,whenAllOwned,amount}')::bigint <> 2 or
     (source_edition.config #>> '{rewards,communityDie,intervalWeeks}')::integer <> 4 or
     (source_edition.config #>> '{rewards,communityDie,whenAllOwned,amount}')::bigint <> 50 then
    raise exception 'earned-collection@1 reward rules do not match the 0010 normalized schema'
      using errcode = '55000';
  end if;

  insert into public.earned_reward_program_versions (
    id,
    program_version,
    economy_edition_id,
    source_config_sha256,
    week_start_isodow,
    period_days,
    maximum_rewarded_rolls,
    roll_reward_stars,
    passport_duration_weeks,
    passport_claims_per_week,
    passport_exhausted_dust,
    community_interval_weeks,
    community_exhausted_dust
  ) values (
    'earned-collection@1/rewards@1',
    1,
    source_edition.id,
    source_edition.config_sha256,
    1,
    (source_edition.config #>> '{rewards,weeklyAuthoritativeRolls,periodDays}')::smallint,
    (source_edition.config #>> '{rewards,weeklyAuthoritativeRolls,maximumRewardedRolls}')::smallint,
    (source_edition.config #>> '{rewards,weeklyAuthoritativeRolls,rewardPerCompletedRoll,amount}')::bigint,
    (source_edition.config #>> '{rewards,newCollectorPassport,durationWeeks}')::smallint,
    (source_edition.config #>> '{rewards,newCollectorPassport,claimsPerWeek}')::smallint,
    (source_edition.config #>> '{rewards,newCollectorPassport,whenAllOwned,amount}')::bigint,
    (source_edition.config #>> '{rewards,communityDie,intervalWeeks}')::smallint,
    (source_edition.config #>> '{rewards,communityDie,whenAllOwned,amount}')::bigint
  );

  insert into public.earned_reward_program_items
    (program_id, reward_kind, canonical_order, catalog_item_id)
  select
    'earned-collection@1/rewards@1',
    'passport',
    source.ordinality::integer,
    source.catalog_item_id
  from jsonb_array_elements_text(
    source_edition.config #> '{rewards,newCollectorPassport,eligibleCatalogItemIds}'
  ) with ordinality as source(catalog_item_id, ordinality);

  insert into public.earned_reward_program_items
    (program_id, reward_kind, canonical_order, catalog_item_id)
  select
    'earned-collection@1/rewards@1',
    'community',
    source.ordinality::integer,
    source.catalog_item_id
  from jsonb_array_elements_text(
    source_edition.config #> '{rewards,communityDie,eligibleCatalogItemIds}'
  ) with ordinality as source(catalog_item_id, ordinality);

  select count(*) into passport_count
  from public.earned_reward_program_items
  where program_id = 'earned-collection@1/rewards@1' and reward_kind = 'passport';
  select count(*) into community_count
  from public.earned_reward_program_items
  where program_id = 'earned-collection@1/rewards@1' and reward_kind = 'community';

  if passport_count <> jsonb_array_length(
       source_edition.config #> '{rewards,newCollectorPassport,eligibleCatalogItemIds}'
     ) or
     community_count <> jsonb_array_length(
       source_edition.config #> '{rewards,communityDie,eligibleCatalogItemIds}'
     ) then
    raise exception 'Normalized earned-reward item pools are incomplete'
      using errcode = '55000';
  end if;
end;
$seed$;

-- ---------------------------------------------------------------------------
-- Private platform helpers.
-- ---------------------------------------------------------------------------
create or replace function private.utc_monday_period_start(p_at timestamptz)
returns date
language sql
immutable
parallel safe
set search_path = ''
as $$
  select (p_at at time zone 'UTC')::date
    - (extract(isodow from p_at at time zone 'UTC')::integer - 1);
$$;

create or replace function private.require_non_anonymous_user()
returns uuid
language plpgsql
stable
set search_path = ''
as $$
declare
  caller_user_id uuid;
  caller_claims jsonb;
begin
  caller_user_id := (select auth.uid());
  caller_claims := coalesce((select auth.jwt()), '{}'::jsonb);
  if caller_user_id is null then
    raise exception 'A signed-in user is required' using errcode = '28000';
  end if;
  if coalesce((caller_claims ->> 'is_anonymous')::boolean, false) then
    raise exception 'Anonymous users cannot earn or claim collectibles'
      using errcode = '28000';
  end if;
  return caller_user_id;
end;
$$;

create or replace function private.lock_wallet_account(p_user_id uuid)
returns public.wallet_accounts
language plpgsql
set search_path = ''
as $$
declare
  target_account public.wallet_accounts%rowtype;
begin
  insert into public.wallet_accounts (user_id)
  values (p_user_id)
  on conflict (user_id) do nothing;

  select * into strict target_account
  from public.wallet_accounts
  where user_id = p_user_id
  for update;

  return target_account;
end;
$$;

revoke all on function private.utc_monday_period_start(timestamptz)
  from public, anon, authenticated, service_role;
revoke all on function private.require_non_anonymous_user()
  from public, anon, authenticated, service_role;
revoke all on function private.lock_wallet_account(uuid)
  from public, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Service-only authoritative roll completion boundary.
-- ---------------------------------------------------------------------------
create or replace function public.record_authoritative_roll_completion(
  p_user_id uuid,
  p_server_event_id text,
  p_payload_sha256 text,
  p_completed_at timestamptz
)
returns public.authoritative_roll_completion_events
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_account public.wallet_accounts%rowtype;
  program public.earned_reward_program_versions%rowtype;
  existing_event public.authoritative_roll_completion_events%rowtype;
  inserted_event public.authoritative_roll_completion_events%rowtype;
  ledger_entry public.wallet_ledger_entries%rowtype;
  target_period_start date;
  credited_count integer;
  target_slot smallint;
begin
  if p_user_id is null or p_completed_at is null then
    raise exception 'User id and completion time are required' using errcode = '22023';
  end if;
  if p_server_event_id is null or
     char_length(p_server_event_id) not between 8 and 160 or
     p_server_event_id !~ '^[A-Za-z0-9][A-Za-z0-9._:-]+$' then
    raise exception 'Invalid authoritative server event id' using errcode = '22023';
  end if;
  if p_payload_sha256 is null or p_payload_sha256 !~ '^[0-9a-f]{64}$' then
    raise exception 'Invalid authoritative payload SHA-256' using errcode = '22023';
  end if;

  select * into strict program
  from public.earned_reward_program_versions
  where id = 'earned-collection@1/rewards@1';

  -- The wallet account is the first lock in every earned-economy write path.
  -- This serializes period-slot allocation, idempotency, claims, and balances.
  target_account := private.lock_wallet_account(p_user_id);

  select * into existing_event
  from public.authoritative_roll_completion_events
  where server_event_id = p_server_event_id;

  if found then
    if existing_event.user_id <> p_user_id or
       existing_event.payload_sha256 <> p_payload_sha256 or
       existing_event.completed_at <> p_completed_at or
       existing_event.program_id <> program.id then
      raise exception 'Server event id % was already used with a different roll payload',
        p_server_event_id
        using errcode = '22023';
    end if;
    return existing_event;
  end if;

  target_period_start := private.utc_monday_period_start(p_completed_at);
  select count(*) into credited_count
  from public.authoritative_roll_completion_events
  where account_id = target_account.id
    and period_start = target_period_start
    and credited_slot is not null;

  if credited_count < program.maximum_rewarded_rolls then
    target_slot := (credited_count + 1)::smallint;
  else
    target_slot := null;
  end if;

  -- Keep the wallet append and event insert in one exception subtransaction.
  -- A global event-id race for another user therefore rolls back any losing
  -- credit before reporting the mismatched replay.
  begin
    if target_slot is not null then
      ledger_entry := public.append_wallet_ledger_entry(
        p_user_id,
        'stars',
        'promotional',
        program.roll_reward_stars,
        'weekly.authoritative-roll',
        'roll-event:' || p_server_event_id,
        program.economy_edition_id,
        jsonb_build_object(
          'serverEventId', p_server_event_id,
          'payloadSha256', p_payload_sha256,
          'periodStart', target_period_start,
          'creditedSlot', target_slot,
          'authority', 'server-authoritative-room'
        )
      );
    end if;

    insert into public.authoritative_roll_completion_events (
      server_event_id,
      payload_sha256,
      authority_kind,
      program_id,
      account_id,
      user_id,
      completed_at,
      period_start,
      credited_slot,
      credited_stars,
      wallet_ledger_entry_id
    ) values (
      p_server_event_id,
      p_payload_sha256,
      'server-authoritative-room',
      program.id,
      target_account.id,
      p_user_id,
      p_completed_at,
      target_period_start,
      target_slot,
      case when target_slot is null then 0 else program.roll_reward_stars end,
      case when target_slot is null then null else ledger_entry.id end
    )
    returning * into inserted_event;
  exception when unique_violation then
    select * into existing_event
    from public.authoritative_roll_completion_events
    where server_event_id = p_server_event_id;

    if found and
       existing_event.user_id = p_user_id and
       existing_event.payload_sha256 = p_payload_sha256 and
       existing_event.completed_at = p_completed_at and
       existing_event.program_id = program.id then
      return existing_event;
    end if;
    if found then
      raise exception 'Server event id % was already used with a different roll payload',
        p_server_event_id
        using errcode = '22023';
    end if;
    raise;
  end;

  return inserted_event;
end;
$$;

comment on function public.record_authoritative_roll_completion(uuid, text, text, timestamptz) is
  'Service-role-only room-server completion ingest. Exact event replay is idempotent, mismatches fail closed, and the account lock caps each UTC-Monday period at ten 160-Star credits.';

-- ---------------------------------------------------------------------------
-- Private deterministic claim engine. Public wrappers below provide the only
-- API surface and pass auth.uid plus the database clock; no caller controls a
-- user, item, amount, claim index, or eligibility timestamp.
-- ---------------------------------------------------------------------------
create or replace function private.issue_earned_reward_claim(
  p_user_id uuid,
  p_claim_kind text,
  p_idempotency_key text,
  p_effective_at timestamptz
)
returns public.earned_reward_claim_outcomes
language plpgsql
set search_path = ''
as $$
declare
  target_account public.wallet_accounts%rowtype;
  program public.earned_reward_program_versions%rowtype;
  enrollment public.earned_reward_passport_enrollments%rowtype;
  existing_claim public.earned_reward_claim_outcomes%rowtype;
  inserted_claim public.earned_reward_claim_outcomes%rowtype;
  ledger_entry public.wallet_ledger_entries%rowtype;
  target_period_start date;
  eligible_claim_count integer;
  existing_claim_count integer;
  next_claim_index integer;
  target_eligible_period date;
  target_catalog_item_id text;
  target_entitlement_id uuid;
  target_claim_id uuid := gen_random_uuid();
  target_dust bigint := 0;
begin
  if p_claim_kind not in ('passport', 'community') then
    raise exception 'Unsupported earned reward claim kind %', p_claim_kind
      using errcode = '22023';
  end if;
  if p_idempotency_key is null or char_length(p_idempotency_key) not between 8 and 160 then
    raise exception 'Invalid earned reward idempotency key' using errcode = '22023';
  end if;
  if p_effective_at is null then
    raise exception 'Claim time is required' using errcode = '22023';
  end if;

  select * into strict program
  from public.earned_reward_program_versions
  where id = 'earned-collection@1/rewards@1';

  target_account := private.lock_wallet_account(p_user_id);

  select * into existing_claim
  from public.earned_reward_claim_outcomes
  where account_id = target_account.id
    and idempotency_key = p_idempotency_key;

  if found then
    if existing_claim.user_id <> p_user_id or
       existing_claim.program_id <> program.id or
       existing_claim.claim_kind <> p_claim_kind then
      raise exception 'Claim idempotency key % was already used for another reward',
        p_idempotency_key
        using errcode = '22023';
    end if;
    return existing_claim;
  end if;

  target_period_start := private.utc_monday_period_start(p_effective_at);
  select * into enrollment
  from public.earned_reward_passport_enrollments
  where account_id = target_account.id and program_id = program.id;

  if not found then
    if p_claim_kind = 'community' then
      raise exception 'Community Die requires New Collector Passport enrollment'
        using errcode = '55000';
    end if;
    insert into public.earned_reward_passport_enrollments (
      account_id,
      user_id,
      program_id,
      enrolled_period_start,
      enrolled_at
    ) values (
      target_account.id,
      p_user_id,
      program.id,
      target_period_start,
      p_effective_at
    )
    returning * into enrollment;
  end if;

  if target_period_start < enrollment.enrolled_period_start then
    raise exception 'Claim time precedes passport enrollment' using errcode = '22023';
  end if;

  select count(*) into existing_claim_count
  from public.earned_reward_claim_outcomes
  where account_id = target_account.id
    and program_id = program.id
    and claim_kind = p_claim_kind;

  if p_claim_kind = 'passport' then
    eligible_claim_count := least(
      program.passport_duration_weeks::integer,
      ((target_period_start - enrollment.enrolled_period_start) / program.period_days)::integer + 1
    );
    if existing_claim_count >= program.passport_duration_weeks then
      raise exception 'New Collector Passport is complete after twelve claims'
        using errcode = '55000';
    end if;
    if existing_claim_count >= eligible_claim_count then
      raise exception 'No New Collector Passport claim is currently available'
        using errcode = '55000';
    end if;
    next_claim_index := existing_claim_count + 1;
    target_eligible_period := enrollment.enrolled_period_start
      + ((next_claim_index - 1) * program.period_days);
    target_dust := program.passport_exhausted_dust;
  else
    eligible_claim_count := ((target_period_start - enrollment.enrolled_period_start)
      / (program.community_interval_weeks * program.period_days))::integer;
    if existing_claim_count >= eligible_claim_count then
      raise exception 'No Community Die claim is currently available'
        using errcode = '55000';
    end if;
    next_claim_index := existing_claim_count + 1;
    target_eligible_period := enrollment.enrolled_period_start
      + (next_claim_index * program.community_interval_weeks * program.period_days);
    target_dust := program.community_exhausted_dust;
  end if;

  -- A concurrent starter grant does not make a claim nondeterministic. If its
  -- uniqueness insert wins after candidate selection, retry the canonical
  -- query and award the next lowest never-granted item.
  loop
    select items.catalog_item_id into target_catalog_item_id
    from public.earned_reward_program_items as items
    where items.program_id = program.id
      and items.reward_kind = p_claim_kind
      and not exists (
        select 1
        from public.user_entitlements as entitlements
        where entitlements.user_id = p_user_id
          and entitlements.catalog_item_id = items.catalog_item_id
      )
    order by items.catalog_item_id
    limit 1;

    exit when target_catalog_item_id is null;
    target_entitlement_id := gen_random_uuid();
    insert into public.user_entitlements (
      id,
      user_id,
      catalog_item_id,
      grant_reason,
      grant_ref,
      provenance
    ) values (
      target_entitlement_id,
      p_user_id,
      target_catalog_item_id,
      'earned.' || p_claim_kind,
      'earned-claim:' || target_claim_id::text,
      jsonb_build_object(
        'programId', program.id,
        'claimKind', p_claim_kind,
        'claimIndex', next_claim_index
      )
    )
    on conflict (user_id, catalog_item_id) do nothing
    returning id into target_entitlement_id;

    exit when target_entitlement_id is not null;
    target_catalog_item_id := null;
  end loop;

  if target_catalog_item_id is null then
    ledger_entry := public.append_wallet_ledger_entry(
      p_user_id,
      'dust',
      'earned',
      target_dust,
      'earned.' || p_claim_kind || '.all-owned',
      'earned-claim:' || target_claim_id::text,
      program.economy_edition_id,
      jsonb_build_object(
        'claimId', target_claim_id,
        'programId', program.id,
        'claimKind', p_claim_kind,
        'claimIndex', next_claim_index,
        'outcome', 'all-owned-dust'
      )
    );
  end if;

  insert into public.earned_reward_claim_outcomes (
    id,
    program_id,
    account_id,
    user_id,
    claim_kind,
    claim_index,
    eligible_period_start,
    idempotency_key,
    outcome_kind,
    catalog_item_id,
    entitlement_id,
    wallet_ledger_entry_id,
    dust_amount,
    claimed_at
  ) values (
    target_claim_id,
    program.id,
    target_account.id,
    p_user_id,
    p_claim_kind,
    next_claim_index,
    target_eligible_period,
    p_idempotency_key,
    case when target_catalog_item_id is null then 'dust' else 'entitlement' end,
    target_catalog_item_id,
    case when target_catalog_item_id is null then null else target_entitlement_id end,
    case when target_catalog_item_id is null then ledger_entry.id else null end,
    case when target_catalog_item_id is null then target_dust else 0 end,
    p_effective_at
  )
  returning * into inserted_claim;

  return inserted_claim;
end;
$$;

revoke all on function private.issue_earned_reward_claim(uuid, text, text, timestamptz)
  from public, anon, authenticated, service_role;

create or replace function public.claim_new_collector_passport(p_idempotency_key text)
returns public.earned_reward_claim_outcomes
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller_user_id uuid;
begin
  caller_user_id := private.require_non_anonymous_user();
  return private.issue_earned_reward_claim(
    caller_user_id,
    'passport',
    p_idempotency_key,
    statement_timestamp()
  );
end;
$$;

create or replace function public.claim_community_die(p_idempotency_key text)
returns public.earned_reward_claim_outcomes
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller_user_id uuid;
begin
  caller_user_id := private.require_non_anonymous_user();
  return private.issue_earned_reward_claim(
    caller_user_id,
    'community',
    p_idempotency_key,
    statement_timestamp()
  );
end;
$$;

comment on function public.claim_new_collector_passport(text) is
  'Authenticated non-anonymous idempotent passport claim. User, item, amount, index, and time are database-derived under an account-first lock.';
comment on function public.claim_community_die(text) is
  'Authenticated non-anonymous idempotent Community Die claim every four completed UTC weeks from passport enrollment.';

-- ---------------------------------------------------------------------------
-- Authenticated derived status. No mutable progress snapshot exists.
-- ---------------------------------------------------------------------------
create or replace function public.get_earned_reward_status()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  caller_user_id uuid;
  program public.earned_reward_program_versions%rowtype;
  target_account public.wallet_accounts%rowtype;
  enrollment public.earned_reward_passport_enrollments%rowtype;
  current_period date := private.utc_monday_period_start(statement_timestamp());
  weekly_credited integer := 0;
  passport_claimed integer := 0;
  passport_available integer := 0;
  community_claimed integer := 0;
  community_available integer := 0;
  passport_state text := 'not_enrolled';
  community_state text := 'not_enrolled';
begin
  caller_user_id := private.require_non_anonymous_user();
  select * into strict program
  from public.earned_reward_program_versions
  where id = 'earned-collection@1/rewards@1';

  select * into target_account
  from public.wallet_accounts
  where user_id = caller_user_id;

  if found then
    select count(*) into weekly_credited
    from public.authoritative_roll_completion_events
    where account_id = target_account.id
      and period_start = current_period
      and credited_slot is not null;

    select * into enrollment
    from public.earned_reward_passport_enrollments
    where account_id = target_account.id and program_id = program.id;
  end if;

  if enrollment.account_id is not null then
    select count(*) into passport_claimed
    from public.earned_reward_claim_outcomes
    where account_id = target_account.id and program_id = program.id and claim_kind = 'passport';
    select count(*) into community_claimed
    from public.earned_reward_claim_outcomes
    where account_id = target_account.id and program_id = program.id and claim_kind = 'community';

    passport_available := least(
      program.passport_duration_weeks::integer,
      greatest(0, ((current_period - enrollment.enrolled_period_start) / program.period_days)::integer + 1)
    );
    community_available := greatest(
      0,
      ((current_period - enrollment.enrolled_period_start)
        / (program.community_interval_weeks * program.period_days))::integer
    );
    passport_state := case
      when passport_claimed >= program.passport_duration_weeks then 'complete'
      else 'active'
    end;
    community_state := case
      when community_available > community_claimed then 'claimable'
      else 'waiting'
    end;
  end if;

  return jsonb_build_object(
    'programId', program.id,
    'economyEditionId', program.economy_edition_id,
    'asOf', statement_timestamp(),
    'weekStart', current_period,
    'weeklyRolls', jsonb_build_object(
      'creditedRolls', weekly_credited,
      'maximumCreditedRolls', program.maximum_rewarded_rolls,
      'starsPerRoll', program.roll_reward_stars,
      'starsEarned', weekly_credited * program.roll_reward_stars
    ),
    'passport', jsonb_build_object(
      'state', passport_state,
      'enrolledPeriodStart', enrollment.enrolled_period_start,
      'claimedCount', passport_claimed,
      'availableClaimCount', passport_available,
      'catchUpClaimCount', greatest(0, passport_available - passport_claimed),
      'maximumClaims', program.passport_duration_weeks
    ),
    'community', jsonb_build_object(
      'state', community_state,
      'claimedCount', community_claimed,
      'availableClaimCount', community_available,
      'catchUpClaimCount', greatest(0, community_available - community_claimed),
      'intervalWeeks', program.community_interval_weeks,
      'nextEligiblePeriodStart', case
        when enrollment.account_id is null then null
        else enrollment.enrolled_period_start
          + ((community_claimed + 1) * program.community_interval_weeks * program.period_days)
      end
    )
  );
end;
$$;

comment on function public.get_earned_reward_status() is
  'Authenticated non-anonymous derived reward status. Passport completion and catch-up are computed from immutable enrollment/claim history; there is no mutable progress row.';

-- ---------------------------------------------------------------------------
-- Forced RLS and least-privilege Data API grants.
-- ---------------------------------------------------------------------------
alter table public.earned_reward_program_versions enable row level security;
alter table public.earned_reward_program_versions force row level security;
alter table public.earned_reward_program_items enable row level security;
alter table public.earned_reward_program_items force row level security;
alter table public.authoritative_roll_completion_events enable row level security;
alter table public.authoritative_roll_completion_events force row level security;
alter table public.earned_reward_passport_enrollments enable row level security;
alter table public.earned_reward_passport_enrollments force row level security;
alter table public.earned_reward_claim_outcomes enable row level security;
alter table public.earned_reward_claim_outcomes force row level security;

create policy "earned reward programs are publicly readable"
  on public.earned_reward_program_versions
  for select to anon, authenticated
  using (true);
create policy "earned reward program items are publicly readable"
  on public.earned_reward_program_items
  for select to anon, authenticated
  using (true);
create policy "users read their own authoritative roll events"
  on public.authoritative_roll_completion_events
  for select to authenticated
  using ((select auth.uid()) is not null and (select auth.uid()) = user_id);
create policy "users read their own earned reward enrollment"
  on public.earned_reward_passport_enrollments
  for select to authenticated
  using ((select auth.uid()) is not null and (select auth.uid()) = user_id);
create policy "users read their own earned reward claims"
  on public.earned_reward_claim_outcomes
  for select to authenticated
  using ((select auth.uid()) is not null and (select auth.uid()) = user_id);

revoke all on table public.earned_reward_program_versions
  from public, anon, authenticated, service_role;
revoke all on table public.earned_reward_program_items
  from public, anon, authenticated, service_role;
revoke all on table public.authoritative_roll_completion_events
  from public, anon, authenticated, service_role;
revoke all on table public.earned_reward_passport_enrollments
  from public, anon, authenticated, service_role;
revoke all on table public.earned_reward_claim_outcomes
  from public, anon, authenticated, service_role;

grant select on table public.earned_reward_program_versions to anon, authenticated, service_role;
grant select on table public.earned_reward_program_items to anon, authenticated, service_role;
grant select on table public.authoritative_roll_completion_events to authenticated, service_role;
grant select on table public.earned_reward_passport_enrollments to authenticated, service_role;
grant select on table public.earned_reward_claim_outcomes to authenticated, service_role;

revoke all on function public.record_authoritative_roll_completion(uuid, text, text, timestamptz)
  from public, anon, authenticated, service_role;
grant execute on function public.record_authoritative_roll_completion(uuid, text, text, timestamptz)
  to service_role;

revoke all on function public.get_earned_reward_status()
  from public, anon, authenticated, service_role;
grant execute on function public.get_earned_reward_status()
  to authenticated;

revoke all on function public.claim_new_collector_passport(text)
  from public, anon, authenticated, service_role;
grant execute on function public.claim_new_collector_passport(text)
  to authenticated;

revoke all on function public.claim_community_die(text)
  from public, anon, authenticated, service_role;
grant execute on function public.claim_community_die(text)
  to authenticated;

revoke all on sequence public.authoritative_roll_completion_events_id_seq
  from public, anon, authenticated, service_role;
