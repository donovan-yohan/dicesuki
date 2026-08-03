begin;

-- Active-version fixture. 0030_earned_economy_rare_pity_10.sql restricted
-- preparation to a banner family's single highest version, and the
-- earned-collection family now heads at the ticket-funded
-- earned-collection-001@4. The Stars-funded preparation this suite proves is
-- therefore exercised on an appended test-only family that clones
-- earned-collection-001@1 byte for byte and heads its own lineage. Banner
-- history stays append-only: nothing published is rewritten.
insert into public.pull_banner_families (id) values ('slice6-conversion-stars');

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
  'slice6-conversion-stars@1',
  'slice6-conversion-stars',
  1,
  'slice6-conversion-stars',
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
from public.pull_banner_versions
where id = 'earned-collection-001@1';

insert into public.pull_banner_offers (banner_version_id, pull_count, cost)
select 'slice6-conversion-stars@1', pull_count, cost
from public.pull_banner_offers
where banner_version_id = 'earned-collection-001@1';

insert into public.pull_banner_tiers (
  banner_version_id,
  tier_id,
  tier_rank,
  weight_units,
  duplicate_dust
)
select 'slice6-conversion-stars@1', tier_id, tier_rank, weight_units, duplicate_dust
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
  'slice6-conversion-stars@1',
  tier_id,
  tier_rank,
  canonical_order,
  catalog_item_id,
  selected_featured
from public.pull_banner_items
where banner_version_id = 'earned-collection-001@1';

do $fixture$
begin
  if (select count(*) from public.pull_banner_offers
      where banner_version_id = 'slice6-conversion-stars@1') <>
     (select count(*) from public.pull_banner_offers
      where banner_version_id = 'earned-collection-001@1') or
     (select count(*) from public.pull_banner_items
      where banner_version_id = 'slice6-conversion-stars@1') <>
     (select count(*) from public.pull_banner_items
      where banner_version_id = 'earned-collection-001@1') or
     (select max(banner_version) from public.pull_banner_versions
      where banner_family_id = 'slice6-conversion-stars') <> 1 then
    raise exception 'Stars-funded active-version fixture is not a complete version-1 clone';
  end if;
end;
$fixture$;

insert into auth.users (id) values
  ('c1600000-0000-4160-8160-000000000001'),
  ('c1600000-0000-4160-8160-000000000002'),
  ('c1600000-0000-4160-8160-000000000003');

-- Seed promotional Stars through the canonical trusted ledger boundary.
do $$
declare
  target record;
begin
  for target in
    select * from (values
      (
        'c1600000-0000-4160-8160-000000000001'::uuid,
        800::bigint,
        'slice6:conversion:seed:success'
      ),
      (
        'c1600000-0000-4160-8160-000000000002'::uuid,
        159::bigint,
        'slice6:conversion:seed:insufficient'
      ),
      (
        'c1600000-0000-4160-8160-000000000003'::uuid,
        320::bigint,
        'slice6:conversion:seed:held'
      )
    ) as seeded(user_id, stars, idempotency_key)
  loop
    perform public.append_wallet_ledger_entry(
      target.user_id,
      'stars',
      'promotional',
      target.stars,
      'test.slice6.conversion.seed',
      target.idempotency_key,
      'earned-collection@1',
      '{}'::jsonb
    );
  end loop;
end;
$$;

-- 160 Stars per ticket, atomic two-ledger settlement, exact replay receipt,
-- and same-key request drift.
set local "request.jwt.claims" =
  '{"sub":"c1600000-0000-4160-8160-000000000001","is_anonymous":false}';
set local role authenticated;

do $$
declare
  first_receipt record;
  replay_receipt record;
begin
  select * into strict first_receipt
  from public.convert_stars_to_standard_roll(
    3,
    'slice6:conversion:success:0001'
  );

  select * into strict replay_receipt
  from public.convert_stars_to_standard_roll(
    3,
    'slice6:conversion:success:0001'
  );

  if row(
    first_receipt.wallet_ledger_entry_id,
    first_receipt.roll_ticket_ledger_entry_id,
    first_receipt.roll_count,
    first_receipt.stars_debited,
    first_receipt.promotional_stars_balance_after,
    first_receipt.standard_roll_tickets_credited,
    first_receipt.standard_roll_quantity_after
  ) is distinct from row(
    replay_receipt.wallet_ledger_entry_id,
    replay_receipt.roll_ticket_ledger_entry_id,
    replay_receipt.roll_count,
    replay_receipt.stars_debited,
    replay_receipt.promotional_stars_balance_after,
    replay_receipt.standard_roll_tickets_credited,
    replay_receipt.standard_roll_quantity_after
  ) or
     first_receipt.roll_count <> 3 or
     first_receipt.stars_debited <> 480 or
     first_receipt.promotional_stars_balance_after <> 320 or
     first_receipt.standard_roll_tickets_credited <> 3 or
     first_receipt.standard_roll_quantity_after <> 3 then
    raise exception 'Conversion or exact replay receipt was not exact';
  end if;

  begin
    perform public.convert_stars_to_standard_roll(
      2,
      'slice6:conversion:success:0001'
    );
    raise exception 'Same-key different-count conversion unexpectedly succeeded';
  exception when sqlstate '22023' then
    null;
  end;
end;
$$;

reset role;

do $$
begin
  if (select current_balance
      from public.wallet_balances
      where user_id = 'c1600000-0000-4160-8160-000000000001'
        and currency_id = 'stars'
        and balance_bucket = 'promotional') <> 320 or
     (select current_quantity
      from public.roll_ticket_balances
      where user_id = 'c1600000-0000-4160-8160-000000000001'
        and roll_type = 'standard_roll') <> 3 or
     (select count(*)
      from public.wallet_ledger_entries
      where user_id = 'c1600000-0000-4160-8160-000000000001') <> 2 or
     (select count(*)
      from public.roll_ticket_ledger_entries
      where user_id = 'c1600000-0000-4160-8160-000000000001') <> 1 or
     not exists (
       select 1
       from public.wallet_ledger_entries
       where user_id = 'c1600000-0000-4160-8160-000000000001'
         and delta_amount = -480
         and balance_before = 800
         and balance_after = 320
         and reason_code = 'conversion.stars_to_standard_roll.debit'
         and idempotency_key =
           'stars-to-standard-roll:wallet:slice6:conversion:success:0001'
     ) or
     not exists (
       select 1
       from public.roll_ticket_ledger_entries
       where user_id = 'c1600000-0000-4160-8160-000000000001'
         and roll_type = 'standard_roll'
         and delta_quantity = 3
         and quantity_before = 0
         and quantity_after = 3
         and reason_code = 'conversion.stars_to_standard_roll.credit'
         and idempotency_key =
           'stars-to-standard-roll:ticket:slice6:conversion:success:0001'
     ) then
    raise exception 'Conversion did not atomically reconcile both ledgers';
  end if;
end;
$$;

-- Raw insufficiency must leave no debit and no ticket credit.
set local "request.jwt.claims" =
  '{"sub":"c1600000-0000-4160-8160-000000000002","is_anonymous":false}';
set local role authenticated;

do $$
begin
  begin
    perform public.convert_stars_to_standard_roll(
      1,
      'slice6:conversion:insufficient:0001'
    );
    raise exception 'Insufficient-Stars conversion unexpectedly succeeded';
  exception when sqlstate '22003' then
    null;
  end;
end;
$$;

reset role;

do $$
begin
  if (select current_balance
      from public.wallet_balances
      where user_id = 'c1600000-0000-4160-8160-000000000002'
        and currency_id = 'stars'
        and balance_bucket = 'promotional') <> 159 or
     (select count(*)
      from public.wallet_ledger_entries
      where user_id = 'c1600000-0000-4160-8160-000000000002') <> 1 or
     exists (
       select 1
       from public.roll_ticket_ledger_entries
       where user_id = 'c1600000-0000-4160-8160-000000000002'
     ) then
    raise exception 'Rejected insufficient conversion left a partial effect';
  end if;
end;
$$;

-- A live legacy Stars pull reserves availability without debiting. Converting
-- all 320 nominal Stars would invade the 160-Star hold and must fail closed.
set local "request.jwt.claims" =
  '{"sub":"c1600000-0000-4160-8160-000000000003","is_anonymous":false}';
set local role authenticated;

do $$
declare
  prepared record;
begin
  select * into strict prepared
  from public.prepare_pull(
    'slice6-conversion-stars@1',
    1::smallint,
    'slice6:conversion:held:prepare:0001'
  );

  if prepared.held_amount <> 160 then
    raise exception 'Held-Stars conversion fixture reserved the wrong amount';
  end if;

  begin
    perform public.convert_stars_to_standard_roll(
      2,
      'slice6:conversion:held:convert:0001'
    );
    raise exception 'Conversion consumed Stars reserved by an active pull';
  exception when sqlstate '22003' then
    null;
  end;
end;
$$;

reset role;

do $$
begin
  if (select current_balance
      from public.wallet_balances
      where user_id = 'c1600000-0000-4160-8160-000000000003'
        and currency_id = 'stars'
        and balance_bucket = 'promotional') <> 320 or
     (select count(*)
      from public.wallet_ledger_entries
      where user_id = 'c1600000-0000-4160-8160-000000000003') <> 1 or
     exists (
       select 1
       from public.roll_ticket_ledger_entries
       where user_id = 'c1600000-0000-4160-8160-000000000003'
     ) or
     not exists (
       select 1
       from public.pull_sessions
       where user_id = 'c1600000-0000-4160-8160-000000000003'
         and held_amount = 160
         and expires_at > clock_timestamp()
         and not exists (
           select 1
           from public.pull_session_transitions
           where pull_session_transitions.session_id = pull_sessions.id
         )
     ) then
    raise exception 'Held-Stars rejection changed balance, tickets, or hold state';
  end if;
end;
$$;

rollback;
