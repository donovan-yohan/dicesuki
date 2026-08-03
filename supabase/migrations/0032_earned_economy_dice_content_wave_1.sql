-- Migration: 0032_earned_economy_dice_content_wave_1
-- Expand the active standard banner's rare, epic, and signature pools with the
-- Dice Content Wave 1 procedural sets.
--
-- A published banner version is immutable, so a pool change appends the next
-- contiguous production edition and the next banner version anchored to it
-- (docs/guides/economy-contracts.md). Version 4 therefore attests
-- earned-collection@3 instead of re-using version 3's 45-item source hash,
-- byte-copies version 3's ticket offers, tier weights, duplicate policy, and
-- every guarantee boundary, and changes only its append-only identity, its
-- edition anchor, and tier pool membership. Family-scoped guarantee counters
-- carry into the highest version unchanged.
--
-- The tier and item rows are derived from the edition of record rather than
-- copied and patched: the seed block below pins the edition by hash first, so
-- the pool the database serves is provably the pool the reviewed JSON declares.
-- Those derived rows are then diff-asserted against version 3's, which is what
-- proves this is an expansion and not a silent re-tiering. (The policy and
-- offer diffs further down are a weaker, defensive check -- those rows are
-- copied column-for-column, so their diff can only fire if a future trigger or
-- column default rewrites a copied value.)
--
-- No function is re-created. 0030_earned_economy_rare_pity_10.sql already
-- restricted private.prepare_pull_for_user to a family's single highest
-- version, and that guard resolves the head dynamically, so appending version 4
-- retires version 3 from the player path with no code change.
--
-- RUNTIME EFFECTS ON EXISTING PLAYERS. Both come from the same place --
-- private.prepare_pull_for_user picks the selected-guarantee target as the
-- lowest-canonical-id *unowned* featured item -- and neither shows up in a
-- config diff.
--
-- 1. Every partial collector's guarantee target silently moves. stormglass/...
--    sorts below every void-crystal/... id, so a player who was N pulls into
--    earning a specific void-crystal die now has stormglass/d10/legendary@1 as
--    their target instead. This is the larger cohort by far.
--
-- 2. Banked pity discharges. private.pull_selected_misses_after resets the
--    counter only when a featured non-duplicate is actually awarded, so a
--    player who already owns all six void-crystal legendaries has no eligible
--    target on any pull, never satisfies the guarantee, and accumulates
--    selected_misses without bound. The predicate is
--    `selected_cursor + 1 >= selected_hard_guarantee_pull`, so a banked counter
--    of 19 or more fires. The moment version 4 is live, stormglass is unowned
--    and eligible, and any such player is awarded a guaranteed legendary on
--    their very next pull.
--
-- That is the correct semantics of an unowned-target guarantee, and it is
-- player-favorable, so this migration deliberately does not touch
-- pull_guarantee_states -- rewriting counters to suppress it would retroactively
-- confiscate pity a player earned. Both effects are recorded here because they
-- are runtime consequences no config diff shows, and effect 2 is pinned by the
-- banked-counter case in
-- supabase/tests/0032_earned_economy_dice_content_wave_1.test.sql.

-- ---------------------------------------------------------------------------
-- Seed immutable production edition 0003.
--
-- The source JSON and this embedded block are checked byte-semantically by
-- scripts/validate-production-economy.js. ON CONFLICT permits migration replay
-- only when the already-published id, hash, and JSON are identical.
-- ---------------------------------------------------------------------------
do $seed$
declare
  expected_config constant jsonb :=
-- BEGIN EARNED ECONOMY EDITION 0003
$edition$
{
  "schemaVersion": 1,
  "edition": 3,
  "editionId": "earned-collection@3",
  "slug": "earned-collection",
  "purpose": "production",
  "migration": "0032_earned_economy_dice_content_wave_1.sql",
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
            "abyssal-glass/d10/rare@1",
            "abyssal-glass/d12/rare@1",
            "abyssal-glass/d20/rare@1",
            "abyssal-glass/d4/rare@1",
            "abyssal-glass/d6/rare@1",
            "abyssal-glass/d8/rare@1",
            "ashvow/d10/rare@1",
            "ashvow/d12/rare@1",
            "ashvow/d20/rare@1",
            "ashvow/d4/rare@1",
            "ashvow/d6/rare@1",
            "ashvow/d8/rare@1",
            "devil-set/devil-d6@1",
            "dragon-jade/d10/rare@1",
            "dragon-jade/d12/rare@1",
            "dragon-jade/d20/rare@1",
            "dragon-jade/d4/rare@1",
            "dragon-jade/d6/rare@1",
            "dragon-jade/d8/rare@1",
            "materials-lab/rubber-d20@1",
            "materials-lab/steel-d20@1",
            "verdigris-vigil/d10/rare@1",
            "verdigris-vigil/d12/rare@1",
            "verdigris-vigil/d20/rare@1",
            "verdigris-vigil/d4/rare@1",
            "verdigris-vigil/d6/rare@1",
            "verdigris-vigil/d8/rare@1"
          ]
        },
        {
          "tierId": "epic",
          "rank": 2,
          "weightUnits": 4,
          "catalogItemIds": [
            "amberfall/d10/epic@1",
            "amberfall/d12/epic@1",
            "amberfall/d20/epic@1",
            "amberfall/d4/epic@1",
            "amberfall/d6/epic@1",
            "amberfall/d8/epic@1",
            "bogwood-reliquary/d10/epic@1",
            "bogwood-reliquary/d12/epic@1",
            "bogwood-reliquary/d20/epic@1",
            "bogwood-reliquary/d4/epic@1",
            "bogwood-reliquary/d6/epic@1",
            "bogwood-reliquary/d8/epic@1",
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
            "stormglass/d10/legendary@1",
            "stormglass/d12/legendary@1",
            "stormglass/d20/legendary@1",
            "stormglass/d4/legendary@1",
            "stormglass/d6/legendary@1",
            "stormglass/d8/legendary@1",
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
          "hardGuaranteePull": 10,
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
            "stormglass/d10/legendary@1",
            "stormglass/d12/legendary@1",
            "stormglass/d20/legendary@1",
            "stormglass/d4/legendary@1",
            "stormglass/d6/legendary@1",
            "stormglass/d8/legendary@1",
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
-- END EARNED ECONOMY EDITION 0003
  ;
  expected_sha256 constant text :=
    'a1623cc4fd3c2b4d80bd41406a1a29bc90ba09bff5b3e98e58c474812b7ffc28';
  banner_config jsonb;
  guarantees_config jsonb;
begin
  insert into public.economy_editions
    (id, edition_version, config_sha256, config)
  values
    ('earned-collection@3', 3, expected_sha256, expected_config)
  on conflict (id) do nothing;

  if not exists (
    select 1
    from public.economy_editions
    where id = 'earned-collection@3'
      and edition_version = 3
      and config_sha256 = expected_sha256
      and config = expected_config
  ) then
    raise exception 'Conflicting immutable economy edition earned-collection@3'
      using errcode = '55000';
  end if;

  banner_config := expected_config -> 'acquisition' -> 'banner';
  guarantees_config := banner_config -> 'guarantees';

  -- The edition of record must itself declare the reviewed pool shape. Seeding
  -- version 4 from an edition that still described the 45-item pool is exactly
  -- the drift this block exists to prevent.
  if (
       select count(*)
       from jsonb_array_elements(banner_config -> 'tiers') as tier(value)
     ) is distinct from 4::bigint or
     (
       select jsonb_agg(
         jsonb_build_array(
           tier.value ->> 'tierId',
           (tier.value ->> 'weightUnits')::integer,
           jsonb_array_length(tier.value -> 'catalogItemIds')
         )
         order by (tier.value ->> 'rank')::integer
       )
       from jsonb_array_elements(banner_config -> 'tiers') as tier(value)
     ) is distinct from jsonb_build_array(
       jsonb_build_array('standard', 72, 24),
       jsonb_build_array('rare', 23, 27),
       jsonb_build_array('epic', 4, 18),
       jsonb_build_array('signature', 1, 12)
     ) then
    raise exception 'earned-collection@3 does not declare the reviewed 72/23/4/1 weights over a 24/27/18/12 pool'
      using errcode = '55000';
  end if;

  -- Pool membership moved; no guarantee boundary did.
  if (guarantees_config -> 'rareOrBetter' ->> 'hardGuaranteePull')::integer
       is distinct from 10 or
     (guarantees_config -> 'epicOrBetter' ->> 'hardGuaranteePull')::integer
       is distinct from 25 or
     (guarantees_config -> 'selectedFeaturedUnowned' ->> 'hardGuaranteePull')::integer
       is distinct from 20 then
    raise exception 'earned-collection@3 does not retain the reviewed 10/25/20 boundaries'
      using errcode = '55000';
  end if;

  -- The selected-featured pool is the whole signature tier, so a pull that
  -- reaches the 20-pull selected guarantee can award any signature die.
  if (guarantees_config -> 'selectedFeaturedUnowned' -> 'catalogItemIds')
       is distinct from (
         select tier.value -> 'catalogItemIds'
         from jsonb_array_elements(banner_config -> 'tiers') as tier(value)
         where tier.value ->> 'tierId' = 'signature'
       ) then
    raise exception 'earned-collection@3 selected-featured pool is not exactly its signature tier'
      using errcode = '55000';
  end if;

  -- ten-thousand-folds is reserved as the premium banner's featured candidate
  -- (2026-08-03-dice-content-wave-1.md §4.1). The 0.6% featured rate-up only
  -- works if the featured set is not also drawable from the standard banner, so
  -- its absence here is a reviewed decision rather than an omission.
  if exists (
    select 1
    from jsonb_array_elements(banner_config -> 'tiers') as tier(value),
         jsonb_array_elements_text(tier.value -> 'catalogItemIds') as item(catalog_item_id)
    where item.catalog_item_id like 'ten-thousand-folds/%'
  ) then
    raise exception 'earned-collection@3 leaked the reserved premium featured set into a standard tier'
      using errcode = '55000';
  end if;
end;
$seed$;

do $migration$
declare
  edition_config jsonb;
  source_banner public.pull_banner_versions%rowtype;
  target_banner public.pull_banner_versions%rowtype;
  tier_record record;
  policy_difference_count bigint;
  offer_difference_count bigint;
  tier_difference_count bigint;
  retired_item_count bigint;
  added_item_count bigint;
  mistiered_item_count bigint;
begin
  select config
  into strict edition_config
  from public.economy_editions
  where id = 'earned-collection@3';

  select *
  into strict source_banner
  from public.pull_banner_versions
  where id = 'earned-collection-001@3';

  -- Fail closed if the immutable predecessor is not the reviewed active
  -- standard source. IS DISTINCT FROM keeps every nullable comparison
  -- two-valued, including the three dormant soft-pity fields.
  if source_banner.banner_id is distinct from 'earned-collection-001' or
     source_banner.banner_version is distinct from 3 or
     source_banner.banner_family_id is distinct from 'earned-collection' or
     source_banner.banner_class is distinct from 'standard' or
     source_banner.roll_type is distinct from 'standard_roll' or
     source_banner.economy_edition_id is distinct from 'earned-collection@2' or
     source_banner.rare_hard_guarantee_pull is distinct from 10 or
     source_banner.epic_hard_guarantee_pull is distinct from 25 or
     source_banner.selected_hard_guarantee_pull is distinct from 20 or
     source_banner.soft_pity_model is not null or
     source_banner.soft_pity_start_pull is not null or
     source_banner.soft_pity_per_pull_increment is not null or
     (select count(*)
      from public.pull_banner_items
      where banner_version_id = source_banner.id) is distinct from 45::bigint or
     (select count(*)
      from public.pull_banner_items
      where banner_version_id = source_banner.id
        and selected_featured) is distinct from 6::bigint then
    raise exception 'earned-collection-001@3 is not the reviewed active standard source'
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
    'earned-collection-001@4',
    source.banner_id,
    4,
    source.banner_family_id,
    'earned-collection@3',
    'a1623cc4fd3c2b4d80bd41406a1a29bc90ba09bff5b3e98e58c474812b7ffc28',
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
    source.banner_class,
    source.roll_type,
    source.soft_pity_model,
    source.soft_pity_start_pull,
    source.soft_pity_per_pull_increment
  from public.pull_banner_versions as source
  where source.id = 'earned-collection-001@3';

  -- Ticket offers are a byte copy: the price of a pull did not change.
  insert into public.pull_banner_offers (
    banner_version_id,
    pull_count,
    cost
  )
  select
    'earned-collection-001@4',
    source.pull_count,
    source.cost
  from public.pull_banner_offers as source
  where source.banner_version_id = 'earned-collection-001@3'
  order by source.pull_count;

  -- Tiers and items are derived from the edition of record, the same way
  -- 0011_earned_pull_preparation.sql seeded version 1. The diff assertions
  -- below then prove the derived weights and duplicate amounts are identical to
  -- version 3's, so only membership moved.
  insert into public.pull_banner_tiers (
    banner_version_id,
    tier_id,
    tier_rank,
    weight_units,
    duplicate_dust
  )
  select
    'earned-collection-001@4',
    tier.value ->> 'tierId',
    (tier.value ->> 'rank')::smallint,
    (tier.value ->> 'weightUnits')::integer,
    (edition_config #>> array['duplicateConversion', 'amountByTier', tier.value ->> 'tierId'])::bigint
  from jsonb_array_elements(edition_config -> 'acquisition' -> 'banner' -> 'tiers') as tier(value)
  order by (tier.value ->> 'rank')::smallint;

  for tier_record in
    select tier.value as tier
    from jsonb_array_elements(edition_config -> 'acquisition' -> 'banner' -> 'tiers') as tier(value)
    order by (tier.value ->> 'rank')::smallint
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
      'earned-collection-001@4',
      tier_record.tier ->> 'tierId',
      (tier_record.tier ->> 'rank')::smallint,
      item.ordinality::integer,
      item.catalog_item_id,
      (edition_config #> array[
        'acquisition', 'banner', 'guarantees', 'selectedFeaturedUnowned', 'catalogItemIds'
      ]) ? item.catalog_item_id
    from jsonb_array_elements_text(tier_record.tier -> 'catalogItemIds')
      with ordinality as item(catalog_item_id, ordinality);
  end loop;

  select *
  into strict target_banner
  from public.pull_banner_versions
  where id = 'earned-collection-001@4';

  -- Compare every policy field except the two deliberately re-anchored.
  select count(*)
  into policy_difference_count
  from (
    select
      source.banner_id,
      source.banner_family_id,
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
      source.banner_class,
      source.roll_type,
      source.soft_pity_model,
      source.soft_pity_start_pull,
      source.soft_pity_per_pull_increment
    from public.pull_banner_versions as source
    where source.id = 'earned-collection-001@3'
    except
    select
      target.banner_id,
      target.banner_family_id,
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
      target.banner_class,
      target.roll_type,
      target.soft_pity_model,
      target.soft_pity_start_pull,
      target.soft_pity_per_pull_increment
    from public.pull_banner_versions as target
    where target.id = 'earned-collection-001@4'
  ) as policy_difference;

  if policy_difference_count is distinct from 0::bigint or
     target_banner.banner_version is distinct from 4 or
     target_banner.rare_hard_guarantee_pull is distinct from 10 or
     target_banner.epic_hard_guarantee_pull is distinct from 25 or
     target_banner.selected_hard_guarantee_pull is distinct from 20 then
    raise exception 'earned-collection-001@4 policy drifted beyond the wave-1 pool expansion'
      using errcode = '55000';
  end if;

  -- Version 4 must attest the production edition that actually declares the
  -- expanded pool. Copying version 3's anchor would leave the shipped odds
  -- attested by a 45-item edition of record.
  if target_banner.economy_edition_id is distinct from 'earned-collection@3' or
     target_banner.source_config_sha256 is distinct from
       'a1623cc4fd3c2b4d80bd41406a1a29bc90ba09bff5b3e98e58c474812b7ffc28' or
     target_banner.source_config_sha256 is not distinct from
       source_banner.source_config_sha256 or
     (select config_sha256
      from public.economy_editions
      where id = target_banner.economy_edition_id) is distinct from
       target_banner.source_config_sha256 then
    raise exception 'earned-collection-001@4 is not anchored to the wave-1 economy edition'
      using errcode = '55000';
  end if;

  select count(*)
  into offer_difference_count
  from (
    (
      select pull_count, cost
      from public.pull_banner_offers
      where banner_version_id = 'earned-collection-001@3'
      except
      select pull_count, cost
      from public.pull_banner_offers
      where banner_version_id = 'earned-collection-001@4'
    )
    union all
    (
      select pull_count, cost
      from public.pull_banner_offers
      where banner_version_id = 'earned-collection-001@4'
      except
      select pull_count, cost
      from public.pull_banner_offers
      where banner_version_id = 'earned-collection-001@3'
    )
  ) as offer_difference;

  select count(*)
  into tier_difference_count
  from (
    (
      select tier_id, tier_rank, weight_units, duplicate_dust
      from public.pull_banner_tiers
      where banner_version_id = 'earned-collection-001@3'
      except
      select tier_id, tier_rank, weight_units, duplicate_dust
      from public.pull_banner_tiers
      where banner_version_id = 'earned-collection-001@4'
    )
    union all
    (
      select tier_id, tier_rank, weight_units, duplicate_dust
      from public.pull_banner_tiers
      where banner_version_id = 'earned-collection-001@4'
      except
      select tier_id, tier_rank, weight_units, duplicate_dust
      from public.pull_banner_tiers
      where banner_version_id = 'earned-collection-001@3'
    )
  ) as tier_difference;

  -- canonical_order is deliberately excluded: appending items re-indexes the
  -- within-tier draw order of an already-immutable version-3 row set. What must
  -- hold is that no version-3 item was dropped, re-tiered, or lost its
  -- selected-featured flag, and that every added row is genuinely new.
  select count(*)
  into retired_item_count
  from (
    select tier_id, tier_rank, catalog_item_id, selected_featured
    from public.pull_banner_items
    where banner_version_id = 'earned-collection-001@3'
    except
    select tier_id, tier_rank, catalog_item_id, selected_featured
    from public.pull_banner_items
    where banner_version_id = 'earned-collection-001@4'
  ) as retired_items;

  select count(*)
  into added_item_count
  from (
    select tier_id, tier_rank, catalog_item_id, selected_featured
    from public.pull_banner_items
    where banner_version_id = 'earned-collection-001@4'
    except
    select tier_id, tier_rank, catalog_item_id, selected_featured
    from public.pull_banner_items
    where banner_version_id = 'earned-collection-001@3'
  ) as added_items;

  -- Tier rank binds to catalog rarity: standard takes common/uncommon, rare
  -- takes rare, epic takes epic, signature takes legendary. This is the DB-side
  -- twin of the tier definitions in scripts/validate-production-economy.js, so
  -- a mis-tiered die fails at apply time rather than at pull time.
  select count(*)
  into mistiered_item_count
  from public.pull_banner_items as items
  join public.catalog_items as catalog
    on catalog.id = items.catalog_item_id
  where items.banner_version_id = 'earned-collection-001@4'
    -- coalesce to an empty array so an unrecognized tier id counts as
    -- mis-tiered instead of vanishing through a NULL comparison.
    and not (catalog.rarity = any (coalesce(
      case items.tier_id
        when 'standard' then array['common', 'uncommon']
        when 'rare' then array['rare']
        when 'epic' then array['epic']
        when 'signature' then array['legendary']
      end,
      array[]::text[]
    )));

  if offer_difference_count is distinct from 0::bigint or
     tier_difference_count is distinct from 0::bigint or
     retired_item_count is distinct from 0::bigint or
     added_item_count is distinct from 36::bigint or
     mistiered_item_count is distinct from 0::bigint or
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
      where banner_version_id = target_banner.id) is distinct from 81::bigint or
     (select count(*)
      from public.pull_banner_items
      where banner_version_id = target_banner.id
        and tier_id = 'standard') is distinct from 24::bigint or
     (select count(*)
      from public.pull_banner_items
      where banner_version_id = target_banner.id
        and tier_id = 'rare') is distinct from 27::bigint or
     (select count(*)
      from public.pull_banner_items
      where banner_version_id = target_banner.id
        and tier_id = 'epic') is distinct from 18::bigint or
     (select count(*)
      from public.pull_banner_items
      where banner_version_id = target_banner.id
        and tier_id = 'signature') is distinct from 12::bigint or
     (select count(*)
      from public.pull_banner_items
      where banner_version_id = target_banner.id
        and selected_featured) is distinct from 12::bigint or
     exists (
       select 1
       from public.pull_banner_items
       where banner_version_id = target_banner.id
         and selected_featured
         and tier_rank <> 3
     ) or
     exists (
       select 1
       from public.pull_banner_items
       where banner_version_id = target_banner.id
         and catalog_item_id like 'ten-thousand-folds/%'
     ) then
    raise exception 'earned-collection-001@4 offers, tiers, or items are not the reviewed wave-1 expansion'
      using errcode = '55000';
  end if;
end;
$migration$;
