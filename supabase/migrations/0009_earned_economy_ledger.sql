-- Migration: 0009_earned_economy_ledger
-- Issue #148 PR1 — immutable earned-economy edition and wallet ledger
--
-- Migration 0008 publishes the Dark Dungeon catalog edition. This migration
-- follows that merged catalog snapshot and remains the next contiguous number.
--
-- This is an earned-only foundation. It creates no claim, pull, result,
-- entitlement, checkout, payment, paid-balance-credit, or RNG path. Trusted
-- server code may append promotional Stars or earned Dust through one
-- service-role-only function. Normal clients can read only their own wallet.

-- ---------------------------------------------------------------------------
-- economy_editions: immutable production configuration snapshots.
-- ---------------------------------------------------------------------------
create table public.economy_editions (
  id                text        primary key,
  edition_version   integer     not null unique check (edition_version > 0),
  config_sha256     text        not null unique check (config_sha256 ~ '^[0-9a-f]{64}$'),
  config            jsonb       not null check (jsonb_typeof(config) = 'object'),
  created_at        timestamptz not null default now(),

  constraint economy_editions_versioned_id
    check (id = config ->> 'slug' || '@' || edition_version::text),
  constraint economy_editions_config_version
    check ((config ->> 'edition')::integer = edition_version),
  constraint economy_editions_config_id
    check (config ->> 'editionId' = id),
  constraint economy_editions_production_only
    check (config ->> 'purpose' = 'production')
);

comment on table public.economy_editions is
  'Immutable public production-economy snapshots. New rates or cadence require a new edition; simulation inputs are never consumed here.';

-- ---------------------------------------------------------------------------
-- wallet_accounts: stable one-to-one account anchor for an auth user.
--
-- User deletion is deliberately RESTRICTED. Currency history must not vanish
-- through an auth.users cascade; any future account-erasure workflow needs an
-- explicit reviewed tombstone/anonymization migration.
-- ---------------------------------------------------------------------------
create table public.wallet_accounts (
  id          uuid        primary key default gen_random_uuid(),
  user_id     uuid        not null unique references auth.users (id) on delete restrict,
  created_at  timestamptz not null default now(),

  constraint wallet_accounts_id_user_unique unique (id, user_id)
);

comment on table public.wallet_accounts is
  'Stable auth-user wallet anchors. Created only by the trusted ledger append boundary; immutable after creation.';

-- ---------------------------------------------------------------------------
-- wallet_balances: current materialized balance, always reconciled atomically
-- with the append-only ledger by append_wallet_ledger_entry().
-- ---------------------------------------------------------------------------
create table public.wallet_balances (
  account_id       uuid        not null,
  user_id          uuid        not null,
  currency_id      text        not null check (currency_id in ('stars', 'dust')),
  balance_bucket   text        not null check (balance_bucket in ('promotional', 'earned')),
  current_balance  bigint      not null default 0 check (current_balance >= 0),
  updated_at       timestamptz not null default now(),

  primary key (account_id, currency_id, balance_bucket),
  constraint wallet_balances_account_user_fkey
    foreign key (account_id, user_id)
    references public.wallet_accounts (id, user_id)
    on delete restrict,
  constraint wallet_balances_currency_bucket_pair
    check (
      (currency_id = 'stars' and balance_bucket = 'promotional') or
      (currency_id = 'dust' and balance_bucket = 'earned')
    ),
  constraint wallet_balances_account_user_currency_bucket_unique
    unique (account_id, user_id, currency_id, balance_bucket)
);

create index wallet_balances_user_idx
  on public.wallet_balances (user_id, currency_id, balance_bucket);

comment on table public.wallet_balances is
  'Materialized nonnegative wallet balances. Promotional Stars and earned Dust remain distinct buckets; no paid bucket exists in this phase.';

-- ---------------------------------------------------------------------------
-- wallet_ledger_entries: immutable, append-only balance history.
-- ---------------------------------------------------------------------------
create table public.wallet_ledger_entries (
  id                   bigint      generated always as identity primary key,
  account_id           uuid        not null,
  user_id              uuid        not null,
  currency_id          text        not null check (currency_id in ('stars', 'dust')),
  balance_bucket       text        not null check (balance_bucket in ('promotional', 'earned')),
  delta_amount         bigint      not null check (delta_amount <> 0),
  balance_before       bigint      not null check (balance_before >= 0),
  balance_after        bigint      not null check (balance_after >= 0),
  reason_code          text        not null,
  idempotency_key      text        not null,
  economy_edition_id   text        not null references public.economy_editions (id) on delete restrict,
  provenance           jsonb       not null default '{}'::jsonb,
  created_at           timestamptz not null default now(),

  constraint wallet_ledger_entries_balance_fkey
    foreign key (account_id, user_id, currency_id, balance_bucket)
    references public.wallet_balances (account_id, user_id, currency_id, balance_bucket)
    on delete restrict,
  constraint wallet_ledger_entries_account_idempotency_unique
    unique (account_id, idempotency_key),
  constraint wallet_ledger_entries_currency_bucket_pair
    check (
      (currency_id = 'stars' and balance_bucket = 'promotional') or
      (currency_id = 'dust' and balance_bucket = 'earned')
    ),
  constraint wallet_ledger_entries_balance_chain
    check (balance_after::numeric = balance_before::numeric + delta_amount::numeric),
  constraint wallet_ledger_entries_reason_code
    check (
      char_length(reason_code) between 3 and 128 and
      reason_code ~ '^[a-z][a-z0-9_.:-]+$'
    ),
  constraint wallet_ledger_entries_idempotency_key
    check (char_length(idempotency_key) between 8 and 200),
  constraint wallet_ledger_entries_provenance_object
    check (jsonb_typeof(provenance) = 'object'),
  constraint wallet_ledger_entries_provenance_size
    check (octet_length(provenance::text) <= 8192)
);

create index wallet_ledger_entries_user_created_idx
  on public.wallet_ledger_entries (user_id, created_at desc, id desc);

create index wallet_ledger_entries_balance_fkey_idx
  on public.wallet_ledger_entries (account_id, user_id, currency_id, balance_bucket);

create index wallet_ledger_entries_economy_edition_id_idx
  on public.wallet_ledger_entries (economy_edition_id);

comment on table public.wallet_ledger_entries is
  'Immutable wallet balance deltas with exact before/after balances, reason, idempotency key, economy edition, and bounded provenance.';

-- ---------------------------------------------------------------------------
-- Immutability enforcement, including TRUNCATE (which row triggers do not
-- cover). Table owners still retain disaster-recovery authority outside the
-- application boundary; every normal API role is explicitly stripped below.
-- ---------------------------------------------------------------------------
create or replace function public.reject_earned_economy_history_mutation()
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

create trigger economy_editions_reject_update_delete
  before update or delete on public.economy_editions
  for each row execute function public.reject_earned_economy_history_mutation();

create trigger economy_editions_reject_truncate
  before truncate on public.economy_editions
  for each statement execute function public.reject_earned_economy_history_mutation();

create trigger wallet_accounts_reject_update_delete
  before update or delete on public.wallet_accounts
  for each row execute function public.reject_earned_economy_history_mutation();

create trigger wallet_accounts_reject_truncate
  before truncate on public.wallet_accounts
  for each statement execute function public.reject_earned_economy_history_mutation();

create trigger wallet_ledger_entries_reject_update_delete
  before update or delete on public.wallet_ledger_entries
  for each row execute function public.reject_earned_economy_history_mutation();

create trigger wallet_ledger_entries_reject_truncate
  before truncate on public.wallet_ledger_entries
  for each statement execute function public.reject_earned_economy_history_mutation();

revoke all on function public.reject_earned_economy_history_mutation()
  from public, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Seed immutable production edition 0001.
--
-- The source JSON and this embedded block are checked byte-semantically by
-- scripts/validate-production-economy.js. ON CONFLICT permits migration replay
-- only when the already-published id, hash, and JSON are identical.
-- ---------------------------------------------------------------------------
do $seed$
declare
  expected_config constant jsonb :=
-- BEGIN EARNED ECONOMY EDITION 0001
$edition$
{
  "schemaVersion": 1,
  "edition": 1,
  "editionId": "earned-collection@1",
  "slug": "earned-collection",
  "purpose": "production",
  "migration": "0009_earned_economy_ledger.sql",
  "decisionSource": {
    "studyId": "candidate-a-vs-collection-first@1",
    "selectedCandidateId": "collection-first-showcase@1"
  },
  "catalogContractVersion": 1,
  "acquisition": {
    "phase": "earned-only",
    "realMoneyEnabled": false,
    "checkoutEnabled": false,
    "currency": {
      "currencyId": "stars",
      "balanceBucket": "promotional",
      "singlePullCost": 160,
      "tenPullCost": 1600
    },
    "banner": {
      "bannerId": "earned-collection-001",
      "familyId": "earned-collection",
      "weightScale": 100,
      "tiers": [
        {
          "tierId": "standard",
          "rank": 0,
          "weightUnits": 72,
          "catalogItemIds": [
            "adventurer-starter/d10/common@1",
            "adventurer-starter/d12/common@1",
            "adventurer-starter/d20/common@1",
            "adventurer-starter/d4/common@1",
            "adventurer-starter/d6/common@1",
            "adventurer-starter/d8/common@1",
            "dragon-jade/d10/common@1",
            "dragon-jade/d10/uncommon@1",
            "dragon-jade/d12/common@1",
            "dragon-jade/d12/uncommon@1",
            "dragon-jade/d20/common@1",
            "dragon-jade/d20/uncommon@1",
            "dragon-jade/d4/common@1",
            "dragon-jade/d4/uncommon@1",
            "dragon-jade/d6/common@1",
            "dragon-jade/d6/uncommon@1",
            "dragon-jade/d8/common@1",
            "dragon-jade/d8/uncommon@1",
            "lucky-bronze/d10/uncommon@1",
            "lucky-bronze/d12/uncommon@1",
            "lucky-bronze/d20/uncommon@1",
            "lucky-bronze/d4/uncommon@1",
            "lucky-bronze/d6/uncommon@1",
            "lucky-bronze/d8/uncommon@1"
          ]
        },
        {
          "tierId": "rare",
          "rank": 1,
          "weightUnits": 23,
          "catalogItemIds": [
            "devil-set/devil-d6@1",
            "dragon-jade/d10/rare@1",
            "dragon-jade/d12/rare@1",
            "dragon-jade/d20/rare@1",
            "dragon-jade/d4/rare@1",
            "dragon-jade/d6/rare@1",
            "dragon-jade/d8/rare@1",
            "materials-lab/rubber-d20@1",
            "materials-lab/steel-d20@1"
          ]
        },
        {
          "tierId": "epic",
          "rank": 2,
          "weightUnits": 4,
          "catalogItemIds": [
            "celestial-gold/d10/epic@1",
            "celestial-gold/d12/epic@1",
            "celestial-gold/d20/epic@1",
            "celestial-gold/d4/epic@1",
            "celestial-gold/d6/epic@1",
            "celestial-gold/d8/epic@1"
          ]
        },
        {
          "tierId": "signature",
          "rank": 3,
          "weightUnits": 1,
          "catalogItemIds": [
            "void-crystal/d10/legendary@1",
            "void-crystal/d12/legendary@1",
            "void-crystal/d20/legendary@1",
            "void-crystal/d4/legendary@1",
            "void-crystal/d6/legendary@1",
            "void-crystal/d8/legendary@1"
          ]
        }
      ],
      "guarantees": {
        "resolutionOrder": [
          "selected-featured-unowned",
          "epic-or-better",
          "rare-or-better",
          "base"
        ],
        "rareOrBetter": {
          "minimumRank": 1,
          "hardGuaranteePull": 8,
          "counterScope": "banner-family",
          "reset": "qualifying-result-awarded"
        },
        "epicOrBetter": {
          "minimumRank": 2,
          "hardGuaranteePull": 25,
          "counterScope": "banner-family",
          "reset": "qualifying-result-awarded"
        },
        "selectedFeaturedUnowned": {
          "minimumRank": 3,
          "hardGuaranteePull": 20,
          "catalogItemIds": [
            "void-crystal/d10/legendary@1",
            "void-crystal/d12/legendary@1",
            "void-crystal/d20/legendary@1",
            "void-crystal/d4/legendary@1",
            "void-crystal/d6/legendary@1",
            "void-crystal/d8/legendary@1"
          ],
          "selection": "lowest-canonical-id-unowned",
          "lossPath": "none",
          "softPity": "none",
          "counterScope": "banner-family",
          "reset": "selected-featured-awarded"
        }
      }
    }
  },
  "rewards": {
    "weeklyAuthoritativeRolls": {
      "periodDays": 7,
      "authoritativeCompletedRollTarget": 10,
      "maximumRewardedRolls": 10,
      "rewardPerCompletedRoll": {
        "currencyId": "stars",
        "balanceBucket": "promotional",
        "amount": 160
      },
      "maximumPeriodReward": 1600,
      "streakLoss": false,
      "missedDayPenalty": false
    },
    "newCollectorPassport": {
      "durationWeeks": 12,
      "claimsPerWeek": 1,
      "eligibleCatalogItemIds": [
        "adventurer-starter/d10/common@1",
        "adventurer-starter/d12/common@1",
        "adventurer-starter/d20/common@1",
        "adventurer-starter/d4/common@1",
        "adventurer-starter/d6/common@1",
        "adventurer-starter/d8/common@1",
        "dragon-jade/d10/common@1",
        "dragon-jade/d10/uncommon@1",
        "dragon-jade/d12/common@1",
        "dragon-jade/d12/uncommon@1",
        "dragon-jade/d20/common@1",
        "dragon-jade/d20/uncommon@1",
        "dragon-jade/d4/common@1",
        "dragon-jade/d4/uncommon@1",
        "dragon-jade/d6/common@1",
        "dragon-jade/d6/uncommon@1",
        "dragon-jade/d8/common@1",
        "dragon-jade/d8/uncommon@1",
        "lucky-bronze/d10/uncommon@1",
        "lucky-bronze/d12/uncommon@1",
        "lucky-bronze/d20/uncommon@1",
        "lucky-bronze/d4/uncommon@1",
        "lucky-bronze/d6/uncommon@1",
        "lucky-bronze/d8/uncommon@1"
      ],
      "selection": "lowest-canonical-id-unowned",
      "whenAllOwned": {
        "currencyId": "dust",
        "balanceBucket": "earned",
        "amount": 2
      },
      "afterWeekTwelve": "completed-no-further-claims"
    },
    "communityDie": {
      "intervalWeeks": 4,
      "claimMode": "direct-claim",
      "eligibleCatalogItemIds": [
        "infernal-obsidian/d10/mythic@1",
        "infernal-obsidian/d12/mythic@1",
        "infernal-obsidian/d20/mythic@1",
        "infernal-obsidian/d4/mythic@1",
        "infernal-obsidian/d6/mythic@1",
        "infernal-obsidian/d8/mythic@1"
      ],
      "selection": "lowest-canonical-id-unowned",
      "whenAllOwned": {
        "currencyId": "dust",
        "balanceBucket": "earned",
        "amount": 50
      }
    }
  },
  "duplicateConversion": {
    "currencyId": "dust",
    "balanceBucket": "earned",
    "amountByTier": {
      "standard": 2,
      "rare": 8,
      "epic": 20,
      "signature": 50,
      "community": 50
    }
  }
}
$edition$::jsonb
-- END EARNED ECONOMY EDITION 0001
  ;
  expected_sha256 constant text :=
    '6e198c0f3a3a96975ada45b27334583b5c17d84549db9eefe4e3671b296aba09';
begin
  insert into public.economy_editions
    (id, edition_version, config_sha256, config)
  values
    ('earned-collection@1', 1, expected_sha256, expected_config)
  on conflict (id) do nothing;

  if not exists (
    select 1
    from public.economy_editions
    where id = 'earned-collection@1'
      and edition_version = 1
      and config_sha256 = expected_sha256
      and config = expected_config
  ) then
    raise exception 'Conflicting immutable economy edition earned-collection@1'
      using errcode = '55000';
  end if;
end;
$seed$;

-- ---------------------------------------------------------------------------
-- Service-only append boundary.
--
-- All wallet mutations for one account lock the stable account row first.
-- That consistent order serializes cross-bucket idempotency keys and prevents
-- concurrent overspend. A replay with the same key and exact payload returns
-- the original row; a mismatched replay fails closed.
-- ---------------------------------------------------------------------------
create or replace function public.append_wallet_ledger_entry(
  p_user_id uuid,
  p_currency_id text,
  p_balance_bucket text,
  p_delta_amount bigint,
  p_reason_code text,
  p_idempotency_key text,
  p_economy_edition_id text,
  p_provenance jsonb default '{}'::jsonb
)
returns public.wallet_ledger_entries
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_account public.wallet_accounts%rowtype;
  target_balance public.wallet_balances%rowtype;
  existing_entry public.wallet_ledger_entries%rowtype;
  inserted_entry public.wallet_ledger_entries%rowtype;
  resulting_balance numeric;
begin
  if p_user_id is null then
    raise exception 'Wallet user id is required' using errcode = '22023';
  end if;
  if p_delta_amount is null or p_delta_amount = 0 then
    raise exception 'Wallet delta must be nonzero' using errcode = '22023';
  end if;
  if not (
    (p_currency_id = 'stars' and p_balance_bucket = 'promotional') or
    (p_currency_id = 'dust' and p_balance_bucket = 'earned')
  ) then
    raise exception 'Unsupported earned-only currency/bucket pair %/%',
      p_currency_id, p_balance_bucket
      using errcode = '22023';
  end if;
  if p_reason_code is null or
     char_length(p_reason_code) not between 3 and 128 or
     p_reason_code !~ '^[a-z][a-z0-9_.:-]+$' then
    raise exception 'Invalid wallet reason code' using errcode = '22023';
  end if;
  if p_idempotency_key is null or
     char_length(p_idempotency_key) not between 8 and 200 then
    raise exception 'Invalid wallet idempotency key' using errcode = '22023';
  end if;
  if p_provenance is null or
     jsonb_typeof(p_provenance) <> 'object' or
     octet_length(p_provenance::text) > 8192 then
    raise exception 'Wallet provenance must be a bounded JSON object' using errcode = '22023';
  end if;
  if not exists (
    select 1 from public.economy_editions where id = p_economy_edition_id
  ) then
    raise exception 'Unknown economy edition %', p_economy_edition_id
      using errcode = '23503';
  end if;

  insert into public.wallet_accounts (user_id)
  values (p_user_id)
  on conflict (user_id) do nothing;

  select *
  into strict target_account
  from public.wallet_accounts
  where user_id = p_user_id
  for update;

  select *
  into existing_entry
  from public.wallet_ledger_entries
  where account_id = target_account.id
    and idempotency_key = p_idempotency_key;

  if found then
    if existing_entry.user_id <> p_user_id or
       existing_entry.currency_id <> p_currency_id or
       existing_entry.balance_bucket <> p_balance_bucket or
       existing_entry.delta_amount <> p_delta_amount or
       existing_entry.reason_code <> p_reason_code or
       existing_entry.economy_edition_id <> p_economy_edition_id or
       existing_entry.provenance is distinct from p_provenance then
      raise exception 'Idempotency key % was already used with a different wallet payload',
        p_idempotency_key
        using errcode = '22023';
    end if;
    return existing_entry;
  end if;

  insert into public.wallet_balances
    (account_id, user_id, currency_id, balance_bucket)
  values
    (target_account.id, p_user_id, p_currency_id, p_balance_bucket)
  on conflict (account_id, currency_id, balance_bucket) do nothing;

  select *
  into strict target_balance
  from public.wallet_balances
  where account_id = target_account.id
    and currency_id = p_currency_id
    and balance_bucket = p_balance_bucket
  for update;

  resulting_balance := target_balance.current_balance::numeric + p_delta_amount::numeric;
  if resulting_balance < 0 then
    raise exception 'Insufficient %/% balance', p_currency_id, p_balance_bucket
      using errcode = '22003';
  end if;
  if resulting_balance > 9223372036854775807::numeric then
    raise exception 'Wallet balance overflow' using errcode = '22003';
  end if;

  insert into public.wallet_ledger_entries (
    account_id,
    user_id,
    currency_id,
    balance_bucket,
    delta_amount,
    balance_before,
    balance_after,
    reason_code,
    idempotency_key,
    economy_edition_id,
    provenance
  ) values (
    target_account.id,
    p_user_id,
    p_currency_id,
    p_balance_bucket,
    p_delta_amount,
    target_balance.current_balance,
    resulting_balance::bigint,
    p_reason_code,
    p_idempotency_key,
    p_economy_edition_id,
    p_provenance
  )
  returning * into inserted_entry;

  update public.wallet_balances
  set current_balance = resulting_balance::bigint,
      updated_at = now()
  where account_id = target_account.id
    and currency_id = p_currency_id
    and balance_bucket = p_balance_bucket;

  return inserted_entry;
end;
$$;

comment on function public.append_wallet_ledger_entry(uuid, text, text, bigint, text, text, text, jsonb) is
  'Service-role-only earned-currency append boundary: locks the account, returns exact idempotent replays, rejects mismatches and negative/overflow balances, and atomically updates ledger plus snapshot.';

-- ---------------------------------------------------------------------------
-- RLS and explicit least-privilege grants.
--
-- New Supabase projects no longer expose public tables automatically. These
-- grants intentionally expose public edition reads and authenticated own-wallet
-- reads only. No API role receives direct wallet DML.
-- ---------------------------------------------------------------------------
alter table public.economy_editions enable row level security;
alter table public.economy_editions force row level security;
alter table public.wallet_accounts enable row level security;
alter table public.wallet_accounts force row level security;
alter table public.wallet_balances enable row level security;
alter table public.wallet_balances force row level security;
alter table public.wallet_ledger_entries enable row level security;
alter table public.wallet_ledger_entries force row level security;

create policy "production economy editions are publicly readable"
  on public.economy_editions
  for select
  to anon, authenticated
  using (true);

create policy "users read their own wallet account"
  on public.wallet_accounts
  for select
  to authenticated
  using ((select auth.uid()) = user_id);

create policy "users read their own wallet balances"
  on public.wallet_balances
  for select
  to authenticated
  using ((select auth.uid()) = user_id);

create policy "users read their own wallet ledger"
  on public.wallet_ledger_entries
  for select
  to authenticated
  using ((select auth.uid()) = user_id);

revoke all on table public.economy_editions
  from public, anon, authenticated, service_role;
revoke all on table public.wallet_accounts
  from public, anon, authenticated, service_role;
revoke all on table public.wallet_balances
  from public, anon, authenticated, service_role;
revoke all on table public.wallet_ledger_entries
  from public, anon, authenticated, service_role;

grant select on table public.economy_editions to anon, authenticated, service_role;
grant select on table public.wallet_accounts to authenticated, service_role;
grant select on table public.wallet_balances to authenticated, service_role;
grant select on table public.wallet_ledger_entries to authenticated, service_role;

revoke all on function public.append_wallet_ledger_entry(
  uuid, text, text, bigint, text, text, text, jsonb
) from public, anon, authenticated, service_role;

grant execute on function public.append_wallet_ledger_entry(
  uuid, text, text, bigint, text, text, text, jsonb
) to service_role;

-- Identity sequences inherit PUBLIC defaults on some Postgres installations.
-- The trusted SECURITY DEFINER function uses the sequence as its owner; API
-- roles need no direct sequence capability.
revoke all on sequence public.wallet_ledger_entries_id_seq
  from public, anon, authenticated, service_role;
