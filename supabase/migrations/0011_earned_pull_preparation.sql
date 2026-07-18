-- Migration: 0011_earned_pull_preparation
-- Issue #148 PR3 - atomic promotional-Star holds and sealed pull preparation
--
-- prepare_pull is intentionally narrower than a completed pull. In one
-- Postgres transaction it reserves available promotional Stars and freezes
-- CSPRNG-selected outcomes behind verifiable commitments. It does not debit a
-- wallet, grant an entitlement, reveal a result/nonce, or advance the durable
-- guarantee state. Later migrations must append explicit commit/reveal/ack
-- history rather than rewriting these snapshots.

create schema if not exists extensions;
create extension if not exists pgcrypto with schema extensions;

-- ---------------------------------------------------------------------------
-- Immutable, versioned pull policy normalized from earned-collection@1.
-- pull-hold@1 is new policy introduced by migration 0011. Its 120-second TTL
-- is deliberately not represented as a value derived from the economy edition.
-- ---------------------------------------------------------------------------
create table public.pull_hold_policy_versions (
  id                text        primary key,
  policy_version    integer     not null unique check (policy_version > 0),
  hold_ttl_seconds  smallint    not null check (hold_ttl_seconds between 30 and 600),
  created_at        timestamptz not null default now(),

  constraint pull_hold_policy_versions_id
    check (id = 'pull-hold@' || policy_version::text)
);

comment on table public.pull_hold_policy_versions is
  'Immutable pull-hold policy versions. pull-hold@1 introduces a 120-second migration-0011 policy; it is not economy-edition-derived.';

create table public.pull_banner_families (
  id          text        primary key,
  created_at  timestamptz not null default now(),

  constraint pull_banner_families_id_format
    check (id ~ '^[a-z0-9][a-z0-9-]{2,79}$')
);

create table public.pull_banner_versions (
  id                         text        primary key,
  banner_id                  text        not null,
  banner_version             integer     not null check (banner_version > 0),
  banner_family_id           text        not null
    references public.pull_banner_families (id) on delete restrict,
  economy_edition_id         text        not null
    references public.economy_editions (id) on delete restrict,
  source_config_sha256       text        not null check (source_config_sha256 ~ '^[0-9a-f]{64}$'),
  hold_policy_id             text        not null
    references public.pull_hold_policy_versions (id) on delete restrict,
  currency_id                text        not null check (currency_id = 'stars'),
  balance_bucket             text        not null check (balance_bucket = 'promotional'),
  duplicate_currency_id      text        not null check (duplicate_currency_id = 'dust'),
  duplicate_balance_bucket   text        not null check (duplicate_balance_bucket = 'earned'),
  weight_scale               integer     not null check (weight_scale > 0),
  rare_minimum_rank          smallint    not null check (rare_minimum_rank >= 0),
  rare_hard_guarantee_pull   integer     not null check (rare_hard_guarantee_pull > 0),
  epic_minimum_rank          smallint    not null check (epic_minimum_rank >= rare_minimum_rank),
  epic_hard_guarantee_pull   integer     not null check (epic_hard_guarantee_pull > 0),
  selected_minimum_rank      smallint    not null check (selected_minimum_rank >= epic_minimum_rank),
  selected_hard_guarantee_pull integer   not null check (selected_hard_guarantee_pull > 0),
  resolution_order           text[]      not null,
  created_at                 timestamptz not null default now(),

  constraint pull_banner_versions_identity_unique
    unique (banner_id, banner_version),
  constraint pull_banner_versions_family_identity_unique
    unique (id, banner_family_id),
  constraint pull_banner_versions_id
    check (id = banner_id || '@' || banner_version::text),
  constraint pull_banner_versions_banner_id_format
    check (banner_id ~ '^[a-z0-9][a-z0-9-]{2,79}$'),
  constraint pull_banner_versions_resolution_order
    check (resolution_order = array[
      'selected-featured-unowned',
      'epic-or-better',
      'rare-or-better',
      'base'
    ]::text[])
);

create index pull_banner_versions_family_idx
  on public.pull_banner_versions (banner_family_id, banner_version desc);
create index pull_banner_versions_economy_edition_idx
  on public.pull_banner_versions (economy_edition_id);
create index pull_banner_versions_hold_policy_idx
  on public.pull_banner_versions (hold_policy_id);

create table public.pull_banner_offers (
  banner_version_id  text      not null
    references public.pull_banner_versions (id) on delete restrict,
  pull_count         smallint  not null check (pull_count between 1 and 100),
  cost               bigint    not null check (cost > 0),

  primary key (banner_version_id, pull_count),
  constraint pull_banner_offers_session_identity_unique
    unique (banner_version_id, pull_count, cost)
);

comment on table public.pull_banner_offers is
  'Immutable normalized prices by banner version and pull count. New pricing appends a new banner version and offer rows; reusable constraints contain no edition-specific amounts.';

create table public.pull_banner_tiers (
  banner_version_id  text      not null
    references public.pull_banner_versions (id) on delete restrict,
  tier_id            text      not null,
  tier_rank          smallint  not null check (tier_rank >= 0),
  weight_units       integer   not null check (weight_units > 0),
  duplicate_dust     bigint    not null check (duplicate_dust > 0),

  primary key (banner_version_id, tier_id),
  constraint pull_banner_tiers_rank_unique
    unique (banner_version_id, tier_rank),
  constraint pull_banner_tiers_identity_unique
    unique (banner_version_id, tier_id, tier_rank),
  constraint pull_banner_tiers_id_format
    check (tier_id ~ '^[a-z][a-z0-9-]{2,39}$')
);

create table public.pull_banner_items (
  banner_version_id   text      not null,
  tier_id             text      not null,
  tier_rank           smallint  not null,
  canonical_order     integer   not null check (canonical_order > 0),
  catalog_item_id     text      not null references public.catalog_items (id) on delete restrict,
  selected_featured   boolean   not null default false,

  primary key (banner_version_id, tier_id, canonical_order),
  constraint pull_banner_items_tier_fkey
    foreign key (banner_version_id, tier_id, tier_rank)
    references public.pull_banner_tiers (banner_version_id, tier_id, tier_rank)
    on delete restrict,
  constraint pull_banner_items_catalog_unique
    unique (banner_version_id, catalog_item_id),
  constraint pull_banner_items_result_identity_unique
    unique (banner_version_id, catalog_item_id, tier_id, tier_rank)
);

create index pull_banner_items_tier_lookup_idx
  on public.pull_banner_items (banner_version_id, tier_rank, canonical_order);
create index pull_banner_items_catalog_item_idx
  on public.pull_banner_items (catalog_item_id);
create index pull_banner_items_selected_idx
  on public.pull_banner_items (banner_version_id, catalog_item_id)
  where selected_featured;

-- ---------------------------------------------------------------------------
-- Durable family-scoped guarantee anchor. It is mutable only for a future
-- reviewed commit boundary. prepare_pull reads it under the account lock but
-- never inserts or updates it.
-- ---------------------------------------------------------------------------
create table public.pull_guarantee_states (
  account_id       uuid        not null,
  user_id          uuid        not null,
  banner_family_id text        not null
    references public.pull_banner_families (id) on delete restrict,
  total_pulls      bigint      not null default 0 check (total_pulls >= 0),
  rare_misses      bigint      not null default 0 check (rare_misses >= 0),
  epic_misses      bigint      not null default 0 check (epic_misses >= 0),
  selected_misses  bigint      not null default 0 check (selected_misses >= 0),
  updated_at       timestamptz not null default now(),

  primary key (account_id, banner_family_id),
  constraint pull_guarantee_states_identity_unique
    unique (account_id, user_id, banner_family_id),
  constraint pull_guarantee_states_account_fkey
    foreign key (account_id, user_id)
    references public.wallet_accounts (id, user_id)
    on delete restrict
);

create index pull_guarantee_states_user_family_idx
  on public.pull_guarantee_states (user_id, banner_family_id);

-- ---------------------------------------------------------------------------
-- Immutable preparation and sealed result snapshots. Session rows are the
-- active hold source while prepared_at <= database time < expires_at. They are
-- never rewritten when they expire. A later transition is another append.
-- ---------------------------------------------------------------------------
create table public.pull_sessions (
  id                       uuid        primary key,
  account_id               uuid        not null,
  user_id                  uuid        not null,
  banner_version_id        text        not null,
  banner_family_id         text        not null,
  hold_policy_id           text        not null
    references public.pull_hold_policy_versions (id) on delete restrict,
  hold_ttl_seconds         smallint    not null check (hold_ttl_seconds between 30 and 600),
  pull_count               smallint    not null check (pull_count between 1 and 100),
  currency_id              text        not null check (currency_id = 'stars'),
  balance_bucket           text        not null check (balance_bucket = 'promotional'),
  held_amount              bigint      not null check (held_amount > 0),
  idempotency_key          text        not null,
  prepared_at              timestamptz not null,
  expires_at               timestamptz not null,
  total_pulls_before       bigint      not null check (total_pulls_before >= 0),
  total_pulls_projected    bigint      not null check (total_pulls_projected >= total_pulls_before),
  rare_misses_before       bigint      not null check (rare_misses_before >= 0),
  rare_misses_projected    bigint      not null check (rare_misses_projected >= 0),
  epic_misses_before       bigint      not null check (epic_misses_before >= 0),
  epic_misses_projected    bigint      not null check (epic_misses_projected >= 0),
  selected_misses_before   bigint      not null check (selected_misses_before >= 0),
  selected_misses_projected bigint     not null check (selected_misses_projected >= 0),
  commitment_scheme        text        not null,
  commitment_root          text        not null check (commitment_root ~ '^[0-9a-f]{64}$'),
  rng_scheme               text        not null,
  rng_seed                 bytea       not null check (octet_length(rng_seed) = 32),

  constraint pull_sessions_account_fkey
    foreign key (account_id, user_id)
    references public.wallet_accounts (id, user_id)
    on delete restrict,
  constraint pull_sessions_banner_fkey
    foreign key (banner_version_id, banner_family_id)
    references public.pull_banner_versions (id, banner_family_id)
    on delete restrict,
  constraint pull_sessions_offer_fkey
    foreign key (banner_version_id, pull_count, held_amount)
    references public.pull_banner_offers (banner_version_id, pull_count, cost)
    on delete restrict,
  constraint pull_sessions_account_key_unique
    unique (account_id, idempotency_key),
  constraint pull_sessions_result_identity_unique
    unique (id, account_id, user_id, banner_version_id),
  constraint pull_sessions_idempotency_key
    check (
      char_length(idempotency_key) between 8 and 160 and
      idempotency_key ~ '^[A-Za-z0-9][A-Za-z0-9._:-]+$'
    ),
  constraint pull_sessions_exact_expiry
    check (expires_at = prepared_at + make_interval(secs => hold_ttl_seconds)),
  constraint pull_sessions_projected_count
    check (total_pulls_projected = total_pulls_before + pull_count),
  constraint pull_sessions_commitment_scheme
    check (commitment_scheme = 'sha256-result-v1+sha256-root-v1'),
  constraint pull_sessions_rng_scheme
    check (rng_scheme = 'hmac-sha256-seed-v1')
);

create index pull_sessions_user_prepared_idx
  on public.pull_sessions (user_id, prepared_at desc, id);
create index pull_sessions_account_active_hold_idx
  on public.pull_sessions (
    account_id, currency_id, balance_bucket, expires_at, prepared_at
  );
create index pull_sessions_account_family_active_idx
  on public.pull_sessions (account_id, banner_family_id, expires_at, prepared_at);
create index pull_sessions_offer_idx
  on public.pull_sessions (banner_version_id, pull_count, held_amount);
create index pull_sessions_hold_policy_idx
  on public.pull_sessions (hold_policy_id);

create table public.sealed_pull_results (
  session_id              uuid        not null,
  account_id              uuid        not null,
  user_id                 uuid        not null,
  banner_version_id       text        not null,
  result_position         smallint    not null check (result_position > 0),
  catalog_item_id         text        not null,
  tier_id                 text        not null,
  tier_rank               smallint    not null check (tier_rank >= 0),
  selected_target_catalog_item_id text,
  resolution_reason       text        not null check (
    resolution_reason in ('base', 'rare-guarantee', 'epic-guarantee', 'selected-guarantee')
  ),
  rare_misses_before      bigint      not null check (rare_misses_before >= 0),
  rare_misses_after       bigint      not null check (rare_misses_after >= 0),
  epic_misses_before      bigint      not null check (epic_misses_before >= 0),
  epic_misses_after       bigint      not null check (epic_misses_after >= 0),
  selected_misses_before  bigint      not null check (selected_misses_before >= 0),
  selected_misses_after   bigint      not null check (selected_misses_after >= 0),
  is_duplicate            boolean     not null,
  duplicate_dust_amount   bigint      not null check (duplicate_dust_amount >= 0),
  nonce                   bytea       not null check (octet_length(nonce) = 32),
  commitment_sha256       text        not null check (commitment_sha256 ~ '^[0-9a-f]{64}$'),
  sealed_at               timestamptz not null,

  primary key (session_id, result_position),
  constraint sealed_pull_results_session_fkey
    foreign key (session_id, account_id, user_id, banner_version_id)
    references public.pull_sessions (id, account_id, user_id, banner_version_id)
    on delete restrict,
  constraint sealed_pull_results_banner_item_fkey
    foreign key (banner_version_id, catalog_item_id, tier_id, tier_rank)
    references public.pull_banner_items (banner_version_id, catalog_item_id, tier_id, tier_rank)
    on delete restrict,
  constraint sealed_pull_results_duplicate_shape
    check (
      (is_duplicate and duplicate_dust_amount > 0) or
      (not is_duplicate and duplicate_dust_amount = 0)
    ),
  constraint sealed_pull_results_session_commitment_unique
    unique (session_id, commitment_sha256)
);

create index sealed_pull_results_account_idx
  on public.sealed_pull_results (account_id, session_id, result_position);
create index sealed_pull_results_user_idx
  on public.sealed_pull_results (user_id, session_id, result_position);
create index sealed_pull_results_banner_item_idx
  on public.sealed_pull_results (banner_version_id, catalog_item_id, tier_id, tier_rank);

comment on table public.pull_sessions is
  'Immutable account-idempotent pull preparations. Active unexpired rows reserve Stars; result commitments are frozen but no debit, grant, reveal, or guarantee mutation occurs here.';
comment on table public.sealed_pull_results is
  'Immutable hidden CSPRNG-selected results and 32-byte nonces. Normal clients have no SELECT path; later reveal history may disclose enough to recompute commitments.';

-- ---------------------------------------------------------------------------
-- Immutability, including TRUNCATE. The guarantee anchor is the only mutable
-- table and remains inaccessible to API DML until a future trusted boundary.
-- ---------------------------------------------------------------------------
create or replace function private.reject_pull_history_mutation()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception '% on %.% is forbidden; append a new version or transition instead',
    tg_op, tg_table_schema, tg_table_name
    using errcode = '55000';
end;
$$;

do $triggers$
declare
  table_name text;
begin
  foreach table_name in array array[
    'pull_hold_policy_versions',
    'pull_banner_families',
    'pull_banner_versions',
    'pull_banner_offers',
    'pull_banner_tiers',
    'pull_banner_items',
    'pull_sessions',
    'sealed_pull_results'
  ] loop
    execute format(
      'create trigger %I before update or delete on public.%I for each row execute function private.reject_pull_history_mutation()',
      table_name || '_reject_update_delete',
      table_name
    );
    execute format(
      'create trigger %I before truncate on public.%I for each statement execute function private.reject_pull_history_mutation()',
      table_name || '_reject_truncate',
      table_name
    );
  end loop;
end;
$triggers$;

create trigger pull_guarantee_states_reject_delete
  before delete on public.pull_guarantee_states
  for each row execute function private.reject_pull_history_mutation();
create trigger pull_guarantee_states_reject_truncate
  before truncate on public.pull_guarantee_states
  for each statement execute function private.reject_pull_history_mutation();

revoke all on function private.reject_pull_history_mutation()
  from public, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Normalize the exact immutable earned-collection@1 banner. The only literal
-- item identities consumed here come from its immutable JSON; no later catalog
-- row can leak into the versioned pool.
-- ---------------------------------------------------------------------------
do $seed$
declare
  source_edition public.economy_editions%rowtype;
  source_banner jsonb;
  source_currency jsonb;
  source_guarantees jsonb;
  source_duplicates jsonb;
  tier_record record;
  total_items integer;
  total_weight integer;
  selected_items integer;
begin
  select * into strict source_edition
  from public.economy_editions
  where id = 'earned-collection@1';

  if source_edition.config_sha256 <>
     '6e198c0f3a3a96975ada45b27334583b5c17d84549db9eefe4e3671b296aba09' then
    raise exception 'earned-collection@1 source SHA does not match migration 0011'
      using errcode = '55000';
  end if;

  source_banner := source_edition.config #> '{acquisition,banner}';
  source_currency := source_edition.config #> '{acquisition,currency}';
  source_guarantees := source_banner -> 'guarantees';
  source_duplicates := source_edition.config -> 'duplicateConversion';

  if source_banner ->> 'bannerId' <> 'earned-collection-001' or
     source_banner ->> 'familyId' <> 'earned-collection' or
     (source_currency ->> 'singlePullCost')::bigint <> 160 or
     (source_currency ->> 'tenPullCost')::bigint <> 1600 or
     source_currency ->> 'currencyId' <> 'stars' or
     source_currency ->> 'balanceBucket' <> 'promotional' or
     source_duplicates ->> 'currencyId' <> 'dust' or
     source_duplicates ->> 'balanceBucket' <> 'earned' or
     (source_duplicates #>> '{amountByTier,standard}')::bigint <> 2 or
     (source_duplicates #>> '{amountByTier,rare}')::bigint <> 8 or
     (source_duplicates #>> '{amountByTier,epic}')::bigint <> 20 or
     (source_duplicates #>> '{amountByTier,signature}')::bigint <> 50 or
     (source_banner ->> 'weightScale')::integer <> 100 or
     (source_guarantees #>> '{rareOrBetter,hardGuaranteePull}')::integer <> 8 or
     (source_guarantees #>> '{epicOrBetter,hardGuaranteePull}')::integer <> 25 or
     (source_guarantees #>> '{selectedFeaturedUnowned,hardGuaranteePull}')::integer <> 20 or
     source_guarantees -> 'resolutionOrder' <> jsonb_build_array(
       'selected-featured-unowned', 'epic-or-better', 'rare-or-better', 'base'
     ) then
    raise exception 'earned-collection@1 pull rules do not match migration 0011'
      using errcode = '55000';
  end if;

  insert into public.pull_hold_policy_versions
    (id, policy_version, hold_ttl_seconds)
  values ('pull-hold@1', 1, 120);

  insert into public.pull_banner_families (id)
  values (source_banner ->> 'familyId');

  insert into public.pull_banner_versions (
    id,
    banner_id,
    banner_version,
    banner_family_id,
    economy_edition_id,
    source_config_sha256,
    hold_policy_id,
    currency_id,
    balance_bucket,
    duplicate_currency_id,
    duplicate_balance_bucket,
    weight_scale,
    rare_minimum_rank,
    rare_hard_guarantee_pull,
    epic_minimum_rank,
    epic_hard_guarantee_pull,
    selected_minimum_rank,
    selected_hard_guarantee_pull,
    resolution_order
  ) values (
    (source_banner ->> 'bannerId') || '@1',
    source_banner ->> 'bannerId',
    1,
    source_banner ->> 'familyId',
    source_edition.id,
    source_edition.config_sha256,
    'pull-hold@1',
    source_currency ->> 'currencyId',
    source_currency ->> 'balanceBucket',
    source_duplicates ->> 'currencyId',
    source_duplicates ->> 'balanceBucket',
    (source_banner ->> 'weightScale')::integer,
    (source_guarantees #>> '{rareOrBetter,minimumRank}')::smallint,
    (source_guarantees #>> '{rareOrBetter,hardGuaranteePull}')::integer,
    (source_guarantees #>> '{epicOrBetter,minimumRank}')::smallint,
    (source_guarantees #>> '{epicOrBetter,hardGuaranteePull}')::integer,
    (source_guarantees #>> '{selectedFeaturedUnowned,minimumRank}')::smallint,
    (source_guarantees #>> '{selectedFeaturedUnowned,hardGuaranteePull}')::integer,
    array(select jsonb_array_elements_text(source_guarantees -> 'resolutionOrder'))
  );

  insert into public.pull_banner_offers (banner_version_id, pull_count, cost)
  values
    ('earned-collection-001@1', 1, (source_currency ->> 'singlePullCost')::bigint),
    ('earned-collection-001@1', 10, (source_currency ->> 'tenPullCost')::bigint);

  insert into public.pull_banner_tiers
    (banner_version_id, tier_id, tier_rank, weight_units, duplicate_dust)
  select
    'earned-collection-001@1',
    tier ->> 'tierId',
    (tier ->> 'rank')::smallint,
    (tier ->> 'weightUnits')::integer,
    (source_duplicates #>> array['amountByTier', tier ->> 'tierId'])::bigint
  from jsonb_array_elements(source_banner -> 'tiers') as source(tier);

  for tier_record in
    select tier
    from jsonb_array_elements(source_banner -> 'tiers') as source(tier)
  loop
    insert into public.pull_banner_items (
      banner_version_id,
      tier_id,
      tier_rank,
      canonical_order,
      catalog_item_id,
      selected_featured
    )
    select
      'earned-collection-001@1',
      tier_record.tier ->> 'tierId',
      (tier_record.tier ->> 'rank')::smallint,
      item.ordinality::integer,
      item.catalog_item_id,
      (source_guarantees #> '{selectedFeaturedUnowned,catalogItemIds}')
        ? item.catalog_item_id
    from jsonb_array_elements_text(tier_record.tier -> 'catalogItemIds')
      with ordinality as item(catalog_item_id, ordinality);
  end loop;

  select count(*), sum(weight_units)
    into total_items, total_weight
  from public.pull_banner_tiers
  where banner_version_id = 'earned-collection-001@1';

  if total_items <> 4 or total_weight <> 100 or
     (select count(*) from public.pull_banner_offers where banner_version_id = 'earned-collection-001@1') <> 2 or
     not exists (
       select 1 from public.pull_banner_offers
       where banner_version_id = 'earned-collection-001@1' and pull_count = 1 and cost = 160
     ) or
     not exists (
       select 1 from public.pull_banner_offers
       where banner_version_id = 'earned-collection-001@1' and pull_count = 10 and cost = 1600
     ) or
     (select count(*) from public.pull_banner_items where banner_version_id = 'earned-collection-001@1') <> 45 or
     (select count(*) from public.pull_banner_items where banner_version_id = 'earned-collection-001@1' and tier_id = 'standard') <> 24 or
     (select count(*) from public.pull_banner_items where banner_version_id = 'earned-collection-001@1' and tier_id = 'rare') <> 9 or
     (select count(*) from public.pull_banner_items where banner_version_id = 'earned-collection-001@1' and tier_id = 'epic') <> 6 or
     (select count(*) from public.pull_banner_items where banner_version_id = 'earned-collection-001@1' and tier_id = 'signature') <> 6 then
    raise exception 'Normalized pull offers, tiers, or item membership are incomplete'
      using errcode = '55000';
  end if;

  select count(*) into selected_items
  from public.pull_banner_items
  where banner_version_id = 'earned-collection-001@1' and selected_featured;
  if selected_items <> 6 or exists (
    select 1
    from public.pull_banner_items
    where banner_version_id = 'earned-collection-001@1'
      and selected_featured
      and tier_rank <> 3
  ) then
    raise exception 'Selected-featured pull membership is incomplete'
      using errcode = '55000';
  end if;
end;
$seed$;

-- ---------------------------------------------------------------------------
-- CSPRNG and commitment helpers. One 32-byte pgcrypto seed drives
-- domain-separated HMAC-SHA256 words. Bounded integers use rejection sampling
-- over the leading unsigned 32-bit word, so tiers and item pools receive no
-- modulo bias and a later seed disclosure can reproduce every accepted draw.
-- ---------------------------------------------------------------------------
create or replace function private.pull_seeded_uint32_below(
  p_seed bytea,
  p_session_id uuid,
  p_result_position smallint,
  p_draw_kind text,
  p_upper_bound integer
)
returns integer
language plpgsql
immutable
strict
set search_path = ''
as $$
declare
  random_bytes bytea;
  random_value bigint;
  acceptance_limit bigint;
  attempt integer := 0;
begin
  if octet_length(p_seed) <> 32 then
    raise exception 'Pull RNG seed must contain 32 bytes' using errcode = '22023';
  end if;
  if p_draw_kind not in ('tier', 'item') then
    raise exception 'Unsupported pull RNG draw kind' using errcode = '22023';
  end if;
  if p_upper_bound <= 0 then
    raise exception 'Random upper bound must be positive' using errcode = '22023';
  end if;

  acceptance_limit := (4294967296::bigint / p_upper_bound::bigint) * p_upper_bound::bigint;
  loop
    random_bytes := extensions.hmac(
      convert_to(
        'dicesuki.pull.rng.v1' || E'\n' ||
        'session=' || p_session_id::text || E'\n' ||
        'position=' || p_result_position::text || E'\n' ||
        'draw=' || p_draw_kind || E'\n' ||
        'attempt=' || attempt::text,
        'UTF8'
      ),
      p_seed,
      'sha256'
    );
    random_value :=
      get_byte(random_bytes, 0)::bigint * 16777216::bigint +
      get_byte(random_bytes, 1)::bigint * 65536::bigint +
      get_byte(random_bytes, 2)::bigint * 256::bigint +
      get_byte(random_bytes, 3)::bigint;
    if random_value < acceptance_limit then
      return (random_value % p_upper_bound::bigint)::integer;
    end if;
    attempt := attempt + 1;
  end loop;
end;
$$;

create or replace function private.pull_selected_misses_after(
  p_selected_misses_before bigint,
  p_result_selected_featured boolean,
  p_is_duplicate boolean
)
returns bigint
language sql
immutable
strict
parallel safe
set search_path = ''
as $$
  select case
    when p_result_selected_featured and not p_is_duplicate then 0
    else p_selected_misses_before + 1
  end;
$$;

create or replace function private.pull_result_nonce(
  p_seed bytea,
  p_session_id uuid,
  p_result_position smallint
)
returns bytea
language sql
immutable
strict
parallel safe
set search_path = ''
as $$
  select extensions.hmac(
    convert_to(
      'dicesuki.pull.nonce.v1' || E'\n' ||
      'session=' || p_session_id::text || E'\n' ||
      'position=' || p_result_position::text,
      'UTF8'
    ),
    p_seed,
    'sha256'
  );
$$;

create or replace function private.pull_result_commitment(
  p_session_id uuid,
  p_result_position smallint,
  p_catalog_item_id text,
  p_tier_id text,
  p_tier_rank smallint,
  p_selected_target_catalog_item_id text,
  p_resolution_reason text,
  p_rare_misses_before bigint,
  p_rare_misses_after bigint,
  p_epic_misses_before bigint,
  p_epic_misses_after bigint,
  p_selected_misses_before bigint,
  p_selected_misses_after bigint,
  p_is_duplicate boolean,
  p_duplicate_dust_amount bigint,
  p_nonce bytea
)
returns text
language sql
immutable
parallel safe
set search_path = ''
as $$
  select encode(
    extensions.digest(
      convert_to(
        'dicesuki.pull.result.v1' || E'\n' ||
        'session=' || p_session_id::text || E'\n' ||
        'position=' || p_result_position::text || E'\n' ||
        'catalogItemId=' || p_catalog_item_id || E'\n' ||
        'tierId=' || p_tier_id || E'\n' ||
        'tierRank=' || p_tier_rank::text || E'\n' ||
        'selectedTargetCatalogItemId=' || coalesce(p_selected_target_catalog_item_id, '') || E'\n' ||
        'reason=' || p_resolution_reason || E'\n' ||
        'rareBefore=' || p_rare_misses_before::text || E'\n' ||
        'rareAfter=' || p_rare_misses_after::text || E'\n' ||
        'epicBefore=' || p_epic_misses_before::text || E'\n' ||
        'epicAfter=' || p_epic_misses_after::text || E'\n' ||
        'selectedBefore=' || p_selected_misses_before::text || E'\n' ||
        'selectedAfter=' || p_selected_misses_after::text || E'\n' ||
        'duplicate=' || case when p_is_duplicate then 'true' else 'false' end || E'\n' ||
        'duplicateDust=' || p_duplicate_dust_amount::text || E'\n' ||
        'nonce=' || encode(p_nonce, 'hex'),
        'UTF8'
      ),
      'sha256'
    ),
    'hex'
  );
$$;

create or replace function private.pull_commitment_root(
  p_session_id uuid,
  p_commitments text[]
)
returns text
language sql
immutable
strict
parallel safe
set search_path = ''
as $$
  select encode(
    extensions.digest(
      convert_to(
        'dicesuki.pull.root.v1' || E'\n' ||
        'session=' || p_session_id::text || E'\n' ||
        'count=' || cardinality(p_commitments)::text || E'\n' ||
        coalesce((
          select string_agg(entry.ordinality::text || ':' || entry.commitment, E'\n'
            order by entry.ordinality)
          from unnest(p_commitments) with ordinality as entry(commitment, ordinality)
        ), ''),
        'UTF8'
      ),
      'sha256'
    ),
    'hex'
  );
$$;

revoke all on function private.pull_seeded_uint32_below(bytea, uuid, smallint, text, integer)
  from public, anon, authenticated, service_role;
revoke all on function private.pull_selected_misses_after(bigint, boolean, boolean)
  from public, anon, authenticated, service_role;
revoke all on function private.pull_result_nonce(bytea, uuid, smallint)
  from public, anon, authenticated, service_role;
revoke all on function private.pull_result_commitment(
  uuid, smallint, text, text, smallint, text, text,
  bigint, bigint, bigint, bigint, bigint, bigint, boolean, bigint, bytea
) from public, anon, authenticated, service_role;
revoke all on function private.pull_commitment_root(uuid, text[])
  from public, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Private preparation engine. Production captures wall-clock decision time
-- after the account lock and exact-replay check. The nullable preparation-time
-- override may only create an already-expired row in the disposable SQL suite;
-- the public wrapper cannot supply it. Both private test seams are revoked from
-- every API role.
-- ---------------------------------------------------------------------------
create or replace function private.prepare_pull_for_user(
  p_user_id uuid,
  p_banner_version_id text,
  p_pull_count smallint,
  p_idempotency_key text,
  p_test_prepared_at timestamptz,
  p_inject_failure boolean default false
)
returns public.pull_sessions
language plpgsql
volatile
set search_path = ''
as $$
declare
  target_account public.wallet_accounts%rowtype;
  banner public.pull_banner_versions%rowtype;
  offer public.pull_banner_offers%rowtype;
  hold_policy public.pull_hold_policy_versions%rowtype;
  guarantee public.pull_guarantee_states%rowtype;
  existing_session public.pull_sessions%rowtype;
  inserted_session public.pull_sessions%rowtype;
  target_session_id uuid := gen_random_uuid();
  pull_seed bytea := extensions.gen_random_bytes(32);
  target_cost bigint;
  current_balance bigint := 0;
  active_holds bigint := 0;
  total_before bigint := 0;
  rare_before bigint := 0;
  epic_before bigint := 0;
  selected_before bigint := 0;
  rare_cursor bigint := 0;
  epic_cursor bigint := 0;
  selected_cursor bigint := 0;
  position integer;
  selected_item record;
  target_tier record;
  target_item record;
  selected_due boolean;
  epic_due boolean;
  rare_due boolean;
  minimum_rank smallint;
  resolution_reason text;
  tier_draw integer;
  item_draw integer;
  eligible_weight integer;
  item_count integer;
  result_nonce bytea;
  result_commitment text;
  result_is_duplicate boolean;
  result_duplicate_dust bigint;
  result_selected_after bigint;
  result_commitments text[] := array[]::text[];
  sealed_results jsonb := '[]'::jsonb;
  projected_catalog_item_ids text[] := array[]::text[];
  target_root text;
  decision_at timestamptz;
  session_prepared_at timestamptz;
begin
  if p_user_id is null then
    raise exception 'Pull user is required' using errcode = '22023';
  end if;
  if p_pull_count is null or p_pull_count not between 1 and 100 then
    raise exception 'Pull count must be between one and one hundred' using errcode = '22023';
  end if;
  if p_idempotency_key is null or
     char_length(p_idempotency_key) not between 8 and 160 or
     p_idempotency_key !~ '^[A-Za-z0-9][A-Za-z0-9._:-]+$' then
    raise exception 'Invalid pull idempotency key' using errcode = '22023';
  end if;

  select * into strict banner
  from public.pull_banner_versions
  where id = p_banner_version_id;
  select * into strict hold_policy
  from public.pull_hold_policy_versions
  where id = banner.hold_policy_id;

  -- Account is the first mutable lock across credits, claims, debits, and pulls.
  target_account := private.lock_wallet_account(p_user_id);

  select * into existing_session
  from public.pull_sessions
  where account_id = target_account.id
    and idempotency_key = p_idempotency_key;

  if found then
    if existing_session.user_id <> p_user_id or
       existing_session.banner_version_id <> p_banner_version_id or
       existing_session.pull_count <> p_pull_count then
      raise exception 'Pull idempotency key % was already used with a different request',
        p_idempotency_key
        using errcode = '22023';
    end if;
    return existing_session;
  end if;

  -- This function is intentionally VOLATILE. Under READ COMMITTED, each SQL
  -- command after the account lock observes commits from the prior lock holder.
  -- clock_timestamp(), unlike statement_timestamp(), cannot predate that wait.
  decision_at := clock_timestamp();
  session_prepared_at := coalesce(p_test_prepared_at, decision_at);
  if p_test_prepared_at is not null and
     p_test_prepared_at + make_interval(secs => hold_policy.hold_ttl_seconds) >= decision_at then
    raise exception 'Private preparation-time override must already be expired'
      using errcode = '22023';
  end if;

  select * into offer
  from public.pull_banner_offers
  where banner_version_id = banner.id
    and pull_count = p_pull_count;
  if not found then
    raise exception 'Pull count % is not offered by banner version %',
      p_pull_count, banner.id
      using errcode = '22023';
  end if;
  target_cost := offer.cost;

  if exists (
    select 1
    from public.pull_sessions
    where account_id = target_account.id
      and banner_family_id = banner.banner_family_id
      and prepared_at <= decision_at
      and expires_at > decision_at
  ) then
    raise exception 'An unexpired prepared pull already exists for banner family %',
      banner.banner_family_id
      using errcode = '55000';
  end if;

  -- A pull may not charge for a fixed starter item the caller was already owed.
  -- Exact replays returned above do not rerun this entitlement writer while a
  -- hold is active. New preparations establish the fixed bundle before taking
  -- their ownership snapshot.
  perform public.ensure_starter_entitlements();

  select balances.current_balance into current_balance
  from public.wallet_balances as balances
  where balances.account_id = target_account.id
    and balances.currency_id = banner.currency_id
    and balances.balance_bucket = banner.balance_bucket;
  current_balance := coalesce(current_balance, 0);

  select coalesce(sum(sessions.held_amount), 0) into active_holds
  from public.pull_sessions as sessions
  where sessions.account_id = target_account.id
    and sessions.currency_id = banner.currency_id
    and sessions.balance_bucket = banner.balance_bucket
    and sessions.prepared_at <= decision_at
    and sessions.expires_at > decision_at;

  if current_balance - active_holds < target_cost then
    raise exception 'Insufficient available promotional Stars after active holds'
      using errcode = '22003';
  end if;

  select * into guarantee
  from public.pull_guarantee_states
  where account_id = target_account.id
    and banner_family_id = banner.banner_family_id;
  if found then
    total_before := guarantee.total_pulls;
    rare_before := guarantee.rare_misses;
    epic_before := guarantee.epic_misses;
    selected_before := guarantee.selected_misses;
  end if;
  rare_cursor := rare_before;
  epic_cursor := epic_before;
  selected_cursor := selected_before;

  for position in 1..p_pull_count loop
    select
      items.catalog_item_id,
      items.tier_id,
      items.tier_rank,
      items.selected_featured
    into selected_item
    from public.pull_banner_items as items
    where items.banner_version_id = banner.id
      and items.selected_featured
      and not exists (
        select 1
        from public.user_entitlements as entitlements
        where entitlements.user_id = p_user_id
          and entitlements.catalog_item_id = items.catalog_item_id
      )
      and not (items.catalog_item_id = any(projected_catalog_item_ids))
    order by items.catalog_item_id
    limit 1;

    selected_due := selected_item.catalog_item_id is not null and
      selected_cursor + 1 >= banner.selected_hard_guarantee_pull;
    epic_due := epic_cursor + 1 >= banner.epic_hard_guarantee_pull;
    rare_due := rare_cursor + 1 >= banner.rare_hard_guarantee_pull;

    if selected_due then
      target_item := selected_item;
      resolution_reason := 'selected-guarantee';
    else
      if epic_due then
        minimum_rank := banner.epic_minimum_rank;
        resolution_reason := 'epic-guarantee';
      elsif rare_due then
        minimum_rank := banner.rare_minimum_rank;
        resolution_reason := 'rare-guarantee';
      else
        minimum_rank := 0;
        resolution_reason := 'base';
      end if;

      select sum(tiers.weight_units)::integer into eligible_weight
      from public.pull_banner_tiers as tiers
      where tiers.banner_version_id = banner.id
        and tiers.tier_rank >= minimum_rank;
      tier_draw := private.pull_seeded_uint32_below(
        pull_seed,
        target_session_id,
        position::smallint,
        'tier',
        eligible_weight
      );

      select tiers.tier_id, tiers.tier_rank, tiers.weight_units into target_tier
      from public.pull_banner_tiers as tiers
      where tiers.banner_version_id = banner.id
        and tiers.tier_rank >= minimum_rank
        and tier_draw < (
          select sum(previous.weight_units)
          from public.pull_banner_tiers as previous
          where previous.banner_version_id = banner.id
            and previous.tier_rank >= minimum_rank
            and previous.tier_rank <= tiers.tier_rank
        )
      order by tiers.tier_rank
      limit 1;

      select count(*)::integer into item_count
      from public.pull_banner_items as items
      where items.banner_version_id = banner.id
        and items.tier_id = target_tier.tier_id;
      item_draw := private.pull_seeded_uint32_below(
        pull_seed,
        target_session_id,
        position::smallint,
        'item',
        item_count
      );

      select
        items.catalog_item_id,
        items.tier_id,
        items.tier_rank,
        items.selected_featured
      into target_item
      from public.pull_banner_items as items
      where items.banner_version_id = banner.id
        and items.tier_id = target_tier.tier_id
      order by items.canonical_order
      offset item_draw
      limit 1;
    end if;

    result_is_duplicate := target_item.catalog_item_id = any(projected_catalog_item_ids) or exists (
      select 1
      from public.user_entitlements as entitlements
      where entitlements.user_id = p_user_id
        and entitlements.catalog_item_id = target_item.catalog_item_id
    );
    select case when result_is_duplicate then tiers.duplicate_dust else 0 end
      into strict result_duplicate_dust
    from public.pull_banner_tiers as tiers
    where tiers.banner_version_id = banner.id
      and tiers.tier_id = target_item.tier_id;
    result_selected_after := private.pull_selected_misses_after(
      selected_cursor,
      target_item.selected_featured,
      result_is_duplicate
    );

    result_nonce := private.pull_result_nonce(
      pull_seed,
      target_session_id,
      position::smallint
    );
    result_commitment := private.pull_result_commitment(
      target_session_id,
      position::smallint,
      target_item.catalog_item_id,
      target_item.tier_id,
      target_item.tier_rank,
      selected_item.catalog_item_id,
      resolution_reason,
      rare_cursor,
      case when target_item.tier_rank >= banner.rare_minimum_rank then 0 else rare_cursor + 1 end,
      epic_cursor,
      case when target_item.tier_rank >= banner.epic_minimum_rank then 0 else epic_cursor + 1 end,
      selected_cursor,
      result_selected_after,
      result_is_duplicate,
      result_duplicate_dust,
      result_nonce
    );

    sealed_results := sealed_results || jsonb_build_array(jsonb_build_object(
      'position', position,
      'catalog_item_id', target_item.catalog_item_id,
      'tier_id', target_item.tier_id,
      'tier_rank', target_item.tier_rank,
      'selected_target_catalog_item_id', selected_item.catalog_item_id,
      'reason', resolution_reason,
      'rare_before', rare_cursor,
      'rare_after', case when target_item.tier_rank >= banner.rare_minimum_rank then 0 else rare_cursor + 1 end,
      'epic_before', epic_cursor,
      'epic_after', case when target_item.tier_rank >= banner.epic_minimum_rank then 0 else epic_cursor + 1 end,
      'selected_before', selected_cursor,
      'selected_after', result_selected_after,
      'is_duplicate', result_is_duplicate,
      'duplicate_dust_amount', result_duplicate_dust,
      'nonce_hex', encode(result_nonce, 'hex'),
      'commitment', result_commitment
    ));
    result_commitments := array_append(result_commitments, result_commitment);
    projected_catalog_item_ids := array_append(
      projected_catalog_item_ids,
      target_item.catalog_item_id
    );

    rare_cursor := case
      when target_item.tier_rank >= banner.rare_minimum_rank then 0
      else rare_cursor + 1
    end;
    epic_cursor := case
      when target_item.tier_rank >= banner.epic_minimum_rank then 0
      else epic_cursor + 1
    end;
    selected_cursor := result_selected_after;
  end loop;

  target_root := private.pull_commitment_root(target_session_id, result_commitments);

  insert into public.pull_sessions (
    id,
    account_id,
    user_id,
    banner_version_id,
    banner_family_id,
    hold_policy_id,
    hold_ttl_seconds,
    pull_count,
    currency_id,
    balance_bucket,
    held_amount,
    idempotency_key,
    prepared_at,
    expires_at,
    total_pulls_before,
    total_pulls_projected,
    rare_misses_before,
    rare_misses_projected,
    epic_misses_before,
    epic_misses_projected,
    selected_misses_before,
    selected_misses_projected,
    commitment_scheme,
    commitment_root,
    rng_scheme,
    rng_seed
  ) values (
    target_session_id,
    target_account.id,
    p_user_id,
    banner.id,
    banner.banner_family_id,
    hold_policy.id,
    hold_policy.hold_ttl_seconds,
    p_pull_count,
    banner.currency_id,
    banner.balance_bucket,
    target_cost,
    p_idempotency_key,
    session_prepared_at,
    session_prepared_at + make_interval(secs => hold_policy.hold_ttl_seconds),
    total_before,
    total_before + p_pull_count,
    rare_before,
    rare_cursor,
    epic_before,
    epic_cursor,
    selected_before,
    selected_cursor,
    'sha256-result-v1+sha256-root-v1',
    target_root,
    'hmac-sha256-seed-v1',
    pull_seed
  )
  returning * into inserted_session;

  if p_inject_failure then
    raise exception 'Injected pull preparation failure after session insert'
      using errcode = 'P0001';
  end if;

  insert into public.sealed_pull_results (
    session_id,
    account_id,
    user_id,
    banner_version_id,
    result_position,
    catalog_item_id,
    tier_id,
    tier_rank,
    selected_target_catalog_item_id,
    resolution_reason,
    rare_misses_before,
    rare_misses_after,
    epic_misses_before,
    epic_misses_after,
    selected_misses_before,
    selected_misses_after,
    is_duplicate,
    duplicate_dust_amount,
    nonce,
    commitment_sha256,
    sealed_at
  )
  select
    target_session_id,
    target_account.id,
    p_user_id,
    banner.id,
    result.position::smallint,
    result.catalog_item_id,
    result.tier_id,
    result.tier_rank::smallint,
    result.selected_target_catalog_item_id,
    result.reason,
    result.rare_before,
    result.rare_after,
    result.epic_before,
    result.epic_after,
    result.selected_before,
    result.selected_after,
    result.is_duplicate,
    result.duplicate_dust_amount,
    decode(result.nonce_hex, 'hex'),
    result.commitment,
    session_prepared_at
  from jsonb_to_recordset(sealed_results) as result(
    position integer,
    catalog_item_id text,
    tier_id text,
    tier_rank integer,
    selected_target_catalog_item_id text,
    reason text,
    rare_before bigint,
    rare_after bigint,
    epic_before bigint,
    epic_after bigint,
    selected_before bigint,
    selected_after bigint,
    is_duplicate boolean,
    duplicate_dust_amount bigint,
    nonce_hex text,
    commitment text
  );

  if (select count(*) from public.sealed_pull_results where session_id = target_session_id)
     <> p_pull_count then
    raise exception 'Prepared pull did not seal exactly % results', p_pull_count
      using errcode = '55000';
  end if;

  return inserted_session;
end;
$$;

revoke all on function private.prepare_pull_for_user(
  uuid, text, smallint, text, timestamptz, boolean
) from public, anon, authenticated, service_role;

-- Wallet and ownership snapshots must remain valid for the life of a hold.
-- Existing reward claims serialize on the same account row, while the legacy
-- fixed starter RPC does not; these triggers provide the final table-level
-- backstop. A future commit migration will append a release/commit transition
-- in the same transaction before its trusted debit and grants.
create or replace function private.preserve_active_pull_holds_on_balance_change()
returns trigger
language plpgsql
volatile
set search_path = ''
as $$
declare
  active_holds bigint;
  decision_at timestamptz := clock_timestamp();
begin
  select coalesce(sum(sessions.held_amount), 0) into active_holds
  from public.pull_sessions as sessions
  where sessions.account_id = new.account_id
    and sessions.currency_id = new.currency_id
    and sessions.balance_bucket = new.balance_bucket
    and sessions.prepared_at <= decision_at
    and sessions.expires_at > decision_at;

  if new.current_balance < active_holds then
    raise exception 'Wallet balance cannot fall below active pull holds'
      using errcode = '22003';
  end if;
  return new;
end;
$$;

create trigger wallet_balances_preserve_active_pull_holds
  before update of current_balance on public.wallet_balances
  for each row execute function private.preserve_active_pull_holds_on_balance_change();

create or replace function private.preserve_pull_ownership_snapshot()
returns trigger
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  target_account public.wallet_accounts%rowtype;
  decision_at timestamptz;
begin
  -- Serialize grant-vs-prepare before reading the hold snapshot. Row locks are
  -- retained through the outer statement/transaction, so whichever operation
  -- wins this account lock defines the ownership snapshot consistently.
  target_account := private.lock_wallet_account(new.user_id);
  decision_at := clock_timestamp();
  if exists (
    select 1
    from public.pull_sessions as sessions
    where sessions.account_id = target_account.id
      and sessions.prepared_at <= decision_at
      and sessions.expires_at > decision_at
  ) then
    raise exception 'Collectible grants are paused while a prepared pull hold is active'
      using errcode = '55000';
  end if;
  return new;
end;
$$;

create trigger user_entitlements_preserve_pull_snapshot
  before insert on public.user_entitlements
  for each row execute function private.preserve_pull_ownership_snapshot();

revoke all on function private.preserve_active_pull_holds_on_balance_change()
  from public, anon, authenticated, service_role;
revoke all on function private.preserve_pull_ownership_snapshot()
  from public, anon, authenticated, service_role;

create or replace function public.prepare_pull(
  p_banner_version_id text,
  p_pull_count smallint,
  p_idempotency_key text
)
returns table (
  session_id uuid,
  banner_version_id text,
  pull_count smallint,
  held_amount bigint,
  prepared_at timestamptz,
  expires_at timestamptz,
  commitment_scheme text,
  commitment_root text,
  rng_scheme text
)
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  caller_user_id uuid;
  prepared public.pull_sessions%rowtype;
begin
  caller_user_id := private.require_non_anonymous_user();
  prepared := private.prepare_pull_for_user(
    caller_user_id,
    p_banner_version_id,
    p_pull_count,
    p_idempotency_key,
    null::timestamptz,
    false
  );
  return query values (
    prepared.id,
    prepared.banner_version_id,
    prepared.pull_count,
    prepared.held_amount,
    prepared.prepared_at,
    prepared.expires_at,
    prepared.commitment_scheme,
    prepared.commitment_root,
    prepared.rng_scheme
  );
end;
$$;

comment on function public.prepare_pull(text, smallint, text) is
  'Authenticated non-anonymous account-idempotent pull preparation. Returns a result-free receipt while atomically holding promotional Stars and sealing reproducible CSPRNG outcomes without debit, grant, reveal, or guarantee-state advance.';

revoke all on function public.prepare_pull(text, smallint, text)
  from public, anon, authenticated, service_role;
grant execute on function public.prepare_pull(text, smallint, text)
  to authenticated;

-- ---------------------------------------------------------------------------
-- Replace the existing ledger append boundary so every negative wallet path,
-- not just pull code, preserves unexpired holds. Exact prior ledger replays are
-- returned before the availability check.
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
volatile
security definer
set search_path = ''
as $$
declare
  target_account public.wallet_accounts%rowtype;
  target_balance public.wallet_balances%rowtype;
  existing_entry public.wallet_ledger_entries%rowtype;
  inserted_entry public.wallet_ledger_entries%rowtype;
  resulting_balance numeric;
  active_holds bigint := 0;
  decision_at timestamptz;
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

  target_account := private.lock_wallet_account(p_user_id);

  select * into existing_entry
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

  select * into strict target_balance
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

  if p_delta_amount < 0 then
    -- Account lock plus VOLATILE execution gives this query a fresh snapshot;
    -- wall-clock time is captured only after any prior lock holder commits.
    decision_at := clock_timestamp();
    select coalesce(sum(sessions.held_amount), 0) into active_holds
    from public.pull_sessions as sessions
    where sessions.account_id = target_account.id
      and sessions.currency_id = p_currency_id
      and sessions.balance_bucket = p_balance_bucket
      and sessions.prepared_at <= decision_at
      and sessions.expires_at > decision_at;
    if resulting_balance < active_holds then
      raise exception 'Insufficient available %/% balance after active holds',
        p_currency_id, p_balance_bucket
        using errcode = '22003';
    end if;
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

-- ---------------------------------------------------------------------------
-- Forced RLS and least-privilege Data API grants.
-- ---------------------------------------------------------------------------
do $rls$
declare
  table_name text;
begin
  foreach table_name in array array[
    'pull_hold_policy_versions',
    'pull_banner_families',
    'pull_banner_versions',
    'pull_banner_offers',
    'pull_banner_tiers',
    'pull_banner_items',
    'pull_guarantee_states',
    'pull_sessions',
    'sealed_pull_results'
  ] loop
    execute format('alter table public.%I enable row level security', table_name);
    execute format('alter table public.%I force row level security', table_name);
    execute format(
      'revoke all on table public.%I from public, anon, authenticated, service_role',
      table_name
    );
  end loop;
end;
$rls$;

create policy "pull hold policies are publicly readable"
  on public.pull_hold_policy_versions
  for select to anon, authenticated
  using (true);
create policy "pull banner families are publicly readable"
  on public.pull_banner_families
  for select to anon, authenticated
  using (true);
create policy "pull banner versions are publicly readable"
  on public.pull_banner_versions
  for select to anon, authenticated
  using (true);
create policy "pull banner offers are publicly readable"
  on public.pull_banner_offers
  for select to anon, authenticated
  using (true);
create policy "pull banner tiers are publicly readable"
  on public.pull_banner_tiers
  for select to anon, authenticated
  using (true);
create policy "pull banner items are publicly readable"
  on public.pull_banner_items
  for select to anon, authenticated
  using (true);
grant select on table public.pull_hold_policy_versions to anon, authenticated, service_role;
grant select on table public.pull_banner_families to anon, authenticated, service_role;
grant select on table public.pull_banner_versions to anon, authenticated, service_role;
grant select on table public.pull_banner_offers to anon, authenticated, service_role;
grant select on table public.pull_banner_tiers to anon, authenticated, service_role;
grant select on table public.pull_banner_items to anon, authenticated, service_role;
grant select on table public.pull_guarantee_states to service_role;
grant select on table public.pull_sessions to service_role;
grant select on table public.sealed_pull_results to service_role;
