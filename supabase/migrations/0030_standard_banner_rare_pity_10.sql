-- Migration: 0030_standard_banner_rare_pity_10
-- Move the active standard banner's rare hard guarantee from pull 8 to pull 10.
--
-- Banner versions are immutable. Version 3 therefore copies version 2's
-- ticket offers, pool, weights, duplicate policy, and every other guarantee
-- setting, changing only its append-only identity and rare hard boundary.
-- Existing family-scoped guarantee counters carry into the highest version.

do $migration$
declare
  source_banner public.pull_banner_versions%rowtype;
  target_banner public.pull_banner_versions%rowtype;
  policy_difference_count bigint;
  offer_difference_count bigint;
  tier_difference_count bigint;
  item_difference_count bigint;
begin
  select *
  into strict source_banner
  from public.pull_banner_versions
  where id = 'earned-collection-001@2';

  if source_banner.banner_id is distinct from 'earned-collection-001' or
     source_banner.banner_version is distinct from 2 or
     source_banner.banner_family_id is distinct from 'earned-collection' or
     source_banner.banner_class is distinct from 'standard' or
     source_banner.roll_type is distinct from 'standard_roll' or
     source_banner.rare_hard_guarantee_pull is distinct from 8 or
     source_banner.epic_hard_guarantee_pull is distinct from 25 or
     source_banner.selected_hard_guarantee_pull is distinct from 20 or
     source_banner.soft_pity_model is not null or
     source_banner.soft_pity_start_pull is not null or
     source_banner.soft_pity_per_pull_increment is not null then
    raise exception 'earned-collection-001@2 is not the reviewed active standard source'
      using errcode = '55000';
  end if;

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
    'earned-collection-001@3',
    source.banner_id,
    3,
    source.banner_family_id,
    source.economy_edition_id,
    source.source_config_sha256,
    source.hold_policy_id,
    source.currency_id,
    source.balance_bucket,
    source.duplicate_currency_id,
    source.duplicate_balance_bucket,
    source.weight_scale,
    source.rare_minimum_rank,
    10,
    source.epic_minimum_rank,
    source.epic_hard_guarantee_pull,
    source.selected_minimum_rank,
    source.selected_hard_guarantee_pull,
    source.resolution_order,
    source.banner_class,
    source.roll_type,
    source.soft_pity_model,
    source.soft_pity_start_pull,
    source.soft_pity_per_pull_increment
  from public.pull_banner_versions as source
  where source.id = 'earned-collection-001@2';

  insert into public.pull_banner_offers (
    banner_version_id,
    pull_count,
    cost
  )
  select
    'earned-collection-001@3',
    source.pull_count,
    source.cost
  from public.pull_banner_offers as source
  where source.banner_version_id = 'earned-collection-001@2'
  order by source.pull_count;

  insert into public.pull_banner_tiers (
    banner_version_id,
    tier_id,
    tier_rank,
    weight_units,
    duplicate_dust
  )
  select
    'earned-collection-001@3',
    source.tier_id,
    source.tier_rank,
    source.weight_units,
    source.duplicate_dust
  from public.pull_banner_tiers as source
  where source.banner_version_id = 'earned-collection-001@2'
  order by source.tier_rank;

  insert into public.pull_banner_items (
    banner_version_id,
    tier_id,
    tier_rank,
    canonical_order,
    catalog_item_id,
    selected_featured
  )
  select
    'earned-collection-001@3',
    source.tier_id,
    source.tier_rank,
    source.canonical_order,
    source.catalog_item_id,
    source.selected_featured
  from public.pull_banner_items as source
  where source.banner_version_id = 'earned-collection-001@2'
  order by source.tier_rank, source.canonical_order;

  select *
  into strict target_banner
  from public.pull_banner_versions
  where id = 'earned-collection-001@3';

  -- Compare every policy field except the one deliberately changed.
  select count(*)
  into policy_difference_count
  from (
    select
      source.banner_id,
      source.banner_family_id,
      source.economy_edition_id,
      source.source_config_sha256,
      source.hold_policy_id,
      source.currency_id,
      source.balance_bucket,
      source.duplicate_currency_id,
      source.duplicate_balance_bucket,
      source.weight_scale,
      source.rare_minimum_rank,
      source.epic_minimum_rank,
      source.epic_hard_guarantee_pull,
      source.selected_minimum_rank,
      source.selected_hard_guarantee_pull,
      source.resolution_order,
      source.banner_class,
      source.roll_type,
      source.soft_pity_model,
      source.soft_pity_start_pull,
      source.soft_pity_per_pull_increment
    from public.pull_banner_versions as source
    where source.id = 'earned-collection-001@2'
    except
    select
      target.banner_id,
      target.banner_family_id,
      target.economy_edition_id,
      target.source_config_sha256,
      target.hold_policy_id,
      target.currency_id,
      target.balance_bucket,
      target.duplicate_currency_id,
      target.duplicate_balance_bucket,
      target.weight_scale,
      target.rare_minimum_rank,
      target.epic_minimum_rank,
      target.epic_hard_guarantee_pull,
      target.selected_minimum_rank,
      target.selected_hard_guarantee_pull,
      target.resolution_order,
      target.banner_class,
      target.roll_type,
      target.soft_pity_model,
      target.soft_pity_start_pull,
      target.soft_pity_per_pull_increment
    from public.pull_banner_versions as target
    where target.id = 'earned-collection-001@3'
  ) as policy_difference;

  if policy_difference_count is distinct from 0::bigint or
     target_banner.banner_version is distinct from 3 or
     target_banner.rare_hard_guarantee_pull is distinct from 10 or
     target_banner.epic_hard_guarantee_pull is distinct from 25 or
     target_banner.selected_hard_guarantee_pull is distinct from 20 then
    raise exception 'earned-collection-001@3 policy drifted beyond rare pity 10'
      using errcode = '55000';
  end if;

  select count(*)
  into offer_difference_count
  from (
    (
      select pull_count, cost
      from public.pull_banner_offers
      where banner_version_id = 'earned-collection-001@2'
      except
      select pull_count, cost
      from public.pull_banner_offers
      where banner_version_id = 'earned-collection-001@3'
    )
    union all
    (
      select pull_count, cost
      from public.pull_banner_offers
      where banner_version_id = 'earned-collection-001@3'
      except
      select pull_count, cost
      from public.pull_banner_offers
      where banner_version_id = 'earned-collection-001@2'
    )
  ) as offer_difference;

  select count(*)
  into tier_difference_count
  from (
    (
      select tier_id, tier_rank, weight_units, duplicate_dust
      from public.pull_banner_tiers
      where banner_version_id = 'earned-collection-001@2'
      except
      select tier_id, tier_rank, weight_units, duplicate_dust
      from public.pull_banner_tiers
      where banner_version_id = 'earned-collection-001@3'
    )
    union all
    (
      select tier_id, tier_rank, weight_units, duplicate_dust
      from public.pull_banner_tiers
      where banner_version_id = 'earned-collection-001@3'
      except
      select tier_id, tier_rank, weight_units, duplicate_dust
      from public.pull_banner_tiers
      where banner_version_id = 'earned-collection-001@2'
    )
  ) as tier_difference;

  select count(*)
  into item_difference_count
  from (
    (
      select
        tier_id,
        tier_rank,
        canonical_order,
        catalog_item_id,
        selected_featured
      from public.pull_banner_items
      where banner_version_id = 'earned-collection-001@2'
      except
      select
        tier_id,
        tier_rank,
        canonical_order,
        catalog_item_id,
        selected_featured
      from public.pull_banner_items
      where banner_version_id = 'earned-collection-001@3'
    )
    union all
    (
      select
        tier_id,
        tier_rank,
        canonical_order,
        catalog_item_id,
        selected_featured
      from public.pull_banner_items
      where banner_version_id = 'earned-collection-001@3'
      except
      select
        tier_id,
        tier_rank,
        canonical_order,
        catalog_item_id,
        selected_featured
      from public.pull_banner_items
      where banner_version_id = 'earned-collection-001@2'
    )
  ) as item_difference;

  if offer_difference_count is distinct from 0::bigint or
     tier_difference_count is distinct from 0::bigint or
     item_difference_count is distinct from 0::bigint or
     (select count(*)
      from public.pull_banner_offers
      where banner_version_id = target_banner.id) is distinct from 2::bigint or
     (select count(*)
      from public.pull_banner_tiers
      where banner_version_id = target_banner.id) is distinct from 4::bigint or
     (select sum(weight_units)
      from public.pull_banner_tiers
      where banner_version_id = target_banner.id) is distinct from 100::bigint or
     (select count(*)
      from public.pull_banner_items
      where banner_version_id = target_banner.id) is distinct from 45::bigint or
     (select count(*)
      from public.pull_banner_items
      where banner_version_id = target_banner.id
        and selected_featured) is distinct from 6::bigint then
    raise exception 'earned-collection-001@3 offers, tiers, or items drifted from version 2'
      using errcode = '55000';
  end if;
end;
$migration$;
