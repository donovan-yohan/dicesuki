begin;

insert into auth.users (id) values
  ('25000000-0000-4000-8000-000000000001'),
  ('25000000-0000-4000-8000-000000000002'),
  ('25000000-0000-4000-8000-000000000003');

insert into public.catalog_items (
  id,
  catalog_key,
  contract_version,
  item_kind,
  set_id,
  dice_type,
  rarity
) values (
  'slice15-pity/d20/common@1',
  'slice15-pity/d20/common',
  1,
  'die',
  'slice15-pity',
  'd20',
  'common'
);

insert into public.pull_banner_families (id) values
  ('slice15-soft-family'),
  ('slice15-lifecycle-family'),
  ('slice15-empty-family'),
  ('slice15-ambiguous-family');

-- Two rows in the soft family prove that ACTIVE means the greatest append-only
-- banner_version, not the oldest row or lexical input. The lifecycle family
-- intentionally leaves every soft-pity field NULL.
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
  resolution_order,
  soft_pity_model,
  soft_pity_start_pull,
  soft_pity_per_pull_increment,
  banner_class,
  roll_type
) values
  (
    'slice15-soft-core@1',
    'slice15-soft-core',
    1,
    'slice15-soft-family',
    'earned-collection@1',
    repeat('1', 64),
    'pull-hold@1',
    'stars',
    'promotional',
    'dust',
    'earned',
    100,
    1,
    8,
    2,
    25,
    3,
    60,
    array[
      'selected-featured-unowned',
      'epic-or-better',
      'rare-or-better',
      'base'
    ]::text[],
    null,
    null,
    null,
    'standard',
    null
  ),
  (
    'slice15-soft-core@2',
    'slice15-soft-core',
    2,
    'slice15-soft-family',
    'earned-collection@1',
    repeat('2', 64),
    'pull-hold@1',
    'stars',
    'promotional',
    'dust',
    'earned',
    100,
    1,
    10,
    2,
    30,
    3,
    75,
    array[
      'selected-featured-unowned',
      'epic-or-better',
      'rare-or-better',
      'base'
    ]::text[],
    'linear-rate-ramp',
    41,
    0.005,
    'standard',
    null
  ),
  (
    'slice15-lifecycle-core@1',
    'slice15-lifecycle-core',
    1,
    'slice15-lifecycle-family',
    'earned-collection@1',
    repeat('3', 64),
    'pull-hold@1',
    'stars',
    'promotional',
    'dust',
    'earned',
    100,
    1,
    8,
    2,
    25,
    3,
    60,
    array[
      'selected-featured-unowned',
      'epic-or-better',
      'rare-or-better',
      'base'
    ]::text[],
    null,
    null,
    null,
    'standard',
    null
  ),
  (
    'slice15-ambiguous-a@7',
    'slice15-ambiguous-a',
    7,
    'slice15-ambiguous-family',
    'earned-collection@1',
    repeat('4', 64),
    'pull-hold@1',
    'stars',
    'promotional',
    'dust',
    'earned',
    100,
    1,
    8,
    2,
    25,
    3,
    60,
    array[
      'selected-featured-unowned',
      'epic-or-better',
      'rare-or-better',
      'base'
    ]::text[],
    null,
    null,
    null,
    'standard',
    null
  ),
  (
    'slice15-ambiguous-b@7',
    'slice15-ambiguous-b',
    7,
    'slice15-ambiguous-family',
    'earned-collection@1',
    repeat('5', 64),
    'pull-hold@1',
    'stars',
    'promotional',
    'dust',
    'earned',
    100,
    1,
    9,
    2,
    26,
    3,
    61,
    array[
      'selected-featured-unowned',
      'epic-or-better',
      'rare-or-better',
      'base'
    ]::text[],
    null,
    null,
    null,
    'standard',
    null
  );

insert into public.pull_banner_offers (
  banner_version_id,
  pull_count,
  cost
) values (
  'slice15-lifecycle-core@1',
  1,
  160
);

insert into public.pull_banner_tiers (
  banner_version_id,
  tier_id,
  tier_rank,
  weight_units,
  duplicate_dust
) values (
  'slice15-lifecycle-core@1',
  'standard',
  0,
  100,
  5
);

insert into public.pull_banner_items (
  banner_version_id,
  tier_id,
  tier_rank,
  canonical_order,
  catalog_item_id,
  selected_featured
) values (
  'slice15-lifecycle-core@1',
  'standard',
  0,
  1,
  'slice15-pity/d20/common@1',
  false
);

-- The canonical wallet append both seeds Stars and establishes accounts for A
-- and B. User C deliberately receives no append so its zero-state read proves
-- that this RPC never creates a wallet account.
select public.append_wallet_ledger_entry(
  '25000000-0000-4000-8000-000000000001',
  'stars',
  'promotional',
  320,
  'test.slice15.pity.seed',
  'slice15:pity:seed:a',
  'earned-collection@1',
  '{}'::jsonb
);
select public.append_wallet_ledger_entry(
  '25000000-0000-4000-8000-000000000002',
  'stars',
  'promotional',
  160,
  'test.slice15.pity.seed',
  'slice15:pity:seed:b',
  'earned-collection@1',
  '{}'::jsonb
);

-- A nonzero B row makes A's pre-lifecycle zero read an isolation assertion,
-- not merely an empty-table assertion.
insert into public.pull_guarantee_states (
  account_id,
  user_id,
  banner_family_id,
  total_pulls,
  rare_misses,
  epic_misses,
  selected_misses
)
select
  account.id,
  account.user_id,
  'slice15-lifecycle-family',
  9,
  3,
  4,
  5
from public.wallet_accounts as account
where account.user_id = '25000000-0000-4000-8000-000000000002';

-- A user with no wallet and no guarantee row receives zero counters plus the
-- highest-version thresholds. Configured soft pity is surfaced exactly; the
-- null-configured family retains NULLs.
set local "request.jwt.claims" =
  '{"sub":"25000000-0000-4000-8000-000000000003","is_anonymous":false}';
set local role authenticated;

do $$
declare
  soft_state record;
  null_state record;
begin
  select * into strict soft_state
  from public.get_my_pull_pity('slice15-soft-family');

  if soft_state.banner_family_id is distinct from 'slice15-soft-family' or
     soft_state.banner_version_id is distinct from 'slice15-soft-core@2' or
     soft_state.banner_version is distinct from 2 or
     soft_state.total_pulls is distinct from 0 or
     soft_state.rare_misses is distinct from 0 or
     soft_state.epic_misses is distinct from 0 or
     soft_state.selected_misses is distinct from 0 or
     soft_state.rare_hard_guarantee_pull is distinct from 10 or
     soft_state.epic_hard_guarantee_pull is distinct from 30 or
     soft_state.selected_hard_guarantee_pull is distinct from 75 or
     soft_state.soft_pity_model is distinct from 'linear-rate-ramp' or
     soft_state.soft_pity_start_pull is distinct from 41 or
     soft_state.soft_pity_per_pull_increment is distinct from 0.005::numeric then
    raise exception 'Zero-state active soft-pity thresholds were not exact';
  end if;

  select * into strict null_state
  from public.get_my_pull_pity('slice15-lifecycle-family');

  if null_state.total_pulls is distinct from 0 or
     null_state.rare_misses is distinct from 0 or
     null_state.epic_misses is distinct from 0 or
     null_state.selected_misses is distinct from 0 or
     null_state.soft_pity_model is not null or
     null_state.soft_pity_start_pull is not null or
     null_state.soft_pity_per_pull_increment is not null then
    raise exception 'Null soft-pity configuration or zero state drifted';
  end if;
end;
$$;

reset role;

do $$
begin
  if exists (
    select 1
    from public.wallet_accounts
    where user_id = '25000000-0000-4000-8000-000000000003'
  ) then
    raise exception 'Pity zero-state read created a wallet account';
  end if;
end;
$$;

-- A cannot observe B's seeded counters because the wrapper derives the caller
-- and exposes no user parameter.
set local "request.jwt.claims" =
  '{"sub":"25000000-0000-4000-8000-000000000001","is_anonymous":false}';
set local role authenticated;

do $$
declare
  pity record;
begin
  select * into strict pity
  from public.get_my_pull_pity('slice15-lifecycle-family');

  if pity.total_pulls is distinct from 0 or
     pity.rare_misses is distinct from 0 or
     pity.epic_misses is distinct from 0 or
     pity.selected_misses is distinct from 0 then
    raise exception 'Cross-user pity counters leaked before lifecycle';
  end if;
end;
$$;

-- The prepare/commit lifecycle is the only producer under test. The read must
-- return the committed projection, not stale prepare-time counters.
-- Role discipline: the API-role window only runs the calls under test and the
-- pity read; the privileged pull_sessions comparison happens as owner below.
create temporary table slice15_lifecycle_ctx (
  session_id uuid not null,
  total_pulls integer not null,
  rare_misses integer not null,
  epic_misses integer not null,
  selected_misses integer not null
) on commit drop;

do $$
declare
  prepared record;
  pity record;
begin
  select * into strict prepared
  from public.prepare_pull(
    'slice15-lifecycle-core@1',
    1::smallint,
    'slice15:pity:lifecycle:0001'
  );
  perform public.commit_pull_session(prepared.session_id);

  select * into strict pity
  from public.get_my_pull_pity('slice15-lifecycle-family');

  insert into pg_temp.slice15_lifecycle_ctx values (
    prepared.session_id,
    pity.total_pulls,
    pity.rare_misses,
    pity.epic_misses,
    pity.selected_misses
  );
end;
$$;

reset role;

do $$
declare
  ctx pg_temp.slice15_lifecycle_ctx%rowtype;
  projection public.pull_sessions%rowtype;
begin
  select * into strict ctx from pg_temp.slice15_lifecycle_ctx;

  select * into strict projection
  from public.pull_sessions
  where id = ctx.session_id;

  if ctx.total_pulls is distinct from projection.total_pulls_projected or
     ctx.rare_misses is distinct from projection.rare_misses_projected or
     ctx.epic_misses is distinct from projection.epic_misses_projected or
     ctx.selected_misses is distinct from projection.selected_misses_projected or
     ctx.total_pulls is distinct from 1 then
    raise exception 'Pity read did not reflect the committed pull projection';
  end if;
end;
$$;

-- B's independently seeded row remains B's view after A commits.
set local "request.jwt.claims" =
  '{"sub":"25000000-0000-4000-8000-000000000002","is_anonymous":false}';
set local role authenticated;

do $$
declare
  pity record;
begin
  select * into strict pity
  from public.get_my_pull_pity('slice15-lifecycle-family');

  if row(
    pity.total_pulls,
    pity.rare_misses,
    pity.epic_misses,
    pity.selected_misses
  ) is distinct from row(9::bigint, 3::bigint, 4::bigint, 5::bigint) then
    raise exception 'Cross-user pity counters leaked after lifecycle';
  end if;
end;
$$;

reset role;

-- Unknown families and known families without any version both fail closed.
set local "request.jwt.claims" =
  '{"sub":"25000000-0000-4000-8000-000000000001","is_anonymous":false}';
set local role authenticated;

do $$
begin
  begin
    perform public.get_my_pull_pity('slice15-unknown-family');
    raise exception 'Unknown pity family unexpectedly succeeded';
  exception when sqlstate '22023' then
    null;
  end;

  begin
    perform public.get_my_pull_pity('slice15-empty-family');
    raise exception 'Unversioned pity family unexpectedly succeeded';
  exception when sqlstate '22023' then
    null;
  end;

  begin
    perform public.get_my_pull_pity('slice15-ambiguous-family');
    raise exception 'Ambiguous active pity version unexpectedly succeeded';
  exception when sqlstate '22023' then
    null;
  end;
end;
$$;

reset role;

-- The anon database role has no EXECUTE privilege.
set local "request.jwt.claims" = '{"role":"anon"}';
set local role anon;

do $$
begin
  begin
    perform public.get_my_pull_pity('slice15-soft-family');
    raise exception 'Anon pity read unexpectedly succeeded';
  exception when insufficient_privilege then
    null;
  end;
end;
$$;

reset role;

-- Supabase anonymous sign-ins use the authenticated database role, so the
-- shared non-anonymous guard must reject that second guest shape as well.
set local "request.jwt.claims" =
  '{"sub":"25000000-0000-4000-8000-000000000003","is_anonymous":true}';
set local role authenticated;

do $$
begin
  begin
    perform public.get_my_pull_pity('slice15-soft-family');
    raise exception 'Anonymous authenticated pity read unexpectedly succeeded';
  exception when sqlstate '28000' then
    null;
  end;
end;
$$;

reset role;

-- Runtime privilege proof complements the migration's textual guardrails.
do $$
begin
  if not has_function_privilege(
       'authenticated',
       'public.get_my_pull_pity(text)',
       'EXECUTE'
     ) or
     has_function_privilege(
       'anon',
       'public.get_my_pull_pity(text)',
       'EXECUTE'
     ) or
     has_function_privilege(
       'service_role',
       'public.get_my_pull_pity(text)',
       'EXECUTE'
     ) or
     has_function_privilege(
       'authenticated',
       'private.get_pull_pity_for_user(uuid,text)',
       'EXECUTE'
     ) or
     has_function_privilege(
       'service_role',
       'private.get_pull_pity_for_user(uuid,text)',
       'EXECUTE'
     ) then
    raise exception 'Pity RPC execution privileges drifted';
  end if;
end;
$$;

rollback;
