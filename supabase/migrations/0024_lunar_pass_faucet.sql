-- Migration: 0024_lunar_pass_faucet
-- Monetization economy spec sections 3.1, 3.5, and 4 -- Lunar Pass slice C.
--
-- [free] DORMANT RAIL: pre-#154, every Lunar Pass Star credit uses the
-- promotional bucket. No webhook or client invokes these RPCs in this slice.
-- Activation still requires issue #154 plus the subscription-law gate from
-- spec section 3.6.
--
-- The paid-pass exception in spec section 3.5 deliberately chooses the
-- Welkin-style claim-on-login-or-lose-it model: one claim for the current UTC
-- calendar day, with no retroactive accrual and no bank. Section 3.1 grants
-- 300 Stars on initial purchase and each renewal plus 90 claimed daily.

-- One private constant is the canonical product binding for every entitlement
-- gate in this migration. Future SKU plumbing must map the Lunar product to
-- this exact 0023 user_subscriptions.product_id value.
create or replace function private.lunar_pass_product_id()
returns text
language sql
immutable
set search_path = ''
as $$
  select 'lunar-pass'::text;
$$;

comment on function private.lunar_pass_product_id() is
  'Canonical 0024 Lunar Pass product id. Daily eligibility and paid-invoice grants must use this exact product.';

revoke all on function private.lunar_pass_product_id()
  from public, anon, authenticated, service_role;

-- Offer amounts are immutable migration constants. Tables and engines call
-- these functions instead of repeating literals, so constraints, wallet
-- appends, and receipt inserts cannot drift independently.
create or replace function private.lunar_daily_star_amount()
returns bigint
language sql
immutable
set search_path = ''
as $$
  select 90::bigint;
$$;

create or replace function private.lunar_purchase_star_amount()
returns bigint
language sql
immutable
set search_path = ''
as $$
  select 300::bigint;
$$;

comment on function private.lunar_daily_star_amount() is
  'Canonical Lunar Pass daily promotional-Star amount.';
comment on function private.lunar_purchase_star_amount() is
  'Canonical Lunar Pass paid-invoice promotional-Star amount.';

revoke all on function private.lunar_daily_star_amount()
  from public, anon, authenticated, service_role;
revoke all on function private.lunar_purchase_star_amount()
  from public, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Immutable daily claim and paid-invoice receipts.
-- ---------------------------------------------------------------------------
create table public.lunar_daily_star_claims (
  id                       bigint      generated always as identity primary key,
  user_id                  uuid        not null references auth.users (id) on delete restrict,
  subscription_id          text        not null,
  utc_day                  date        not null,
  credited_stars           bigint      not null
    check (credited_stars = private.lunar_daily_star_amount()),
  wallet_ledger_entry_id   bigint      not null unique
    references public.wallet_ledger_entries (id) on delete restrict,
  claimed_at               timestamptz not null,

  constraint lunar_daily_star_claims_subscription_fkey
    foreign key (user_id, subscription_id)
    references public.user_subscriptions (user_id, subscription_id)
    on delete restrict,
  constraint lunar_daily_star_claims_user_day_unique
    unique (user_id, utc_day),
  constraint lunar_daily_star_claims_day_matches_time
    check (utc_day = (claimed_at at time zone 'UTC')::date)
);

create index lunar_daily_star_claims_subscription_fkey_idx
  on public.lunar_daily_star_claims (user_id, subscription_id);

comment on table public.lunar_daily_star_claims is
  'Immutable one-per-user UTC-day Lunar Pass receipts. Missing days are never materialized or banked; exact same-day replays return the prior receipt.';

create table public.lunar_purchase_star_grants (
  id                         bigint      generated always as identity primary key,
  user_id                    uuid        not null references auth.users (id) on delete restrict,
  subscription_id            text        not null,
  xsolla_transaction_id      bigint      not null check (xsolla_transaction_id > 0),
  plan_id                    text        not null,
  product_id                 text        not null,
  credited_stars             bigint      not null
    check (credited_stars = private.lunar_purchase_star_amount()),
  wallet_ledger_entry_id     bigint      not null unique
    references public.wallet_ledger_entries (id) on delete restrict,
  granted_at                 timestamptz not null,

  constraint lunar_purchase_star_grants_invoice_unique
    unique (user_id, subscription_id, xsolla_transaction_id)
);

-- Replay lookup locks the account, then probes user + invoice before comparing
-- subscription semantics. The triple UNIQUE cannot support that probe past its
-- subscription_id column, so retain this exact supporting btree shape.
create index lunar_purchase_star_grants_user_invoice_idx
  on public.lunar_purchase_star_grants
  using btree (user_id, xsolla_transaction_id);

comment on table public.lunar_purchase_star_grants is
  'Immutable Lunar paid-invoice grants. Payment processing may precede subscription-event projection, so this table intentionally has no FK to subscription_events or user_subscriptions and is ordering-independent.';

-- ---------------------------------------------------------------------------
-- Append-only enforcement, including TRUNCATE.
-- ---------------------------------------------------------------------------
create or replace function private.reject_lunar_pass_history_mutation()
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

create trigger lunar_daily_star_claims_reject_update_delete
  before update or delete on public.lunar_daily_star_claims
  for each row execute function private.reject_lunar_pass_history_mutation();
create trigger lunar_daily_star_claims_reject_truncate
  before truncate on public.lunar_daily_star_claims
  for each statement execute function private.reject_lunar_pass_history_mutation();

create trigger lunar_purchase_star_grants_reject_update_delete
  before update or delete on public.lunar_purchase_star_grants
  for each row execute function private.reject_lunar_pass_history_mutation();
create trigger lunar_purchase_star_grants_reject_truncate
  before truncate on public.lunar_purchase_star_grants
  for each statement execute function private.reject_lunar_pass_history_mutation();

revoke all on function private.reject_lunar_pass_history_mutation()
  from public, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Private daily engine.
--
-- The public wrapper supplies auth.uid and the database clock. The effective
-- timestamp remains private so the SQL harness can prove the UTC boundary.
-- Account-first serialization is the repo-wide wallet invariant: it makes the
-- user/day receipt and canonical 0009 ledger append one exactly-once operation.
-- A matching receipt is returned before current eligibility is rechecked, so a
-- retry after cancellation remains an idempotent read instead of an error.
-- ---------------------------------------------------------------------------
create or replace function private.claim_lunar_daily_stars_for_user(
  p_user_id uuid,
  p_effective_at timestamptz
)
returns public.lunar_daily_star_claims
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  target_account public.wallet_accounts%rowtype;
  target_subscription public.user_subscriptions%rowtype;
  existing_claim public.lunar_daily_star_claims%rowtype;
  inserted_claim public.lunar_daily_star_claims%rowtype;
  ledger_entry public.wallet_ledger_entries%rowtype;
  target_utc_day date;
  ledger_key text;
begin
  if p_user_id is null or p_effective_at is null then
    raise exception 'Lunar daily claim user and time are required'
      using errcode = '22023';
  end if;

  target_utc_day := (p_effective_at at time zone 'UTC')::date;
  target_account := private.lock_wallet_account(p_user_id);

  select *
  into existing_claim
  from public.lunar_daily_star_claims
  where user_id = p_user_id
    and utc_day = target_utc_day;

  if found then
    return existing_claim;
  end if;

  if not public.is_lunar_pass_active(
    p_user_id,
    p_effective_at,
    private.lunar_pass_product_id()
  ) then
    raise exception 'An active Lunar Pass is required for the current UTC day'
      using errcode = '55000';
  end if;

  -- Lock the exact qualifying projection row through the credit. A concurrent
  -- cancellation/update must therefore linearize before this selection or
  -- after the receipt+ledger transaction, never between eligibility and append.
  select *
  into target_subscription
  from public.user_subscriptions as subscriptions
  where subscriptions.user_id = p_user_id
    and subscriptions.product_id = private.lunar_pass_product_id()
    and (
      subscriptions.status = 'active'
      or (
        subscriptions.status = 'non_renewing' and
        subscriptions.date_next_charge is not null and
        p_effective_at < subscriptions.date_next_charge
      )
      or (
        subscriptions.status = 'canceled' and
        subscriptions.date_end is not null and
        p_effective_at < subscriptions.date_end
      )
    )
  order by
    case subscriptions.status
      when 'active' then 0
      when 'non_renewing' then 1
      else 2
    end,
    subscriptions.subscription_id
  limit 1
  for share;

  if not found then
    raise exception 'Lunar Pass eligibility changed before the daily credit'
      using errcode = '55000';
  end if;

  ledger_key := 'lunar-daily:' || p_user_id::text || ':' || target_utc_day::text;
  ledger_entry := public.append_wallet_ledger_entry(
    p_user_id,
    'stars',
    'promotional',
    private.lunar_daily_star_amount(),
    'lunar.daily',
    ledger_key,
    'earned-collection@1',
    jsonb_build_object(
      'lunarProductId', private.lunar_pass_product_id(),
      'subscriptionId', target_subscription.subscription_id,
      'utcDay', target_utc_day,
      'claimModel', 'claim-on-login-or-lose-it',
      'specSection', '3.5'
    )
  );

  insert into public.lunar_daily_star_claims (
    user_id,
    subscription_id,
    utc_day,
    credited_stars,
    wallet_ledger_entry_id,
    claimed_at
  ) values (
    p_user_id,
    target_subscription.subscription_id,
    target_utc_day,
    private.lunar_daily_star_amount(),
    ledger_entry.id,
    p_effective_at
  )
  returning * into inserted_claim;

  return inserted_claim;
end;
$$;

comment on function private.claim_lunar_daily_stars_for_user(uuid, timestamptz) is
  'Private UTC-time seam for the Lunar daily engine. It serializes on the wallet account, filters the exact canonical product, appends 90 promotional Stars through 0009, and never derives retroactive days.';

revoke all on function private.claim_lunar_daily_stars_for_user(uuid, timestamptz)
  from public, anon, authenticated, service_role;

create or replace function public.claim_lunar_daily_stars()
returns public.lunar_daily_star_claims
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  caller_user_id uuid;
begin
  caller_user_id := private.require_non_anonymous_user();
  return private.claim_lunar_daily_stars_for_user(
    caller_user_id,
    statement_timestamp()
  );
end;
$$;

comment on function public.claim_lunar_daily_stars() is
  'Authenticated self-only Lunar Pass daily claim. User, amount, canonical product, subscription, and current UTC day are database-derived; missed days are lost, not banked.';

-- ---------------------------------------------------------------------------
-- Service-only paid-invoice engine.
--
-- The future payment-fulfill branch calls this boundary only for a signed
-- `payment` event whose `purchase.subscription` block has the Lunar product.
-- It must never be called from `update_subscription`: lifecycle updates are
-- not proof that money moved. A paid invoice grants even after cancellation;
-- refunds reverse through the refund path instead of withholding a real charge.
-- No subscription-state read or FK is allowed here, so payment fulfillment is
-- independent of subscription-event delivery order.
-- ---------------------------------------------------------------------------
create or replace function public.grant_lunar_purchase_stars(
  p_user_id uuid,
  p_xsolla_transaction_id bigint,
  p_subscription_id text,
  p_plan_id text,
  p_product_id text
)
returns public.lunar_purchase_star_grants
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  target_account public.wallet_accounts%rowtype;
  existing_grant public.lunar_purchase_star_grants%rowtype;
  inserted_grant public.lunar_purchase_star_grants%rowtype;
  ledger_entry public.wallet_ledger_entries%rowtype;
  ledger_key text;
begin
  if p_user_id is null or
     p_xsolla_transaction_id is null or p_xsolla_transaction_id <= 0 or
     p_subscription_id is null or
     char_length(p_subscription_id) not between 1 and 255 or
     p_plan_id is null or char_length(p_plan_id) not between 1 and 255 or
     p_product_id is null or char_length(p_product_id) not between 1 and 255 then
    raise exception 'Lunar payment user, positive transaction id, subscription id, plan id, and product id are required'
      using errcode = '22023';
  end if;

  if p_product_id is distinct from private.lunar_pass_product_id() then
    raise exception 'Payment purchase.subscription product is not the Lunar Pass product'
      using errcode = '55000';
  end if;

  -- Account-first locking serializes all attempts for one buyer. The receipt
  -- lookup intentionally keys on user + invoice before comparing subscription
  -- semantics: reusing one real invoice with a different subscription must
  -- fail closed instead of slipping past the required three-column UNIQUE.
  target_account := private.lock_wallet_account(p_user_id);

  select *
  into existing_grant
  from public.lunar_purchase_star_grants
  where user_id = p_user_id
    and xsolla_transaction_id = p_xsolla_transaction_id;

  if found then
    if existing_grant.subscription_id <> p_subscription_id or
       existing_grant.plan_id <> p_plan_id or
       existing_grant.product_id <> p_product_id or
       existing_grant.credited_stars <> private.lunar_purchase_star_amount() then
      raise exception 'Xsolla transaction id was already used with different Lunar purchase semantics'
        using errcode = '22023';
    end if;
    return existing_grant;
  end if;

  -- bigint::text is a canonical, timezone-independent invoice representation.
  -- 0009 scopes this key to the locked wallet account and rejects any payload
  -- drift, providing a second fail-closed seam beneath the grant receipt.
  ledger_key := 'lunar-purchase:' || p_xsolla_transaction_id::text;
  ledger_entry := public.append_wallet_ledger_entry(
    p_user_id,
    'stars',
    'promotional',
    private.lunar_purchase_star_amount(),
    'lunar.purchase',
    ledger_key,
    'earned-collection@1',
    jsonb_build_object(
      'lunarProductId', private.lunar_pass_product_id(),
      'subscriptionId', p_subscription_id,
      'planId', p_plan_id,
      'xsollaTransactionId', p_xsolla_transaction_id,
      'grantModel', 'paid-invoice',
      'specSection', '3.1'
    )
  );

  insert into public.lunar_purchase_star_grants (
    user_id,
    subscription_id,
    xsolla_transaction_id,
    plan_id,
    product_id,
    credited_stars,
    wallet_ledger_entry_id,
    granted_at
  ) values (
    p_user_id,
    p_subscription_id,
    p_xsolla_transaction_id,
    p_plan_id,
    p_product_id,
    private.lunar_purchase_star_amount(),
    ledger_entry.id,
    statement_timestamp()
  )
  returning * into inserted_grant;

  return inserted_grant;
end;
$$;

comment on function public.grant_lunar_purchase_stars(uuid, bigint, text, text, text) is
  'Service-only Lunar paid-invoice grant. The future payment-fulfill branch passes the verified user, transaction id, and payment purchase.subscription fields; update_subscription must never call it.';

-- ---------------------------------------------------------------------------
-- Owner-read RLS and explicit least privilege.
-- ---------------------------------------------------------------------------
alter table public.lunar_daily_star_claims enable row level security;
alter table public.lunar_daily_star_claims force row level security;
alter table public.lunar_purchase_star_grants enable row level security;
alter table public.lunar_purchase_star_grants force row level security;

create policy "users read their own Lunar daily claims"
  on public.lunar_daily_star_claims
  for select
  to authenticated
  using ((select auth.uid()) = user_id);

create policy "users read their own Lunar purchase grants"
  on public.lunar_purchase_star_grants
  for select
  to authenticated
  using ((select auth.uid()) = user_id);

revoke all on table public.lunar_daily_star_claims
  from public, anon, authenticated, service_role;
revoke all on table public.lunar_purchase_star_grants
  from public, anon, authenticated, service_role;

grant select on table public.lunar_daily_star_claims
  to authenticated, service_role;
grant select on table public.lunar_purchase_star_grants
  to authenticated, service_role;

revoke all on function public.claim_lunar_daily_stars()
  from public, anon, authenticated, service_role;
grant execute on function public.claim_lunar_daily_stars()
  to authenticated;

revoke all on function public.grant_lunar_purchase_stars(uuid, bigint, text, text, text)
  from public, anon, authenticated, service_role;
grant execute on function public.grant_lunar_purchase_stars(uuid, bigint, text, text, text)
  to service_role;

revoke all on sequence public.lunar_daily_star_claims_id_seq
  from public, anon, authenticated, service_role;
revoke all on sequence public.lunar_purchase_star_grants_id_seq
  from public, anon, authenticated, service_role;
