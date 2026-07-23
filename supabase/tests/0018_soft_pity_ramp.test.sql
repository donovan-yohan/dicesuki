begin;

-- Fresh identities keep the behavioral cases independent from every earlier
-- sorted suite. All rows are rolled back at the end of this file.
insert into auth.users (id) values
  ('18000000-0000-4000-8000-000000000001'),
  ('18000000-0000-4000-8000-000000000002'),
  ('18000000-0000-4000-8000-000000000003');

-- Clone the immutable earned pool into a test-only family. The normalized
-- weights remain realistic (including a non-zero signature base rate), while
-- the increment makes the attempt-2 target rate exactly 1.0.
insert into public.pull_banner_families (id)
values ('slice6-soft-pity');

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
  banner_class,
  roll_type,
  soft_pity_model,
  soft_pity_start_pull,
  soft_pity_per_pull_increment
)
select
  'slice6-soft-pity@1',
  'slice6-soft-pity',
  1,
  'slice6-soft-pity',
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
  'standard',
  null,
  'linear-rate-ramp',
  2,
  1.0
from public.pull_banner_versions
where id = 'earned-collection-001@1';

insert into public.pull_banner_offers (banner_version_id, pull_count, cost)
values
  ('slice6-soft-pity@1', 1, 160),
  ('slice6-soft-pity@1', 2, 320);

insert into public.pull_banner_tiers (
  banner_version_id,
  tier_id,
  tier_rank,
  weight_units,
  duplicate_dust
)
select
  'slice6-soft-pity@1',
  tier_id,
  tier_rank,
  weight_units,
  duplicate_dust
from public.pull_banner_tiers
where banner_version_id = 'earned-collection-001@1';

insert into public.pull_banner_items (
  banner_version_id,
  tier_id,
  tier_rank,
  canonical_order,
  catalog_item_id,
  selected_featured
)
select
  'slice6-soft-pity@1',
  tier_id,
  tier_rank,
  canonical_order,
  catalog_item_id,
  selected_featured
from public.pull_banner_items
where banner_version_id = 'earned-collection-001@1';

do $$
begin
  if not exists (
    select 1
    from public.pull_banner_versions
    where id = 'slice6-soft-pity@1'
      and soft_pity_model = 'linear-rate-ramp'
      and soft_pity_start_pull = 2
      and soft_pity_per_pull_increment = 1.0
      and selected_hard_guarantee_pull > soft_pity_start_pull
  ) or not exists (
    select 1
    from public.pull_banner_items
    where banner_version_id = 'slice6-soft-pity@1'
      and selected_featured
  ) then
    raise exception 'Soft-pity behavioral fixture is incomplete';
  end if;
end;
$$;

-- Exercise the live all-or-none constraint in both directions.
do $$
begin
  begin
    insert into public.pull_banner_versions (
      id, banner_id, banner_version, banner_family_id, economy_edition_id,
      source_config_sha256, hold_policy_id, currency_id, balance_bucket,
      duplicate_currency_id, duplicate_balance_bucket, weight_scale,
      rare_minimum_rank, rare_hard_guarantee_pull,
      epic_minimum_rank, epic_hard_guarantee_pull,
      selected_minimum_rank, selected_hard_guarantee_pull, resolution_order,
      banner_class, roll_type,
      soft_pity_model, soft_pity_start_pull, soft_pity_per_pull_increment
    )
    select
      'slice6-soft-partial-model@1', 'slice6-soft-partial-model', 1,
      'slice6-soft-pity', economy_edition_id, source_config_sha256,
      hold_policy_id, currency_id, balance_bucket, duplicate_currency_id,
      duplicate_balance_bucket, weight_scale, rare_minimum_rank,
      rare_hard_guarantee_pull, epic_minimum_rank, epic_hard_guarantee_pull,
      selected_minimum_rank, selected_hard_guarantee_pull, resolution_order,
      'standard', null, 'linear-rate-ramp', null, null
    from public.pull_banner_versions
    where id = 'earned-collection-001@1';
    raise exception 'A model-only soft-pity configuration was accepted';
  exception when check_violation then
    null;
  end;

  begin
    insert into public.pull_banner_versions (
      id, banner_id, banner_version, banner_family_id, economy_edition_id,
      source_config_sha256, hold_policy_id, currency_id, balance_bucket,
      duplicate_currency_id, duplicate_balance_bucket, weight_scale,
      rare_minimum_rank, rare_hard_guarantee_pull,
      epic_minimum_rank, epic_hard_guarantee_pull,
      selected_minimum_rank, selected_hard_guarantee_pull, resolution_order,
      banner_class, roll_type,
      soft_pity_model, soft_pity_start_pull, soft_pity_per_pull_increment
    )
    select
      'slice6-soft-partial-values@1', 'slice6-soft-partial-values', 1,
      'slice6-soft-pity', economy_edition_id, source_config_sha256,
      hold_policy_id, currency_id, balance_bucket, duplicate_currency_id,
      duplicate_balance_bucket, weight_scale, rare_minimum_rank,
      rare_hard_guarantee_pull, epic_minimum_rank, epic_hard_guarantee_pull,
      selected_minimum_rank, selected_hard_guarantee_pull, resolution_order,
      'standard', null, null, 2, 1.0
    from public.pull_banner_versions
    where id = 'earned-collection-001@1';
    raise exception 'Soft-pity values without a model were accepted';
  exception when check_violation then
    null;
  end;
end;
$$;

-- Equality is the sharp boundary for start_pull < selected hard pity.
do $$
begin
  begin
    insert into public.pull_banner_versions (
      id, banner_id, banner_version, banner_family_id, economy_edition_id,
      source_config_sha256, hold_policy_id, currency_id, balance_bucket,
      duplicate_currency_id, duplicate_balance_bucket, weight_scale,
      rare_minimum_rank, rare_hard_guarantee_pull,
      epic_minimum_rank, epic_hard_guarantee_pull,
      selected_minimum_rank, selected_hard_guarantee_pull, resolution_order,
      banner_class, roll_type,
      soft_pity_model, soft_pity_start_pull, soft_pity_per_pull_increment
    )
    select
      'slice6-soft-too-late@1', 'slice6-soft-too-late', 1,
      'slice6-soft-pity', economy_edition_id, source_config_sha256,
      hold_policy_id, currency_id, balance_bucket, duplicate_currency_id,
      duplicate_balance_bucket, weight_scale, rare_minimum_rank,
      rare_hard_guarantee_pull, epic_minimum_rank, epic_hard_guarantee_pull,
      selected_minimum_rank, selected_hard_guarantee_pull, resolution_order,
      'standard', null, 'linear-rate-ramp',
      selected_hard_guarantee_pull, 1.0
    from public.pull_banner_versions
    where id = 'earned-collection-001@1';
    raise exception 'Soft pity was allowed to start at selected hard pity';
  exception when check_violation then
    null;
  end;
end;
$$;

-- Seed exactly the promotional Stars each preparation reserves.
select public.append_wallet_ledger_entry(
  '18000000-0000-4000-8000-000000000001',
  'stars',
  'promotional',
  320,
  'test.soft-pity-seed',
  'slice6-soft-pity:seed:two',
  'earned-collection@1',
  '{}'::jsonb
);

select public.append_wallet_ledger_entry(
  '18000000-0000-4000-8000-000000000002',
  'stars',
  'promotional',
  160,
  'test.soft-pity-seed',
  'slice6-soft-pity:seed:attempt-two',
  'earned-collection@1',
  '{}'::jsonb
);

select public.append_wallet_ledger_entry(
  '18000000-0000-4000-8000-000000000003',
  'stars',
  'promotional',
  1600,
  'test.soft-pity-seed',
  'slice6-soft-pity:seed:null',
  'earned-collection@1',
  '{}'::jsonb
);

-- Starting from zero misses, randomness may naturally award the selected item
-- on result 1. If it does not, result 2 is attempt 2 and the 1.0 target makes
-- the soft-pity upgrade certain. Either path therefore awards selected by the
-- second attempt without a probabilistic assertion.
set local "request.jwt.claims" =
  '{"sub":"18000000-0000-4000-8000-000000000001","is_anonymous":false}';
set local role authenticated;
select *
from public.prepare_pull(
  'slice6-soft-pity@1',
  2::smallint,
  'slice6-soft-pity:prepare:two'
);
reset role;

do $$
declare
  target_session_id uuid;
  first_is_selected boolean;
  first_reason text;
  first_selected_after bigint;
  second_is_selected boolean;
  second_reason text;
  second_selected_before bigint;
begin
  select id into strict target_session_id
  from public.pull_sessions
  where user_id = '18000000-0000-4000-8000-000000000001'
    and idempotency_key = 'slice6-soft-pity:prepare:two';

  select
    items.selected_featured,
    results.resolution_reason,
    results.selected_misses_after
  into strict
    first_is_selected,
    first_reason,
    first_selected_after
  from public.sealed_pull_results as results
  join public.pull_banner_items as items
    on items.banner_version_id = results.banner_version_id
   and items.catalog_item_id = results.catalog_item_id
  where results.session_id = target_session_id
    and results.result_position = 1;

  select
    items.selected_featured,
    results.resolution_reason,
    results.selected_misses_before
  into strict
    second_is_selected,
    second_reason,
    second_selected_before
  from public.sealed_pull_results as results
  join public.pull_banner_items as items
    on items.banner_version_id = results.banner_version_id
   and items.catalog_item_id = results.catalog_item_id
  where results.session_id = target_session_id
    and results.result_position = 2;

  if (select count(*) from public.sealed_pull_results
      where session_id = target_session_id) <> 2 then
    raise exception 'Two-pull ramp session did not seal exactly two results';
  end if;

  if first_is_selected then
    if first_reason <> 'base' or first_selected_after <> 0 or
       second_selected_before <> 0 or second_reason <> 'base' then
      raise exception
        'Natural attempt-1 featured hit did not reset counter/reason ordering';
    end if;
  else
    if first_reason <> 'base' or first_selected_after <> 1 or
       not second_is_selected or second_selected_before <> 1 or
       second_reason <> 'soft-pity' then
      raise exception
        'Attempt 2 was not the deterministic selected soft-pity award';
    end if;
  end if;

  if not first_is_selected and not second_is_selected then
    raise exception 'No featured award existed by the guaranteed second attempt';
  end if;
end;
$$;

-- A second fresh account starts at one selected miss, so its next result is
-- unambiguously attempt 2. This independently proves target=1.0 always seals
-- the selected item with the soft-pity reason.
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
  id,
  user_id,
  'slice6-soft-pity',
  1,
  0,
  0,
  1
from public.wallet_accounts
where user_id = '18000000-0000-4000-8000-000000000002';

set local "request.jwt.claims" =
  '{"sub":"18000000-0000-4000-8000-000000000002","is_anonymous":false}';
set local role authenticated;
select *
from public.prepare_pull(
  'slice6-soft-pity@1',
  1::smallint,
  'slice6-soft-pity:prepare:attempt-two'
);
reset role;

do $$
begin
  if not exists (
    select 1
    from public.sealed_pull_results as results
    join public.pull_banner_items as items
      on items.banner_version_id = results.banner_version_id
     and items.catalog_item_id = results.catalog_item_id
    where results.user_id = '18000000-0000-4000-8000-000000000002'
      and results.result_position = 1
      and results.selected_misses_before = 1
      and results.selected_misses_after = 0
      and results.resolution_reason = 'soft-pity'
      and items.selected_featured
      and results.catalog_item_id = results.selected_target_catalog_item_id
  ) or (select count(*) from public.sealed_pull_results
        where user_id = '18000000-0000-4000-8000-000000000002') <> 1 then
    raise exception
      'A certain attempt-2 ramp did not seal exactly one selected soft-pity result';
  end if;
end;
$$;

-- The pre-0018 production banner was backfilled with three NULLs. Its normal
-- ten-result draw still emits only the canonical pre-ramp reason vocabulary.
set local "request.jwt.claims" =
  '{"sub":"18000000-0000-4000-8000-000000000003","is_anonymous":false}';
set local role authenticated;
select *
from public.prepare_pull(
  'earned-collection-001@1',
  10::smallint,
  'slice6-soft-pity:prepare:null'
);
reset role;

do $$
begin
  if not exists (
    select 1
    from public.pull_banner_versions
    where id = 'earned-collection-001@1'
      and soft_pity_model is null
      and soft_pity_start_pull is null
      and soft_pity_per_pull_increment is null
  ) or (select count(*)
        from public.sealed_pull_results
        where user_id = '18000000-0000-4000-8000-000000000003') <> 10 or
     exists (
       select 1
       from public.sealed_pull_results
       where user_id = '18000000-0000-4000-8000-000000000003'
         and resolution_reason = 'soft-pity'
     ) or exists (
       select 1
       from public.sealed_pull_results
       where user_id = '18000000-0000-4000-8000-000000000003'
         and resolution_reason not in (
           'base',
           'rare-guarantee',
           'epic-guarantee',
           'selected-guarantee'
         )
     ) then
    raise exception 'NULL-ramp banner did not preserve canonical result reasons';
  end if;
end;
$$;

rollback;
