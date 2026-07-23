begin;

insert into auth.users (id) values
  ('b1511111-1111-4111-8111-111111111111'),
  ('b1522222-2222-4222-8222-222222222222'),
  ('b1533333-3333-4333-8333-333333333333'),
  ('b1544444-4444-4444-8444-444444444444');

-- Mirror the immutable 0011 pool into one ticket-funded standard banner and
-- one premium-class banner. Ticket prices are deliberately exact pull units.
insert into public.pull_banner_families (id) values
  ('slice-six-standard'),
  ('slice-six-premium');

insert into public.pull_banner_versions (
  id, banner_id, banner_version, banner_family_id, economy_edition_id,
  source_config_sha256, hold_policy_id, currency_id, balance_bucket,
  duplicate_currency_id, duplicate_balance_bucket, weight_scale,
  rare_minimum_rank, rare_hard_guarantee_pull,
  epic_minimum_rank, epic_hard_guarantee_pull,
  selected_minimum_rank, selected_hard_guarantee_pull, resolution_order,
  banner_class, roll_type
)
select
  target.id,
  target.banner_id,
  1,
  target.family_id,
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
  target.banner_class,
  target.roll_type
from public.pull_banner_versions as source
cross join (values
  (
    'slice-six-standard@1',
    'slice-six-standard',
    'slice-six-standard',
    'standard',
    'standard_roll'
  ),
  (
    'slice-six-premium@1',
    'slice-six-premium',
    'slice-six-premium',
    'premium',
    'premium_roll'
  )
) as target(id, banner_id, family_id, banner_class, roll_type)
where source.id = 'earned-collection-001@1';

insert into public.pull_banner_offers (
  banner_version_id, pull_count, cost
) values
  ('slice-six-standard@1', 1, 1),
  ('slice-six-standard@1', 2, 2),
  ('slice-six-premium@1', 1, 1);

insert into public.pull_banner_tiers (
  banner_version_id, tier_id, tier_rank, weight_units, duplicate_dust
)
select target.banner_version_id, source.tier_id, source.tier_rank,
       source.weight_units, source.duplicate_dust
from public.pull_banner_tiers as source
cross join (values
  ('slice-six-standard@1'),
  ('slice-six-premium@1')
) as target(banner_version_id)
where source.banner_version_id = 'earned-collection-001@1';

insert into public.pull_banner_items (
  banner_version_id, tier_id, tier_rank, canonical_order,
  catalog_item_id, selected_featured
)
select target.banner_version_id, source.tier_id, source.tier_rank,
       source.canonical_order, source.catalog_item_id, source.selected_featured
from public.pull_banner_items as source
cross join (values
  ('slice-six-standard@1'),
  ('slice-six-premium@1')
) as target(banner_version_id)
where source.banner_version_id = 'earned-collection-001@1';

do $$
begin
  if exists (
    select 1
    from public.pull_banner_offers
    join public.pull_banner_versions
      on pull_banner_versions.id = pull_banner_offers.banner_version_id
    where pull_banner_versions.roll_type is not null
      and pull_banner_offers.cost <> pull_banner_offers.pull_count
  ) then
    raise exception 'A ticket-funded test offer is not priced in exact pull units';
  end if;

  if not exists (
    select 1
    from public.pull_banner_versions
    where id = 'earned-collection-001@1'
      and banner_class = 'standard'
      and roll_type is null
  ) then
    raise exception 'Legacy banner did not retain NULL roll-type Stars funding';
  end if;
end;
$$;

set local role service_role;
do $$
begin
  perform public.record_roll_ticket_ledger_entry(
    'b1511111-1111-4111-8111-111111111111',
    'standard_roll', 1, 'test.ticket-seed',
    'binding:ticket:hold-seed', '{}'::jsonb
  );
  perform public.record_roll_ticket_ledger_entry(
    'b1522222-2222-4222-8222-222222222222',
    'standard_roll', 1, 'test.ticket-seed',
    'binding:ticket:expiry-seed', '{}'::jsonb
  );
  perform public.record_roll_ticket_ledger_entry(
    'b1533333-3333-4333-8333-333333333333',
    'standard_roll', 1, 'test.ticket-seed',
    'binding:ticket:reverse-seed', '{}'::jsonb
  );

  perform public.append_wallet_ledger_entry(
    'b1511111-1111-4111-8111-111111111111',
    'stars', 'promotional', 160,
    'test.stars-seed', 'binding:stars:ticket-hold',
    'earned-collection@1', '{}'::jsonb
  );
  perform public.append_wallet_ledger_entry(
    'b1533333-3333-4333-8333-333333333333',
    'stars', 'promotional', 160,
    'test.stars-seed', 'binding:stars:legacy-hold',
    'earned-collection@1', '{}'::jsonb
  );
end;
$$;
reset role;

-- Ticket preparation reserves rather than debits. The family gate rejects a
-- second live preparation, and the balance trigger proves the held ticket is
-- unavailable to any later spend.
set local "request.jwt.claims" =
  '{"sub":"b1511111-1111-4111-8111-111111111111","is_anonymous":false}';
set local role authenticated;
do $$
declare
  receipt record;
begin
  select * into strict receipt
  from public.prepare_pull(
    'slice-six-standard@1', 1::smallint, 'binding:ticket:hold:0001'
  );
  if receipt.held_amount <> 1 then
    raise exception 'Ticket-funded preparation did not hold one ticket';
  end if;

  begin
    perform public.prepare_pull(
      'slice-six-standard@1', 1::smallint, 'binding:ticket:hold:0002'
    );
    raise exception 'Second live ticket preparation unexpectedly succeeded';
  exception when sqlstate '55000' then
    null;
  end;
end;
$$;
reset role;

set local role service_role;
do $$
begin
  if (select current_quantity from public.roll_ticket_balances
      where user_id = 'b1511111-1111-4111-8111-111111111111'
        and roll_type = 'standard_roll') <> 1 or
     (select count(*) from public.roll_ticket_ledger_entries
      where user_id = 'b1511111-1111-4111-8111-111111111111') <> 1 then
    raise exception 'Ticket preparation debited or rewrote the ticket ledger';
  end if;

  begin
    perform public.record_roll_ticket_ledger_entry(
      'b1511111-1111-4111-8111-111111111111',
      'standard_roll', -1, 'test.ticket-spend',
      'binding:ticket:held-spend', '{}'::jsonb
    );
    raise exception 'Ticket spend consumed an active ticket hold';
  exception when sqlstate '22003' then
    null;
  end;

  -- A ticket hold does not reserve the independent promotional-Stars pool.
  perform public.append_wallet_ledger_entry(
    'b1511111-1111-4111-8111-111111111111',
    'stars', 'promotional', -160,
    'test.stars-spend', 'binding:stars:under-ticket-hold',
    'earned-collection@1', '{}'::jsonb
  );
end;
$$;
reset role;

-- An already-expired ticket session reserves nothing and loses no tickets.
-- A two-pull follow-up is rejected for insufficient ticket capacity, while a
-- one-pull follow-up succeeds from the same unchanged quantity.
do $$
declare
  expired public.pull_sessions%rowtype;
begin
  perform set_config(
    'request.jwt.claims',
    '{"sub":"b1522222-2222-4222-8222-222222222222","is_anonymous":false}',
    true
  );
  expired := private.prepare_pull_for_user(
    'b1522222-2222-4222-8222-222222222222',
    'slice-six-standard@1',
    1::smallint,
    'binding:ticket:expired:0001',
    clock_timestamp() - interval '121 seconds',
    false
  );
  if expired.expires_at >= clock_timestamp() then
    raise exception 'Ticket test session was not created already expired';
  end if;
end;
$$;

set local "request.jwt.claims" =
  '{"sub":"b1522222-2222-4222-8222-222222222222","is_anonymous":false}';
set local role authenticated;
do $$
declare
  active_receipt record;
begin
  begin
    perform public.prepare_pull(
      'slice-six-standard@1', 2::smallint, 'binding:ticket:exceeds:0002'
    );
    raise exception 'Ticket preparation exceeding available capacity succeeded';
  exception when sqlstate '22003' then
    null;
  end;

  select * into strict active_receipt
  from public.prepare_pull(
    'slice-six-standard@1', 1::smallint, 'binding:ticket:after-expiry:0003'
  );
  if active_receipt.held_amount <> 1 then
    raise exception 'Expired ticket capacity was not reusable';
  end if;
end;
$$;
reset role;

do $$
begin
  if (select current_quantity from public.roll_ticket_balances
      where user_id = 'b1522222-2222-4222-8222-222222222222'
        and roll_type = 'standard_roll') <> 1 or
     (select count(*) from public.roll_ticket_ledger_entries
      where user_id = 'b1522222-2222-4222-8222-222222222222') <> 1 or
     (select count(*) from public.pull_sessions
      where user_id = 'b1522222-2222-4222-8222-222222222222') <> 2 then
    raise exception 'Ticket expiry changed quantity or failed to free capacity';
  end if;
end;
$$;

-- Legacy NULL-roll-type preparation still reserves Stars without debiting.
set local "request.jwt.claims" =
  '{"sub":"b1533333-3333-4333-8333-333333333333","is_anonymous":false}';
set local role authenticated;
do $$
declare
  receipt record;
begin
  select * into strict receipt
  from public.prepare_pull(
    'earned-collection-001@1', 1::smallint, 'binding:legacy:stars:0001'
  );
  if receipt.held_amount <> 160 then
    raise exception 'Legacy banner did not reserve its Stars offer cost';
  end if;
end;
$$;
reset role;

set local role service_role;
do $$
begin
  if (select current_balance from public.wallet_balances
      where user_id = 'b1533333-3333-4333-8333-333333333333'
        and currency_id = 'stars' and balance_bucket = 'promotional') <> 160 or
     (select count(*) from public.wallet_ledger_entries
      where user_id = 'b1533333-3333-4333-8333-333333333333'
        and currency_id = 'stars') <> 1 then
    raise exception 'Legacy preparation debited Stars instead of reserving them';
  end if;

  -- A legacy Stars hold does not reserve the independent ticket pool.
  perform public.record_roll_ticket_ledger_entry(
    'b1533333-3333-4333-8333-333333333333',
    'standard_roll', -1, 'test.ticket-spend',
    'binding:ticket:under-stars-hold', '{}'::jsonb
  );
end;
$$;
reset role;

-- Premium-class random preparation remains fail-closed before funding.
set local "request.jwt.claims" =
  '{"sub":"b1544444-4444-4444-8444-444444444444","is_anonymous":false}';
set local role authenticated;
do $$
begin
  begin
    perform public.prepare_pull(
      'slice-six-premium@1', 1::smallint, 'binding:premium:blocked:0001'
    );
    raise exception 'Premium-class banner preparation unexpectedly succeeded';
  exception when sqlstate '55000' then
    null;
  end;
end;
$$;

rollback;
