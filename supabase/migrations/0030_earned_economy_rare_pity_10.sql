-- Migration: 0030_earned_economy_rare_pity_10
-- Move the active standard banner's rare hard guarantee from pull 8 to pull 10.
--
-- A production rate change appends the next contiguous production edition and
-- anchors it to this migration (docs/guides/economy-contracts.md). Version 3
-- therefore attests earned-collection@2 instead of re-using the 8-pull source
-- hash of version 2, byte-copies version 2's ticket offers, pool, weights,
-- duplicate policy, and every other guarantee setting, and changes only its
-- append-only identity, rare hard boundary, and edition anchor. Existing
-- family-scoped guarantee counters carry into the highest version.
--
-- The preparation engine is re-created at the end so that only the highest
-- version of a banner family stays player-callable: without that guard the
-- superseded 8-pull version 2 would remain reachable at the same ticket price.

-- ---------------------------------------------------------------------------
-- Seed immutable production edition 0002.
--
-- The source JSON and this embedded block are checked byte-semantically by
-- scripts/validate-production-economy.js. ON CONFLICT permits migration replay
-- only when the already-published id, hash, and JSON are identical.
-- ---------------------------------------------------------------------------
do $seed$
declare
  expected_config constant jsonb :=
-- BEGIN EARNED ECONOMY EDITION 0002
$edition$
{
  "schemaVersion": 1,
  "edition": 2,
  "editionId": "earned-collection@2",
  "slug": "earned-collection",
  "purpose": "production",
  "migration": "0030_earned_economy_rare_pity_10.sql",
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
-- END EARNED ECONOMY EDITION 0002
  ;
  expected_sha256 constant text :=
    '62232a0a8913c8162ee0733532b0ce3c034fe2c9eda7276c6d2b7b4e37ca8626';
begin
  insert into public.economy_editions
    (id, edition_version, config_sha256, config)
  values
    ('earned-collection@2', 2, expected_sha256, expected_config)
  on conflict (id) do nothing;

  if not exists (
    select 1
    from public.economy_editions
    where id = 'earned-collection@2'
      and edition_version = 2
      and config_sha256 = expected_sha256
      and config = expected_config
  ) then
    raise exception 'Conflicting immutable economy edition earned-collection@2'
      using errcode = '55000';
  end if;

  -- The edition of record must itself declare the reviewed boundary. Anchoring
  -- version 3 to an edition that still said 8 is exactly the drift this seed
  -- exists to prevent.
  if (
    expected_config -> 'acquisition' -> 'banner' -> 'guarantees'
      -> 'rareOrBetter' ->> 'hardGuaranteePull'
  )::integer is distinct from 10 or
     (expected_config -> 'acquisition' -> 'banner' -> 'guarantees'
        -> 'epicOrBetter' ->> 'hardGuaranteePull')::integer is distinct from 25 or
     (expected_config -> 'acquisition' -> 'banner' -> 'guarantees'
        -> 'selectedFeaturedUnowned' ->> 'hardGuaranteePull')::integer
       is distinct from 20 then
    raise exception 'earned-collection@2 does not declare the reviewed 10/25/20 boundaries'
      using errcode = '55000';
  end if;
end;
$seed$;
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
     source_banner.economy_edition_id is distinct from 'earned-collection@1' or
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
    'earned-collection@2',
    '62232a0a8913c8162ee0733532b0ce3c034fe2c9eda7276c6d2b7b4e37ca8626',
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

  -- Version 3 must attest the production edition that actually declares the
  -- 10-pull boundary. Copying version 2's anchor would leave the shipped rate
  -- attested by an 8-pull edition of record.
  if target_banner.economy_edition_id is distinct from 'earned-collection@2' or
     target_banner.source_config_sha256 is distinct from
       '62232a0a8913c8162ee0733532b0ce3c034fe2c9eda7276c6d2b7b4e37ca8626' or
     target_banner.source_config_sha256 is not distinct from
       source_banner.source_config_sha256 or
     (select config_sha256
      from public.economy_editions
      where id = target_banner.economy_edition_id) is distinct from
       target_banner.source_config_sha256 or
     (select (config -> 'acquisition' -> 'banner' -> 'guarantees'
                -> 'rareOrBetter' ->> 'hardGuaranteePull')::integer
      from public.economy_editions
      where id = target_banner.economy_edition_id) is distinct from
       target_banner.rare_hard_guarantee_pull then
    raise exception 'earned-collection-001@3 is not anchored to the 10-pull economy edition'
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

-- ---------------------------------------------------------------------------
-- Only the active version of a banner family may be prepared.
--
-- Copy of the canonical 0021 preparation body. Only the declarations and the
-- active-version guard below the premium gate differ. The guard lives inside
-- the trusted engine, not in public.prepare_pull, so hand-built callers and
-- future wrappers cannot reach a superseded version either. Sessions already
-- store their banner at preparation, so commit/reveal semantics are unchanged.
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
  soft_pity_upgraded boolean;
  soft_pity_base_rate numeric;
  soft_pity_target_rate numeric;
  soft_pity_excess_rate numeric;
  soft_pity_upgrade_draw integer;
  soft_pity_upgrade_threshold integer;
  soft_pity_draw_scale integer := 1000000000;
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
  active_banner_version integer;
  active_banner_count bigint;
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

  -- Premium random pulls remain legally gated by issue #154. This guard is
  -- deliberately inside the trusted preparation engine so hand-inserted rows
  -- cannot make that path reachable.
  if banner.banner_class = 'premium' then
    raise exception 'Premium banner preparation is disabled pending issue #154'
      using errcode = '55000';
  end if;

  -- A banner family is append-only and only its highest version is live, the
  -- same rule 0025_pity_read.sql uses to resolve the active version. Resolving
  -- the request by banner id alone would leave every superseded version
  -- player-callable, so a retired version -- for example an older, more
  -- generous rare guarantee offered at the identical ticket price -- fails
  -- closed here, before the account lock and before any hold can exist.
  --
  -- ASSUMPTION (economy model), identical to the pity read: one banner_family_id
  -- holds exactly one banner lineage. Two lineages sharing a top version are
  -- rejected rather than mis-selected. Replace this with an explicit
  -- active-banner marker if multi-lineage families are ever introduced.
  select max(versions.banner_version)
  into active_banner_version
  from public.pull_banner_versions as versions
  where versions.banner_family_id = banner.banner_family_id;

  select count(*)
  into active_banner_count
  from public.pull_banner_versions as versions
  where versions.banner_family_id = banner.banner_family_id
    and versions.banner_version = active_banner_version;

  if active_banner_count is distinct from 1::bigint then
    raise exception 'Ambiguous active pull banner version for family %',
      banner.banner_family_id
      using errcode = '55000';
  end if;

  if banner.banner_version is distinct from active_banner_version then
    raise exception 'Pull banner version % is superseded by version % of family %',
      banner.id, active_banner_version, banner.banner_family_id
      using errcode = '55000';
  end if;

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
      and not exists (
        select 1
        from public.pull_session_transitions as transitions
        where transitions.session_id = pull_sessions.id
      )
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

  if banner.roll_type is null then
    select balances.current_balance into current_balance
    from public.wallet_balances as balances
    where balances.account_id = target_account.id
      and balances.currency_id = banner.currency_id
      and balances.balance_bucket = banner.balance_bucket;
    current_balance := coalesce(current_balance, 0);

    select coalesce(sum(sessions.held_amount), 0) into active_holds
    from public.pull_sessions as sessions
    join public.pull_banner_versions as held_banners
      on held_banners.id = sessions.banner_version_id
     and held_banners.roll_type is null
    where sessions.account_id = target_account.id
      and sessions.currency_id = banner.currency_id
      and sessions.balance_bucket = banner.balance_bucket
      and sessions.prepared_at <= decision_at
      and sessions.expires_at > decision_at
      and not exists (
        select 1
        from public.pull_session_transitions as transitions
        where transitions.session_id = sessions.id
      );

    if current_balance - active_holds < target_cost then
      raise exception 'Insufficient available promotional Stars after active holds'
        using errcode = '22003';
    end if;
  else
    if target_cost <> p_pull_count::bigint then
      raise exception 'Ticket-funded offer cost must equal its pull count'
        using errcode = '55000';
    end if;

    select balances.current_quantity into current_balance
    from public.roll_ticket_balances as balances
    where balances.user_id = p_user_id
      and balances.roll_type = banner.roll_type;
    current_balance := coalesce(current_balance, 0);

    select coalesce(sum(sessions.held_amount), 0) into active_holds
    from public.pull_sessions as sessions
    join public.pull_banner_versions as held_banners
      on held_banners.id = sessions.banner_version_id
     and held_banners.roll_type = banner.roll_type
    where sessions.user_id = p_user_id
      and sessions.prepared_at <= decision_at
      and sessions.expires_at > decision_at
      and not exists (
        select 1
        from public.pull_session_transitions as transitions
        where transitions.session_id = sessions.id
      );

    if current_balance - active_holds < p_pull_count then
      raise exception 'Insufficient available % roll tickets after active holds',
        banner.roll_type
        using errcode = '22003';
    end if;

    -- Preparation reserves tickets only. The future commit/reveal boundary
    -- must debit them there without double-counting this active hold.
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
        from public.dice_copies as copies
        where copies.user_id = p_user_id
          and copies.catalog_item_id = items.catalog_item_id
          and copies.scrapped_at is null
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
      soft_pity_upgraded := false;

      -- A configured ramp upgrades to the selected unowned signature before
      -- the canonical minimum-rank tier/item draw. selected_due was computed
      -- above and still takes precedence over this branch.
      if not selected_due and
         banner.soft_pity_model = 'linear-rate-ramp' and
         selected_item.catalog_item_id is not null and
         not exists (
           select 1
           from public.dice_copies as copies
           where copies.user_id = p_user_id
             and copies.catalog_item_id = selected_item.catalog_item_id
             and copies.scrapped_at is null
         ) and
         not (selected_item.catalog_item_id = any(projected_catalog_item_ids)) and
         selected_cursor + 1 >= banner.soft_pity_start_pull then
        -- The fixed base is the selected signature tier's full-banner weight,
        -- normalized by all banner tiers even when an epic/rare minimum-rank
        -- guarantee is also due.
        select tiers.weight_units::numeric / (
            select sum(all_tiers.weight_units)::numeric
            from public.pull_banner_tiers as all_tiers
            where all_tiers.banner_version_id = banner.id
          )
          into strict soft_pity_base_rate
        from public.pull_banner_tiers as tiers
        where tiers.banner_version_id = banner.id
          and tiers.tier_id = selected_item.tier_id;

        if soft_pity_base_rate < 1 then
          soft_pity_target_rate := least(
            1::numeric,
            soft_pity_base_rate +
              banner.soft_pity_per_pull_increment *
              (selected_cursor + 1 - banner.soft_pity_start_pull + 1)::numeric
          );
          soft_pity_excess_rate :=
            (soft_pity_target_rate - soft_pity_base_rate) /
            (1::numeric - soft_pity_base_rate);

          -- Match the design simulator's billion-point integer draw. floor()
          -- deliberately rounds the favorable threshold down.
          soft_pity_upgrade_threshold := floor(
            soft_pity_excess_rate * soft_pity_draw_scale::numeric
          )::integer;
          soft_pity_upgrade_draw := private.pull_seeded_uint32_below(
            pull_seed,
            target_session_id,
            position::smallint,
            'soft-pity-upgrade',
            soft_pity_draw_scale
          );

          if soft_pity_upgrade_draw < soft_pity_upgrade_threshold then
            target_item := selected_item;
            if epic_due then
              resolution_reason := 'epic-guarantee';
            elsif rare_due then
              resolution_reason := 'rare-guarantee';
            else
              resolution_reason := 'soft-pity';
            end if;
            soft_pity_upgraded := true;
          end if;
        end if;
      end if;

      -- Keep this canonical 0017 block byte-identical. A NULL ramp or failed
      -- upgrade reaches the same labeled tier/item draws in the same order.
      if not soft_pity_upgraded then
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
    end if;

    result_is_duplicate := target_item.catalog_item_id = any(projected_catalog_item_ids) or exists (
      select 1
      from public.dice_copies as copies
      where copies.user_id = p_user_id
        and copies.catalog_item_id = target_item.catalog_item_id
        and copies.scrapped_at is null
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
