-- Migration: 0026_sku_registry
-- Monetization economy spec sections 2, 3.1, and 6 delta 7.
--
-- [#154] DORMANT SANDBOX RAIL: this registry is server truth for purchasable
-- SKUs, but no checkout, fulfillment, refund, or client path consumes it yet.
-- The existing catalog-item checkout path remains unchanged. A later migration
-- may activate non-die fulfillment only after the remaining #154 gates close.

-- ---------------------------------------------------------------------------
-- One versioned row per purchasable SKU.
--
-- The class/field-shape constraint is a closed, NULL-safe tagged union:
-- Star bundles own every Star amount, subscriptions own product_id, and dice
-- own catalog_item_id. No class may borrow or omit another class's fields.
-- ---------------------------------------------------------------------------
create table public.store_skus (
  sku_id             text        primary key,
  sku_class          text        not null check (
    sku_class in ('star_bundle', 'subscription', 'die')
  ),
  price_usd_cents    integer     not null check (price_usd_cents > 0),
  star_raw           integer,
  star_bonus         integer,
  star_total         integer,
  first_time_total   integer,
  product_id         text,
  catalog_item_id    text        references public.catalog_items (id) on delete restrict,
  status              text        not null default 'draft' check (
    status in ('draft', 'sandbox', 'live')
  ),
  value_version       integer     not null default 1 check (value_version > 0),
  updated_at          timestamptz not null default now(),

  constraint store_skus_id_format check (
    char_length(sku_id) between 1 and 160 and
    sku_id ~ '^[a-z0-9][a-z0-9_-]*$'
  ),
  constraint store_skus_product_id_format check (
    product_id is null or char_length(product_id) between 1 and 255
  ),
  constraint store_skus_class_field_shape check (
    (
      sku_class = 'star_bundle' and
      star_raw is not null and
      star_bonus is not null and
      star_total is not null and
      first_time_total is not null and
      product_id is null and
      catalog_item_id is null
    ) or (
      sku_class = 'subscription' and
      star_raw is null and
      star_bonus is null and
      star_total is null and
      first_time_total is null and
      product_id is not null and
      catalog_item_id is null
    ) or (
      sku_class = 'die' and
      star_raw is null and
      star_bonus is null and
      star_total is null and
      first_time_total is null and
      product_id is null and
      catalog_item_id is not null
    )
  ),
  constraint store_skus_star_amounts check (
    sku_class <> 'star_bundle' or (
      star_raw is not null and
      star_raw > 0 and
      star_bonus is not null and
      star_bonus >= 0 and
      star_total is not null and
      star_total = star_raw + star_bonus and
      first_time_total is not null and
      first_time_total = star_raw * 2
    )
  )
);

comment on table public.store_skus is
  'Dormant server-truth SKU registry for #154. Authenticated clients read sandbox/live rows; trusted service code alone reads drafts or retunes rows.';

-- PO-locked Star lineup from spec section 2. The first-time total is double
-- raw and replaces, rather than stacks with, the standard bonus. Lunar price
-- and product binding are locked by section 3.1 and 0024 respectively.
insert into public.store_skus (
  sku_id,
  sku_class,
  price_usd_cents,
  star_raw,
  star_bonus,
  star_total,
  first_time_total,
  product_id,
  catalog_item_id,
  status,
  value_version
) values
  ('stars_handful',     'star_bundle',  49,   60,    0,   60,   120, null,         null, 'sandbox', 1),
  ('stars_pouch',       'star_bundle', 249,  300,   30,  330,   600, null,         null, 'sandbox', 1),
  ('stars_bag',         'star_bundle', 749,  980,  110, 1090,  1960, null,         null, 'sandbox', 1),
  ('stars_chest',       'star_bundle', 1499, 1980,  260, 2240,  3960, null,         null, 'sandbox', 1),
  ('stars_vault',       'star_bundle', 2499, 3280,  600, 3880,  6560, null,         null, 'sandbox', 1),
  ('stars_hoard',       'star_bundle', 4999, 6480, 1600, 8080, 12960, null,         null, 'sandbox', 1),
  ('lunar_pass_monthly', 'subscription', 299, null, null, null, null, 'lunar-pass', null, 'sandbox', 1);

-- sku_id and sku_class are immutable. Every economic or fulfillment-binding
-- retune advances exactly one version; status is governance metadata and keeps
-- its version. Every accepted update receives a server timestamp.
create or replace function private.enforce_store_sku_update()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  sku_payload_changed boolean;
begin
  if new.sku_id is distinct from old.sku_id then
    raise exception 'Store SKU identity is immutable'
      using errcode = '22023';
  end if;

  if new.sku_class is distinct from old.sku_class then
    raise exception 'Store SKU class is immutable'
      using errcode = '55000';
  end if;

  sku_payload_changed := (
    new.price_usd_cents,
    new.star_raw,
    new.star_bonus,
    new.star_total,
    new.first_time_total,
    new.product_id,
    new.catalog_item_id
  ) is distinct from (
    old.price_usd_cents,
    old.star_raw,
    old.star_bonus,
    old.star_total,
    old.first_time_total,
    old.product_id,
    old.catalog_item_id
  );

  if sku_payload_changed then
    if new.value_version <> old.value_version + 1 then
      raise exception 'Store SKU payload changes require value_version %',
        old.value_version + 1
        using errcode = '22023';
    end if;
  elsif new.value_version <> old.value_version then
    raise exception 'value_version may advance only with a Store SKU payload change'
      using errcode = '22023';
  end if;

  new.updated_at := clock_timestamp();
  return new;
end;
$$;

create trigger store_skus_enforce_update
  before update on public.store_skus
  for each row execute function private.enforce_store_sku_update();

revoke all on function private.enforce_store_sku_update()
  from public, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Dormant alternate payment-order binding.
--
-- Existing rows all retain catalog_item_id. Existing creation/fulfill/refund
-- functions are deliberately untouched and therefore keep the die path's
-- behavior. Future non-die creation may set sku_id only after its trusted
-- boundary lands in a later slice.
-- ---------------------------------------------------------------------------
alter table public.payment_orders
  alter column catalog_item_id drop not null,
  add column sku_id text
    references public.store_skus (sku_id) on delete restrict,
  add constraint payment_orders_exactly_one_product_binding check (
    (
      catalog_item_id is not null and
      sku_id is null
    ) or (
      catalog_item_id is null and
      sku_id is not null
    )
  );

create index payment_orders_sku_idx
  on public.payment_orders (sku_id)
  where sku_id is not null;

comment on column public.payment_orders.sku_id is
  'Dormant non-die SKU binding. Exactly one of catalog_item_id and sku_id is required; 0013 die fulfillment remains unchanged.';

-- Authenticated clients may render only sandbox/live server truth. Draft rows
-- remain service-only through BYPASSRLS plus the explicit service SELECT grant.
alter table public.store_skus enable row level security;
alter table public.store_skus force row level security;

create policy "authenticated users read available store skus"
  on public.store_skus
  for select
  to authenticated
  using (status in ('sandbox', 'live'));

revoke all on table public.store_skus
  from public, anon, authenticated, service_role;
grant select on table public.store_skus
  to authenticated, service_role;
grant insert, update on table public.store_skus
  to service_role;
