begin;

insert into auth.users (id) values
  ('24000000-0000-4000-8000-000000000001'),
  ('24000000-0000-4000-8000-000000000002'),
  ('24000000-0000-4000-8000-000000000003'),
  ('24000000-0000-4000-8000-000000000004'),
  ('24000000-0000-4000-8000-000000000005'),
  ('24000000-0000-4000-8000-000000000006'),
  ('24000000-0000-4000-8000-000000000007'),
  ('24000000-0000-4000-8000-000000000008'),
  ('24000000-0000-4000-8000-000000000009'),
  ('24000000-0000-4000-8000-000000000010');

-- Both receipt tables force owner-read RLS; API roles receive no direct DML.
-- The daily wrapper is authenticated-only, the purchase wrapper service-only,
-- and neither private engine is exposed.
do $$
begin
  if exists (
    select 1
    from pg_class
    where oid in (
      'public.lunar_daily_star_claims'::regclass,
      'public.lunar_purchase_star_grants'::regclass
    )
      and (not relrowsecurity or not relforcerowsecurity)
  ) then
    raise exception 'Every Lunar receipt table must force RLS';
  end if;

  if has_table_privilege(
       'authenticated', 'public.lunar_daily_star_claims', 'INSERT'
     ) or
     has_table_privilege(
       'service_role', 'public.lunar_daily_star_claims', 'INSERT'
     ) or
     has_table_privilege(
       'authenticated', 'public.lunar_purchase_star_grants', 'UPDATE'
     ) or
     has_table_privilege(
       'service_role', 'public.lunar_purchase_star_grants', 'UPDATE'
     ) then
    raise exception 'Direct Lunar receipt DML leaked to an API role';
  end if;

  if not has_function_privilege(
       'authenticated',
       'public.claim_lunar_daily_stars()',
       'EXECUTE'
     ) or
     has_function_privilege(
       'anon',
       'public.claim_lunar_daily_stars()',
       'EXECUTE'
     ) or
     has_function_privilege(
       'service_role',
       'public.claim_lunar_daily_stars()',
       'EXECUTE'
     ) or
     not has_function_privilege(
       'service_role',
       'public.grant_lunar_purchase_stars(uuid,bigint,text,text,text)',
       'EXECUTE'
     ) or
     has_function_privilege(
       'authenticated',
       'public.grant_lunar_purchase_stars(uuid,bigint,text,text,text)',
       'EXECUTE'
     ) or
     has_function_privilege(
       'service_role',
       'private.claim_lunar_daily_stars_for_user(uuid,timestamptz)',
       'EXECUTE'
     ) then
    raise exception 'Lunar RPC exposure drifted from public-wrapper-only rules';
  end if;

  if to_regprocedure('public.grant_lunar_purchase_stars(bigint)') is not null then
    raise exception 'Legacy subscription-event purchase grant path still exists';
  end if;
end;
$$;

set local "request.jwt.claims" = '{"role":"service_role"}';
set local role service_role;

-- Fixture subscriptions use the signed-webhook boundary from 0023.
select public.record_subscription_event(
  '24000000-0000-4000-8000-000000000001',
  'lunar-daily-one',
  'create_subscription',
  'lunar-plan',
  'lunar-pass',
  '2030-01-01 00:00:00+00',
  '2030-02-01 00:00:00+00',
  null,
  '{"fixture":"daily-one"}'::jsonb,
  repeat('1', 64)
);

select public.record_subscription_event(
  '24000000-0000-4000-8000-000000000002',
  'lunar-daily-two',
  'create_subscription',
  'lunar-plan',
  'lunar-pass',
  '2030-01-01 00:00:00+00',
  '2030-02-01 00:00:00+00',
  null,
  '{"fixture":"daily-two"}'::jsonb,
  repeat('2', 64)
);

-- Product-filter mismatch fixture: another subscription product must never
-- satisfy the Lunar claim gate.
select public.record_subscription_event(
  '24000000-0000-4000-8000-000000000004',
  'other-pass-subscription',
  'create_subscription',
  'other-plan',
  'other-pass',
  '2030-01-01 00:00:00+00',
  '2030-02-01 00:00:00+00',
  null,
  '{"fixture":"product-mismatch"}'::jsonb,
  repeat('4', 64)
);

-- Canceled past date_end fixture.
select public.record_subscription_event(
  '24000000-0000-4000-8000-000000000005',
  'lunar-canceled',
  'create_subscription',
  'lunar-plan',
  'lunar-pass',
  '2030-01-01 00:00:00+00',
  '2030-02-01 00:00:00+00',
  null,
  '{"fixture":"cancel-create"}'::jsonb,
  repeat('5', 64)
);
select public.record_subscription_event(
  '24000000-0000-4000-8000-000000000005',
  'lunar-canceled',
  'cancel_subscription',
  null,
  'lunar-pass',
  null,
  null,
  '2030-01-05 00:00:00+00',
  '{"fixture":"cancel-end"}'::jsonb,
  repeat('6', 64)
);

-- Non-renewing past date_next_charge fixture.
select public.record_subscription_event(
  '24000000-0000-4000-8000-000000000006',
  'lunar-nonrenewing',
  'create_subscription',
  'lunar-plan',
  'lunar-pass',
  '2030-01-01 00:00:00+00',
  '2030-01-10 00:00:00+00',
  null,
  '{"fixture":"nonrenew-create"}'::jsonb,
  repeat('7', 64)
);
select public.record_subscription_event(
  '24000000-0000-4000-8000-000000000006',
  'lunar-nonrenewing',
  'non_renewal_subscription',
  'lunar-plan',
  'lunar-pass',
  null,
  '2030-01-10 00:00:00+00',
  null,
  '{"fixture":"nonrenew-end"}'::jsonb,
  repeat('8', 64)
);

-- Dedicated public-wrapper fixture avoids coupling the database clock to the
-- private UTC-boundary cases above.
select public.record_subscription_event(
  '24000000-0000-4000-8000-000000000009',
  'lunar-public-wrapper',
  'create_subscription',
  'lunar-plan',
  'lunar-pass',
  '2030-01-01 00:00:00+00',
  '2030-02-01 00:00:00+00',
  null,
  '{"fixture":"public-wrapper"}'::jsonb,
  repeat('d', 64)
);

reset role;

-- Active sub -> exactly 90 promotional Stars and one immutable receipt.
-- Same-day replay -> the prior receipt, with zero new receipt or ledger rows.
-- UTC day boundary -> 23:59:59 and 00:00:01 are two different claim days.
do $$
declare
  first_claim public.lunar_daily_star_claims%rowtype;
  replay_claim public.lunar_daily_star_claims%rowtype;
  second_day_claim public.lunar_daily_star_claims%rowtype;
  claim_count_before bigint;
  ledger_count_before bigint;
begin
  first_claim := private.claim_lunar_daily_stars_for_user(
    '24000000-0000-4000-8000-000000000001',
    '2030-01-15 23:59:59+00'
  );

  if first_claim.utc_day <> '2030-01-15'::date or
     first_claim.credited_stars <> 90 or
     not exists (
       select 1
       from public.wallet_ledger_entries
       where id = first_claim.wallet_ledger_entry_id
         and user_id = '24000000-0000-4000-8000-000000000001'
         and currency_id = 'stars'
         and balance_bucket = 'promotional'
         and delta_amount = 90
         and reason_code = 'lunar.daily'
         and idempotency_key =
           'lunar-daily:24000000-0000-4000-8000-000000000001:2030-01-15'
     ) then
    raise exception 'Active Lunar daily claim did not credit exactly 90 promotional Stars';
  end if;

  select count(*) into claim_count_before
  from public.lunar_daily_star_claims
  where user_id = '24000000-0000-4000-8000-000000000001';
  select count(*) into ledger_count_before
  from public.wallet_ledger_entries
  where user_id = '24000000-0000-4000-8000-000000000001'
    and reason_code = 'lunar.daily';

  replay_claim := private.claim_lunar_daily_stars_for_user(
    '24000000-0000-4000-8000-000000000001',
    '2030-01-15 12:00:00+00'
  );

  if replay_claim is distinct from first_claim or
     (select count(*) from public.lunar_daily_star_claims
      where user_id = '24000000-0000-4000-8000-000000000001')
       <> claim_count_before or
     (select count(*) from public.wallet_ledger_entries
      where user_id = '24000000-0000-4000-8000-000000000001'
        and reason_code = 'lunar.daily')
       <> ledger_count_before then
    raise exception 'Same-day replay changed Lunar receipt or ledger state';
  end if;

  second_day_claim := private.claim_lunar_daily_stars_for_user(
    '24000000-0000-4000-8000-000000000001',
    '2030-01-16 00:00:01+00'
  );

  if second_day_claim.utc_day <> '2030-01-16'::date or
     second_day_claim.id = first_claim.id or
     (select count(*) from public.lunar_daily_star_claims
      where user_id = '24000000-0000-4000-8000-000000000001') <> 2 or
     (select current_balance
      from public.wallet_balances
      where user_id = '24000000-0000-4000-8000-000000000001'
        and currency_id = 'stars'
        and balance_bucket = 'promotional') <> 180 then
    raise exception 'UTC day boundary did not create exactly one new 90-Star claim';
  end if;
end;
$$;

-- Different user isolation: the same UTC day has an independent receipt and
-- balance for another subscriber.
do $$
declare
  isolated_claim public.lunar_daily_star_claims%rowtype;
begin
  isolated_claim := private.claim_lunar_daily_stars_for_user(
    '24000000-0000-4000-8000-000000000002',
    '2030-01-15 23:59:59+00'
  );

  if isolated_claim.user_id <>
       '24000000-0000-4000-8000-000000000002'::uuid or
     isolated_claim.utc_day <> '2030-01-15'::date or
     (select current_balance
      from public.wallet_balances
      where user_id = '24000000-0000-4000-8000-000000000002'
        and currency_id = 'stars'
        and balance_bucket = 'promotional') <> 90 then
    raise exception 'Different user isolation failed for the Lunar daily claim';
  end if;
end;
$$;

-- Non-subscriber, canceled-past-date_end, non-renewing-past-next_charge, and
-- product-filter mismatch all fail closed with SQLSTATE 55000 and zero effects.
do $$
declare
  claims_before bigint;
  ledger_before bigint;
begin
  select count(*) into claims_before from public.lunar_daily_star_claims;
  select count(*) into ledger_before
  from public.wallet_ledger_entries
  where reason_code = 'lunar.daily';

  begin
    perform private.claim_lunar_daily_stars_for_user(
      '24000000-0000-4000-8000-000000000003',
      '2030-01-15 12:00:00+00'
    );
    raise exception 'Non-subscriber claim unexpectedly succeeded';
  exception when sqlstate '55000' then
    null;
  end;

  begin
    perform private.claim_lunar_daily_stars_for_user(
      '24000000-0000-4000-8000-000000000005',
      '2030-01-06 00:00:00+00'
    );
    raise exception 'Canceled past date_end claim unexpectedly succeeded';
  exception when sqlstate '55000' then
    null;
  end;

  begin
    perform private.claim_lunar_daily_stars_for_user(
      '24000000-0000-4000-8000-000000000006',
      '2030-01-10 00:00:01+00'
    );
    raise exception 'Non-renewing past date_next_charge claim unexpectedly succeeded';
  exception when sqlstate '55000' then
    null;
  end;

  begin
    perform private.claim_lunar_daily_stars_for_user(
      '24000000-0000-4000-8000-000000000004',
      '2030-01-15 12:00:00+00'
    );
    raise exception 'Product-filter mismatch claim unexpectedly succeeded';
  exception when sqlstate '55000' then
    null;
  end;

  if (select count(*) from public.lunar_daily_star_claims) <> claims_before or
     (select count(*) from public.wallet_ledger_entries
      where reason_code = 'lunar.daily') <> ledger_before then
    raise exception 'Rejected daily claim changed receipt or ledger state';
  end if;
end;
$$;

set local role service_role;

-- Same invoice replay returns the exact prior receipt and appends no second
-- grant or wallet row. User 7 has no subscription projection, proving the
-- payment receipt itself -- not lifecycle ordering -- is the charge proof.
do $$
declare
  first_grant public.lunar_purchase_star_grants%rowtype;
  replay_grant public.lunar_purchase_star_grants%rowtype;
  grant_count_before bigint;
  ledger_count_before bigint;
begin
  first_grant := public.grant_lunar_purchase_stars(
    '24000000-0000-4000-8000-000000000007',
    7001,
    'lunar-invoice-sub',
    'lunar-plan',
    'lunar-pass'
  );

  if first_grant.user_id <>
       '24000000-0000-4000-8000-000000000007'::uuid or
     first_grant.subscription_id <> 'lunar-invoice-sub' or
     first_grant.xsolla_transaction_id <> 7001 or
     first_grant.plan_id <> 'lunar-plan' or
     first_grant.product_id <> 'lunar-pass' or
     first_grant.credited_stars <> 300 or
     not exists (
       select 1
       from public.wallet_ledger_entries
       where id = first_grant.wallet_ledger_entry_id
         and user_id = '24000000-0000-4000-8000-000000000007'
         and currency_id = 'stars'
         and balance_bucket = 'promotional'
         and delta_amount = 300
         and reason_code = 'lunar.purchase'
         and idempotency_key = 'lunar-purchase:7001'
     ) then
    raise exception 'Paid invoice did not append exactly 300 promotional Stars';
  end if;

  select count(*) into grant_count_before
  from public.lunar_purchase_star_grants
  where user_id = '24000000-0000-4000-8000-000000000007';
  select count(*) into ledger_count_before
  from public.wallet_ledger_entries
  where user_id = '24000000-0000-4000-8000-000000000007'
    and reason_code = 'lunar.purchase';

  replay_grant := public.grant_lunar_purchase_stars(
    '24000000-0000-4000-8000-000000000007',
    7001,
    'lunar-invoice-sub',
    'lunar-plan',
    'lunar-pass'
  );
  if replay_grant is distinct from first_grant or
     (select count(*) from public.lunar_purchase_star_grants
      where user_id = '24000000-0000-4000-8000-000000000007')
       <> grant_count_before or
     (select count(*) from public.wallet_ledger_entries
      where user_id = '24000000-0000-4000-8000-000000000007'
        and reason_code = 'lunar.purchase')
       <> ledger_count_before then
    raise exception 'Same invoice replay changed grant or ledger state';
  end if;
end;
$$;

-- Distinct invoice in the same billing period grants again: two unique paid
-- charges are two credits, regardless of any shared subscription period.
do $$
declare
  second_grant public.lunar_purchase_star_grants%rowtype;
begin
  second_grant := public.grant_lunar_purchase_stars(
    '24000000-0000-4000-8000-000000000007',
    7002,
    'lunar-invoice-sub',
    'lunar-plan',
    'lunar-pass'
  );

  if second_grant.xsolla_transaction_id <> 7002 or
     (select count(*) from public.lunar_purchase_star_grants
      where user_id = '24000000-0000-4000-8000-000000000007') <> 2 or
     (select current_balance
      from public.wallet_balances
      where user_id = '24000000-0000-4000-8000-000000000007'
        and currency_id = 'stars'
        and balance_bucket = 'promotional') <> 600 then
    raise exception 'Distinct paid invoice did not grant a second 300-Star credit';
  end if;
end;
$$;

-- Plan-change update event has no grant path: recording lifecycle state does
-- not mint Stars. The service grant separately rejects a non-Lunar payment
-- product with zero effects.
select public.record_subscription_event(
  '24000000-0000-4000-8000-000000000010',
  'plan-change-only',
  'create_subscription',
  'lunar-plan',
  'lunar-pass',
  '2030-01-01 00:00:00+00',
  '2030-02-01 00:00:00+00',
  null,
  '{"fixture":"plan-change-create"}'::jsonb,
  repeat('a', 64)
);
select public.record_subscription_event(
  '24000000-0000-4000-8000-000000000010',
  'plan-change-only',
  'update_subscription',
  'lunar-plan-upgraded',
  'lunar-pass',
  null,
  '2030-03-01 00:00:00+00',
  null,
  '{"fixture":"plan-change-update"}'::jsonb,
  repeat('b', 64)
);

do $$
declare
  grants_before bigint;
  ledger_before bigint;
begin
  select count(*) into grants_before
  from public.lunar_purchase_star_grants
  where user_id = '24000000-0000-4000-8000-000000000010';
  select count(*) into ledger_before
  from public.wallet_ledger_entries
  where user_id = '24000000-0000-4000-8000-000000000010'
    and reason_code = 'lunar.purchase';

  if grants_before <> 0 or ledger_before <> 0 then
    raise exception 'Plan-change lifecycle update unexpectedly created a grant path';
  end if;

  begin
    perform public.grant_lunar_purchase_stars(
      '24000000-0000-4000-8000-000000000010',
      10001,
      'plan-change-only',
      'lunar-plan-upgraded',
      'other-pass'
    );
    raise exception 'Product-mismatch payment unexpectedly granted Lunar Stars';
  exception when sqlstate '55000' then
    null;
  end;

  if (select count(*) from public.lunar_purchase_star_grants
      where user_id = '24000000-0000-4000-8000-000000000010') <> grants_before or
     (select count(*) from public.wallet_ledger_entries
      where user_id = '24000000-0000-4000-8000-000000000010'
        and reason_code = 'lunar.purchase') <> ledger_before then
    raise exception 'Rejected payment product mismatch changed grant or ledger state';
  end if;
end;
$$;

-- Paid-after-cancel invoice grants. The cancellation projection for user 5 is
-- terminal and already expired, but a signed payment means money moved;
-- refunds, not current activity, reverse that charge.
do $$
declare
  canceled_grant public.lunar_purchase_star_grants%rowtype;
begin
  canceled_grant := public.grant_lunar_purchase_stars(
    '24000000-0000-4000-8000-000000000005',
    5001,
    'lunar-canceled',
    'lunar-plan',
    'lunar-pass'
  );

  if canceled_grant.credited_stars <> 300 or
     (select status from public.user_subscriptions
      where user_id = '24000000-0000-4000-8000-000000000005'
        and subscription_id = 'lunar-canceled') <> 'canceled' or
     (select current_balance from public.wallet_balances
      where user_id = '24000000-0000-4000-8000-000000000005'
        and currency_id = 'stars'
        and balance_bucket = 'promotional') <> 300 then
    raise exception 'Paid-after-cancel invoice did not grant exactly once';
  end if;
end;
$$;

-- Payment-before-subscription ordering: user 8 has no subscription_events or
-- user_subscriptions row, yet the verified Lunar payment grants. A later
-- lifecycle event may project independently.
do $$
declare
  ordering_grant public.lunar_purchase_star_grants%rowtype;
begin
  if exists (
    select 1 from public.user_subscriptions
    where user_id = '24000000-0000-4000-8000-000000000008'
  ) or exists (
    select 1 from public.subscription_events
    where user_id = '24000000-0000-4000-8000-000000000008'
  ) then
    raise exception 'Payment-before-subscription fixture unexpectedly has lifecycle state';
  end if;

  ordering_grant := public.grant_lunar_purchase_stars(
    '24000000-0000-4000-8000-000000000008',
    8001,
    'payment-first-sub',
    'lunar-plan',
    'lunar-pass'
  );

  if ordering_grant.xsolla_transaction_id <> 8001 or
     ordering_grant.credited_stars <> 300 or
     exists (
       select 1 from public.user_subscriptions
       where user_id = '24000000-0000-4000-8000-000000000008'
     ) then
    raise exception 'Payment-before-subscription ordering did not grant independently';
  end if;
end;
$$;

-- Same invoice subscription drift and same invoice plan drift fail closed
-- under the account lock, with no receipt or wallet effects.
do $$
declare
  grants_before bigint;
  ledger_before bigint;
begin
  select count(*) into grants_before
  from public.lunar_purchase_star_grants
  where user_id = '24000000-0000-4000-8000-000000000007';
  select count(*) into ledger_before
  from public.wallet_ledger_entries
  where user_id = '24000000-0000-4000-8000-000000000007'
    and reason_code = 'lunar.purchase';

  begin
    perform public.grant_lunar_purchase_stars(
      '24000000-0000-4000-8000-000000000007',
      7001,
      'different-subscription',
      'lunar-plan',
      'lunar-pass'
    );
    raise exception 'Same invoice subscription drift unexpectedly succeeded';
  exception when sqlstate '22023' then
    null;
  end;

  begin
    perform public.grant_lunar_purchase_stars(
      '24000000-0000-4000-8000-000000000007',
      7001,
      'lunar-invoice-sub',
      'different-plan',
      'lunar-pass'
    );
    raise exception 'Same invoice plan drift unexpectedly succeeded';
  exception when sqlstate '22023' then
    null;
  end;

  if (select count(*) from public.lunar_purchase_star_grants
      where user_id = '24000000-0000-4000-8000-000000000007') <> grants_before or
     (select count(*) from public.wallet_ledger_entries
      where user_id = '24000000-0000-4000-8000-000000000007'
        and reason_code = 'lunar.purchase') <> ledger_before then
    raise exception 'Same invoice subscription or plan drift changed state';
  end if;
end;
$$;

-- Same invoice product drift fails closed before replay. Product identity
-- comes from payment.purchase.subscription and must be exactly Lunar.
do $$
declare
  grants_before bigint;
  ledger_before bigint;
begin
  select count(*) into grants_before
  from public.lunar_purchase_star_grants
  where user_id = '24000000-0000-4000-8000-000000000007';
  select count(*) into ledger_before
  from public.wallet_ledger_entries
  where user_id = '24000000-0000-4000-8000-000000000007'
    and reason_code = 'lunar.purchase';

  begin
    perform public.grant_lunar_purchase_stars(
      '24000000-0000-4000-8000-000000000007',
      7001,
      'lunar-invoice-sub',
      'lunar-plan',
      'other-pass'
    );
    raise exception 'Same invoice product drift unexpectedly succeeded';
  exception when sqlstate '55000' then
    null;
  end;

  if (select count(*) from public.lunar_purchase_star_grants
      where user_id = '24000000-0000-4000-8000-000000000007')
       <> grants_before or
     (select count(*) from public.wallet_ledger_entries
      where user_id = '24000000-0000-4000-8000-000000000007'
        and reason_code = 'lunar.purchase') <> ledger_before then
    raise exception 'Same invoice product drift changed grant or ledger state';
  end if;
end;
$$;

-- Same invoice amount drift fails closed at the canonical 0009 ledger seam.
-- Amount is not caller-controlled at the grant RPC; attempting to reuse its
-- invoice-derived key with a different delta is rejected with zero effects.
do $$
declare
  grants_before bigint;
  ledger_before bigint;
begin
  select count(*) into grants_before
  from public.lunar_purchase_star_grants
  where user_id = '24000000-0000-4000-8000-000000000007';
  select count(*) into ledger_before
  from public.wallet_ledger_entries
  where user_id = '24000000-0000-4000-8000-000000000007'
    and reason_code = 'lunar.purchase';

  begin
    perform public.append_wallet_ledger_entry(
      '24000000-0000-4000-8000-000000000007',
      'stars',
      'promotional',
      301,
      'lunar.purchase',
      'lunar-purchase:7001',
      'earned-collection@1',
      jsonb_build_object(
        'lunarProductId', 'lunar-pass',
        'subscriptionId', 'lunar-invoice-sub',
        'planId', 'lunar-plan',
        'xsollaTransactionId', 7001,
        'grantModel', 'paid-invoice',
        'specSection', '3.1'
      )
    );
    raise exception 'Same invoice amount drift unexpectedly succeeded';
  exception when sqlstate '22023' then
    null;
  end;

  if (select count(*) from public.lunar_purchase_star_grants
      where user_id = '24000000-0000-4000-8000-000000000007') <> grants_before or
     (select count(*) from public.wallet_ledger_entries
      where user_id = '24000000-0000-4000-8000-000000000007'
        and reason_code = 'lunar.purchase') <> ledger_before then
    raise exception 'Same invoice amount drift changed grant or ledger state';
  end if;
end;
$$;

reset role;

-- Append-only history rejects UPDATE, DELETE, and TRUNCATE with SQLSTATE 55000.
do $$
begin
  begin
    update public.lunar_daily_star_claims
    set credited_stars = credited_stars
    where id = (select id from public.lunar_daily_star_claims limit 1);
    raise exception 'Daily receipt update unexpectedly succeeded';
  exception when sqlstate '55000' then
    null;
  end;

  begin
    delete from public.lunar_purchase_star_grants
    where id = (select id from public.lunar_purchase_star_grants limit 1);
    raise exception 'Purchase receipt delete unexpectedly succeeded';
  exception when sqlstate '55000' then
    null;
  end;

  begin
    truncate table public.lunar_daily_star_claims;
    raise exception 'Daily receipt truncate unexpectedly succeeded';
  exception when sqlstate '55000' then
    null;
  end;

  begin
    truncate table public.lunar_purchase_star_grants;
    raise exception 'Purchase receipt truncate unexpectedly succeeded';
  exception when sqlstate '55000' then
    null;
  end;
end;
$$;

-- Direct DML denial, authenticated purchase rejection, and RLS cross-user.
set local "request.jwt.claims" =
  '{"sub":"24000000-0000-4000-8000-000000000001","role":"authenticated","is_anonymous":false}';
set local role authenticated;

do $$
begin
  if (select count(*) from public.lunar_daily_star_claims) <> 2 or
     (select count(*) from public.lunar_purchase_star_grants) <> 0 then
    raise exception 'RLS cross-user isolation failed for Lunar receipts';
  end if;

  begin
    insert into public.lunar_daily_star_claims (
      user_id,
      subscription_id,
      utc_day,
      credited_stars,
      wallet_ledger_entry_id,
      claimed_at
    ) values (
      '24000000-0000-4000-8000-000000000001',
      'lunar-daily-one',
      '2030-01-17',
      90,
      1,
      '2030-01-17 00:00:00+00'
    );
    raise exception 'Direct DML denial failed for daily receipts';
  exception when insufficient_privilege then
    null;
  end;

  begin
    perform public.grant_lunar_purchase_stars(
      '24000000-0000-4000-8000-000000000001',
      1001,
      'denied-subscription',
      'lunar-plan',
      'lunar-pass'
    );
    raise exception 'Authenticated purchase call rejected check failed';
  exception when insufficient_privilege then
    null;
  end;

  begin
    perform public.is_lunar_pass_active(
      '24000000-0000-4000-8000-000000000002',
      statement_timestamp(),
      'lunar-pass'
    );
    raise exception 'Authenticated caller queried another Lunar user';
  exception when sqlstate '42501' then
    null;
  end;
end;
$$;

reset role;

-- Authenticated non-anonymous public daily claim success: the public zero-arg
-- wrapper derives auth.uid and database time, then returns only that user's
-- receipt with the canonical 90-Star ledger effect.
set local "request.jwt.claims" =
  '{"sub":"24000000-0000-4000-8000-000000000009","role":"authenticated","is_anonymous":false}';
set local role authenticated;
do $$
declare
  public_claim public.lunar_daily_star_claims%rowtype;
begin
  public_claim := public.claim_lunar_daily_stars();

  if public_claim.user_id <>
       '24000000-0000-4000-8000-000000000009'::uuid or
     public_claim.subscription_id <> 'lunar-public-wrapper' or
     public_claim.credited_stars <> 90 or
     public_claim.utc_day <>
       (public_claim.claimed_at at time zone 'UTC')::date or
     (select count(*) from public.lunar_daily_star_claims) <> 1 or
     not exists (
       select 1
       from public.wallet_ledger_entries
       where id = public_claim.wallet_ledger_entry_id
         and user_id = '24000000-0000-4000-8000-000000000009'
         and currency_id = 'stars'
         and balance_bucket = 'promotional'
         and delta_amount = 90
         and reason_code = 'lunar.daily'
     ) or
     (select current_balance
      from public.wallet_balances
      where user_id = '24000000-0000-4000-8000-000000000009'
        and currency_id = 'stars'
        and balance_bucket = 'promotional') <> 90 then
    raise exception 'Authenticated public daily wrapper did not credit self exactly once';
  end if;
end;
$$;

reset role;

-- The public daily wrapper is self-only: another user's identity cannot be
-- supplied, and anonymous authenticated sessions fail with SQLSTATE 28000.
set local "request.jwt.claims" =
  '{"sub":"24000000-0000-4000-8000-000000000002","role":"authenticated","is_anonymous":true}';
set local role authenticated;
do $$
begin
  begin
    perform public.claim_lunar_daily_stars();
    raise exception 'Anonymous daily claim unexpectedly succeeded';
  exception when sqlstate '28000' then
    null;
  end;
end;
$$;

reset role;

rollback;
