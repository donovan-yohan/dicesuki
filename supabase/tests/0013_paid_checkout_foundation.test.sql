begin;

insert into auth.users (id) values
  ('c0130000-0000-4000-8000-000000000001'),
  ('c0130000-0000-4000-8000-000000000002'),
  ('c0130000-0000-4000-8000-000000000003'),
  ('c0130000-0000-4000-8000-000000000004'),
  ('c0130000-0000-4000-8000-000000000005'),
  ('c0130000-0000-4000-8000-000000000006'),
  ('c0130000-0000-4000-8000-000000000007');

-- Stash generated order identifiers for the trusted (postgres-role) steps. The
-- buyer-visible RLS checks below filter by user_id and never read this table.
create temporary table order_ctx (
  label       text primary key,
  order_id    uuid not null,
  external_id uuid not null,
  txn         bigint
);

-- ---------------------------------------------------------------------------
-- Foundation: the paid bucket is a legal domain value but still inert. No paid
-- balance row can exist because the immutable currency/bucket pair rule and the
-- ledger append boundary admit no paid currency in this slice.
-- ---------------------------------------------------------------------------
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.wallet_balances'::regclass
      and conname = 'wallet_balances_balance_bucket_check'
      and pg_get_constraintdef(oid) like '%''paid''%'
  ) then
    raise exception 'wallet bucket domain was not extended with the paid value';
  end if;
end;
$$;

-- Seed a wallet account through the one existing append boundary, then prove a
-- paid balance row is still rejected by the untouched pair constraint.
select public.append_wallet_ledger_entry(
  'c0130000-0000-4000-8000-000000000005',
  'stars', 'promotional', 160,
  'test.paid-foundation', 'paid-foundation:seed',
  'earned-collection@1', '{}'::jsonb
);

do $$
begin
  begin
    insert into public.wallet_balances (account_id, user_id, currency_id, balance_bucket)
    select id, user_id, 'stars', 'paid'
    from public.wallet_accounts
    where user_id = 'c0130000-0000-4000-8000-000000000005';
    raise exception 'A paid wallet balance row was unexpectedly accepted';
  exception when check_violation then
    null;
  end;
end;
$$;

-- ---------------------------------------------------------------------------
-- Order creation and buyer own-row RLS.
-- ---------------------------------------------------------------------------
insert into order_ctx (label, order_id, external_id, txn)
select 'a', created.id, created.external_id, 900000001
from public.create_payment_order(
  'c0130000-0000-4000-8000-000000000001',
  'void-crystal/d20/legendary@1',
  499,
  'USD',
  true
) as created;

do $$
begin
  if (select count(*) from public.payment_orders
      where user_id = 'c0130000-0000-4000-8000-000000000001'
        and status = 'pending'
        and dry_run
        and amount_minor = 499
        and currency = 'USD'
        and xsolla_transaction_id is null
        and entitlement_id is null) <> 1 then
    raise exception 'create_payment_order did not persist one pending order';
  end if;
end;
$$;

-- The buyer reads only their own order; a different signed-in user sees nothing.
set local "request.jwt.claims" = '{"sub":"c0130000-0000-4000-8000-000000000001","is_anonymous":false}';
set local role authenticated;
do $$
begin
  if (select count(*) from public.payment_orders
      where user_id = 'c0130000-0000-4000-8000-000000000001') <> 1 then
    raise exception 'Buyer could not read their own payment order under RLS';
  end if;
  begin
    perform 1 from public.payment_events;
    raise exception 'Authenticated caller read raw payment events';
  exception when insufficient_privilege then
    null;
  end;
end;
$$;
reset role;

set local "request.jwt.claims" = '{"sub":"c0130000-0000-4000-8000-000000000002","is_anonymous":false}';
set local role authenticated;
do $$
begin
  if (select count(*) from public.payment_orders
      where user_id = 'c0130000-0000-4000-8000-000000000001') <> 0 then
    raise exception 'RLS leaked another buyer''s payment order';
  end if;
end;
$$;
reset role;

-- ---------------------------------------------------------------------------
-- Fulfillment grants exactly one purchase entitlement and flips the order.
-- ---------------------------------------------------------------------------
do $$
declare
  ctx order_ctx%rowtype;
  fulfilled public.payment_orders%rowtype;
begin
  select * into strict ctx from order_ctx where label = 'a';
  fulfilled := public.fulfill_payment_order(
    ctx.external_id, ctx.txn, 'payment', true,
    jsonb_build_object('transaction', jsonb_build_object('id', ctx.txn, 'dry_run', 1))
  );

  if fulfilled.status <> 'fulfilled' or
     fulfilled.xsolla_transaction_id <> ctx.txn or
     fulfilled.entitlement_id is null or
     fulfilled.paid_at is null or
     fulfilled.fulfilled_at is null then
    raise exception 'Fulfillment did not flip the order to a bound fulfilled state';
  end if;

  if (select count(*) from public.user_entitlements
      where user_id = 'c0130000-0000-4000-8000-000000000001'
        and catalog_item_id = 'void-crystal/d20/legendary@1'
        and grant_reason = 'purchase'
        and grant_ref = 'payment-order:' || ctx.external_id::text
        and provenance ->> 'source' = 'purchase'
        and revoked_at is null) <> 1 then
    raise exception 'Fulfillment did not grant exactly one purchase entitlement';
  end if;

  if (select count(*) from public.user_entitlements
      where user_id = 'c0130000-0000-4000-8000-000000000001') <> 1 or
     (select count(*) from public.wallet_ledger_entries
      where user_id = 'c0130000-0000-4000-8000-000000000001') <> 0 then
    raise exception 'Direct cosmetic fulfillment touched extra grants or the wallet ledger';
  end if;

  if (select entitlement_id from public.payment_orders where id = ctx.order_id) <> (
       select id from public.user_entitlements
       where user_id = 'c0130000-0000-4000-8000-000000000001'
         and catalog_item_id = 'void-crystal/d20/legendary@1'
     ) then
    raise exception 'Order entitlement link does not match the granted row';
  end if;

  if (select count(*) from public.payment_events where order_id = ctx.order_id) <> 1 then
    raise exception 'Fulfillment did not record exactly one webhook event';
  end if;
end;
$$;

-- Exact replay of the same (transaction, event_type) is a no-op returning prior
-- state. An out-of-order distinct event type is audited but never re-grants.
do $$
declare
  ctx order_ctx%rowtype;
  replayed public.payment_orders%rowtype;
  reordered public.payment_orders%rowtype;
begin
  select * into strict ctx from order_ctx where label = 'a';

  replayed := public.fulfill_payment_order(
    ctx.external_id, ctx.txn, 'payment', true, '{}'::jsonb
  );
  if replayed.status <> 'fulfilled' then
    raise exception 'Exact fulfillment replay changed the order';
  end if;
  if (select count(*) from public.payment_events where order_id = ctx.order_id) <> 1 or
     (select count(*) from public.user_entitlements
      where user_id = 'c0130000-0000-4000-8000-000000000001') <> 1 then
    raise exception 'Exact fulfillment replay double-recorded or double-granted';
  end if;

  reordered := public.fulfill_payment_order(
    ctx.external_id, ctx.txn, 'order_paid', true, '{}'::jsonb
  );
  if reordered.status <> 'fulfilled' then
    raise exception 'Out-of-order webhook changed the fulfilled order';
  end if;
  if (select count(*) from public.payment_events where order_id = ctx.order_id) <> 2 or
     (select count(*) from public.user_entitlements
      where user_id = 'c0130000-0000-4000-8000-000000000001') <> 1 then
    raise exception 'Out-of-order webhook re-granted or skipped its audit row';
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- Fulfillment fails closed on sandbox/production, bound-transaction, and
-- unknown-order mismatches.
-- ---------------------------------------------------------------------------
insert into order_ctx (label, order_id, external_id, txn)
select 'b', created.id, created.external_id, 900000002
from public.create_payment_order(
  'c0130000-0000-4000-8000-000000000002',
  'celestial-gold/d20/epic@1',
  999,
  'USD',
  true
) as created;

do $$
declare
  ctx order_ctx%rowtype;
begin
  select * into strict ctx from order_ctx where label = 'b';

  begin
    perform public.fulfill_payment_order(ctx.external_id, ctx.txn, 'payment', false, '{}'::jsonb);
    raise exception 'A production webhook fulfilled a sandbox order';
  exception when sqlstate '22023' then
    null;
  end;

  begin
    perform public.fulfill_payment_order(
      gen_random_uuid(), 900000099, 'payment', true, '{}'::jsonb
    );
    raise exception 'An unknown order was fulfilled';
  exception when sqlstate '23503' then
    null;
  end;

  -- Bind the order to its transaction, then a different transaction fails closed.
  perform public.fulfill_payment_order(ctx.external_id, ctx.txn, 'payment', true, '{}'::jsonb);
  begin
    perform public.fulfill_payment_order(ctx.external_id, 900000098, 'order_paid', true, '{}'::jsonb);
    raise exception 'A second transaction rebound an already-bound order';
  exception when sqlstate '22023' then
    null;
  end;
end;
$$;

-- ---------------------------------------------------------------------------
-- Fulfillment for an already-owned cosmetic links the existing entitlement
-- rather than creating a duplicate.
-- ---------------------------------------------------------------------------
insert into public.user_entitlements (user_id, catalog_item_id, grant_reason, grant_ref)
values (
  'c0130000-0000-4000-8000-000000000004',
  'materials-lab/steel-d20@1',
  'test.preowned',
  'test:preowned:steel'
);

insert into order_ctx (label, order_id, external_id, txn)
select 'd', created.id, created.external_id, 900000004
from public.create_payment_order(
  'c0130000-0000-4000-8000-000000000004',
  'materials-lab/steel-d20@1',
  299,
  'USD',
  true
) as created;

do $$
declare
  ctx order_ctx%rowtype;
  fulfilled public.payment_orders%rowtype;
begin
  select * into strict ctx from order_ctx where label = 'd';
  fulfilled := public.fulfill_payment_order(ctx.external_id, ctx.txn, 'payment', true, '{}'::jsonb);

  if (select count(*) from public.user_entitlements
      where user_id = 'c0130000-0000-4000-8000-000000000004'
        and catalog_item_id = 'materials-lab/steel-d20@1') <> 1 then
    raise exception 'Fulfilling an owned cosmetic duplicated the entitlement';
  end if;
  if fulfilled.entitlement_id <> (
       select id from public.user_entitlements
       where user_id = 'c0130000-0000-4000-8000-000000000004'
         and catalog_item_id = 'materials-lab/steel-d20@1'
     ) then
    raise exception 'Order did not link the pre-existing entitlement';
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- Refund reverses the entitlement, marks the order, and is replay-safe.
-- ---------------------------------------------------------------------------
insert into order_ctx (label, order_id, external_id, txn)
select 'c', created.id, created.external_id, 900000003
from public.create_payment_order(
  'c0130000-0000-4000-8000-000000000003',
  'infernal-obsidian/d20/mythic@1',
  1499,
  'EUR',
  true
) as created;

do $$
declare
  ctx order_ctx%rowtype;
  refunded public.payment_orders%rowtype;
begin
  select * into strict ctx from order_ctx where label = 'c';
  perform public.fulfill_payment_order(ctx.external_id, ctx.txn, 'payment', true, '{}'::jsonb);

  refunded := public.refund_payment_order(ctx.txn, 'refund', true, '{}'::jsonb);
  if refunded.status <> 'refunded' or refunded.refunded_at is null then
    raise exception 'Refund did not mark the order refunded';
  end if;
  if (select revoked_at from public.user_entitlements where id = refunded.entitlement_id) is null then
    raise exception 'Refund did not revoke the purchased entitlement';
  end if;

  -- Exact refund replay is a no-op.
  perform public.refund_payment_order(ctx.txn, 'refund', true, '{}'::jsonb);
  if (select count(*) from public.payment_events
      where order_id = ctx.order_id and event_type = 'refund') <> 1 then
    raise exception 'Refund replay double-recorded the reversal';
  end if;

  -- A chargeback after refund is audited but does not re-reverse.
  perform public.refund_payment_order(ctx.txn, 'chargeback', true, '{}'::jsonb);
  if (select count(*) from public.payment_events where order_id = ctx.order_id) <> 3 or
     (select status from public.payment_orders where id = ctx.order_id) <> 'refunded' then
    raise exception 'Chargeback after refund changed state or skipped its audit row';
  end if;

  -- A refund for an unknown transaction fails closed.
  begin
    perform public.refund_payment_order(900000097, 'refund', true, '{}'::jsonb);
    raise exception 'A refund succeeded for an unbound transaction';
  exception when sqlstate '23503' then
    null;
  end;
end;
$$;

-- ---------------------------------------------------------------------------
-- Entitlement lineage (P1a): earned-grant -> buy -> refund. The order only LINKS
-- the die the buyer already earned, so its refund must not revoke that die.
-- ---------------------------------------------------------------------------
insert into public.user_entitlements (user_id, catalog_item_id, grant_reason, grant_ref, provenance)
values (
  'c0130000-0000-4000-8000-000000000006',
  'dragon-jade/d20/rare@1',
  'earned',
  'test:earned:dragon',
  jsonb_build_object('source', 'earned')
);

insert into order_ctx (label, order_id, external_id, txn)
select 'e', created.id, created.external_id, 900000006
from public.create_payment_order(
  'c0130000-0000-4000-8000-000000000006',
  'dragon-jade/d20/rare@1',
  599,
  'USD',
  true
) as created;

do $$
declare
  ctx order_ctx%rowtype;
  earned_id uuid;
  fulfilled public.payment_orders%rowtype;
  refunded public.payment_orders%rowtype;
begin
  select * into strict ctx from order_ctx where label = 'e';
  select id into strict earned_id
  from public.user_entitlements
  where user_id = 'c0130000-0000-4000-8000-000000000006'
    and catalog_item_id = 'dragon-jade/d20/rare@1';

  -- Fulfillment links the pre-existing earned grant and records that this order
  -- did NOT establish it (entitlement_created is false).
  fulfilled := public.fulfill_payment_order(ctx.external_id, ctx.txn, 'payment', true, '{}'::jsonb);
  if fulfilled.entitlement_id <> earned_id or fulfilled.entitlement_created then
    raise exception 'An order over an earned grant wrongly claimed entitlement creation';
  end if;
  if (select count(*) from public.user_entitlements
      where user_id = 'c0130000-0000-4000-8000-000000000006'
        and catalog_item_id = 'dragon-jade/d20/rare@1') <> 1 then
    raise exception 'Fulfilling over an earned grant duplicated the entitlement';
  end if;

  -- Refund marks the order refunded and audits the reversal, but the earned die
  -- the buyer owned independently must survive intact.
  refunded := public.refund_payment_order(ctx.txn, 'refund', true, '{}'::jsonb);
  if refunded.status <> 'refunded' then
    raise exception 'Refund did not mark the linked-earned order refunded';
  end if;
  if (select revoked_at from public.user_entitlements where id = earned_id) is not null then
    raise exception 'Refund over-revoked an independently-earned entitlement';
  end if;
  if (select count(*) from public.user_entitlements
      where user_id = 'c0130000-0000-4000-8000-000000000006'
        and catalog_item_id = 'dragon-jade/d20/rare@1'
        and revoked_at is null) <> 1 then
    raise exception 'The earned die did not survive the refund as a single active row';
  end if;
  if (select count(*) from public.payment_events
      where order_id = ctx.order_id and event_type = 'refund') <> 1 then
    raise exception 'Refund without a revoke skipped its audit event';
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- Entitlement lineage (P1b): buy -> refund -> buy. The refund revokes the row
-- this purchase created; the second purchase reactivates that same row rather
-- than under-granting. One entitlement row, both fulfill calls settle fulfilled.
-- ---------------------------------------------------------------------------
insert into order_ctx (label, order_id, external_id, txn)
select 'f', created.id, created.external_id, 900000007
from public.create_payment_order(
  'c0130000-0000-4000-8000-000000000007',
  'lucky-bronze/d20/uncommon@1',
  349,
  'USD',
  true
) as created;

insert into order_ctx (label, order_id, external_id, txn)
select 'g', created.id, created.external_id, 900000008
from public.create_payment_order(
  'c0130000-0000-4000-8000-000000000007',
  'lucky-bronze/d20/uncommon@1',
  349,
  'USD',
  true
) as created;

do $$
declare
  first_ctx    order_ctx%rowtype;
  second_ctx   order_ctx%rowtype;
  first_order  public.payment_orders%rowtype;
  second_order public.payment_orders%rowtype;
  entitlement_id_1 uuid;
  entitlement_id_2 uuid;
begin
  select * into strict first_ctx  from order_ctx where label = 'f';
  select * into strict second_ctx from order_ctx where label = 'g';

  -- Buy: creates and owns the entitlement.
  first_order := public.fulfill_payment_order(first_ctx.external_id, first_ctx.txn, 'payment', true, '{}'::jsonb);
  if first_order.status <> 'fulfilled' or not first_order.entitlement_created then
    raise exception 'First purchase did not fulfill and record entitlement creation';
  end if;
  entitlement_id_1 := first_order.entitlement_id;
  if (select revoked_at from public.user_entitlements where id = entitlement_id_1) is not null then
    raise exception 'First purchase left the entitlement revoked';
  end if;

  -- Refund: revokes the row this purchase created.
  perform public.refund_payment_order(first_ctx.txn, 'refund', true, '{}'::jsonb);
  if (select revoked_at from public.user_entitlements where id = entitlement_id_1) is null then
    raise exception 'Refund of a self-created purchase did not revoke the entitlement';
  end if;

  -- Buy again: reactivates the SAME revoked row instead of under-granting.
  second_order := public.fulfill_payment_order(second_ctx.external_id, second_ctx.txn, 'payment', true, '{}'::jsonb);
  if second_order.status <> 'fulfilled' or not second_order.entitlement_created then
    raise exception 'Second purchase after refund did not fulfill and re-establish the grant';
  end if;
  entitlement_id_2 := second_order.entitlement_id;
  if entitlement_id_2 <> entitlement_id_1 then
    raise exception 'Second purchase created a duplicate entitlement instead of reactivating';
  end if;
  if (select count(*) from public.user_entitlements
      where user_id = 'c0130000-0000-4000-8000-000000000007'
        and catalog_item_id = 'lucky-bronze/d20/uncommon@1') <> 1 then
    raise exception 'Buy-refund-buy left more than one entitlement row';
  end if;
  if (select revoked_at from public.user_entitlements where id = entitlement_id_2) is not null then
    raise exception 'Second purchase did not reactivate the revoked entitlement';
  end if;
  if (select status from public.payment_orders where id = first_ctx.order_id) <> 'refunded' or
     (select status from public.payment_orders where id = second_ctx.order_id) <> 'fulfilled' then
    raise exception 'Buy-refund-buy did not leave order one refunded and order two fulfilled';
  end if;

  -- Lineage re-ownership: because the second purchase re-established the die, a
  -- later refund of that order revokes it again (no free die survives a refund).
  perform public.refund_payment_order(second_ctx.txn, 'refund', true, '{}'::jsonb);
  if (select revoked_at from public.user_entitlements where id = entitlement_id_2) is null then
    raise exception 'Refund of the reactivating purchase did not revoke the die';
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- Realtime (P2): payment_orders is published so a buyer's client receives its
-- own fulfill/refund transitions; the raw event ledger is never published.
-- ---------------------------------------------------------------------------
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'payment_orders'
  ) then
    raise exception 'payment_orders is not published to supabase_realtime';
  end if;
  if exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'payment_events'
  ) then
    raise exception 'payment_events must never be published to supabase_realtime';
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- create_payment_order input validation.
-- ---------------------------------------------------------------------------
do $$
begin
  begin
    perform public.create_payment_order(
      'c0130000-0000-4000-8000-000000000001', 'void-crystal/d20/legendary@1', 499, 'usd', true
    );
    raise exception 'A lowercase currency was accepted';
  exception when sqlstate '22023' then
    null;
  end;

  begin
    perform public.create_payment_order(
      'c0130000-0000-4000-8000-000000000001', 'void-crystal/d20/legendary@1', 0, 'USD', true
    );
    raise exception 'A non-positive amount was accepted';
  exception when sqlstate '22023' then
    null;
  end;

  begin
    perform public.create_payment_order(
      'c0130000-0000-4000-8000-000000000001', 'not-a-real-item@1', 499, 'USD', true
    );
    raise exception 'An unknown catalog item was accepted';
  exception when sqlstate '23503' then
    null;
  end;
end;
$$;

-- ---------------------------------------------------------------------------
-- Append-only guards: events reject every post-insert mutation; orders reject
-- delete and truncate while their SECURITY DEFINER status updates succeed.
-- ---------------------------------------------------------------------------
do $$
begin
  begin
    update public.payment_events set event_type = event_type
    where id = (select id from public.payment_events limit 1);
    raise exception 'A payment event update unexpectedly succeeded';
  exception when sqlstate '55000' then
    null;
  end;

  begin
    delete from public.payment_events
    where id = (select id from public.payment_events limit 1);
    raise exception 'A payment event delete unexpectedly succeeded';
  exception when sqlstate '55000' then
    null;
  end;

  begin
    truncate table public.payment_events;
    raise exception 'A payment event truncate unexpectedly succeeded';
  exception when sqlstate '55000' then
    null;
  end;

  begin
    delete from public.payment_orders
    where id = (select id from public.payment_orders limit 1);
    raise exception 'A payment order delete unexpectedly succeeded';
  exception when sqlstate '55000' then
    null;
  end;

  -- payment_events references payment_orders, so a bare truncate is refused for
  -- that dependency before any trigger; cascade reaches the reject trigger.
  begin
    truncate table public.payment_orders cascade;
    raise exception 'A payment order truncate unexpectedly succeeded';
  exception when sqlstate '55000' then
    null;
  end;
end;
$$;

-- ---------------------------------------------------------------------------
-- No API role may execute the boundaries or reach the tables directly.
-- ---------------------------------------------------------------------------
do $$
begin
  if exists (
    select 1 from pg_class
    where oid in ('public.payment_orders'::regclass, 'public.payment_events'::regclass)
      and (not relrowsecurity or not relforcerowsecurity)
  ) then
    raise exception 'Every 0013 table must force RLS';
  end if;

  if not has_table_privilege('authenticated', 'public.payment_orders', 'SELECT') or
     has_table_privilege('anon', 'public.payment_orders', 'SELECT') or
     not has_table_privilege('service_role', 'public.payment_orders', 'SELECT') or
     has_table_privilege('authenticated', 'public.payment_events', 'SELECT') or
     not has_table_privilege('service_role', 'public.payment_events', 'SELECT') then
    raise exception 'Payment table read grants are wrong';
  end if;

  if has_table_privilege('authenticated', 'public.payment_orders', 'INSERT') or
     has_table_privilege('authenticated', 'public.payment_orders', 'UPDATE') or
     has_table_privilege('service_role', 'public.payment_orders', 'INSERT') or
     has_table_privilege('service_role', 'public.payment_orders', 'UPDATE') or
     has_table_privilege('service_role', 'public.payment_events', 'INSERT') then
    raise exception 'A payment table leaked direct DML to an API role';
  end if;

  if not has_function_privilege(
       'service_role', 'public.create_payment_order(uuid,text,bigint,text,boolean)', 'EXECUTE'
     ) or
     not has_function_privilege(
       'service_role', 'public.fulfill_payment_order(uuid,bigint,text,boolean,jsonb)', 'EXECUTE'
     ) or
     not has_function_privilege(
       'service_role', 'public.refund_payment_order(bigint,text,boolean,jsonb)', 'EXECUTE'
     ) then
    raise exception 'A service-role payment boundary is not executable';
  end if;

  if has_function_privilege(
       'authenticated', 'public.fulfill_payment_order(uuid,bigint,text,boolean,jsonb)', 'EXECUTE'
     ) or
     has_function_privilege(
       'anon', 'public.fulfill_payment_order(uuid,bigint,text,boolean,jsonb)', 'EXECUTE'
     ) or
     has_function_privilege(
       'authenticated', 'public.create_payment_order(uuid,text,bigint,text,boolean)', 'EXECUTE'
     ) or
     has_function_privilege(
       'authenticated', 'public.refund_payment_order(bigint,text,boolean,jsonb)', 'EXECUTE'
     ) then
    raise exception 'A payment boundary is API-executable';
  end if;
end;
$$;

-- A non-service API role is refused at the execution boundary.
set local role authenticated;
do $$
begin
  perform public.fulfill_payment_order(gen_random_uuid(), 1, 'payment', true, '{}'::jsonb);
  raise exception 'authenticated unexpectedly executed fulfill_payment_order';
exception when insufficient_privilege then
  null;
end;
$$;
reset role;

set local role anon;
do $$
begin
  perform public.create_payment_order(
    'c0130000-0000-4000-8000-000000000001', 'void-crystal/d20/legendary@1', 499, 'USD', true
  );
  raise exception 'anon unexpectedly executed create_payment_order';
exception when insufficient_privilege then
  null;
end;
$$;
reset role;

rollback;
