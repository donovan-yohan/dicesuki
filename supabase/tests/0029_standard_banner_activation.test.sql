begin;

insert into auth.users (id) values
  ('d0290000-0000-4029-8029-000000000001');

-- This is the exact relational shape used by fetchActiveStandardPullBanner:
-- same projection, predicates, and descending version order.
create temporary table slice20_standard_discovery
on commit drop
as
select
  id,
  banner_id,
  banner_version,
  banner_family_id,
  banner_class,
  roll_type
from public.pull_banner_versions
where banner_class = 'standard'
  and roll_type = 'standard_roll'
order by banner_version desc;

do $$
declare
  discovered record;
begin
  select *
  into strict discovered
  from pg_temp.slice20_standard_discovery
  order by banner_version desc, id
  limit 1;

  if (select count(*) from pg_temp.slice20_standard_discovery) is distinct from 2::bigint or
     discovered.id is distinct from 'earned-collection-001@3' or
     discovered.banner_id is distinct from 'earned-collection-001' or
     discovered.banner_version is distinct from 3 or
     discovered.banner_family_id is distinct from 'earned-collection' or
     discovered.banner_class is distinct from 'standard' or
     discovered.roll_type is distinct from 'standard_roll' then
    raise exception 'Standard discovery query did not return active earned-collection-001@3';
  end if;
end;
$$;

-- Runtime NULL-hole and byte-copy audit. Every touched nullable value is
-- checked with IS [NOT] NULL or IS DISTINCT FROM, never nullable equality.
do $$
declare
  source_banner public.pull_banner_versions%rowtype;
  target_banner public.pull_banner_versions%rowtype;
begin
  select * into strict source_banner
  from public.pull_banner_versions
  where id = 'earned-collection-001@1';

  select * into strict target_banner
  from public.pull_banner_versions
  where id = 'earned-collection-001@2';

  if source_banner.banner_family_id is distinct from target_banner.banner_family_id or
     source_banner.economy_edition_id is distinct from target_banner.economy_edition_id or
     source_banner.source_config_sha256 is distinct from target_banner.source_config_sha256 or
     source_banner.hold_policy_id is distinct from target_banner.hold_policy_id or
     source_banner.currency_id is distinct from target_banner.currency_id or
     source_banner.balance_bucket is distinct from target_banner.balance_bucket or
     source_banner.duplicate_currency_id is distinct from target_banner.duplicate_currency_id or
     source_banner.duplicate_balance_bucket is distinct from target_banner.duplicate_balance_bucket or
     source_banner.weight_scale is distinct from target_banner.weight_scale or
     source_banner.rare_minimum_rank is distinct from target_banner.rare_minimum_rank or
     source_banner.rare_hard_guarantee_pull is distinct from target_banner.rare_hard_guarantee_pull or
     source_banner.epic_minimum_rank is distinct from target_banner.epic_minimum_rank or
     source_banner.epic_hard_guarantee_pull is distinct from target_banner.epic_hard_guarantee_pull or
     source_banner.selected_minimum_rank is distinct from target_banner.selected_minimum_rank or
     source_banner.selected_hard_guarantee_pull is distinct from target_banner.selected_hard_guarantee_pull or
     source_banner.resolution_order is distinct from target_banner.resolution_order or
     target_banner.banner_class is distinct from 'standard' or
     target_banner.roll_type is distinct from 'standard_roll' or
     target_banner.soft_pity_model is not null or
     target_banner.soft_pity_start_pull is not null or
     target_banner.soft_pity_per_pull_increment is not null or
     exists (
       select 1
       from public.pull_banner_offers
       where banner_version_id = target_banner.id
         and (
           pull_count is null or
           cost is null or
           cost is distinct from pull_count::bigint
         )
     ) or
     exists (
       select 1
       from public.pull_banner_tiers
       where banner_version_id = target_banner.id
         and (
           tier_id is null or
           tier_rank is null or
           weight_units is null or
           duplicate_dust is null
         )
     ) or
     exists (
       select 1
       from public.pull_banner_items
       where banner_version_id = target_banner.id
         and (
           tier_id is null or
           tier_rank is null or
           canonical_order is null or
           catalog_item_id is null or
           selected_featured is null
         )
     ) then
    raise exception 'Standard activation NULL-hole audit failed';
  end if;
end;
$$;

-- The same user proves both compatibility paths in sequence. Stars fund the
-- explicit legacy @1 preparation; tickets fund @2. A distinctive family row
-- is present before @1, then @1's committed projection becomes @2's exact
-- before-state.
set local role service_role;

do $$
begin
  perform public.append_wallet_ledger_entry(
    'd0290000-0000-4029-8029-000000000001',
    'stars',
    'promotional',
    160,
    'test.slice20.stars.seed',
    'slice20:stars:seed:0001',
    'earned-collection@1',
    '{}'::jsonb
  );

  perform public.record_roll_ticket_ledger_entry(
    'd0290000-0000-4029-8029-000000000001',
    'standard_roll',
    11,
    'test.slice20.ticket.seed',
    'slice20:ticket:seed:0001',
    '{}'::jsonb
  );
end;
$$;

reset role;

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
  'earned-collection',
  40,
  2,
  3,
  4
from public.wallet_accounts as account
where account.user_id = 'd0290000-0000-4029-8029-000000000001';

set local "request.jwt.claims" =
  '{"sub":"d0290000-0000-4029-8029-000000000001","is_anonymous":false}';
set local role authenticated;

-- Create the lifecycle carrier under the same role that writes it. The owner
-- session resumes after RESET ROLE for privileged projection assertions.
create temporary table slice20_lifecycle_ctx (
  old_session_id uuid not null,
  new_session_id uuid not null,
  old_total_pulls bigint not null,
  old_rare_misses bigint not null,
  old_epic_misses bigint not null,
  old_selected_misses bigint not null,
  new_total_pulls bigint not null,
  new_rare_misses bigint not null,
  new_epic_misses bigint not null,
  new_selected_misses bigint not null
) on commit drop;

do $$
declare
  prepared record;
  old_pity record;
  new_pity record;
  receipt jsonb;
begin
  select * into strict prepared
  from public.prepare_pull(
    'earned-collection-001@1',
    1::smallint,
    'slice20:legacy:prepare:0001'
  );

  if prepared.banner_version_id is distinct from 'earned-collection-001@1' or
     prepared.held_amount is distinct from 160::bigint or
     (select current_balance
      from public.wallet_balances
      where user_id = 'd0290000-0000-4029-8029-000000000001'
        and currency_id = 'stars'
        and balance_bucket = 'promotional') is distinct from 160::bigint or
     (select current_quantity
      from public.roll_ticket_balances
      where user_id = 'd0290000-0000-4029-8029-000000000001'
        and roll_type = 'standard_roll') is distinct from 11::bigint then
    raise exception 'Legacy Stars-funded version @1 did not prepare and commit under NULL roll binding';
  end if;

  receipt := public.commit_pull_session(prepared.session_id);

  if receipt ->> 'banner_version_id' is distinct from 'earned-collection-001@1' or
     (receipt ->> 'held_amount')::bigint is distinct from 160::bigint or
     jsonb_array_length(receipt -> 'results') is distinct from 1 then
    raise exception 'Legacy Stars-funded version @1 did not prepare and commit under NULL roll binding';
  end if;

  select * into strict old_pity
  from public.get_my_pull_pity('earned-collection');

  if old_pity.banner_version_id is distinct from 'earned-collection-001@3' or
     old_pity.banner_version is distinct from 3 or
     (select current_balance
      from public.wallet_balances
      where user_id = 'd0290000-0000-4029-8029-000000000001'
        and currency_id = 'stars'
        and balance_bucket = 'promotional') is distinct from 0::bigint or
     (select current_quantity
      from public.roll_ticket_balances
      where user_id = 'd0290000-0000-4029-8029-000000000001'
        and roll_type = 'standard_roll') is distinct from 11::bigint then
    raise exception 'Legacy Stars-funded version @1 did not prepare and commit under NULL roll binding';
  end if;

  insert into pg_temp.slice20_lifecycle_ctx (
    old_session_id,
    new_session_id,
    old_total_pulls,
    old_rare_misses,
    old_epic_misses,
    old_selected_misses,
    new_total_pulls,
    new_rare_misses,
    new_epic_misses,
    new_selected_misses
  ) values (
    prepared.session_id,
    '00000000-0000-4000-8000-000000000000',
    old_pity.total_pulls,
    old_pity.rare_misses,
    old_pity.epic_misses,
    old_pity.selected_misses,
    0,
    0,
    0,
    0
  );

  select * into strict prepared
  from public.prepare_pull(
    'earned-collection-001@2',
    10::smallint,
    'slice20:standard:prepare:0002'
  );

  if prepared.banner_version_id is distinct from 'earned-collection-001@2' or
     prepared.pull_count is distinct from 10::smallint or
     prepared.held_amount is distinct from 10::bigint or
     (select current_quantity
      from public.roll_ticket_balances
      where user_id = 'd0290000-0000-4029-8029-000000000001'
        and roll_type = 'standard_roll') is distinct from 11::bigint or
     (select current_balance
      from public.wallet_balances
      where user_id = 'd0290000-0000-4029-8029-000000000001'
        and currency_id = 'stars'
        and balance_bucket = 'promotional') is distinct from 0::bigint then
    raise exception 'Version @2 did not reserve ten standard-roll tickets without touching Stars';
  end if;

  receipt := public.commit_pull_session(prepared.session_id);

  if receipt ->> 'banner_version_id' is distinct from 'earned-collection-001@2' or
     (receipt ->> 'held_amount')::bigint is distinct from 10::bigint or
     (receipt ->> 'pull_count')::integer is distinct from 10 or
     jsonb_array_length(receipt -> 'results') is distinct from 10 then
    raise exception 'Version @2 commit did not grant ten copies and debit exactly ten tickets';
  end if;

  select * into strict new_pity
  from public.get_my_pull_pity('earned-collection');

  if new_pity.banner_family_id is distinct from 'earned-collection' or
     new_pity.banner_version_id is distinct from 'earned-collection-001@3' or
     new_pity.banner_version is distinct from 3 or
     new_pity.rare_hard_guarantee_pull is distinct from 10 or
     new_pity.epic_hard_guarantee_pull is distinct from 25 or
     new_pity.selected_hard_guarantee_pull is distinct from 20 or
     new_pity.soft_pity_model is not null or
     new_pity.soft_pity_start_pull is not null or
     new_pity.soft_pity_per_pull_increment is not null then
    raise exception 'Pity read did not expose active version @3 counters, shallow thresholds, and NULL soft pity';
  end if;

  update pg_temp.slice20_lifecycle_ctx
  set new_session_id = prepared.session_id,
      new_total_pulls = new_pity.total_pulls,
      new_rare_misses = new_pity.rare_misses,
      new_epic_misses = new_pity.epic_misses,
      new_selected_misses = new_pity.selected_misses;
end;
$$;

reset role;

do $$
declare
  ctx pg_temp.slice20_lifecycle_ctx%rowtype;
  old_session public.pull_sessions%rowtype;
  new_session public.pull_sessions%rowtype;
begin
  select * into strict ctx from pg_temp.slice20_lifecycle_ctx;
  select * into strict old_session
  from public.pull_sessions
  where id = ctx.old_session_id;
  select * into strict new_session
  from public.pull_sessions
  where id = ctx.new_session_id;

  if row(
       old_session.total_pulls_before,
       old_session.rare_misses_before,
       old_session.epic_misses_before,
       old_session.selected_misses_before
     ) is distinct from row(40::bigint, 2::bigint, 3::bigint, 4::bigint) or
     row(
       ctx.old_total_pulls,
       ctx.old_rare_misses,
       ctx.old_epic_misses,
       ctx.old_selected_misses
     ) is distinct from row(
       old_session.total_pulls_projected,
       old_session.rare_misses_projected,
       old_session.epic_misses_projected,
       old_session.selected_misses_projected
     ) or
     row(
       new_session.total_pulls_before,
       new_session.rare_misses_before,
       new_session.epic_misses_before,
       new_session.selected_misses_before
     ) is distinct from row(
       old_session.total_pulls_projected,
       old_session.rare_misses_projected,
       old_session.epic_misses_projected,
       old_session.selected_misses_projected
     ) or
     row(
       ctx.new_total_pulls,
       ctx.new_rare_misses,
       ctx.new_epic_misses,
       ctx.new_selected_misses
     ) is distinct from row(
       new_session.total_pulls_projected,
       new_session.rare_misses_projected,
       new_session.epic_misses_projected,
       new_session.selected_misses_projected
     ) then
    raise exception 'Version @2 did not continue every family counter from version @1';
  end if;

  if (select current_quantity
      from public.roll_ticket_balances
      where user_id = 'd0290000-0000-4029-8029-000000000001'
        and roll_type = 'standard_roll') is distinct from 1::bigint or
     (select count(*)
      from public.roll_ticket_ledger_entries
      where user_id = 'd0290000-0000-4029-8029-000000000001'
        and roll_type = 'standard_roll'
        and delta_quantity = -10
        and reason_code = 'pull.commit.standard_roll.debit') is distinct from 1::bigint or
     (select count(*)
      from public.wallet_ledger_entries
      where user_id = 'd0290000-0000-4029-8029-000000000001'
        and currency_id = 'stars'
        and balance_bucket = 'promotional') is distinct from 2::bigint or
     (select count(*)
      from public.wallet_ledger_entries
      where user_id = 'd0290000-0000-4029-8029-000000000001'
        and reason_code = 'pull.commit.stars.debit') is distinct from 1::bigint or
     (select count(*)
      from public.dice_copies
      where user_id = 'd0290000-0000-4029-8029-000000000001'
        and source_kind = 'pull') is distinct from 11::bigint or
     (select count(*)
      from public.dice_copies
      where user_id = 'd0290000-0000-4029-8029-000000000001'
        and source_kind = 'pull'
        and source_reference like
          'pull-session:' || ctx.new_session_id::text || ':result:%') is distinct from 10::bigint then
    raise exception 'Version @2 commit did not grant ten copies and debit exactly ten tickets';
  end if;
end;
$$;

-- A test-only premium row needs no offers: the trusted engine must reject its
-- class immediately after lookup, before any funding or pool access.
insert into public.pull_banner_families (id)
values ('slice20-premium-fixture');

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
  'slice20-premium-fixture@1',
  'slice20-premium-fixture',
  1,
  'slice20-premium-fixture',
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
  'premium',
  'premium_roll',
  null,
  null,
  null
from public.pull_banner_versions as source
where source.id = 'earned-collection-001@2';

set local "request.jwt.claims" =
  '{"sub":"d0290000-0000-4029-8029-000000000001","is_anonymous":false}';
set local role authenticated;

do $$
begin
  begin
    perform public.prepare_pull(
      'slice20-premium-fixture@1',
      1::smallint,
      'slice20:premium:blocked:0001'
    );
    raise exception 'Premium preparation no longer failed closed';
  exception when sqlstate '55000' then
    if sqlerrm is distinct from
       'Premium banner preparation is disabled pending issue #154' then
      raise exception 'Premium preparation no longer failed closed';
    end if;
  end;
end;
$$;

rollback;
