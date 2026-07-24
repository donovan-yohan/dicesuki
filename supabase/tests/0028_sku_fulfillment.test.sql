begin;

insert into auth.users (id) values
  ('c0280000-0000-4028-8028-000000000001'),
  ('c0280000-0000-4028-8028-000000000002'),
  ('c0280000-0000-4028-8028-000000000003'),
  ('c0280000-0000-4028-8028-000000000004'),
  ('c0280000-0000-4028-8028-000000000005');

-- API-role windows contain only the calls under test plus pg_temp handoff.
-- All fixture setup and privileged-table assertions run as the session owner.
create temporary table order_ctx (
  label text primary key,
  order_id uuid,
  external_id uuid,
  txn bigint,
  user_id uuid,
  status text,
  entitlement_id uuid,
  entitlement_created boolean,
  source_entry_id bigint
) on commit drop;
grant select, insert, update on pg_temp.order_ctx to service_role;

-- No self-only call should inherit a stale JWT from another scenario.
set local "request.jwt.claims" = '{}';

-- Registry order creation derives the exact price and rejects drafts itself.
set local role service_role;
do $$
declare
  created public.payment_orders%rowtype;
begin
  created := public.create_sku_payment_order(
    'c0280000-0000-4028-8028-000000000001',
    'stars_handful',
    'USD',
    true
  );
  insert into pg_temp.order_ctx (
    label, order_id, external_id, txn, user_id, status
  ) values (
    'bundle-first', created.id, created.external_id, 28001,
    created.user_id, created.status
  );
end;
$$;

reset role;

do $$
declare
  ctx pg_temp.order_ctx%rowtype;
  created public.payment_orders%rowtype;
begin
  select * into strict ctx
  from pg_temp.order_ctx
  where label = 'bundle-first';

  select * into strict created
  from public.payment_orders
  where id = ctx.order_id;

  if created.amount_minor <> 49 or created.sku_id <> 'stars_handful' or
     created.catalog_item_id is not null or
     created.sku_value_version <> 1 or
     created.sku_price_usd_cents <> 49 or
     created.sku_star_total <> 60 or
     created.sku_first_time_total <> 120 or
     created.sku_product_id is not null then
    raise exception 'Registry checkout did not derive the sandbox SKU price and binding';
  end if;
end;
$$;

insert into public.store_skus (
  sku_id, sku_class, price_usd_cents, star_raw, star_bonus,
  star_total, first_time_total, status
) values (
  'slice28_draft', 'star_bundle', 100, 100, 10, 110, 200, 'draft'
);

set local role service_role;
do $$
begin
  begin
    perform public.create_sku_payment_order(
      'c0280000-0000-4028-8028-000000000001',
      'slice28_draft',
      'USD',
      true
    );
    raise exception 'Draft Store SKU unexpectedly became sellable';
  exception when sqlstate '55000' then
    null;
  end;
end;
$$;
reset role;

-- First handful purchase credits double raw (120), snapshots the economic
-- values, and appends one active first-purchase grant.
set local role service_role;
do $$
declare
  ctx pg_temp.order_ctx%rowtype;
  fulfilled public.payment_orders%rowtype;
begin
  select * into strict ctx from pg_temp.order_ctx where label = 'bundle-first';
  fulfilled := public.fulfill_payment_order(
    ctx.external_id,
    ctx.txn,
    'payment',
    true,
    jsonb_build_object('notification_type', 'payment', 'transaction', jsonb_build_object('id', ctx.txn))
  );
  perform public.fulfill_payment_order(
    ctx.external_id,
    ctx.txn,
    'payment',
    true,
    jsonb_build_object('notification_type', 'payment', 'transaction', jsonb_build_object('id', ctx.txn))
  );
  update pg_temp.order_ctx
  set user_id = fulfilled.user_id,
      status = fulfilled.status
  where label = 'bundle-first';
end;
$$;
reset role;

do $$
declare
  ctx pg_temp.order_ctx%rowtype;
begin
  select * into strict ctx
  from pg_temp.order_ctx
  where label = 'bundle-first';

  if ctx.status <> 'fulfilled' or
     (select current_balance from public.wallet_balances
      where user_id = ctx.user_id and currency_id = 'stars' and balance_bucket = 'paid') <> 120 or
     not exists (
       select 1
       from public.star_bundle_fulfillments
       where order_id = ctx.order_id
         and credited_stars = 120
         and sku_value_version = 1
         and first_time_applied
     ) or
     (select count(*) from public.star_bundle_first_purchases
      where user_id = ctx.user_id and sku_id = 'stars_handful') <> 1 or
     (select count(*) from public.star_bundle_first_purchase_events
      where order_id = ctx.order_id and event_type = 'granted') <> 1 then
    raise exception 'First bundle purchase did not credit double-raw paid Stars and flag exactly once';
  end if;

  if (select count(*) from public.wallet_ledger_entries
      where user_id = ctx.user_id and reason_code = 'purchase.star_bundle') <> 1 then
    raise exception 'Bundle fulfillment replay appended a second credit';
  end if;
end;
$$;

-- A second purchase gets the standard 60 total.
set local role service_role;
do $$
declare
  created public.payment_orders%rowtype;
  fulfilled public.payment_orders%rowtype;
begin
  created := public.create_sku_payment_order(
    'c0280000-0000-4028-8028-000000000001',
    'stars_handful',
    'USD',
    true
  );
  fulfilled := public.fulfill_payment_order(
    created.external_id, 28002, 'payment', true,
    '{"notification_type":"payment","transaction":{"id":28002}}'::jsonb
  );
  insert into pg_temp.order_ctx (
    label, order_id, external_id, txn, user_id, status
  ) values (
    'bundle-second', created.id, created.external_id, 28002,
    fulfilled.user_id, fulfilled.status
  );
end;
$$;
reset role;

do $$
declare
  ctx pg_temp.order_ctx%rowtype;
begin
  select * into strict ctx
  from pg_temp.order_ctx
  where label = 'bundle-second';

  if not exists (
       select 1 from public.star_bundle_fulfillments
       where order_id = ctx.order_id and credited_stars = 60 and not first_time_applied
     ) or
     (select current_balance from public.wallet_balances
      where user_id = ctx.user_id and currency_id = 'stars' and balance_bucket = 'paid') <> 180 then
    raise exception 'Subsequent bundle purchase did not use the standard Star total';
  end if;
end;
$$;

-- Even service_role cannot pre-poison the canonical refund idempotency key:
-- only refund_payment_order can append the internal exact intent.
do $$
declare
  ctx pg_temp.order_ctx%rowtype;
begin
  select * into strict ctx
  from pg_temp.order_ctx
  where label = 'bundle-first';

  update pg_temp.order_ctx
  set source_entry_id = (
    select wallet_ledger_entry_id
    from public.star_bundle_fulfillments
    where order_id = ctx.order_id
  )
  where label = 'bundle-first';
end;
$$;

set local role service_role;
do $$
declare
  ctx pg_temp.order_ctx%rowtype;
begin
  select * into strict ctx from pg_temp.order_ctx where label = 'bundle-first';

  begin
    perform public.append_wallet_ledger_entry(
      'c0280000-0000-4028-8028-000000000001',
      'stars',
      'paid',
      -120,
      'purchase.refund',
      'star-bundle-refund:' || ctx.order_id::text,
      'earned-collection@1',
      jsonb_build_object(
        'orderId', ctx.order_id,
        'sourceLedgerEntryId', ctx.source_entry_id
      )
    );
    raise exception 'Direct service paid reversal unexpectedly bypassed exact refund intent';
  exception when sqlstate '55000' then
    null;
  end;
end;
$$;
reset role;

-- A covered refund reverses the exact snapshotted 120 and the first-time event.
-- A later purchase is first-time eligible again and receives 120.
set local role service_role;
do $$
declare
  ctx pg_temp.order_ctx%rowtype;
  refunded public.payment_orders%rowtype;
begin
  select * into strict ctx from pg_temp.order_ctx where label = 'bundle-first';
  refunded := public.refund_payment_order(
    ctx.txn, 'refund', true,
    '{"notification_type":"refund","transaction":{"id":28001}}'::jsonb
  );

  update pg_temp.order_ctx
  set user_id = refunded.user_id,
      status = refunded.status
  where label = 'bundle-first';
end;
$$;
reset role;

do $$
declare
  refunded_ctx pg_temp.order_ctx%rowtype;
begin
  select * into strict refunded_ctx
  from pg_temp.order_ctx
  where label = 'bundle-first';

  if refunded_ctx.status <> 'refunded' or
     (select current_balance from public.wallet_balances
      where user_id = refunded_ctx.user_id and currency_id = 'stars' and balance_bucket = 'paid') <> 60 or
     not exists (
       select 1 from public.wallet_ledger_entries
       where user_id = refunded_ctx.user_id
         and delta_amount = -120
         and reason_code = 'purchase.refund'
     ) or
     not exists (
       select 1 from public.star_bundle_first_purchase_events
       where order_id = refunded_ctx.order_id and event_type = 'reversed'
     ) then
    raise exception 'Covered refund did not reverse exact credit and first-purchase event';
  end if;
end;
$$;

set local role service_role;
do $$
declare
  ctx pg_temp.order_ctx%rowtype;
  repurchase public.payment_orders%rowtype;
begin
  select * into strict ctx from pg_temp.order_ctx where label = 'bundle-first';
  repurchase := public.create_sku_payment_order(
    ctx.user_id, 'stars_handful', 'USD', true
  );
  perform public.fulfill_payment_order(
    repurchase.external_id, 28003, 'payment', true,
    '{"notification_type":"payment","transaction":{"id":28003}}'::jsonb
  );

  insert into pg_temp.order_ctx (
    label, order_id, external_id, txn, user_id
  ) values (
    'bundle-repurchase', repurchase.id, repurchase.external_id, 28003,
    repurchase.user_id
  );
end;
$$;
reset role;

do $$
declare
  repurchase_ctx pg_temp.order_ctx%rowtype;
begin
  select * into strict repurchase_ctx
  from pg_temp.order_ctx
  where label = 'bundle-repurchase';

  if not exists (
       select 1 from public.star_bundle_fulfillments
       where order_id = repurchase_ctx.order_id and credited_stars = 120 and first_time_applied
     ) then
    raise exception 'Refunded first purchase did not restore double-raw eligibility';
  end if;
end;
$$;

-- TEST FIXTURE ONLY: paid spending is not activated yet, so no canonical paid
-- debit exists. Simulate that future state by lowering the materialized balance.
-- The refund persists one unresolved receipt and LOGs 55000, but returns the
-- fulfilled order without reversing credit/eligibility or marking it refunded.
set local role service_role;
do $$
declare
  created public.payment_orders%rowtype;
begin
  created := public.create_sku_payment_order(
    'c0280000-0000-4028-8028-000000000002',
    'stars_handful',
    'USD',
    true
  );
  perform public.fulfill_payment_order(
    created.external_id, 28101, 'payment', true,
    '{"notification_type":"payment","transaction":{"id":28101}}'::jsonb
  );
  insert into pg_temp.order_ctx (
    label, order_id, external_id, txn, user_id
  ) values (
    'bundle-insolvent', created.id, created.external_id, 28101,
    created.user_id
  );
end;
$$;

reset role;
update public.wallet_balances
set current_balance = 0
where user_id = 'c0280000-0000-4028-8028-000000000002'
  and currency_id = 'stars'
  and balance_bucket = 'paid';
set local role service_role;

do $$
declare
  ctx pg_temp.order_ctx%rowtype;
  attempted public.payment_orders%rowtype;
begin
  select * into strict ctx from pg_temp.order_ctx where label = 'bundle-insolvent';
  attempted := public.refund_payment_order(
    28101, 'refund', true,
    '{"notification_type":"refund","transaction":{"id":28101}}'::jsonb
  );

  update pg_temp.order_ctx
  set status = attempted.status
  where label = 'bundle-insolvent';
end;
$$;
reset role;

do $$
declare
  ctx pg_temp.order_ctx%rowtype;
begin
  select * into strict ctx
  from pg_temp.order_ctx
  where label = 'bundle-insolvent';

  if ctx.status <> 'fulfilled' or
     not exists (
       select 1 from public.unresolved_payment_reversals
       where order_id = ctx.order_id
         and reversal_class = 'star_bundle'
         and required_stars = 120
         and available_stars = 0
     ) or
     exists (
       select 1 from public.star_bundle_first_purchase_events
       where order_id = ctx.order_id and event_type = 'reversed'
     ) or
     exists (
       select 1 from public.payment_refund_reversals
       where order_id = ctx.order_id
     ) then
    raise exception 'Insolvent refund did not remain durable, unresolved, and non-mutating';
  end if;
end;
$$;

-- Lunar uses transaction.id as an invoice key and only signed
-- purchase.subscription fields. Every renewal on the bound subscription grants
-- once; refunding one invoice leaves the order fulfilled for future invoices.
set local role service_role;
do $$
declare
  created public.payment_orders%rowtype;
  fulfilled public.payment_orders%rowtype;
  event jsonb;
begin
  created := public.create_sku_payment_order(
    'c0280000-0000-4028-8028-000000000003',
    'lunar_pass_monthly',
    'USD',
    true
  );
  event := jsonb_build_object(
    'notification_type', 'payment',
    'transaction', jsonb_build_object('id', 28201),
    'purchase', jsonb_build_object(
      'subscription', jsonb_build_object(
        'subscription_id', 'slice28-sub',
        'plan_id', 'owner-provider-plan',
        'product_id', 'lunar-pass'
      )
    )
  );
  fulfilled := public.fulfill_payment_order(
    created.external_id, 28201, 'payment', true, event
  );
  perform public.fulfill_payment_order(
    created.external_id, 28201, 'payment', true, event
  );

  insert into pg_temp.order_ctx (
    label, order_id, external_id, txn, user_id, status
  ) values (
    'lunar-order', created.id, created.external_id, 28201,
    created.user_id, fulfilled.status
  );
end;
$$;
reset role;

do $$
declare
  ctx pg_temp.order_ctx%rowtype;
begin
  select * into strict ctx
  from pg_temp.order_ctx
  where label = 'lunar-order';

  if ctx.status <> 'fulfilled' or
     (select count(*) from public.lunar_purchase_star_grants
      where user_id = ctx.user_id and xsolla_transaction_id = 28201) <> 1 or
     (select count(*) from public.lunar_order_invoices
      where order_id = ctx.order_id and xsolla_transaction_id = 28201) <> 1 or
     (select current_balance from public.wallet_balances
      where user_id = ctx.user_id and currency_id = 'stars'
        and balance_bucket = 'promotional') <> 300 then
    raise exception 'Lunar payment did not grant exactly 300 once per invoice';
  end if;
end;
$$;

set local role service_role;
do $$
declare
  renewal_event jsonb;
begin
  renewal_event := jsonb_build_object(
    'notification_type', 'payment',
    'transaction', jsonb_build_object('id', 28202),
    'purchase', jsonb_build_object(
      'subscription', jsonb_build_object(
        'subscription_id', 'slice28-sub',
        'plan_id', 'owner-provider-plan',
        'product_id', 'lunar-pass'
      )
    )
  );
  perform public.fulfill_payment_order(
    null, 28202, 'payment', true, renewal_event
  );
  perform public.fulfill_payment_order(
    null, 28202, 'payment', true, renewal_event
  );
end;
$$;
reset role;

do $$
declare
  ctx pg_temp.order_ctx%rowtype;
begin
  select * into strict ctx
  from pg_temp.order_ctx
  where label = 'lunar-order';

  if (select count(*) from public.lunar_order_invoices
      where order_id = ctx.order_id) <> 2 or
     (select count(*) from public.lunar_purchase_star_grants
      where user_id = ctx.user_id) <> 2 or
     (select current_balance from public.wallet_balances
      where user_id = ctx.user_id and currency_id = 'stars'
        and balance_bucket = 'promotional') <> 600 then
    raise exception 'Distinct Lunar renewal invoice did not grant exactly once';
  end if;
end;
$$;

set local role service_role;
do $$
declare
  refunded public.payment_orders%rowtype;
begin
  refunded := public.refund_payment_order(
    28202, 'refund', true,
    '{"notification_type":"refund","transaction":{"id":28202}}'::jsonb
  );

  update pg_temp.order_ctx
  set status = refunded.status
  where label = 'lunar-order';
end;
$$;
reset role;

do $$
declare
  ctx pg_temp.order_ctx%rowtype;
begin
  select * into strict ctx
  from pg_temp.order_ctx
  where label = 'lunar-order';

  if ctx.status <> 'fulfilled' or
     (select current_balance from public.wallet_balances
      where user_id = ctx.user_id and currency_id = 'stars'
        and balance_bucket = 'promotional') <> 300 or
     not exists (
       select 1 from public.payment_refund_reversals
       where order_id = ctx.order_id
         and xsolla_transaction_id = 28202
         and reversed_stars = 300
     ) then
    raise exception 'Lunar invoice refund did not reverse exactly 300 without poisoning the order';
  end if;
end;
$$;

set local role service_role;
do $$
begin
  perform public.refund_payment_order(
    28202, 'chargeback', true,
    '{"notification_type":"chargeback","transaction":{"id":28202}}'::jsonb
  );
end;
$$;
reset role;

do $$
declare
  ctx pg_temp.order_ctx%rowtype;
begin
  select * into strict ctx
  from pg_temp.order_ctx
  where label = 'lunar-order';

  if (select count(*) from public.payment_refund_reversals
      where order_id = ctx.order_id and xsolla_transaction_id = 28202) <> 1 or
     (select current_balance from public.wallet_balances
      where user_id = ctx.user_id and currency_id = 'stars'
        and balance_bucket = 'promotional') <> 300 then
    raise exception 'Second Lunar reversal type re-reversed one invoice';
  end if;
end;
$$;

set local role service_role;
do $$
declare
  later_event jsonb;
begin
  later_event := jsonb_build_object(
    'notification_type', 'payment',
    'transaction', jsonb_build_object('id', 28203),
    'purchase', jsonb_build_object(
      'subscription', jsonb_build_object(
        'subscription_id', 'slice28-sub',
        'plan_id', 'owner-provider-plan',
        'product_id', 'lunar-pass'
      )
    )
  );
  perform public.fulfill_payment_order(
    null, 28203, 'payment', true, later_event
  );
end;
$$;
reset role;

do $$
declare
  ctx pg_temp.order_ctx%rowtype;
begin
  select * into strict ctx
  from pg_temp.order_ctx
  where label = 'lunar-order';

  if (select count(*) from public.lunar_order_invoices
      where order_id = ctx.order_id) <> 3 or
     (select count(*) from public.lunar_purchase_star_grants
      where user_id = ctx.user_id) <> 3 or
     (select current_balance from public.wallet_balances
      where user_id = ctx.user_id and currency_id = 'stars'
        and balance_bucket = 'promotional') <> 600 then
    raise exception 'Refunded Lunar invoice poisoned a later renewal invoice';
  end if;
end;
$$;

-- The legacy catalog-item create/fulfill/refund path still establishes and
-- revokes the exact entitlement.
set local role service_role;
do $$
declare
  created public.payment_orders%rowtype;
  fulfilled public.payment_orders%rowtype;
  refunded public.payment_orders%rowtype;
begin
  created := public.create_payment_order(
    'c0280000-0000-4028-8028-000000000004',
    'void-crystal/d20/legendary@1',
    799,
    'USD',
    true
  );
  fulfilled := public.fulfill_payment_order(
    created.external_id, 28301, 'payment', true,
    '{"notification_type":"payment","transaction":{"id":28301}}'::jsonb
  );
  refunded := public.refund_payment_order(
    28301, 'refund', true,
    '{"notification_type":"refund","transaction":{"id":28301}}'::jsonb
  );

  insert into pg_temp.order_ctx (
    label, order_id, external_id, txn, user_id, status,
    entitlement_id, entitlement_created
  ) values (
    'legacy-die', created.id, created.external_id, 28301, created.user_id,
    refunded.status, fulfilled.entitlement_id, fulfilled.entitlement_created
  );
end;
$$;
reset role;

do $$
declare
  ctx pg_temp.order_ctx%rowtype;
begin
  select * into strict ctx
  from pg_temp.order_ctx
  where label = 'legacy-die';

  if ctx.entitlement_id is null or not ctx.entitlement_created then
    raise exception 'Legacy die fulfillment changed under SKU branching';
  end if;
  if ctx.status <> 'refunded' or
     not exists (
       select 1 from public.user_entitlements
       where id = ctx.entitlement_id and revoked_at is not null
     ) then
    raise exception 'Legacy die refund changed under SKU branching';
  end if;
end;
$$;

-- Registry retunes after checkout cannot change the immutable order snapshot or
-- fulfillment amount.
set local role service_role;
do $$
declare
  created public.payment_orders%rowtype;
begin
  created := public.create_sku_payment_order(
    'c0280000-0000-4028-8028-000000000005',
    'stars_handful',
    'USD',
    true
  );

  insert into pg_temp.order_ctx (
    label, order_id, external_id, txn, user_id
  ) values (
    'registry-retune', created.id, created.external_id, 28401,
    created.user_id
  );
end;
$$;
reset role;

update public.store_skus
set price_usd_cents = 59,
    star_raw = 70,
    star_bonus = 0,
    star_total = 70,
    first_time_total = 140,
    value_version = 2
where sku_id = 'stars_handful';

set local role service_role;
do $$
declare
  ctx pg_temp.order_ctx%rowtype;
begin
  select * into strict ctx
  from pg_temp.order_ctx
  where label = 'registry-retune';
  perform public.fulfill_payment_order(
    ctx.external_id, ctx.txn, 'payment', true,
    '{"notification_type":"payment","transaction":{"id":28401}}'::jsonb
  );
end;
$$;
reset role;

do $$
declare
  ctx pg_temp.order_ctx%rowtype;
begin
  select * into strict ctx
  from pg_temp.order_ctx
  where label = 'registry-retune';

  if not exists (
       select 1
       from public.star_bundle_fulfillments
       where order_id = ctx.order_id
         and credited_stars = 120
         and sku_value_version = 1
     ) or
     (select amount_minor from public.payment_orders where id = ctx.order_id) <> 49 then
    raise exception 'Registry retune changed an existing order fulfillment snapshot';
  end if;

  begin
    update public.payment_orders
    set sku_star_total = 999
    where id = ctx.order_id;
    raise exception 'Payment order SKU snapshot mutation unexpectedly succeeded';
  exception when sqlstate '55000' then
    null;
  end;
end;
$$;

-- Least privilege plus actual-call probes: only service_role executes the new
-- creation boundary, and no API role mutates append-only fulfillment receipts.
do $$
begin
  if not has_function_privilege(
       'service_role',
       'public.create_sku_payment_order(uuid,text,text,boolean)',
       'EXECUTE'
     ) or
     has_function_privilege(
       'authenticated',
       'public.create_sku_payment_order(uuid,text,text,boolean)',
       'EXECUTE'
     ) or
     has_table_privilege(
       'authenticated', 'public.star_bundle_fulfillments', 'SELECT'
     ) or
     has_table_privilege(
       'service_role', 'public.star_bundle_fulfillments', 'UPDATE'
     ) then
    raise exception 'SKU fulfillment privilege boundary drifted';
  end if;
end;
$$;

set local "request.jwt.claims" =
  '{"sub":"c0280000-0000-4028-8028-000000000001","is_anonymous":false}';
set local role authenticated;
do $$
begin
  begin
    perform public.create_sku_payment_order(
      'c0280000-0000-4028-8028-000000000001',
      'stars_handful',
      'USD',
      true
    );
    raise exception 'Authenticated registry order creation unexpectedly succeeded';
  exception when insufficient_privilege then
    null;
  end;
end;
$$;
reset role;
set local "request.jwt.claims" = '{}';

do $$
begin
  begin
    update public.star_bundle_first_purchases set created_at = now();
    raise exception 'First-purchase history update unexpectedly succeeded';
  exception when sqlstate '55000' then
    null;
  end;
end;
$$;

rollback;
