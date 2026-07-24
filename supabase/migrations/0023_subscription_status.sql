-- Migration: 0023_subscription_status
-- Monetization economy spec section 3 -- Lunar Pass subscription state, slice A.
--
-- [free] DORMANT RAIL: this migration records subscription truth but activates
-- no monetary or reward path. Monetary activation must ride issue #154 plus the
-- subscription-law gate required by spec section 3.6.
--
-- Xsolla sends all four subscription event types to the existing signed webhook
-- endpoint, sequentially but with possible duplicate delivery:
--   developers.xsolla.com/webhooks/subscriptions/created-subscription/
--   developers.xsolla.com/webhooks/subscriptions/updated-subscription/
--   developers.xsolla.com/webhooks/subscriptions/nonrenewing-subscription/
--   developers.xsolla.com/webhooks/subscriptions/canceled-subscription/
-- There is no subscription event id or sequence number, so the immutable receipt
-- uses Xsolla's recommended semantic date plus the raw-body SHA-256 as its key.

-- ---------------------------------------------------------------------------
-- subscription_events: immutable webhook receipt ledger.
--
-- `notification_type` stores the four documented names or the explicit
-- `unknown` passthrough class. For an unknown notification, the verbatim source
-- envelope remains in raw_payload and processed=false records that no projection
-- rule ran. Known terminal-dominant no-ops are still processed events.
-- ---------------------------------------------------------------------------
create table public.subscription_events (
  id                    bigint      generated always as identity primary key,
  -- p_user_id is the ALREADY-RESOLVED Supabase auth uid. Xsolla user.id to
  -- auth uid resolution happens upstream in the webhook handler (slice B).
  user_id               uuid        not null references auth.users (id) on delete restrict,
  subscription_id       text        not null,
  notification_type     text        not null check (
    notification_type in (
      'create_subscription',
      'update_subscription',
      'non_renewal_subscription',
      'cancel_subscription',
      'unknown'
    )
  ),
  plan_id               text,
  product_id            text,
  date_create           timestamptz,
  date_next_charge      timestamptz,
  date_end              timestamptz,
  raw_payload           jsonb       not null,
  body_sha256           text        not null,
  processed             boolean     not null,
  received_at           timestamptz not null default now(),

  constraint subscription_events_subscription_id
    check (char_length(subscription_id) between 1 and 255),
  constraint subscription_events_plan_id
    check (plan_id is null or char_length(plan_id) between 1 and 255),
  constraint subscription_events_product_id
    check (product_id is null or char_length(product_id) between 1 and 255),
  constraint subscription_events_raw_payload_object
    check (jsonb_typeof(raw_payload) = 'object'),
  constraint subscription_events_raw_payload_size
    check (octet_length(raw_payload::text) <= 65536),
  constraint subscription_events_body_sha256
    check (body_sha256 ~ '^[0-9a-f]{64}$'),
  constraint subscription_events_processed_class
    check (processed = (notification_type <> 'unknown')),
  constraint subscription_events_documented_shape
    check (
      (notification_type = 'create_subscription' and
       plan_id is not null and date_create is not null and
       date_next_charge is not null and date_end is null) or
      (notification_type = 'update_subscription' and
       plan_id is not null and date_create is null and
       date_next_charge is not null and date_end is null) or
      (notification_type = 'non_renewal_subscription' and
       date_create is null and date_next_charge is not null and
       date_end is null) or
      (notification_type = 'cancel_subscription' and
       date_create is null and date_next_charge is null and
       date_end is not null) or
      notification_type = 'unknown'
    )
);

-- The relevant Xsolla date is date_create for creation, date_next_charge for
-- renewal/nonrenewal, date_end for cancellation, and a NULL sentinel for the
-- unknown passthrough class. Raw-body hash distinguishes same-date deliveries.
create unique index subscription_events_delivery_dedupe_idx
  on public.subscription_events (
    subscription_id,
    notification_type,
    (
      coalesce(
        case notification_type
          when 'create_subscription' then date_create
          when 'update_subscription' then date_next_charge
          when 'non_renewal_subscription' then date_next_charge
          when 'cancel_subscription' then date_end
          else null
        end,
        '-infinity'::timestamptz
      )
    ),
    body_sha256
  );

create index subscription_events_user_received_idx
  on public.subscription_events (user_id, received_at desc, id desc);

comment on table public.subscription_events is
  'Immutable Xsolla subscription webhook receipts. Unknown notification names normalize to the unknown class, retain the raw envelope, and are marked unprocessed.';

comment on column public.subscription_events.user_id is
  'ALREADY-RESOLVED Supabase auth uid. Slice B resolves Xsolla user.id to this auth uid upstream in the webhook handler.';

-- ---------------------------------------------------------------------------
-- user_subscriptions: monotone terminal-dominant materialized projection.
--
-- Rank is active(0) < non_renewing(1) < canceled(2). Rank never decreases and
-- canceled is absorbing for a subscription_id. A genuine signup receives a new
-- Xsolla subscription_id, so a create event can never resurrect a canceled row.
-- ---------------------------------------------------------------------------
create table public.user_subscriptions (
  -- This FK stores the ALREADY-RESOLVED Supabase auth uid; slice B resolves
  -- Xsolla user.id to the auth uid upstream before calling the RPC.
  user_id               uuid        not null references auth.users (id) on delete restrict,
  subscription_id       text        not null,
  status                text        not null check (
    status in ('active', 'non_renewing', 'canceled')
  ),
  plan_id               text,
  product_id            text,
  -- Xsolla is_gift and trial deliberately stay in subscription_events.raw_payload
  -- only. Future gift logic reparses that jsonb instead of widening this projection.
  date_next_charge      timestamptz,
  date_end              timestamptz,
  updated_at            timestamptz not null default now(),

  primary key (user_id, subscription_id),
  constraint user_subscriptions_subscription_id
    check (char_length(subscription_id) between 1 and 255),
  constraint user_subscriptions_plan_id
    check (plan_id is null or char_length(plan_id) between 1 and 255),
  constraint user_subscriptions_product_id
    check (product_id is null or char_length(product_id) between 1 and 255)
);

create index user_subscriptions_active_lookup_idx
  on public.user_subscriptions (
    user_id, product_id, status, date_next_charge, date_end
  );

comment on table public.user_subscriptions is
  'Monotone Lunar Pass projection. Status cannot decrease and canceled is absorbing; only the trusted subscription event engine may mutate rows.';

comment on column public.user_subscriptions.user_id is
  'ALREADY-RESOLVED Supabase auth uid. Slice B resolves Xsolla user.id to this auth uid upstream in the webhook handler.';

-- ---------------------------------------------------------------------------
-- Append-only enforcement, including TRUNCATE.
-- ---------------------------------------------------------------------------
create or replace function private.reject_subscription_event_mutation()
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

create trigger subscription_events_reject_update_delete
  before update or delete on public.subscription_events
  for each row execute function private.reject_subscription_event_mutation();

create trigger subscription_events_reject_truncate
  before truncate on public.subscription_events
  for each statement execute function private.reject_subscription_event_mutation();

revoke all on function private.reject_subscription_event_mutation()
  from public, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Private record engine.
--
-- One advisory transaction lock per globally-identified subscription serializes
-- duplicate deliveries and state transitions without creating unrelated wallet
-- rows or racing the global delivery-dedupe identity.
-- Exact dedupe hits return the immutable prior receipt and never reproject.
-- ---------------------------------------------------------------------------
create or replace function private.record_subscription_event(
  p_user_id uuid,
  p_subscription_id text,
  p_notification_type text,
  p_plan_id text,
  p_product_id text,
  p_date_create timestamptz,
  p_date_next_charge timestamptz,
  p_date_end timestamptz,
  p_raw_payload jsonb,
  p_body_sha256 text
)
returns public.subscription_events
language plpgsql
security definer
set search_path = ''
as $$
declare
  normalized_type text;
  relevant_date timestamptz;
  existing_event public.subscription_events%rowtype;
  inserted_event public.subscription_events%rowtype;
begin
  if p_user_id is null then
    raise exception 'Subscription user id is required' using errcode = '22023';
  end if;
  if p_subscription_id is null or
     char_length(p_subscription_id) not between 1 and 255 then
    raise exception 'Subscription id must contain 1 to 255 characters'
      using errcode = '22023';
  end if;
  if p_notification_type is null or
     char_length(p_notification_type) not between 1 and 255 then
    raise exception 'Subscription notification type is required'
      using errcode = '22023';
  end if;
  if p_plan_id is not null and
     char_length(p_plan_id) not between 1 and 255 then
    raise exception 'Subscription plan id must contain 1 to 255 characters'
      using errcode = '22023';
  end if;
  if p_product_id is not null and
     char_length(p_product_id) not between 1 and 255 then
    raise exception 'Subscription product id must contain 1 to 255 characters'
      using errcode = '22023';
  end if;
  if p_raw_payload is null or
     jsonb_typeof(p_raw_payload) <> 'object' or
     octet_length(p_raw_payload::text) > 65536 then
    raise exception 'Subscription payload must be a bounded JSON object'
      using errcode = '22023';
  end if;
  if p_body_sha256 is null or p_body_sha256 !~ '^[0-9a-f]{64}$' then
    raise exception 'Subscription body SHA-256 must be 64 lowercase hex characters'
      using errcode = '22023';
  end if;

  normalized_type := case
    when p_notification_type in (
      'create_subscription',
      'update_subscription',
      'non_renewal_subscription',
      'cancel_subscription'
    ) then p_notification_type
    else 'unknown'
  end;

  if normalized_type = 'create_subscription' and (
       p_plan_id is null or
       p_date_create is null or
       p_date_next_charge is null or
       p_date_end is not null
     ) then
    raise exception 'create_subscription requires plan_id, date_create, and date_next_charge, and forbids date_end'
      using errcode = '22023';
  elsif normalized_type = 'update_subscription' and (
          p_plan_id is null or
          p_date_create is not null or
          p_date_next_charge is null or
          p_date_end is not null
        ) then
    raise exception 'update_subscription requires plan_id and date_next_charge, and forbids date_create and date_end'
      using errcode = '22023';
  elsif normalized_type = 'non_renewal_subscription' and (
          p_date_create is not null or
          p_date_next_charge is null or
          p_date_end is not null
        ) then
    raise exception 'non_renewal_subscription requires date_next_charge and forbids date_create and date_end'
      using errcode = '22023';
  elsif normalized_type = 'cancel_subscription' and (
          p_date_create is not null or
          p_date_next_charge is not null or
          p_date_end is null
        ) then
    raise exception 'cancel_subscription requires date_end and forbids date_create and date_next_charge'
      using errcode = '22023';
  end if;

  relevant_date := case normalized_type
    when 'create_subscription' then p_date_create
    when 'update_subscription' then p_date_next_charge
    when 'non_renewal_subscription' then p_date_next_charge
    when 'cancel_subscription' then p_date_end
    else null
  end;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      p_subscription_id,
      0
    )
  );

  select *
  into existing_event
  from public.subscription_events
  where subscription_id = p_subscription_id
    and notification_type = normalized_type
    and (
      case notification_type
        when 'create_subscription' then date_create
        when 'update_subscription' then date_next_charge
        when 'non_renewal_subscription' then date_next_charge
        when 'cancel_subscription' then date_end
        else null
      end
    ) is not distinct from relevant_date
    and body_sha256 = p_body_sha256;

  if found then
    if existing_event.user_id <> p_user_id or
       existing_event.plan_id is distinct from p_plan_id or
       existing_event.product_id is distinct from p_product_id or
       existing_event.date_create is distinct from p_date_create or
       existing_event.date_next_charge is distinct from p_date_next_charge or
       existing_event.date_end is distinct from p_date_end or
       existing_event.raw_payload is distinct from p_raw_payload then
      raise exception 'Subscription delivery key was already used with a different parsed payload'
        using errcode = '22023';
    end if;
    return existing_event;
  end if;

  insert into public.subscription_events (
    user_id,
    subscription_id,
    notification_type,
    plan_id,
    product_id,
    date_create,
    date_next_charge,
    date_end,
    raw_payload,
    body_sha256,
    processed
  ) values (
    p_user_id,
    p_subscription_id,
    normalized_type,
    p_plan_id,
    p_product_id,
    p_date_create,
    p_date_next_charge,
    p_date_end,
    p_raw_payload,
    p_body_sha256,
    normalized_type <> 'unknown'
  )
  returning * into inserted_event;

  if normalized_type = 'create_subscription' then
    insert into public.user_subscriptions (
      user_id, subscription_id, status, plan_id, product_id,
      date_next_charge, date_end
    ) values (
      p_user_id, p_subscription_id, 'active', p_plan_id, p_product_id,
      p_date_next_charge, null
    )
    on conflict (user_id, subscription_id) do update
      set plan_id = excluded.plan_id,
          product_id = coalesce(
            excluded.product_id,
            user_subscriptions.product_id
          ),
          date_next_charge = excluded.date_next_charge,
          date_end = null,
          updated_at = now()
      where user_subscriptions.status = 'active'
        and (
          user_subscriptions.date_next_charge is null or
          excluded.date_next_charge >= user_subscriptions.date_next_charge
        );

  elsif normalized_type = 'update_subscription' then
    insert into public.user_subscriptions (
      user_id, subscription_id, status, plan_id, product_id,
      date_next_charge, date_end
    ) values (
      p_user_id, p_subscription_id, 'active', p_plan_id, p_product_id,
      p_date_next_charge, null
    )
    on conflict (user_id, subscription_id) do update
      set plan_id = excluded.plan_id,
          product_id = coalesce(
            excluded.product_id,
            user_subscriptions.product_id
          ),
          date_next_charge = excluded.date_next_charge,
          updated_at = now()
      where user_subscriptions.status = 'active'
        and (
          user_subscriptions.date_next_charge is null or
          excluded.date_next_charge >= user_subscriptions.date_next_charge
        );

  elsif normalized_type = 'non_renewal_subscription' then
    insert into public.user_subscriptions (
      user_id, subscription_id, status, plan_id, product_id,
      date_next_charge, date_end
    ) values (
      p_user_id, p_subscription_id, 'non_renewing',
      p_plan_id, p_product_id, p_date_next_charge, null
    )
    on conflict (user_id, subscription_id) do update
      set status = 'non_renewing',
          plan_id = coalesce(excluded.plan_id, user_subscriptions.plan_id),
          product_id = coalesce(
            excluded.product_id,
            user_subscriptions.product_id
          ),
          date_next_charge = excluded.date_next_charge,
          updated_at = now()
      -- Slice B relies on sequential delivery, but a delayed stale event can
      -- still arrive. Both rank paths need the date guard so non_renewal cannot
      -- shorten the projected entitlement window.
      where (
          user_subscriptions.status = 'active' and
          (
            user_subscriptions.date_next_charge is null or
            excluded.date_next_charge >= user_subscriptions.date_next_charge
          )
        )
         or (
           user_subscriptions.status = 'non_renewing' and
           (
             user_subscriptions.date_next_charge is null or
             excluded.date_next_charge >= user_subscriptions.date_next_charge
           )
         );

  elsif normalized_type = 'cancel_subscription' then
    insert into public.user_subscriptions (
      user_id, subscription_id, status, plan_id, product_id,
      date_next_charge, date_end
    ) values (
      p_user_id, p_subscription_id, 'canceled',
      p_plan_id, p_product_id, p_date_next_charge, p_date_end
    )
    on conflict (user_id, subscription_id) do update
      set status = 'canceled',
          plan_id = coalesce(excluded.plan_id, user_subscriptions.plan_id),
          product_id = coalesce(
            excluded.product_id,
            user_subscriptions.product_id
          ),
          date_next_charge = coalesce(
            excluded.date_next_charge,
            user_subscriptions.date_next_charge
          ),
          date_end = excluded.date_end,
          updated_at = now()
      where user_subscriptions.status <> 'canceled'
         or user_subscriptions.date_end is null
         or excluded.date_end >= user_subscriptions.date_end;
  end if;

  return inserted_event;
end;
$$;

revoke all on function private.record_subscription_event(
  uuid, text, text, text, text, timestamptz, timestamptz, timestamptz, jsonb, text
) from public, anon, authenticated, service_role;

-- Public RPC name for the future signed webhook. The wrapper remains service
-- only; the private engine is not exposed through the Data API. p_user_id is
-- the ALREADY-RESOLVED Supabase auth uid: slice B resolves Xsolla user.id to
-- that auth uid upstream in the webhook handler before calling this RPC.
create or replace function public.record_subscription_event(
  p_user_id uuid,
  p_subscription_id text,
  p_notification_type text,
  p_plan_id text,
  p_product_id text,
  p_date_create timestamptz,
  p_date_next_charge timestamptz,
  p_date_end timestamptz,
  p_raw_payload jsonb,
  p_body_sha256 text
)
returns public.subscription_events
language sql
security definer
set search_path = ''
as $$
  select private.record_subscription_event(
    p_user_id,
    p_subscription_id,
    p_notification_type,
    p_plan_id,
    p_product_id,
    p_date_create,
    p_date_next_charge,
    p_date_end,
    p_raw_payload,
    p_body_sha256
  );
$$;

comment on function public.record_subscription_event(
  uuid, text, text, text, text, timestamptz, timestamptz, timestamptz, jsonb, text
) is
  'Service-only Xsolla subscription receipt boundary. p_user_id is the ALREADY-RESOLVED Supabase auth uid; slice B resolves Xsolla user.id upstream in the webhook handler. Exact semantic-date/body-hash replays return the prior receipt without reprojection; unknown types append unprocessed receipts.';

-- ---------------------------------------------------------------------------
-- Lunar Pass entitlement predicate.
--
-- Xsolla does not send failed-renewal/grace/dunning status, so active remains
-- entitled regardless of dates:
-- developers.xsolla.com/webhooks/subscriptions/updated-subscription/
-- Nonrenewal remains entitled before the charge that will not occur:
-- developers.xsolla.com/webhooks/subscriptions/nonrenewing-subscription/
-- Cancellation remains entitled only before a supplied terminal date_end:
-- developers.xsolla.com/webhooks/subscriptions/canceled-subscription/
-- ---------------------------------------------------------------------------
create or replace function public.is_lunar_pass_active(
  p_user_id uuid,
  p_at timestamptz,
  p_product_id text default null
)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  caller_id uuid := (select auth.uid());
  caller_claims jsonb := coalesce((select auth.jwt()), '{}'::jsonb);
  is_service boolean := coalesce(
    caller_claims ->> 'role' = 'service_role',
    false
  ) or current_setting('role', true) = 'service_role';
begin
  if not is_service and (
    caller_id is distinct from p_user_id or
    coalesce((caller_claims ->> 'is_anonymous')::boolean, false)
  ) then
    raise exception 'Lunar Pass status is self-only'
      using errcode = '42501';
  end if;

  if p_user_id is null or p_at is null then
    return false;
  end if;

  return exists (
    select 1
    from public.user_subscriptions as subscriptions
    where subscriptions.user_id = p_user_id
      and (
        p_product_id is null or
        subscriptions.product_id = p_product_id
      )
      and (
        subscriptions.status = 'active'
        or (
          subscriptions.status = 'non_renewing' and
          subscriptions.date_next_charge is not null and
          p_at < subscriptions.date_next_charge
        )
        or (
          subscriptions.status = 'canceled' and
          subscriptions.date_end is not null and
          p_at < subscriptions.date_end
        )
      )
  );
end;
$$;

comment on function public.is_lunar_pass_active(uuid, timestamptz, text) is
  'Stable service-or-authenticated-self Lunar Pass predicate. NULL product means any subscription; a non-NULL product requires an exact match. Slice C daily claims MUST pass the Lunar product id once its SKU exists so a future second subscription product cannot leak entitlement. Active survives invisible grace; nonrenewing and canceled access use strict, NULL-safe Xsolla boundary dates.';

-- ---------------------------------------------------------------------------
-- Forced RLS, Realtime, and explicit least-privilege grants.
-- ---------------------------------------------------------------------------
alter table public.subscription_events enable row level security;
alter table public.subscription_events force row level security;
alter table public.user_subscriptions enable row level security;
alter table public.user_subscriptions force row level security;

create policy "users read their own subscription events"
  on public.subscription_events
  for select
  to authenticated
  using ((select auth.uid()) = user_id);

create policy "users read their own subscription status"
  on public.user_subscriptions
  for select
  to authenticated
  using ((select auth.uid()) = user_id);

-- Future clients watch the projection only; raw webhook receipts stay private.
alter publication supabase_realtime add table public.user_subscriptions;

revoke all on table public.subscription_events
  from public, anon, authenticated, service_role;
revoke all on table public.user_subscriptions
  from public, anon, authenticated, service_role;

grant select on table public.subscription_events
  to authenticated, service_role;
grant select on table public.user_subscriptions
  to authenticated, service_role;

revoke all on function public.record_subscription_event(
  uuid, text, text, text, text, timestamptz, timestamptz, timestamptz, jsonb, text
) from public, anon, authenticated, service_role;
grant execute on function public.record_subscription_event(
  uuid, text, text, text, text, timestamptz, timestamptz, timestamptz, jsonb, text
) to service_role;

revoke all on function public.is_lunar_pass_active(uuid, timestamptz, text)
  from public, anon, authenticated, service_role;
grant execute on function public.is_lunar_pass_active(uuid, timestamptz, text)
  to authenticated, service_role;

revoke all on sequence public.subscription_events_id_seq
  from public, anon, authenticated, service_role;
