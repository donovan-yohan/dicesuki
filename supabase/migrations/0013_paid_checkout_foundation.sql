-- Migration: 0013_paid_checkout_foundation
-- Issue #153 groundwork — Xsolla sandbox paid-checkout schema (Packet A)
--
-- Migration 0012 added the pull-preparation foreign-key indexes. This migration
-- follows that merged schema and remains the next contiguous number.
--
-- This is a paid-checkout foundation for direct cosmetic purchases only. It adds
-- an inert `paid` wallet bucket domain value, a durable `payment_orders` state
-- machine, an append-only `payment_events` webhook idempotency lock, and three
-- service-role-only SECURITY DEFINER boundaries (create/fulfill/refund). It adds
-- no paid currency, no randomized chest, no client write path, and no Xsolla
-- credential handling; fulfillment truth is the webhook, never a success
-- redirect, and every entitlement grant flows through the reviewed fulfill path.
--
-- Trusted server code (the Xsolla webhook edge function, Packet B) records
-- transactions and calls these boundaries with a JWT-verified buyer id. Normal
-- clients can read only their own orders.

-- ---------------------------------------------------------------------------
-- Extend the immutable 0009 wallet bucket domain with the paid bucket.
--
-- This is a forward-only foundation. The currency/bucket pair rule and the
-- ledger append boundary still admit no paid currency, so no paid balance row
-- can exist until a later paid-currency migration extends those rules together.
-- Direct cosmetic purchases in this slice grant entitlements only and never
-- touch a wallet balance.
-- ---------------------------------------------------------------------------
alter table public.wallet_balances
  drop constraint wallet_balances_balance_bucket_check;
alter table public.wallet_balances
  add constraint wallet_balances_balance_bucket_check
  check (balance_bucket in ('promotional', 'earned', 'paid'));

-- ---------------------------------------------------------------------------
-- payment_orders: durable buyer-owned checkout state machine.
--
-- One row is created pending before checkout, bound to exactly one Xsolla
-- transaction on fulfillment, and advanced only through the SECURITY DEFINER
-- boundaries below. `external_id` is our merchant-side identifier sent to Xsolla
-- and returned to the client for cold-relaunch reconciliation. `dry_run` records
-- the sandbox flag at creation so a mismatched-environment webhook fails closed.
-- ---------------------------------------------------------------------------
create table public.payment_orders (
  id                     uuid        primary key default gen_random_uuid(),
  external_id            uuid        not null unique default gen_random_uuid(),
  user_id                uuid        not null references auth.users (id) on delete restrict,
  catalog_item_id        text        not null references public.catalog_items (id) on delete restrict,
  amount_minor           bigint      not null check (amount_minor > 0),
  currency               text        not null check (currency ~ '^[A-Z]{3}$'),
  status                 text        not null default 'pending'
    check (status in ('pending', 'paid', 'fulfilled', 'canceled', 'refunded')),
  xsolla_transaction_id  bigint      unique
    check (xsolla_transaction_id is null or xsolla_transaction_id > 0),
  dry_run                boolean     not null,
  entitlement_id         uuid,
  -- True only when THIS order's fulfill created or reactivated the linked
  -- entitlement, so a refund reverses exactly the die this purchase established
  -- and never a grant the buyer already owned (an earned grant or a prior,
  -- un-refunded purchase). Set false when fulfill only links such a grant.
  entitlement_created    boolean     not null default false,
  raw_event              jsonb       not null default '{}'::jsonb,
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now(),
  paid_at                timestamptz,
  fulfilled_at           timestamptz,
  refunded_at            timestamptz,

  constraint payment_orders_raw_event_object
    check (jsonb_typeof(raw_event) = 'object'),
  constraint payment_orders_raw_event_size
    check (octet_length(raw_event::text) <= 16384),
  constraint payment_orders_entitlement_fkey
    foreign key (entitlement_id, user_id, catalog_item_id)
    references public.user_entitlements (id, user_id, catalog_item_id)
    on delete restrict,
  -- A pending order has granted nothing. A fulfilled order proves its purchase
  -- provenance: exactly one bound transaction, one linked entitlement, and paid
  -- plus fulfilled timestamps. A refunded order retains that fulfillment lineage.
  constraint payment_orders_pending_shape
    check (
      status <> 'pending' or
      (xsolla_transaction_id is null and entitlement_id is null and
       entitlement_created is false and
       paid_at is null and fulfilled_at is null and refunded_at is null)
    ),
  constraint payment_orders_fulfilled_shape
    check (
      status <> 'fulfilled' or
      (xsolla_transaction_id is not null and entitlement_id is not null and
       paid_at is not null and fulfilled_at is not null and refunded_at is null)
    ),
  constraint payment_orders_refunded_shape
    check (
      status <> 'refunded' or
      (xsolla_transaction_id is not null and entitlement_id is not null and
       paid_at is not null and fulfilled_at is not null and refunded_at is not null)
    )
);

create index payment_orders_user_created_idx
  on public.payment_orders (user_id, created_at desc, id desc);

create index payment_orders_catalog_item_idx
  on public.payment_orders (catalog_item_id);

create index payment_orders_entitlement_idx
  on public.payment_orders (entitlement_id)
  where entitlement_id is not null;

comment on table public.payment_orders is
  'Durable buyer-owned direct-cosmetic checkout orders. Created pending, advanced only through service-role SECURITY DEFINER boundaries, and readable only by the buyer.';

-- ---------------------------------------------------------------------------
-- payment_events: append-only webhook idempotency lock.
--
-- Every processed webhook records exactly one row keyed by
-- (xsolla_transaction_id, event_type). The unique INSERT ... ON CONFLICT DO
-- NOTHING gate makes exact duplicate/out-of-order webhooks no-ops, so a
-- transaction can never double-grant across Xsolla's ~20 retries.
-- ---------------------------------------------------------------------------
create table public.payment_events (
  id                     bigint      generated always as identity primary key,
  order_id               uuid        not null references public.payment_orders (id) on delete restrict,
  xsolla_transaction_id  bigint      not null check (xsolla_transaction_id > 0),
  event_type             text        not null
    check (event_type in ('payment', 'order_paid', 'refund', 'chargeback')),
  dry_run                boolean     not null,
  raw_event              jsonb       not null default '{}'::jsonb,
  processed_at           timestamptz not null default now(),

  constraint payment_events_transaction_event_unique
    unique (xsolla_transaction_id, event_type),
  constraint payment_events_raw_event_object
    check (jsonb_typeof(raw_event) = 'object'),
  constraint payment_events_raw_event_size
    check (octet_length(raw_event::text) <= 16384)
);

create index payment_events_order_idx
  on public.payment_events (order_id, processed_at, id);

comment on table public.payment_events is
  'Immutable append-only Xsolla webhook ledger. The (xsolla_transaction_id, event_type) key is the idempotency lock that makes duplicate and out-of-order webhooks single-grant.';

-- ---------------------------------------------------------------------------
-- Append-only enforcement, including TRUNCATE. payment_orders is a mutable
-- state machine advanced only by the trusted boundaries, so it forbids delete
-- and truncate but permits the SECURITY DEFINER status updates. payment_events
-- forbids every post-insert mutation.
-- ---------------------------------------------------------------------------
create or replace function private.reject_payment_history_mutation()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception '% on %.% is forbidden; append a new immutable row instead',
    tg_op, tg_table_schema, tg_table_name
    using errcode = '55000';
end;
$$;

create trigger payment_orders_reject_delete
  before delete on public.payment_orders
  for each row execute function private.reject_payment_history_mutation();
create trigger payment_orders_reject_truncate
  before truncate on public.payment_orders
  for each statement execute function private.reject_payment_history_mutation();

create trigger payment_events_reject_update_delete
  before update or delete on public.payment_events
  for each row execute function private.reject_payment_history_mutation();
create trigger payment_events_reject_truncate
  before truncate on public.payment_events
  for each statement execute function private.reject_payment_history_mutation();

revoke all on function private.reject_payment_history_mutation()
  from public, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Service-only order creation boundary.
--
-- The Packet B create-checkout edge function verifies the buyer JWT, looks up
-- the server-side price, and calls this with the verified buyer id. The client
-- never supplies a user id, price, or SKU mapping through any API role.
-- ---------------------------------------------------------------------------
create or replace function public.create_payment_order(
  p_user_id uuid,
  p_catalog_item_id text,
  p_amount_minor bigint,
  p_currency text,
  p_dry_run boolean
)
returns public.payment_orders
language plpgsql
security definer
set search_path = ''
as $$
declare
  new_order public.payment_orders%rowtype;
begin
  if p_user_id is null then
    raise exception 'Buyer user id is required' using errcode = '22023';
  end if;
  if p_amount_minor is null or p_amount_minor <= 0 then
    raise exception 'Order amount must be positive minor units' using errcode = '22023';
  end if;
  if p_currency is null or p_currency !~ '^[A-Z]{3}$' then
    raise exception 'Order currency must be an ISO-4217 alphabetic code' using errcode = '22023';
  end if;
  if p_dry_run is null then
    raise exception 'Order sandbox flag is required' using errcode = '22023';
  end if;
  if not exists (select 1 from public.catalog_items where id = p_catalog_item_id) then
    raise exception 'Unknown catalog item %', p_catalog_item_id using errcode = '23503';
  end if;

  insert into public.payment_orders (
    user_id,
    catalog_item_id,
    amount_minor,
    currency,
    dry_run
  ) values (
    p_user_id,
    p_catalog_item_id,
    p_amount_minor,
    p_currency,
    p_dry_run
  )
  returning * into new_order;

  return new_order;
end;
$$;

comment on function public.create_payment_order(uuid, text, bigint, text, boolean) is
  'Service-role-only pending-order boundary. The trusted edge function passes a JWT-verified buyer id and a server-looked-up price; the client controls no user, price, or SKU mapping.';

-- ---------------------------------------------------------------------------
-- Service-only fulfillment boundary.
--
-- One transaction: lock the order, fail closed on a sandbox/production or bound
-- transaction mismatch, gate on the append-only webhook event, grant the
-- purchased entitlement with provenance 'purchase', and flip the order to
-- fulfilled. An exact webhook replay returns the prior order without a second
-- event or grant; a different webhook type for an already-fulfilled order is
-- audited but never re-grants. A future paid-currency top-up would append a
-- 'paid' bucket wallet ledger entry here; direct cosmetics append none.
-- ---------------------------------------------------------------------------
create or replace function public.fulfill_payment_order(
  p_external_id uuid,
  p_xsolla_transaction_id bigint,
  p_event_type text,
  p_dry_run boolean,
  p_raw_event jsonb default '{}'::jsonb
)
returns public.payment_orders
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_order public.payment_orders%rowtype;
  result_order public.payment_orders%rowtype;
  granted_entitlement_id uuid;
  entitlement_created_now boolean;
  conflicting_revoked_at timestamptz;
  event_inserted integer;
begin
  if p_external_id is null then
    raise exception 'Order external id is required' using errcode = '22023';
  end if;
  if p_xsolla_transaction_id is null or p_xsolla_transaction_id <= 0 then
    raise exception 'A positive Xsolla transaction id is required' using errcode = '22023';
  end if;
  if p_event_type is null or p_event_type not in ('payment', 'order_paid') then
    raise exception 'Unsupported fulfillment event type %', p_event_type using errcode = '22023';
  end if;
  if p_dry_run is null then
    raise exception 'Webhook sandbox flag is required' using errcode = '22023';
  end if;
  if p_raw_event is null or
     jsonb_typeof(p_raw_event) <> 'object' or
     octet_length(p_raw_event::text) > 16384 then
    raise exception 'Webhook payload must be a bounded JSON object' using errcode = '22023';
  end if;

  -- The order row is the serialization point for concurrent webhooks. Locking
  -- it before the idempotency insert forces duplicate deliveries into a stable
  -- order, so a replay observes the prior committed fulfillment.
  select * into target_order
  from public.payment_orders
  where external_id = p_external_id
  for update;
  if not found then
    raise exception 'Unknown payment order %', p_external_id using errcode = '23503';
  end if;

  if target_order.dry_run <> p_dry_run then
    raise exception 'Webhook sandbox flag does not match order %', p_external_id
      using errcode = '22023';
  end if;
  if target_order.xsolla_transaction_id is not null and
     target_order.xsolla_transaction_id <> p_xsolla_transaction_id then
    raise exception 'Order % is already bound to a different transaction', p_external_id
      using errcode = '22023';
  end if;

  insert into public.payment_events (
    order_id,
    xsolla_transaction_id,
    event_type,
    dry_run,
    raw_event
  ) values (
    target_order.id,
    p_xsolla_transaction_id,
    p_event_type,
    p_dry_run,
    p_raw_event
  )
  on conflict (xsolla_transaction_id, event_type) do nothing;
  get diagnostics event_inserted = row_count;

  -- Exact webhook replay: the (transaction, event_type) key already exists, so
  -- this delivery grants nothing and returns the prior order state.
  if event_inserted = 0 then
    return target_order;
  end if;

  -- A distinct webhook type for an order another event already advanced records
  -- its audit row above but must not re-grant.
  if target_order.status <> 'pending' then
    return target_order;
  end if;

  -- Grant the purchased cosmetic and record whether THIS order established the
  -- currently-active grant (its entitlement lineage). Three cases:
  --   1. The INSERT creates a new row              -> this order owns it.
  --   2. Conflict on a REVOKED row (a prior purchase of this die was refunded)
  --      -> reactivate it; this purchase re-establishes and owns it.
  --   3. Conflict on an ACTIVE row (an earned grant or an un-refunded prior
  --      purchase the buyer already owns) -> link it but do NOT own it, so a
  --      later refund of this order cannot revoke a die owned independently.
  insert into public.user_entitlements (
    id,
    user_id,
    catalog_item_id,
    grant_reason,
    grant_ref,
    provenance
  ) values (
    gen_random_uuid(),
    target_order.user_id,
    target_order.catalog_item_id,
    'purchase',
    'payment-order:' || target_order.external_id::text,
    jsonb_build_object(
      'source', 'purchase',
      'orderId', target_order.id,
      'externalId', target_order.external_id,
      'xsollaTransactionId', p_xsolla_transaction_id,
      'dryRun', p_dry_run
    )
  )
  on conflict (user_id, catalog_item_id) do nothing
  returning id into granted_entitlement_id;

  if granted_entitlement_id is not null then
    -- Case 1: the INSERT actually inserted a fresh entitlement row.
    entitlement_created_now := true;
  else
    -- Conflict: exactly one row already exists for this (user, item). Inspect it.
    select id, revoked_at
      into strict granted_entitlement_id, conflicting_revoked_at
    from public.user_entitlements
    where user_id = target_order.user_id
      and catalog_item_id = target_order.catalog_item_id;

    if conflicting_revoked_at is not null then
      -- Case 2: a previously refunded purchase of this die. Reactivate the same
      -- row (append provenance) instead of leaving the buyer under-granted.
      update public.user_entitlements
      set revoked_at = null,
          provenance = provenance || jsonb_build_object(
            'reactivatedBy', 'purchase',
            'reactivationOrderId', target_order.id,
            'reactivationExternalId', target_order.external_id,
            'reactivationXsollaTransactionId', p_xsolla_transaction_id,
            'reactivationDryRun', p_dry_run
          )
      where id = granted_entitlement_id;
      entitlement_created_now := true;
    else
      -- Case 3: the buyer already owns this die independently; only link it.
      entitlement_created_now := false;
    end if;
  end if;

  update public.payment_orders
  set status = 'fulfilled',
      xsolla_transaction_id = p_xsolla_transaction_id,
      entitlement_id = granted_entitlement_id,
      entitlement_created = entitlement_created_now,
      paid_at = now(),
      fulfilled_at = now(),
      raw_event = p_raw_event,
      updated_at = now()
  where id = target_order.id
  returning * into result_order;

  return result_order;
end;
$$;

comment on function public.fulfill_payment_order(uuid, bigint, text, boolean, jsonb) is
  'Service-role-only webhook fulfillment. Idempotent on (transaction, event_type) and on order status: an exact replay or out-of-order webhook returns the prior order without a second entitlement grant, and a sandbox/production mismatch fails closed.';

-- ---------------------------------------------------------------------------
-- Service-only refund/chargeback reversal boundary.
--
-- A refund webhook reverses the purchase. It revokes the linked entitlement only
-- when this order established it (`entitlement_created`); when the order merely
-- linked a die the buyer already owned independently (an earned grant or an
-- un-refunded prior purchase), the order is marked refunded and audited without
-- touching that die. Either way the order keeps its fulfillment lineage and the
-- append-only event key makes the reversal idempotent. A future paid-currency
-- purchase would also append a reversing ledger entry; direct cosmetics revoke
-- the entitlement only.
-- ---------------------------------------------------------------------------
create or replace function public.refund_payment_order(
  p_xsolla_transaction_id bigint,
  p_event_type text,
  p_dry_run boolean,
  p_raw_event jsonb default '{}'::jsonb
)
returns public.payment_orders
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_order public.payment_orders%rowtype;
  result_order public.payment_orders%rowtype;
  event_inserted integer;
begin
  if p_xsolla_transaction_id is null or p_xsolla_transaction_id <= 0 then
    raise exception 'A positive Xsolla transaction id is required' using errcode = '22023';
  end if;
  if p_event_type is null or p_event_type not in ('refund', 'chargeback') then
    raise exception 'Unsupported refund event type %', p_event_type using errcode = '22023';
  end if;
  if p_dry_run is null then
    raise exception 'Webhook sandbox flag is required' using errcode = '22023';
  end if;
  if p_raw_event is null or
     jsonb_typeof(p_raw_event) <> 'object' or
     octet_length(p_raw_event::text) > 16384 then
    raise exception 'Webhook payload must be a bounded JSON object' using errcode = '22023';
  end if;

  select * into target_order
  from public.payment_orders
  where xsolla_transaction_id = p_xsolla_transaction_id
  for update;
  if not found then
    raise exception 'No fulfilled order is bound to transaction %', p_xsolla_transaction_id
      using errcode = '23503';
  end if;

  if target_order.dry_run <> p_dry_run then
    raise exception 'Webhook sandbox flag does not match order %', target_order.external_id
      using errcode = '22023';
  end if;

  insert into public.payment_events (
    order_id,
    xsolla_transaction_id,
    event_type,
    dry_run,
    raw_event
  ) values (
    target_order.id,
    p_xsolla_transaction_id,
    p_event_type,
    p_dry_run,
    p_raw_event
  )
  on conflict (xsolla_transaction_id, event_type) do nothing;
  get diagnostics event_inserted = row_count;

  -- Exact reversal replay, or a second reversal type after the order is already
  -- refunded, records nothing new and returns the prior state.
  if event_inserted = 0 or target_order.status = 'refunded' then
    return target_order;
  end if;

  if target_order.status <> 'fulfilled' then
    raise exception 'Only a fulfilled order can be refunded (order %)', target_order.external_id
      using errcode = '55000';
  end if;

  -- Reverse the die only when THIS order established it. An order that just
  -- linked a grant the buyer owned independently (earned, or an un-refunded
  -- prior purchase) is marked refunded and audited above without revoking it.
  if target_order.entitlement_created then
    update public.user_entitlements
    set revoked_at = now()
    where id = target_order.entitlement_id
      and user_id = target_order.user_id
      and revoked_at is null;
  end if;

  update public.payment_orders
  set status = 'refunded',
      refunded_at = now(),
      raw_event = p_raw_event,
      updated_at = now()
  where id = target_order.id
  returning * into result_order;

  return result_order;
end;
$$;

comment on function public.refund_payment_order(bigint, text, boolean, jsonb) is
  'Service-role-only refund/chargeback reversal. Idempotent on the append-only event key; revokes the purchased entitlement only when this order established it (entitlement_created), otherwise marks the order refunded without touching an independently-owned die, always retaining auditable fulfillment lineage.';

-- ---------------------------------------------------------------------------
-- Forced RLS and least-privilege Data API grants.
--
-- Buyers read only their own orders. No API role receives any order or event
-- DML: the trusted edge function reaches these tables solely through the
-- service-role SECURITY DEFINER boundaries above. Raw webhook events are never
-- client-readable.
-- ---------------------------------------------------------------------------
alter table public.payment_orders enable row level security;
alter table public.payment_orders force row level security;
alter table public.payment_events enable row level security;
alter table public.payment_events force row level security;

create policy "users read their own payment orders"
  on public.payment_orders
  for select
  to authenticated
  using ((select auth.uid()) = user_id);

-- ---------------------------------------------------------------------------
-- Realtime: publish payment_orders so a buyer's client receives its own order's
-- fulfill/refund status transitions live (Xsolla settles asynchronously via the
-- webhook, so the client cannot observe fulfillment from a redirect). The forced
-- buyer own-row RLS policy above governs delivery: Realtime authorizes each
-- subscriber against that policy, so a subscriber only ever receives changes to
-- its own orders. The raw webhook ledger (payment_events) stays unpublished.
-- ---------------------------------------------------------------------------
alter publication supabase_realtime add table public.payment_orders;

revoke all on table public.payment_orders
  from public, anon, authenticated, service_role;
revoke all on table public.payment_events
  from public, anon, authenticated, service_role;

grant select on table public.payment_orders to authenticated, service_role;
grant select on table public.payment_events to service_role;

revoke all on function public.create_payment_order(uuid, text, bigint, text, boolean)
  from public, anon, authenticated, service_role;
grant execute on function public.create_payment_order(uuid, text, bigint, text, boolean)
  to service_role;

revoke all on function public.fulfill_payment_order(uuid, bigint, text, boolean, jsonb)
  from public, anon, authenticated, service_role;
grant execute on function public.fulfill_payment_order(uuid, bigint, text, boolean, jsonb)
  to service_role;

revoke all on function public.refund_payment_order(bigint, text, boolean, jsonb)
  from public, anon, authenticated, service_role;
grant execute on function public.refund_payment_order(bigint, text, boolean, jsonb)
  to service_role;

-- Identity sequences inherit PUBLIC defaults on some Postgres installations.
-- The trusted SECURITY DEFINER boundaries own the sequence as their definer;
-- API roles need no direct sequence capability.
revoke all on sequence public.payment_events_id_seq
  from public, anon, authenticated, service_role;
