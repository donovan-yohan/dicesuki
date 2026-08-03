begin;

-- ---------------------------------------------------------------------------
-- Migration 0031 payload. The seven Dice Content Wave 1 procedural sets reached
-- catalog_items/catalog_asset_versions with the authored rarity, appearance,
-- and generated per-die name. The name assertion pins the procedural naming
-- contract ("<Set Name> D20", generate-collectible-catalog.js) that the
-- concept document records as a generator behavior rather than authored data.
-- ---------------------------------------------------------------------------
do $$
declare
  wave_set record;
begin
  for wave_set in
    select *
    from (values
      ('ten-thousand-folds', 'legendary', '#2f343b', 'metal', 'Ten Thousand Folds D20'),
      ('stormglass', 'legendary', '#2b3a52', 'celestial', 'Stormglass D20'),
      ('bogwood-reliquary', 'epic', '#2b1d14', 'wood', 'Bogwood Reliquary D20'),
      ('amberfall', 'epic', '#6b380c', 'resin', 'Amberfall D20'),
      ('verdigris-vigil', 'rare', '#1f6b5e', 'metal', 'Verdigris Vigil D20'),
      ('abyssal-glass', 'rare', '#12306b', 'glass', 'Abyssal Glass D20'),
      ('ashvow', 'rare', '#26292e', 'stone', 'Ashvow D20')
    ) as wave(set_id, rarity, base_color, material, d20_name)
  loop
    if (select count(*)
        from public.catalog_items
        where set_id = wave_set.set_id) is distinct from 6::bigint or
       (select count(distinct dice_type)
        from public.catalog_items
        where set_id = wave_set.set_id) is distinct from 6::bigint or
       exists (
         select 1
         from public.catalog_items
         where set_id = wave_set.set_id
           and rarity is distinct from wave_set.rarity
       ) then
      raise exception 'Wave-1 set % did not publish six single-rarity dice', wave_set.set_id;
    end if;

    if (select assets.metadata -> 'appearance' ->> 'baseColor'
        from public.catalog_asset_versions as assets
        where assets.catalog_item_id =
          wave_set.set_id || '/d20/' || wave_set.rarity || '@1')
         is distinct from wave_set.base_color or
       (select assets.metadata -> 'appearance' ->> 'material'
        from public.catalog_asset_versions as assets
        where assets.catalog_item_id =
          wave_set.set_id || '/d20/' || wave_set.rarity || '@1')
         is distinct from wave_set.material or
       (select assets.metadata ->> 'name'
        from public.catalog_asset_versions as assets
        where assets.catalog_item_id =
          wave_set.set_id || '/d20/' || wave_set.rarity || '@1')
         is distinct from wave_set.d20_name then
      raise exception 'Wave-1 set % did not publish its authored d20 appearance', wave_set.set_id;
    end if;
  end loop;
end;
$$;

-- ---------------------------------------------------------------------------
-- Client activation contract: the standard pull screen resolves the highest
-- ticket-bound standard banner, which migration 0032 moved to @4.
-- ---------------------------------------------------------------------------
do $$
declare
  active_banner record;
begin
  select
    versions.id,
    versions.banner_version,
    versions.banner_family_id,
    versions.economy_edition_id
  into strict active_banner
  from public.pull_banner_versions as versions
  where versions.banner_class = 'standard'
    and versions.roll_type = 'standard_roll'
  order by versions.banner_version desc, versions.id
  limit 1;

  if active_banner.id is distinct from 'earned-collection-001@4' or
     active_banner.banner_version is distinct from 4 or
     active_banner.banner_family_id is distinct from 'earned-collection' or
     active_banner.economy_edition_id is distinct from 'earned-collection@3' then
    raise exception 'Standard discovery did not activate earned-collection-001@4';
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- Appending @4 did not mutate @3. Its 45-item pool, six featured items, and
-- 10-pull edition anchor are exactly as 0030 published them.
-- ---------------------------------------------------------------------------
do $$
declare
  version_3 public.pull_banner_versions%rowtype;
begin
  select * into strict version_3
  from public.pull_banner_versions
  where id = 'earned-collection-001@3';

  if version_3.economy_edition_id is distinct from 'earned-collection@2' or
     version_3.rare_hard_guarantee_pull is distinct from 10 or
     version_3.epic_hard_guarantee_pull is distinct from 25 or
     version_3.selected_hard_guarantee_pull is distinct from 20 or
     (select count(*)
      from public.pull_banner_items
      where banner_version_id = 'earned-collection-001@3') is distinct from 45::bigint or
     (select count(*)
      from public.pull_banner_items
      where banner_version_id = 'earned-collection-001@3'
        and selected_featured) is distinct from 6::bigint then
    raise exception 'Version 3 changed while appending the wave-1 pool';
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- The expansion itself: pool cardinality moved, tier weights did not, and every
-- pooled die still matches its tier's catalog rarity.
-- ---------------------------------------------------------------------------
do $$
declare
  edition_3 public.economy_editions%rowtype;
  version_3 public.pull_banner_versions%rowtype;
  version_4 public.pull_banner_versions%rowtype;
begin
  select * into strict edition_3
  from public.economy_editions where id = 'earned-collection@3';
  select * into strict version_3
  from public.pull_banner_versions where id = 'earned-collection-001@3';
  select * into strict version_4
  from public.pull_banner_versions where id = 'earned-collection-001@4';

  if edition_3.edition_version is distinct from 3 or
     edition_3.config ->> 'migration' is distinct from
       '0032_earned_economy_dice_content_wave_1.sql' or
     version_4.source_config_sha256 is distinct from edition_3.config_sha256 or
     version_4.source_config_sha256 is not distinct from
       version_3.source_config_sha256 then
    raise exception 'Version 4 is not anchored to the appended wave-1 economy edition';
  end if;

  -- Weights are the reviewed 72/23/4/1 on both versions: only membership moved.
  if (select count(*)
      from (
        select tier_id, tier_rank, weight_units, duplicate_dust
        from public.pull_banner_tiers
        where banner_version_id = 'earned-collection-001@3'
        except
        select tier_id, tier_rank, weight_units, duplicate_dust
        from public.pull_banner_tiers
        where banner_version_id = 'earned-collection-001@4'
      ) as tier_difference) is distinct from 0::bigint or
     (select jsonb_object_agg(tier_id, weight_units)
      from public.pull_banner_tiers
      where banner_version_id = 'earned-collection-001@4')
       is distinct from jsonb_build_object(
         'standard', 72, 'rare', 23, 'epic', 4, 'signature', 1
       ) then
    raise exception 'Wave-1 expansion changed a standard banner tier weight';
  end if;

  if (select jsonb_object_agg(tier_id, item_count)
      from (
        select tier_id, count(*) as item_count
        from public.pull_banner_items
        where banner_version_id = 'earned-collection-001@4'
        group by tier_id
      ) as tier_counts)
       is distinct from jsonb_build_object(
         'standard', 24, 'rare', 27, 'epic', 18, 'signature', 12
       ) or
     (select count(*)
      from public.pull_banner_items
      where banner_version_id = 'earned-collection-001@4'
        and selected_featured) is distinct from 12::bigint or
     exists (
       select 1
       from public.pull_banner_items
       where banner_version_id = 'earned-collection-001@4'
         and selected_featured
         and tier_rank <> 3
     ) then
    raise exception 'Version 4 pools are not the reviewed 24/27/18/12 expansion';
  end if;

  -- Tier rank binds to catalog rarity, the DB-side twin of the tier definitions
  -- in scripts/validate-production-economy.js.
  if exists (
    select 1
    from public.pull_banner_items as items
    join public.catalog_items as catalog
      on catalog.id = items.catalog_item_id
    where items.banner_version_id = 'earned-collection-001@4'
      and not (catalog.rarity = any (coalesce(
        case items.tier_id
          when 'standard' then array['common', 'uncommon']
          when 'rare' then array['rare']
          when 'epic' then array['epic']
          when 'signature' then array['legendary']
        end,
        array[]::text[]
      )))
  ) then
    raise exception 'A version 4 pool item does not match its tier rarity';
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- Per-set membership. Six of the seven wave-1 sets contribute exactly six dice
-- to their tier. ten-thousand-folds contributes none anywhere: it is reserved
-- as the premium banner's featured candidate (dice-content-wave-1 §4.1), and
-- the 0.6% featured rate-up only works while it stays out of the standard pool.
-- ---------------------------------------------------------------------------
do $$
declare
  wave_set record;
begin
  for wave_set in
    select *
    from (values
      ('stormglass', 'signature'),
      ('bogwood-reliquary', 'epic'),
      ('amberfall', 'epic'),
      ('verdigris-vigil', 'rare'),
      ('abyssal-glass', 'rare'),
      ('ashvow', 'rare')
    ) as wave(set_id, tier_id)
  loop
    if (select count(*)
        from public.pull_banner_items as items
        join public.catalog_items as catalog
          on catalog.id = items.catalog_item_id
        where items.banner_version_id = 'earned-collection-001@4'
          and catalog.set_id = wave_set.set_id
          and items.tier_id = wave_set.tier_id) is distinct from 6::bigint then
      raise exception 'Wave-1 set % did not join its reviewed tier', wave_set.set_id;
    end if;
  end loop;

  if exists (
    select 1
    from public.pull_banner_items as items
    join public.catalog_items as catalog
      on catalog.id = items.catalog_item_id
    where catalog.set_id = 'ten-thousand-folds'
  ) then
    raise exception 'The reserved premium featured set leaked into a pull banner';
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- Superseded version 3 is no longer player-callable, and its rejection reserves
-- nothing. 0030 installed the active-version guard; this proves the guard now
-- retires the version 0032 replaced.
-- ---------------------------------------------------------------------------
insert into auth.users (id) values
  ('d0320000-0000-4032-8032-000000000001'),
  ('d0320000-0000-4032-8032-000000000020');

set local role service_role;
do $$
begin
  perform public.record_roll_ticket_ledger_entry(
    'd0320000-0000-4032-8032-000000000001',
    'standard_roll',
    2,
    'test.slice22.ticket.seed',
    'slice22:ticket:seed:0001',
    '{}'::jsonb
  );
  perform public.record_roll_ticket_ledger_entry(
    'd0320000-0000-4032-8032-000000000020',
    'standard_roll',
    1,
    'test.slice22.ticket.seed',
    'slice22:ticket:seed:0020',
    '{}'::jsonb
  );
end;
$$;
reset role;

set local "request.jwt.claims" =
  '{"sub":"d0320000-0000-4032-8032-000000000001","is_anonymous":false}';
set local role authenticated;

do $$
declare
  prepared record;
begin
  begin
    perform public.prepare_pull(
      'earned-collection-001@3',
      1::smallint,
      'slice22:superseded:version-3'
    );
    raise exception 'Superseded version 3 is still player-callable';
  exception when sqlstate '55000' then
    if sqlerrm is distinct from
       'Pull banner version earned-collection-001@3 is superseded by version 4 '
       || 'of family earned-collection' then
      raise exception 'Superseded version 3 is still player-callable';
    end if;
  end;

  if (select current_quantity
      from public.roll_ticket_balances
      where user_id = 'd0320000-0000-4032-8032-000000000001'
        and roll_type = 'standard_roll') is distinct from 2::bigint then
    raise exception 'The superseded version 3 rejection still reserved tickets';
  end if;

  select * into strict prepared
  from public.prepare_pull(
    'earned-collection-001@4',
    1::smallint,
    'slice22:active:version-4'
  );

  if prepared.banner_version_id is distinct from 'earned-collection-001@4' or
     prepared.held_amount is distinct from 1::bigint then
    raise exception 'Active version 4 did not prepare after the superseded rejection';
  end if;

  perform public.cancel_pull_session(prepared.session_id);
end;
$$;

reset role;

-- ---------------------------------------------------------------------------
-- The expansion is reachable, not merely stored. selectedFeaturedUnowned awards
-- the lowest-canonical-id unowned signature die at pull 20, and adding
-- Stormglass to the signature tier makes stormglass/d10/legendary@1 that die --
-- it sorts below every void-crystal id. A pull that lands here proves the new
-- signature set is drawable and is now the selected-featured target.
-- ---------------------------------------------------------------------------
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
  accounts.id,
  'd0320000-0000-4032-8032-000000000020',
  'earned-collection',
  19,
  0,
  0,
  19
from public.wallet_accounts as accounts
where accounts.user_id = 'd0320000-0000-4032-8032-000000000020';

-- The sealed row is read back with the suite's own privileges, the way 0030
-- reads its boundary results: sealed_pull_results is deliberately unreadable by
-- `authenticated`, so only the claim is switched, not the role.
set local "request.jwt.claims" =
  '{"sub":"d0320000-0000-4032-8032-000000000020","is_anonymous":false}';

do $$
declare
  sealed public.sealed_pull_results%rowtype;
begin
  perform public.prepare_pull(
    'earned-collection-001@4',
    1::smallint,
    'slice22:selected:pull-20'
  );

  select * into strict sealed
  from public.sealed_pull_results
  where user_id = 'd0320000-0000-4032-8032-000000000020';

  if sealed.resolution_reason is distinct from 'selected-guarantee' or
     sealed.catalog_item_id is distinct from 'stormglass/d10/legendary@1' or
     sealed.tier_id is distinct from 'signature' or
     sealed.tier_rank is distinct from 3::smallint or
     sealed.selected_target_catalog_item_id is distinct from
       'stormglass/d10/legendary@1' then
    raise exception 'The selected-featured guarantee did not award the new signature die';
  end if;
end;
$$;

rollback;
