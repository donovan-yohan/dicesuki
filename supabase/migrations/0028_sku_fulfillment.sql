-- Migration: 0028_sku_fulfillment
-- Monetization economy spec section 6, deltas 5-6.
--
-- Activates the sandbox/server purchase loop for registry-backed Star bundles
-- and Lunar Pass invoices while preserving the 0013 catalog-item path.

-- A stable one-row anchor satisfies the per-user/per-SKU uniqueness contract.
-- Eligibility itself is derived from immutable grant/reversal events: a grant
-- with no matching reversal is active; after its reversal the anchor remains
-- and the buyer is eligible again.
create table public.star_bundle_first_purchases (
  id          bigint      generated always as identity primary key,
  user_id     uuid        not null references auth.users (id) on delete restrict,
  sku_id      text        not null references public.store_skus (sku_id) on delete restrict,
  created_at  timestamptz not null default now(),

  constraint star_bundle_first_purchases_user_sku_unique
    unique (user_id, sku_id)
);

create table public.star_bundle_fulfillments (
  order_id                uuid        primary key
    references public.payment_orders (id) on delete restrict,
  first_purchase_id       bigint      not null
    references public.star_bundle_first_purchases (id) on delete restrict,
  user_id                 uuid        not null references auth.users (id) on delete restrict,
  sku_id                  text        not null references public.store_skus (sku_id) on delete restrict,
  credited_stars          bigint      not null check (credited_stars > 0),
  sku_value_version       integer     not null check (sku_value_version > 0),
  first_time_applied      boolean     not null,
  wallet_ledger_entry_id  bigint      not null unique
    references public.wallet_ledger_entries (id) on delete restrict,
  fulfilled_at            timestamptz not null default now()
);

create table public.star_bundle_first_purchase_events (
  id                 bigint      generated always as identity primary key,
  first_purchase_id  bigint      not null
    references public.star_bundle_first_purchases (id) on delete restrict,
  order_id           uuid        not null
    references public.star_bundle_fulfillments (order_id) on delete restrict,
  event_type         text        not null check (event_type in ('granted', 'reversed')),
  created_at         timestamptz not null default now(),

  constraint star_bundle_first_purchase_events_order_type_unique
    unique (order_id, event_type)
);

-- Successful reversals pin both sides of the append chain. Unresolved rows are
-- separate durable receipts because raising an exception would roll them back.
create table public.payment_refund_reversals (
  id                               bigint      generated always as identity primary key,
  order_id                         uuid        not null
    references public.payment_orders (id) on delete restrict,
  xsolla_transaction_id            bigint      not null check (xsolla_transaction_id > 0),
  reversal_class                   text        not null
    check (reversal_class in ('star_bundle', 'lunar_subscription')),
  source_wallet_ledger_entry_id    bigint      not null
    references public.wallet_ledger_entries (id) on delete restrict,
  reversal_wallet_ledger_entry_id  bigint      not null unique
    references public.wallet_ledger_entries (id) on delete restrict,
  reversed_stars                   bigint      not null check (reversed_stars > 0),
  created_at                       timestamptz not null default now(),

  constraint payment_refund_reversals_order_invoice_unique
    unique (order_id, xsolla_transaction_id)
);

create table public.unresolved_payment_reversals (
  id                             bigint      generated always as identity primary key,
  order_id                       uuid        not null
    references public.payment_orders (id) on delete restrict,
  xsolla_transaction_id          bigint      not null check (xsolla_transaction_id > 0),
  reversal_class                 text        not null
    check (reversal_class in ('star_bundle', 'lunar_subscription')),
  source_wallet_ledger_entry_id  bigint      not null
    references public.wallet_ledger_entries (id) on delete restrict,
  required_stars                 bigint      not null check (required_stars > 0),
  available_stars                bigint      not null check (available_stars >= 0),
  reason_code                    text        not null
    check (reason_code = 'insufficient_available_balance'),
  event_type                     text        not null
    check (event_type in ('refund', 'chargeback')),
  raw_event                      jsonb       not null default '{}'::jsonb
    check (jsonb_typeof(raw_event) = 'object' and octet_length(raw_event::text) <= 16384),
  created_at                     timestamptz not null default now(),

  constraint unresolved_payment_reversals_order_invoice_unique
    unique (order_id, xsolla_transaction_id)
);

-- Every Lunar payment transaction, including renewals after the initial order
-- fulfillment, receives its own immutable order correlation receipt.
create table public.lunar_order_invoices (
  id                         bigint      generated always as identity primary key,
  order_id                   uuid        not null
    references public.payment_orders (id) on delete restrict,
  user_id                    uuid        not null references auth.users (id) on delete restrict,
  xsolla_transaction_id      bigint      not null unique check (xsolla_transaction_id > 0),
  subscription_id            text        not null,
  plan_id                    text        not null,
  product_id                 text        not null,
  -- By-value reference only: migration 0024 makes Lunar grant receipts
  -- ordering-independent and deliberately admits no inbound history FK.
  -- UNIQUE retains a covering btree index without coupling either append-only
  -- table's TRUNCATE contract to the other.
  lunar_purchase_grant_id    bigint      not null unique,
  created_at                 timestamptz not null default now(),

  constraint lunar_order_invoices_order_transaction_unique
    unique (order_id, xsolla_transaction_id)
);

-- The trusted refund function appends this exact intent immediately before a
-- paid reversal. Generic service callers have no INSERT privilege, so the
-- canonical append cannot be invoked with a fabricated partial provenance.
create table public.payment_refund_intents (
  id                              bigint      generated always as identity primary key,
  order_id                        uuid        not null
    references public.payment_orders (id) on delete restrict,
  xsolla_transaction_id           bigint      not null check (xsolla_transaction_id > 0),
  reversal_class                  text        not null check (reversal_class = 'star_bundle'),
  source_wallet_ledger_entry_id   bigint      not null
    references public.wallet_ledger_entries (id) on delete restrict,
  reversal_amount                 bigint      not null check (reversal_amount < 0),
  idempotency_key                 text        not null,
  created_at                      timestamptz not null default now(),

  constraint payment_refund_intents_order_invoice_unique
    unique (order_id, xsolla_transaction_id),
  constraint payment_refund_intents_idempotency_unique
    unique (idempotency_key)
);

create index star_bundle_first_purchase_events_anchor_idx
  on public.star_bundle_first_purchase_events (first_purchase_id, id);
create index star_bundle_fulfillments_user_sku_idx
  on public.star_bundle_fulfillments (user_id, sku_id, order_id);
create index lunar_order_invoices_order_idx
  on public.lunar_order_invoices (order_id, id);

comment on table public.star_bundle_first_purchases is
  'Immutable unique user/SKU anchor. Active first-time use is an unreversed granted event; a successful refund appends reversed and restores eligibility per spec section 6 delta 6.';
comment on table public.star_bundle_fulfillments is
  'Immutable per-order Star credit snapshot. Amount, SKU value version, first-time decision, and exact source ledger row never follow mutable registry values.';
comment on table public.unresolved_payment_reversals is
  'Durable fail-closed refund receipts when the exact credited Stars are no longer available. The order, credit, and first-time event remain unchanged pending an owner policy.';
comment on table public.lunar_order_invoices is
  'Immutable per-invoice correlation for one Lunar checkout order. Distinct signed payment transaction ids grant independently; exact invoice replay remains idempotent.';
comment on table public.payment_refund_intents is
  'Internal immutable exact intent required by the canonical paid-Star negative gate. No API role can insert an intent directly.';

-- All new receipt surfaces are append-only, including TRUNCATE.
create trigger star_bundle_first_purchases_reject_update_delete
  before update or delete on public.star_bundle_first_purchases
  for each row execute function private.reject_payment_history_mutation();
create trigger star_bundle_first_purchases_reject_truncate
  before truncate on public.star_bundle_first_purchases
  for each statement execute function private.reject_payment_history_mutation();
create trigger star_bundle_fulfillments_reject_update_delete
  before update or delete on public.star_bundle_fulfillments
  for each row execute function private.reject_payment_history_mutation();
create trigger star_bundle_fulfillments_reject_truncate
  before truncate on public.star_bundle_fulfillments
  for each statement execute function private.reject_payment_history_mutation();
create trigger star_bundle_first_purchase_events_reject_update_delete
  before update or delete on public.star_bundle_first_purchase_events
  for each row execute function private.reject_payment_history_mutation();
create trigger star_bundle_first_purchase_events_reject_truncate
  before truncate on public.star_bundle_first_purchase_events
  for each statement execute function private.reject_payment_history_mutation();
create trigger payment_refund_reversals_reject_update_delete
  before update or delete on public.payment_refund_reversals
  for each row execute function private.reject_payment_history_mutation();
create trigger payment_refund_reversals_reject_truncate
  before truncate on public.payment_refund_reversals
  for each statement execute function private.reject_payment_history_mutation();
create trigger unresolved_payment_reversals_reject_update_delete
  before update or delete on public.unresolved_payment_reversals
  for each row execute function private.reject_payment_history_mutation();
create trigger unresolved_payment_reversals_reject_truncate
  before truncate on public.unresolved_payment_reversals
  for each statement execute function private.reject_payment_history_mutation();
create trigger lunar_order_invoices_reject_update_delete
  before update or delete on public.lunar_order_invoices
  for each row execute function private.reject_payment_history_mutation();
create trigger lunar_order_invoices_reject_truncate
  before truncate on public.lunar_order_invoices
  for each statement execute function private.reject_payment_history_mutation();
create trigger payment_refund_intents_reject_update_delete
  before update or delete on public.payment_refund_intents
  for each row execute function private.reject_payment_history_mutation();
create trigger payment_refund_intents_reject_truncate
  before truncate on public.payment_refund_intents
  for each statement execute function private.reject_payment_history_mutation();

-- Order-time immutable SKU economics. Backfill any dormant pre-activation SKU
-- orders before enforcing the closed snapshot shape.
alter table public.payment_orders
  add column sku_value_version integer,
  add column sku_price_usd_cents integer,
  add column sku_star_total integer,
  add column sku_first_time_total integer,
  add column sku_product_id text;

update public.payment_orders as orders
set sku_value_version = skus.value_version,
    sku_price_usd_cents = skus.price_usd_cents,
    sku_star_total = skus.star_total,
    sku_first_time_total = skus.first_time_total,
    sku_product_id = skus.product_id
from public.store_skus as skus
where orders.sku_id = skus.sku_id;

alter table public.payment_orders
  add constraint payment_orders_sku_snapshot_shape check (
    (
      sku_id is null and
      sku_value_version is null and
      sku_price_usd_cents is null and
      sku_star_total is null and
      sku_first_time_total is null and
      sku_product_id is null
    ) or (
      sku_id is not null and
      sku_value_version is not null and sku_value_version > 0 and
      sku_price_usd_cents is not null and sku_price_usd_cents > 0 and
      (
        (
          sku_star_total is not null and sku_star_total > 0 and
          sku_first_time_total is not null and sku_first_time_total > 0 and
          sku_product_id is null
        ) or (
          sku_star_total is null and
          sku_first_time_total is null and
          sku_product_id is not null
        )
      )
    )
  );

create or replace function private.preserve_payment_order_sku_snapshot()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if (
    new.sku_id,
    new.sku_value_version,
    new.sku_price_usd_cents,
    new.sku_star_total,
    new.sku_first_time_total,
    new.sku_product_id
  ) is distinct from (
    old.sku_id,
    old.sku_value_version,
    old.sku_price_usd_cents,
    old.sku_star_total,
    old.sku_first_time_total,
    old.sku_product_id
  ) then
    raise exception 'Payment order SKU snapshot is immutable'
      using errcode = '55000';
  end if;
  return new;
end;
$$;

create trigger payment_orders_preserve_sku_snapshot
  before update on public.payment_orders
  for each row execute function private.preserve_payment_order_sku_snapshot();

revoke all on function private.preserve_payment_order_sku_snapshot()
  from public, anon, authenticated, service_role;

-- 0013 required an entitlement for every fulfilled/refunded order. Registry
-- currency/subscription orders deliberately have no entitlement; retain every
-- timestamp/transaction invariant and make only that binding check class-aware.
alter table public.payment_orders
  drop constraint payment_orders_fulfilled_shape,
  add constraint payment_orders_fulfilled_shape
  check (
    status <> 'fulfilled' or
    (
      xsolla_transaction_id is not null and
      paid_at is not null and
      fulfilled_at is not null and
      refunded_at is null and
      (
        (catalog_item_id is not null and sku_id is null and entitlement_id is not null) or
        (catalog_item_id is null and sku_id is not null and entitlement_id is null and
         entitlement_created is false)
      )
    )
  ),
  drop constraint payment_orders_refunded_shape,
  add constraint payment_orders_refunded_shape
  check (
    status <> 'refunded' or
    (
      xsolla_transaction_id is not null and
      paid_at is not null and
      fulfilled_at is not null and
      refunded_at is not null and
      (
        (catalog_item_id is not null and sku_id is null and entitlement_id is not null) or
        (catalog_item_id is null and sku_id is not null and entitlement_id is null and
         entitlement_created is false)
      )
    )
  );

-- Separate registry creation boundary. It derives price from the locked row,
-- accepts only non-die sandbox/live SKUs, and therefore rejects drafts even
-- though service_role bypasses the registry's read policy.
create or replace function public.create_sku_payment_order(
  p_user_id uuid,
  p_sku_id text,
  p_currency text,
  p_dry_run boolean
)
returns public.payment_orders
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_sku public.store_skus%rowtype;
  new_order public.payment_orders%rowtype;
begin
  if p_user_id is null then
    raise exception 'Buyer user id is required' using errcode = '22023';
  end if;
  if p_sku_id is null or char_length(p_sku_id) not between 1 and 160 then
    raise exception 'Store SKU id is required' using errcode = '22023';
  end if;
  if p_currency is distinct from 'USD' then
    raise exception 'Registry checkout currently supports USD only' using errcode = '22023';
  end if;
  if p_dry_run is null then
    raise exception 'Order sandbox flag is required' using errcode = '22023';
  end if;

  select *
  into target_sku
  from public.store_skus
  where sku_id = p_sku_id;
  if not found then
    raise exception 'Unknown Store SKU %', p_sku_id using errcode = '23503';
  end if;
  if target_sku.status not in ('sandbox', 'live') then
    raise exception 'Store SKU % is not sellable', p_sku_id using errcode = '55000';
  end if;
  if target_sku.sku_class not in ('star_bundle', 'subscription') then
    raise exception 'Registry checkout does not sell die SKU %', p_sku_id using errcode = '22023';
  end if;

  insert into public.payment_orders (
    user_id,
    sku_id,
    sku_value_version,
    sku_price_usd_cents,
    sku_star_total,
    sku_first_time_total,
    sku_product_id,
    amount_minor,
    currency,
    dry_run
  ) values (
    p_user_id,
    target_sku.sku_id,
    target_sku.value_version,
    target_sku.price_usd_cents,
    target_sku.star_total,
    target_sku.first_time_total,
    target_sku.product_id,
    target_sku.price_usd_cents,
    p_currency,
    p_dry_run
  )
  returning * into new_order;

  return new_order;
end;
$$;

comment on function public.create_sku_payment_order(uuid, text, text, boolean) is
  'Service-only non-die order creation. Status and USD price are database-derived from a sandbox/live Store SKU; drafts and registry die rows fail closed.';

revoke all on function public.create_sku_payment_order(uuid, text, text, boolean)
  from public, anon, authenticated, service_role;
grant execute on function public.create_sku_payment_order(uuid, text, text, boolean)
  to service_role;

-- Canonical 0027 append body with one narrow gate delta: a paid negative is
-- admitted only when it exactly matches an immutable fulfilled Star-bundle
-- snapshot and the canonical order-derived refund key. Every account lock,
-- idempotency, nonnegative balance, active-hold, overflow, and append guard is
-- retained.
create or replace function public.append_wallet_ledger_entry(
  p_user_id uuid,
  p_currency_id text,
  p_balance_bucket text,
  p_delta_amount bigint,
  p_reason_code text,
  p_idempotency_key text,
  p_economy_edition_id text,
  p_provenance jsonb default '{}'::jsonb
)
returns public.wallet_ledger_entries
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  target_account public.wallet_accounts%rowtype;
  target_balance public.wallet_balances%rowtype;
  existing_entry public.wallet_ledger_entries%rowtype;
  inserted_entry public.wallet_ledger_entries%rowtype;
  resulting_balance numeric;
  active_holds bigint := 0;
  decision_at timestamptz;
  refund_order_id uuid;
begin
  if p_user_id is null then
    raise exception 'Wallet user id is required' using errcode = '22023';
  end if;
  if p_delta_amount is null or p_delta_amount = 0 then
    raise exception 'Wallet delta must be nonzero' using errcode = '22023';
  end if;
  if p_currency_id is null or p_balance_bucket is null or not (
    (p_currency_id = 'stars' and p_balance_bucket = 'promotional') or
    (p_currency_id = 'stars' and p_balance_bucket = 'paid') or
    (p_currency_id = 'dust' and p_balance_bucket = 'earned')
  ) then
    raise exception 'Unsupported wallet currency/bucket pair %/%',
      p_currency_id, p_balance_bucket
      using errcode = '22023';
  end if;

  if p_balance_bucket = 'paid' and p_delta_amount < 0 then
    if p_reason_code is distinct from 'purchase.refund' or
       p_provenance is null or
       jsonb_typeof(p_provenance) <> 'object' or
       coalesce(p_provenance ->> 'orderId', '') !~
         '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$' then
      raise exception 'Paid Stars debits remain disabled except exact purchase refunds'
        using errcode = '55000';
    end if;

    refund_order_id := (p_provenance ->> 'orderId')::uuid;
    if p_idempotency_key is distinct from
         'star-bundle-refund:' || refund_order_id::text or
       not exists (
         select 1
         from public.payment_refund_intents as intent
         join public.star_bundle_fulfillments as fulfillment
           on fulfillment.order_id = intent.order_id
         join public.payment_orders as orders
           on orders.id = fulfillment.order_id
         where intent.order_id = refund_order_id
           and intent.xsolla_transaction_id = orders.xsolla_transaction_id
           and intent.reversal_class = 'star_bundle'
           and intent.source_wallet_ledger_entry_id =
             fulfillment.wallet_ledger_entry_id
           and intent.reversal_amount = p_delta_amount
           and intent.idempotency_key = p_idempotency_key
           and fulfillment.user_id = p_user_id
           and orders.status = 'fulfilled'
           and p_delta_amount = -fulfillment.credited_stars
           and p_provenance ->> 'sourceLedgerEntryId' =
             fulfillment.wallet_ledger_entry_id::text
       ) then
      raise exception 'Paid Stars debit is not an exact fulfilled purchase refund'
        using errcode = '55000';
    end if;
  end if;
  if p_reason_code is null or
     char_length(p_reason_code) not between 3 and 128 or
     p_reason_code !~ '^[a-z][a-z0-9_.:-]+$' then
    raise exception 'Invalid wallet reason code' using errcode = '22023';
  end if;
  if p_idempotency_key is null or
     char_length(p_idempotency_key) not between 8 and 200 then
    raise exception 'Invalid wallet idempotency key' using errcode = '22023';
  end if;
  if p_provenance is null or
     jsonb_typeof(p_provenance) <> 'object' or
     octet_length(p_provenance::text) > 8192 then
    raise exception 'Wallet provenance must be a bounded JSON object' using errcode = '22023';
  end if;
  if not exists (
    select 1 from public.economy_editions where id = p_economy_edition_id
  ) then
    raise exception 'Unknown economy edition %', p_economy_edition_id
      using errcode = '23503';
  end if;

  target_account := private.lock_wallet_account(p_user_id);

  select * into existing_entry
  from public.wallet_ledger_entries
  where account_id = target_account.id
    and idempotency_key = p_idempotency_key;

  if found then
    if existing_entry.user_id <> p_user_id or
       existing_entry.currency_id <> p_currency_id or
       existing_entry.balance_bucket <> p_balance_bucket or
       existing_entry.delta_amount <> p_delta_amount or
       existing_entry.reason_code <> p_reason_code or
       existing_entry.economy_edition_id <> p_economy_edition_id or
       existing_entry.provenance is distinct from p_provenance then
      raise exception 'Idempotency key % was already used with a different wallet payload',
        p_idempotency_key
        using errcode = '22023';
    end if;
    return existing_entry;
  end if;

  insert into public.wallet_balances
    (account_id, user_id, currency_id, balance_bucket)
  values
    (target_account.id, p_user_id, p_currency_id, p_balance_bucket)
  on conflict (account_id, currency_id, balance_bucket) do nothing;

  select * into strict target_balance
  from public.wallet_balances
  where account_id = target_account.id
    and currency_id = p_currency_id
    and balance_bucket = p_balance_bucket
  for update;

  resulting_balance := target_balance.current_balance::numeric + p_delta_amount::numeric;
  if resulting_balance < 0 then
    raise exception 'Insufficient %/% balance', p_currency_id, p_balance_bucket
      using errcode = '22003';
  end if;
  if resulting_balance > 9223372036854775807::numeric then
    raise exception 'Wallet balance overflow' using errcode = '22003';
  end if;

  if p_delta_amount < 0 then
    decision_at := clock_timestamp();
    select coalesce(sum(sessions.held_amount), 0) into active_holds
    from public.pull_sessions as sessions
    join public.pull_banner_versions as banners
      on banners.id = sessions.banner_version_id
     and banners.roll_type is null
    where sessions.account_id = target_account.id
      and sessions.currency_id = p_currency_id
      and sessions.balance_bucket = p_balance_bucket
      and sessions.prepared_at <= decision_at
      and sessions.expires_at > decision_at
      and not exists (
        select 1
        from public.pull_session_transitions as transitions
        where transitions.session_id = sessions.id
      );
    if resulting_balance < active_holds then
      raise exception 'Insufficient available %/% balance after active holds',
        p_currency_id, p_balance_bucket
        using errcode = '22003';
    end if;
  end if;

  insert into public.wallet_ledger_entries (
    account_id,
    user_id,
    currency_id,
    balance_bucket,
    delta_amount,
    balance_before,
    balance_after,
    reason_code,
    idempotency_key,
    economy_edition_id,
    provenance
  ) values (
    target_account.id,
    p_user_id,
    p_currency_id,
    p_balance_bucket,
    p_delta_amount,
    target_balance.current_balance,
    resulting_balance::bigint,
    p_reason_code,
    p_idempotency_key,
    p_economy_edition_id,
    p_provenance
  )
  returning * into inserted_entry;

  update public.wallet_balances
  set current_balance = resulting_balance::bigint,
      updated_at = now()
  where account_id = target_account.id
    and currency_id = p_currency_id
    and balance_bucket = p_balance_bucket;

  return inserted_entry;
end;
$$;

comment on function public.append_wallet_ledger_entry(
  uuid, text, text, bigint, text, text, text, jsonb
) is
  'Service-only canonical wallet append. Paid negatives remain disabled except an exact immutable Star-bundle purchase refund; all canonical nonnegative, hold, overflow, and idempotency guards remain.';

revoke all on function public.append_wallet_ledger_entry(
  uuid, text, text, bigint, text, text, text, jsonb
) from public, anon, authenticated, service_role;
grant execute on function public.append_wallet_ledger_entry(
  uuid, text, text, bigint, text, text, text, jsonb
) to service_role;

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
  target_sku public.store_skus%rowtype;
  granted_entitlement_id uuid;
  entitlement_created_now boolean;
  conflicting_revoked_at timestamptz;
  event_inserted integer;
  first_purchase public.star_bundle_first_purchases%rowtype;
  first_time_eligible boolean;
  stars_to_credit bigint;
  ledger_entry public.wallet_ledger_entries%rowtype;
  purchase_subscription jsonb;
  lunar_subscription_id text;
  lunar_plan_id text;
  lunar_product_id text;
  lunar_grant public.lunar_purchase_star_grants%rowtype;
begin
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

  if p_external_id is null then
    -- Renewal payments need not retain the checkout's external_id. Resolve the
    -- already-bound order only when the signed subscription id maps to exactly
    -- one prior order; an absent/ambiguous binding fails closed.
    purchase_subscription := p_raw_event #> '{purchase,subscription}';
    lunar_subscription_id := purchase_subscription ->> 'subscription_id';
    if lunar_subscription_id is null then
      raise exception 'Order external id or bound Lunar subscription is required'
        using errcode = '22023';
    end if;

    select orders.* into target_order
    from public.payment_orders as orders
    where orders.id = (
      select (array_agg(distinct invoices.order_id))[1]
      from public.lunar_order_invoices as invoices
      where invoices.subscription_id = lunar_subscription_id
      having count(distinct invoices.order_id) = 1
    )
    for update;
  else
    select * into target_order
    from public.payment_orders
    where external_id = p_external_id
    for update;
  end if;
  if not found then
    raise exception 'Unknown or ambiguous payment order correlation'
      using errcode = '23503';
  end if;

  if target_order.dry_run <> p_dry_run then
    raise exception 'Webhook sandbox flag does not match order %', p_external_id
      using errcode = '22023';
  end if;

  if target_order.sku_id is not null then
    select *
    into strict target_sku
    from public.store_skus
    where sku_id = target_order.sku_id;
  end if;

  if target_order.xsolla_transaction_id is not null and
     target_order.xsolla_transaction_id <> p_xsolla_transaction_id and
     not (
       target_order.sku_id is not null and
       target_sku.sku_class = 'subscription' and
       target_order.status = 'fulfilled' and
       p_event_type = 'payment'
     ) then
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

  if event_inserted = 0 then
    return target_order;
  end if;
  if target_order.status <> 'pending' and
     not (
       target_order.sku_id is not null and
       target_sku.sku_class = 'subscription' and
       target_order.status = 'fulfilled' and
       p_event_type = 'payment'
     ) then
    return target_order;
  end if;

  if target_order.sku_id is not null then
    if target_sku.sku_class = 'star_bundle' then
      insert into public.star_bundle_first_purchases (user_id, sku_id)
      values (target_order.user_id, target_sku.sku_id)
      on conflict (user_id, sku_id) do nothing;

      select *
      into strict first_purchase
      from public.star_bundle_first_purchases
      where user_id = target_order.user_id
        and sku_id = target_sku.sku_id
      for update;

      first_time_eligible := not exists (
        select 1
        from public.star_bundle_first_purchase_events as granted
        where granted.first_purchase_id = first_purchase.id
          and granted.event_type = 'granted'
          and not exists (
            select 1
            from public.star_bundle_first_purchase_events as reversed
            where reversed.order_id = granted.order_id
              and reversed.event_type = 'reversed'
          )
      );
      stars_to_credit := case
        when first_time_eligible then target_order.sku_first_time_total
        else target_order.sku_star_total
      end;

      ledger_entry := public.append_wallet_ledger_entry(
        target_order.user_id,
        'stars',
        'paid',
        stars_to_credit,
        'purchase.star_bundle',
        'star-bundle-purchase:' || target_order.id::text,
        'earned-collection@1',
        jsonb_build_object(
          'orderId', target_order.id,
          'externalId', target_order.external_id,
          'skuId', target_sku.sku_id,
          'skuValueVersion', target_order.sku_value_version,
          'firstTimeApplied', first_time_eligible,
          'xsollaTransactionId', p_xsolla_transaction_id,
          'specSection', '6.delta-5-6'
        )
      );

      insert into public.star_bundle_fulfillments (
        order_id,
        first_purchase_id,
        user_id,
        sku_id,
        credited_stars,
        sku_value_version,
        first_time_applied,
        wallet_ledger_entry_id
      ) values (
        target_order.id,
        first_purchase.id,
        target_order.user_id,
        target_sku.sku_id,
        stars_to_credit,
        target_order.sku_value_version,
        first_time_eligible,
        ledger_entry.id
      );

      if first_time_eligible then
        insert into public.star_bundle_first_purchase_events (
          first_purchase_id,
          order_id,
          event_type
        ) values (
          first_purchase.id,
          target_order.id,
          'granted'
        );
      end if;

      update public.payment_orders
      set status = 'fulfilled',
          xsolla_transaction_id = p_xsolla_transaction_id,
          paid_at = now(),
          fulfilled_at = now(),
          raw_event = p_raw_event,
          updated_at = now()
      where id = target_order.id
      returning * into result_order;

      return result_order;
    elsif target_sku.sku_class = 'subscription' then
      -- 0024 permits this paid-invoice faucet only from the signed payment
      -- envelope carrying purchase.subscription, never order_paid/lifecycle.
      if p_event_type <> 'payment' then
        raise exception 'Subscription fulfillment requires a payment event'
          using errcode = '22023';
      end if;

      purchase_subscription := p_raw_event #> '{purchase,subscription}';
      if purchase_subscription is null or
         jsonb_typeof(purchase_subscription) <> 'object' then
        raise exception 'Lunar payment requires purchase.subscription'
          using errcode = '22023';
      end if;
      lunar_subscription_id := purchase_subscription ->> 'subscription_id';
      lunar_plan_id := purchase_subscription ->> 'plan_id';
      lunar_product_id := purchase_subscription ->> 'product_id';
      if lunar_subscription_id is null or
         char_length(lunar_subscription_id) not between 1 and 255 or
         lunar_plan_id is null or
         char_length(lunar_plan_id) not between 1 and 255 or
         lunar_product_id is distinct from target_order.sku_product_id then
        raise exception 'Lunar payment purchase.subscription does not match the bound SKU'
          using errcode = '22023';
      end if;

      if exists (
           select 1
           from public.lunar_order_invoices
           where order_id = target_order.id
         ) and not exists (
           select 1
           from public.lunar_order_invoices
           where order_id = target_order.id
             and subscription_id = lunar_subscription_id
             and product_id = lunar_product_id
         ) then
        raise exception 'Lunar invoice does not match the subscription bound to this order'
          using errcode = '22023';
      end if;

      lunar_grant := public.grant_lunar_purchase_stars(
        target_order.user_id,
        p_xsolla_transaction_id,
        lunar_subscription_id,
        lunar_plan_id,
        lunar_product_id
      );

      insert into public.lunar_order_invoices (
        order_id,
        user_id,
        xsolla_transaction_id,
        subscription_id,
        plan_id,
        product_id,
        lunar_purchase_grant_id
      ) values (
        target_order.id,
        target_order.user_id,
        p_xsolla_transaction_id,
        lunar_subscription_id,
        lunar_plan_id,
        lunar_product_id,
        lunar_grant.id
      );

      if target_order.status = 'fulfilled' then
        return target_order;
      end if;

      update public.payment_orders
      set status = 'fulfilled',
          xsolla_transaction_id = p_xsolla_transaction_id,
          paid_at = now(),
          fulfilled_at = now(),
          raw_event = p_raw_event,
          updated_at = now()
      where id = target_order.id
      returning * into result_order;

      return result_order;
    else
      raise exception 'Registry die fulfillment is not activated by create_sku_payment_order'
        using errcode = '55000';
    end if;
  end if;

  -- The following catalog-item entitlement DML is byte-identical to 0013.
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
    entitlement_created_now := true;
  else
    select id, revoked_at
      into strict granted_entitlement_id, conflicting_revoked_at
    from public.user_entitlements
    where user_id = target_order.user_id
      and catalog_item_id = target_order.catalog_item_id;

    if conflicting_revoked_at is not null then
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
  'Service-only idempotent fulfillment. Catalog items retain 0013 entitlement DML; Star bundles append paid Stars from immutable order-time SKU snapshots; every distinct signed Lunar payment invoice receives its own immutable order correlation and 0024 grant.';

-- Lock the canonical account/balance rows and return spendable balance after
-- active holds. Keeping this lock through the subsequent append closes the
-- preflight/append race while allowing an insolvent receipt to commit.
create or replace function private.available_wallet_balance_for_reversal(
  p_user_id uuid,
  p_balance_bucket text
)
returns bigint
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  target_account public.wallet_accounts%rowtype;
  target_balance public.wallet_balances%rowtype;
  active_holds bigint := 0;
  decision_at timestamptz;
begin
  target_account := private.lock_wallet_account(p_user_id);

  select *
  into strict target_balance
  from public.wallet_balances
  where account_id = target_account.id
    and currency_id = 'stars'
    and balance_bucket = p_balance_bucket
  for update;

  decision_at := clock_timestamp();
  select coalesce(sum(sessions.held_amount), 0)
  into active_holds
  from public.pull_sessions as sessions
  join public.pull_banner_versions as banners
    on banners.id = sessions.banner_version_id
   and banners.roll_type is null
  where sessions.account_id = target_account.id
    and sessions.currency_id = 'stars'
    and sessions.balance_bucket = p_balance_bucket
    and sessions.prepared_at <= decision_at
    and sessions.expires_at > decision_at
    and not exists (
      select 1
      from public.pull_session_transitions as transitions
      where transitions.session_id = sessions.id
    );

  return greatest(target_balance.current_balance - active_holds, 0);
end;
$$;

revoke all on function private.available_wallet_balance_for_reversal(uuid, text)
  from public, anon, authenticated, service_role;

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
  target_sku public.store_skus%rowtype;
  bundle_fulfillment public.star_bundle_fulfillments%rowtype;
  first_purchase public.star_bundle_first_purchases%rowtype;
  lunar_invoice public.lunar_order_invoices%rowtype;
  lunar_grant public.lunar_purchase_star_grants%rowtype;
  reversal_entry public.wallet_ledger_entries%rowtype;
  event_inserted integer;
  available_stars bigint;
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

  select orders.* into target_order
  from public.payment_orders as orders
  where orders.xsolla_transaction_id = p_xsolla_transaction_id
     or exists (
       select 1
       from public.lunar_order_invoices as invoices
       where invoices.order_id = orders.id
         and invoices.xsolla_transaction_id = p_xsolla_transaction_id
     )
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

  if event_inserted = 0 or target_order.status = 'refunded' then
    return target_order;
  end if;
  if target_order.status <> 'fulfilled' then
    raise exception 'Only a fulfilled order can be refunded (order %)', target_order.external_id
      using errcode = '55000';
  end if;
  if exists (
    select 1
    from public.payment_refund_reversals
    where order_id = target_order.id
      and xsolla_transaction_id = p_xsolla_transaction_id
  ) then
    return target_order;
  end if;

  if target_order.sku_id is not null then
    select * into strict target_sku
    from public.store_skus
    where sku_id = target_order.sku_id;

    if target_sku.sku_class = 'star_bundle' then
      select * into strict bundle_fulfillment
      from public.star_bundle_fulfillments
      where order_id = target_order.id;

      -- Match fulfill's global lock order: first-purchase anchor, then wallet
      -- account/balance. This prevents fulfill/refund deadlocks for one user/SKU.
      select * into strict first_purchase
      from public.star_bundle_first_purchases
      where id = bundle_fulfillment.first_purchase_id
      for update;

      available_stars := private.available_wallet_balance_for_reversal(
        target_order.user_id,
        'paid'
      );
      if available_stars < bundle_fulfillment.credited_stars then
        insert into public.unresolved_payment_reversals (
          order_id,
          xsolla_transaction_id,
          reversal_class,
          source_wallet_ledger_entry_id,
          required_stars,
          available_stars,
          reason_code,
          event_type,
          raw_event
        ) values (
          target_order.id,
          p_xsolla_transaction_id,
          'star_bundle',
          bundle_fulfillment.wallet_ledger_entry_id,
          bundle_fulfillment.credited_stars,
          available_stars,
          'insufficient_available_balance',
          p_event_type,
          p_raw_event
        )
        on conflict (order_id, xsolla_transaction_id) do nothing;

        raise log
          'Unresolved Star-bundle reversal for order %, required %, available %',
          target_order.id, bundle_fulfillment.credited_stars, available_stars
          using errcode = '55000';
        return target_order;
      end if;

      insert into public.payment_refund_intents (
        order_id,
        xsolla_transaction_id,
        reversal_class,
        source_wallet_ledger_entry_id,
        reversal_amount,
        idempotency_key
      ) values (
        target_order.id,
        p_xsolla_transaction_id,
        'star_bundle',
        bundle_fulfillment.wallet_ledger_entry_id,
        -bundle_fulfillment.credited_stars,
        'star-bundle-refund:' || target_order.id::text
      );

      reversal_entry := public.append_wallet_ledger_entry(
        target_order.user_id,
        'stars',
        'paid',
        -bundle_fulfillment.credited_stars,
        'purchase.refund',
        'star-bundle-refund:' || target_order.id::text,
        'earned-collection@1',
        jsonb_build_object(
          'orderId', target_order.id,
          'externalId', target_order.external_id,
          'skuId', bundle_fulfillment.sku_id,
          'skuValueVersion', bundle_fulfillment.sku_value_version,
          'sourceLedgerEntryId', bundle_fulfillment.wallet_ledger_entry_id,
          'xsollaTransactionId', p_xsolla_transaction_id,
          'eventType', p_event_type,
          'specSection', '6.delta-6'
        )
      );

      insert into public.payment_refund_reversals (
        order_id,
        xsolla_transaction_id,
        reversal_class,
        source_wallet_ledger_entry_id,
        reversal_wallet_ledger_entry_id,
        reversed_stars
      ) values (
        target_order.id,
        p_xsolla_transaction_id,
        'star_bundle',
        bundle_fulfillment.wallet_ledger_entry_id,
        reversal_entry.id,
        bundle_fulfillment.credited_stars
      );

      if bundle_fulfillment.first_time_applied then
        insert into public.star_bundle_first_purchase_events (
          first_purchase_id,
          order_id,
          event_type
        ) values (
          bundle_fulfillment.first_purchase_id,
          target_order.id,
          'reversed'
        );
      end if;
    elsif target_sku.sku_class = 'subscription' then
      select * into strict lunar_invoice
      from public.lunar_order_invoices
      where order_id = target_order.id
        and xsolla_transaction_id = p_xsolla_transaction_id;

      select * into strict lunar_grant
      from public.lunar_purchase_star_grants
      where id = lunar_invoice.lunar_purchase_grant_id;

      available_stars := private.available_wallet_balance_for_reversal(
        target_order.user_id,
        'promotional'
      );
      if available_stars < lunar_grant.credited_stars then
        insert into public.unresolved_payment_reversals (
          order_id,
          xsolla_transaction_id,
          reversal_class,
          source_wallet_ledger_entry_id,
          required_stars,
          available_stars,
          reason_code,
          event_type,
          raw_event
        ) values (
          target_order.id,
          p_xsolla_transaction_id,
          'lunar_subscription',
          lunar_grant.wallet_ledger_entry_id,
          lunar_grant.credited_stars,
          available_stars,
          'insufficient_available_balance',
          p_event_type,
          p_raw_event
        )
        on conflict (order_id, xsolla_transaction_id) do nothing;

        raise log
          'Unresolved Lunar reversal for order %, required %, available %',
          target_order.id, lunar_grant.credited_stars, available_stars
          using errcode = '55000';
        return target_order;
      end if;

      reversal_entry := public.append_wallet_ledger_entry(
        target_order.user_id,
        'stars',
        'promotional',
        -lunar_grant.credited_stars,
        'lunar.purchase.refund',
        'lunar-purchase-refund:' || p_xsolla_transaction_id::text,
        'earned-collection@1',
        jsonb_build_object(
          'orderId', target_order.id,
          'externalId', target_order.external_id,
          'subscriptionId', lunar_grant.subscription_id,
          'planId', lunar_grant.plan_id,
          'productId', lunar_grant.product_id,
          'sourceLedgerEntryId', lunar_grant.wallet_ledger_entry_id,
          'xsollaTransactionId', p_xsolla_transaction_id,
          'eventType', p_event_type,
          'specSection', '3.1'
        )
      );

      insert into public.payment_refund_reversals (
        order_id,
        xsolla_transaction_id,
        reversal_class,
        source_wallet_ledger_entry_id,
        reversal_wallet_ledger_entry_id,
        reversed_stars
      ) values (
        target_order.id,
        p_xsolla_transaction_id,
        'lunar_subscription',
        lunar_grant.wallet_ledger_entry_id,
        reversal_entry.id,
        lunar_grant.credited_stars
      );

      -- A refunded invoice does not poison the recurring subscription order.
      -- Its immutable reversal receipt handles replay; future invoice payments
      -- continue to use this fulfilled order.
      return target_order;
    else
      raise exception 'Registry die refund is not activated by create_sku_payment_order'
        using errcode = '55000';
    end if;
  else
    -- Byte-identical 0013 catalog-item entitlement reversal.
    if target_order.entitlement_created then
      update public.user_entitlements
      set revoked_at = now()
      where id = target_order.entitlement_id
        and user_id = target_order.user_id
        and revoked_at is null;
    end if;
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
  'Service-only idempotent reversal. Star/Lunar invoice credits reverse exact immutable snapshots by append; a Lunar invoice refund leaves its recurring order fulfilled for later invoices; insufficient available balance commits an unresolved receipt plus SQLSTATE 55000 LOG without mutating credit, first-time eligibility, or order state; catalog-item revocation remains 0013.';

-- New receipts have no client surface in this server-wiring slice.
alter table public.star_bundle_first_purchases enable row level security;
alter table public.star_bundle_first_purchases force row level security;
alter table public.star_bundle_fulfillments enable row level security;
alter table public.star_bundle_fulfillments force row level security;
alter table public.star_bundle_first_purchase_events enable row level security;
alter table public.star_bundle_first_purchase_events force row level security;
alter table public.payment_refund_reversals enable row level security;
alter table public.payment_refund_reversals force row level security;
alter table public.unresolved_payment_reversals enable row level security;
alter table public.unresolved_payment_reversals force row level security;
alter table public.lunar_order_invoices enable row level security;
alter table public.lunar_order_invoices force row level security;
alter table public.payment_refund_intents enable row level security;
alter table public.payment_refund_intents force row level security;

revoke all on table
  public.star_bundle_first_purchases,
  public.star_bundle_fulfillments,
  public.star_bundle_first_purchase_events,
  public.payment_refund_reversals,
  public.unresolved_payment_reversals,
  public.lunar_order_invoices,
  public.payment_refund_intents
from public, anon, authenticated, service_role;
grant select on table
  public.star_bundle_first_purchases,
  public.star_bundle_fulfillments,
  public.star_bundle_first_purchase_events,
  public.payment_refund_reversals,
  public.unresolved_payment_reversals,
  public.lunar_order_invoices,
  public.payment_refund_intents
to service_role;

revoke all on sequence
  public.star_bundle_first_purchases_id_seq,
  public.star_bundle_first_purchase_events_id_seq,
  public.payment_refund_reversals_id_seq,
  public.unresolved_payment_reversals_id_seq,
  public.lunar_order_invoices_id_seq,
  public.payment_refund_intents_id_seq
from public, anon, authenticated, service_role;

revoke all on function public.fulfill_payment_order(uuid, bigint, text, boolean, jsonb)
  from public, anon, authenticated, service_role;
grant execute on function public.fulfill_payment_order(uuid, bigint, text, boolean, jsonb)
  to service_role;
revoke all on function public.refund_payment_order(bigint, text, boolean, jsonb)
  from public, anon, authenticated, service_role;
grant execute on function public.refund_payment_order(bigint, text, boolean, jsonb)
  to service_role;
