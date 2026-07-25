-- Migration: 0029_standard_banner_activation
-- Activate the permanent earned-collection pool for the standard pull screen.
--
-- This is intentionally data-only. Version 2 keeps the existing family and
-- byte-copies every pool, weight, duplicate, and guarantee policy from version
-- 1. Only its append-only identity and funding binding change: the standard
-- client can discover it, and its 1/10 offers reserve 1/10 standard-roll
-- tickets. Family-scoped guarantee state therefore continues across versions.

do $migration$
declare
  source_banner public.pull_banner_versions%rowtype;
  target_banner public.pull_banner_versions%rowtype;
  policy_difference_count bigint;
  tier_difference_count bigint;
  item_difference_count bigint;
begin
  select *
  into strict source_banner
  from public.pull_banner_versions
  where id = 'earned-collection-001@1';

  -- Fail closed if the immutable source no longer represents the reviewed
  -- shallow standard pool. IS DISTINCT FROM keeps every nullable comparison
  -- two-valued, including the three dormant soft-pity fields.
  if source_banner.banner_id is distinct from 'earned-collection-001' or
     source_banner.banner_version is distinct from 1 or
     source_banner.banner_family_id is distinct from 'earned-collection' or
     source_banner.banner_class is distinct from 'standard' or
     source_banner.roll_type is not null or
     source_banner.rare_hard_guarantee_pull is distinct from 8 or
     source_banner.epic_hard_guarantee_pull is distinct from 25 or
     source_banner.selected_hard_guarantee_pull is distinct from 20 or
     source_banner.soft_pity_model is not null or
     source_banner.soft_pity_start_pull is not null or
     source_banner.soft_pity_per_pull_increment is not null then
    raise exception 'earned-collection-001@1 is not the reviewed shallow standard source'
      using errcode = '55000';
  end if;

  if (select count(*)
      from public.pull_banner_offers
      where banner_version_id = source_banner.id) is distinct from 2::bigint or
     not exists (
       select 1
       from public.pull_banner_offers
       where banner_version_id = source_banner.id
         and pull_count = 1
         and cost = 160
     ) or
     not exists (
       select 1
       from public.pull_banner_offers
       where banner_version_id = source_banner.id
         and pull_count = 10
         and cost = 1600
     ) then
    raise exception 'earned-collection-001@1 offers are not the reviewed Stars source'
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
    'earned-collection-001@2',
    source.banner_id,
    2,
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
    source.rare_hard_guarantee_pull,
    source.epic_minimum_rank,
    source.epic_hard_guarantee_pull,
    source.selected_minimum_rank,
    source.selected_hard_guarantee_pull,
    source.resolution_order,
    'standard',
    'standard_roll',
    null,
    null,
    null
  from public.pull_banner_versions as source
  where source.id = 'earned-collection-001@1';

  insert into public.pull_banner_offers (
    banner_version_id,
    pull_count,
    cost
  )
  select
    'earned-collection-001@2',
    source.pull_count,
    source.pull_count::bigint
  from public.pull_banner_offers as source
  where source.banner_version_id = 'earned-collection-001@1'
  order by source.pull_count;

  insert into public.pull_banner_tiers (
    banner_version_id,
    tier_id,
    tier_rank,
    weight_units,
    duplicate_dust
  )
  select
    'earned-collection-001@2',
    source.tier_id,
    source.tier_rank,
    source.weight_units,
    source.duplicate_dust
  from public.pull_banner_tiers as source
  where source.banner_version_id = 'earned-collection-001@1'
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
    'earned-collection-001@2',
    source.tier_id,
    source.tier_rank,
    source.canonical_order,
    source.catalog_item_id,
    source.selected_featured
  from public.pull_banner_items as source
  where source.banner_version_id = 'earned-collection-001@1'
  order by source.tier_rank, source.canonical_order;

  select *
  into strict target_banner
  from public.pull_banner_versions
  where id = 'earned-collection-001@2';

  -- Version policy must be an exact copy aside from append-only identity and
  -- ticket binding. The row comparison includes every nullable policy field.
  select count(*)
  into policy_difference_count
  from (
    select
      source.economy_edition_id,
      source.source_config_sha256,
      source.hold_policy_id,
      source.currency_id,
      source.balance_bucket,
      source.duplicate_currency_id,
      source.duplicate_balance_bucket,
      source.weight_scale,
      source.rare_minimum_rank,
      source.rare_hard_guarantee_pull,
      source.epic_minimum_rank,
      source.epic_hard_guarantee_pull,
      source.selected_minimum_rank,
      source.selected_hard_guarantee_pull,
      source.resolution_order,
      source.soft_pity_model,
      source.soft_pity_start_pull,
      source.soft_pity_per_pull_increment
    from public.pull_banner_versions as source
    where source.id = 'earned-collection-001@1'
    except
    select
      target.economy_edition_id,
      target.source_config_sha256,
      target.hold_policy_id,
      target.currency_id,
      target.balance_bucket,
      target.duplicate_currency_id,
      target.duplicate_balance_bucket,
      target.weight_scale,
      target.rare_minimum_rank,
      target.rare_hard_guarantee_pull,
      target.epic_minimum_rank,
      target.epic_hard_guarantee_pull,
      target.selected_minimum_rank,
      target.selected_hard_guarantee_pull,
      target.resolution_order,
      target.soft_pity_model,
      target.soft_pity_start_pull,
      target.soft_pity_per_pull_increment
    from public.pull_banner_versions as target
    where target.id = 'earned-collection-001@2'
  ) as policy_difference;

  if policy_difference_count is distinct from 0::bigint or
     target_banner.banner_id is distinct from source_banner.banner_id or
     target_banner.banner_version is distinct from 2 or
     target_banner.banner_family_id is distinct from source_banner.banner_family_id or
     target_banner.banner_class is distinct from 'standard' or
     target_banner.roll_type is distinct from 'standard_roll' or
     target_banner.soft_pity_model is not null or
     target_banner.soft_pity_start_pull is not null or
     target_banner.soft_pity_per_pull_increment is not null then
    raise exception 'earned-collection-001@2 policy or binding drifted from version 1'
      using errcode = '55000';
  end if;

  if (select count(*)
      from public.pull_banner_offers
      where banner_version_id = target_banner.id) is distinct from 2::bigint or
     not exists (
       select 1
       from public.pull_banner_offers
       where banner_version_id = target_banner.id
         and pull_count = 1
         and cost = 1
     ) or
     not exists (
       select 1
       from public.pull_banner_offers
       where banner_version_id = target_banner.id
         and pull_count = 10
         and cost = 10
     ) or
     exists (
       select 1
       from public.pull_banner_offers
       where banner_version_id = target_banner.id
         and cost is distinct from pull_count::bigint
     ) then
    raise exception 'earned-collection-001@2 ticket offers are not exact pull units'
      using errcode = '55000';
  end if;

  select count(*)
  into tier_difference_count
  from (
    (
      select tier_id, tier_rank, weight_units, duplicate_dust
      from public.pull_banner_tiers
      where banner_version_id = 'earned-collection-001@1'
      except
      select tier_id, tier_rank, weight_units, duplicate_dust
      from public.pull_banner_tiers
      where banner_version_id = 'earned-collection-001@2'
    )
    union all
    (
      select tier_id, tier_rank, weight_units, duplicate_dust
      from public.pull_banner_tiers
      where banner_version_id = 'earned-collection-001@2'
      except
      select tier_id, tier_rank, weight_units, duplicate_dust
      from public.pull_banner_tiers
      where banner_version_id = 'earned-collection-001@1'
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
      where banner_version_id = 'earned-collection-001@1'
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
    union all
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
      where banner_version_id = 'earned-collection-001@1'
    )
  ) as item_difference;

  if tier_difference_count is distinct from 0::bigint or
     item_difference_count is distinct from 0::bigint or
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
    raise exception 'earned-collection-001@2 tiers or items are not a complete version-1 copy'
      using errcode = '55000';
  end if;
end;
$migration$;
