-- Migration: 0020_dice_copy_inventory
-- Monetization economy spec section 6.1 delta 10.
--
-- This is a dormant, additive inventory foundation. It does not backfill
-- entitlements or change pull, seal, scrap-value, craft, or consumer behavior.

create table public.dice_copies (
  id                     uuid        primary key default gen_random_uuid(),
  user_id                uuid        not null references auth.users (id) on delete restrict,
  catalog_item_id        text        not null references public.catalog_items (id) on delete restrict,
  source_kind            text        not null check (
    source_kind in ('pull', 'craft', 'purchase', 'reward')
  ),
  source_reference       text        not null,
  grant_idempotency_key  text        not null,
  acquired_at            timestamptz not null default now(),
  is_first_copy          boolean     not null,
  scrapped_at            timestamptz,
  scrap_idempotency_key  text,

  constraint dice_copies_user_grant_idempotency_unique
    unique (user_id, grant_idempotency_key),
  constraint dice_copies_source_reference
    check (char_length(source_reference) between 1 and 512),
  constraint dice_copies_grant_idempotency_key
    check (
      char_length(grant_idempotency_key) between 8 and 200 and
      grant_idempotency_key ~ '^[A-Za-z0-9][A-Za-z0-9._:-]+$'
    ),
  constraint dice_copies_scrap_idempotency_key
    check (
      scrap_idempotency_key is null or
      (
        char_length(scrap_idempotency_key) between 8 and 200 and
        scrap_idempotency_key ~ '^[A-Za-z0-9][A-Za-z0-9._:-]+$'
      )
    ),
  constraint dice_copies_scrap_marker_pair
    check (
      (scrapped_at is null and scrap_idempotency_key is null) or
      (scrapped_at is not null and scrap_idempotency_key is not null)
    ),
  constraint dice_copies_scrap_order
    check (scrapped_at is null or scrapped_at >= acquired_at)
);

-- The retained first row is the per-user/catalog-item ever-owned latch.
-- Serializing grants on the wallet-account row makes this partial uniqueness
-- constraint deterministic even when the first grants race.
create unique index dice_copies_first_copy_latch_idx
  on public.dice_copies (user_id, catalog_item_id)
  where is_first_copy;

-- Supports the ownership predicate and live-copy count with an index-only
-- scan over one user's one catalog item.
create index dice_copies_live_count_idx
  on public.dice_copies (user_id, catalog_item_id)
  where scrapped_at is null;

create unique index dice_copies_user_scrap_idempotency_idx
  on public.dice_copies (user_id, scrap_idempotency_key)
  where scrap_idempotency_key is not null;

-- Supports catalog-item RESTRICT checks and catalog-keyed inventory scans.
create index dice_copies_catalog_item_id_fkey_idx
  on public.dice_copies (catalog_item_id);

-- Covers unfiltered per-user/catalog history lookups, including scrapped rows.
create index dice_copies_user_catalog_item_idx
  on public.dice_copies (user_id, catalog_item_id);

comment on table public.dice_copies is
  'One immutable row per acquired spawnable die copy. Ownership is the count of rows whose scrapped_at is null; retained first-copy rows form the never-unlatched ever-owned flag.';

-- Rows are immutable except for the single null-to-value scrap transition.
create or replace function private.enforce_dice_copy_transition()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'TRUNCATE' then
    raise exception 'TRUNCATE on public.dice_copies is forbidden'
      using errcode = '55000';
  end if;

  if tg_op = 'DELETE' then
    raise exception 'Dice copies must never be deleted; append the scrap marker'
      using errcode = '55000';
  end if;

  if old.scrapped_at is not null or
     new.scrapped_at is null or
     old.scrap_idempotency_key is not null or
     new.scrap_idempotency_key is null or
     new.id is distinct from old.id or
     new.user_id is distinct from old.user_id or
     new.catalog_item_id is distinct from old.catalog_item_id or
     new.source_kind is distinct from old.source_kind or
     new.source_reference is distinct from old.source_reference or
     new.grant_idempotency_key is distinct from old.grant_idempotency_key or
     new.acquired_at is distinct from old.acquired_at or
     new.is_first_copy is distinct from old.is_first_copy then
    raise exception 'Dice copies permit only one irreversible scrap transition'
      using errcode = '55000';
  end if;

  return new;
end;
$$;

create trigger dice_copies_enforce_update_delete
  before update or delete on public.dice_copies
  for each row execute function private.enforce_dice_copy_transition();

create trigger dice_copies_reject_truncate
  before truncate on public.dice_copies
  for each statement execute function private.enforce_dice_copy_transition();

revoke all on function private.enforce_dice_copy_transition()
  from public, anon, authenticated, service_role;

-- Service-only acquisition boundary. The wallet-account lock serializes every
-- inventory operation for a user, including first-ever and idempotency checks.
create or replace function public.record_dice_copy_grant(
  p_user_id uuid,
  p_catalog_item_id text,
  p_source_kind text,
  p_source_reference text,
  p_idempotency_key text
)
returns public.dice_copies
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_account public.wallet_accounts%rowtype;
  existing_copy public.dice_copies%rowtype;
  inserted_copy public.dice_copies%rowtype;
  first_ever boolean;
begin
  if p_user_id is null then
    raise exception 'Dice-copy user id is required' using errcode = '22023';
  end if;
  if p_catalog_item_id is null or not exists (
    select 1
    from public.catalog_items
    where id = p_catalog_item_id
      and item_kind = 'die'
  ) then
    raise exception 'Dice-copy catalog item must identify a die'
      using errcode = '22023';
  end if;
  if p_source_kind is null or
     p_source_kind not in ('pull', 'craft', 'purchase', 'reward') then
    raise exception 'Unsupported dice-copy source kind %', p_source_kind
      using errcode = '22023';
  end if;
  if p_source_reference is null or
     char_length(p_source_reference) not between 1 and 512 then
    raise exception 'Invalid dice-copy source reference'
      using errcode = '22023';
  end if;
  if p_idempotency_key is null or
     char_length(p_idempotency_key) not between 8 and 200 or
     p_idempotency_key !~ '^[A-Za-z0-9][A-Za-z0-9._:-]+$' then
    raise exception 'Invalid dice-copy idempotency key'
      using errcode = '22023';
  end if;

  insert into public.wallet_accounts (user_id)
  values (p_user_id)
  on conflict (user_id) do nothing;

  select *
  into strict target_account
  from public.wallet_accounts
  where user_id = p_user_id
  for update;

  select *
  into existing_copy
  from public.dice_copies
  where user_id = p_user_id
    and grant_idempotency_key = p_idempotency_key;

  if found then
    if existing_copy.catalog_item_id <> p_catalog_item_id or
       existing_copy.source_kind <> p_source_kind or
       existing_copy.source_reference <> p_source_reference then
      raise exception 'Idempotency key % was already used with a different dice-copy grant payload',
        p_idempotency_key
        using errcode = '22023';
    end if;
    return existing_copy;
  end if;

  if exists (
    select 1
    from public.dice_copies
    where user_id = p_user_id
      and scrap_idempotency_key = p_idempotency_key
  ) then
    raise exception 'Idempotency key % was already used for dice-copy scrap',
      p_idempotency_key
      using errcode = '22023';
  end if;

  first_ever := not exists (
    select 1
    from public.dice_copies
    where user_id = p_user_id
      and catalog_item_id = p_catalog_item_id
      and is_first_copy
  );

  insert into public.dice_copies (
    user_id,
    catalog_item_id,
    source_kind,
    source_reference,
    grant_idempotency_key,
    is_first_copy
  ) values (
    p_user_id,
    p_catalog_item_id,
    p_source_kind,
    p_source_reference,
    p_idempotency_key,
    first_ever
  )
  returning * into inserted_copy;

  return inserted_copy;
end;
$$;

comment on function public.record_dice_copy_grant(uuid, text, text, text, text) is
  'Service-role-only idempotent grant boundary. Appends one copy and latches is_first_copy only for the first-ever user/catalog-item acquisition.';

-- Private marker primitive. Exact replay returns the original transitioned
-- row; a different key cannot scrap an already non-live copy.
create or replace function private.record_dice_copy_scrap(
  p_user_id uuid,
  p_copy_id uuid,
  p_idempotency_key text
)
returns public.dice_copies
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_account public.wallet_accounts%rowtype;
  existing_copy public.dice_copies%rowtype;
  target_copy public.dice_copies%rowtype;
  scrapped_copy public.dice_copies%rowtype;
begin
  if p_user_id is null then
    raise exception 'Dice-copy user id is required' using errcode = '22023';
  end if;
  if p_copy_id is null then
    raise exception 'Dice-copy id is required' using errcode = '22023';
  end if;
  if p_idempotency_key is null or
     char_length(p_idempotency_key) not between 8 and 200 or
     p_idempotency_key !~ '^[A-Za-z0-9][A-Za-z0-9._:-]+$' then
    raise exception 'Invalid dice-copy idempotency key'
      using errcode = '22023';
  end if;

  insert into public.wallet_accounts (user_id)
  values (p_user_id)
  on conflict (user_id) do nothing;

  select *
  into strict target_account
  from public.wallet_accounts
  where user_id = p_user_id
  for update;

  select *
  into existing_copy
  from public.dice_copies
  where user_id = p_user_id
    and scrap_idempotency_key = p_idempotency_key;

  if found then
    if existing_copy.id <> p_copy_id then
      raise exception 'Idempotency key % was already used with a different dice-copy scrap payload',
        p_idempotency_key
        using errcode = '22023';
    end if;
    return existing_copy;
  end if;

  if exists (
    select 1
    from public.dice_copies
    where user_id = p_user_id
      and grant_idempotency_key = p_idempotency_key
  ) then
    raise exception 'Idempotency key % was already used for a dice-copy grant',
      p_idempotency_key
      using errcode = '22023';
  end if;

  select *
  into target_copy
  from public.dice_copies
  where id = p_copy_id
    and user_id = p_user_id
  for update;

  if not found then
    raise exception 'Live dice copy is not owned by the caller'
      using errcode = '42501';
  end if;
  if target_copy.scrapped_at is not null then
    raise exception 'Dice copy % is already scrapped', p_copy_id
      using errcode = '55000';
  end if;

  update public.dice_copies
  set scrapped_at = now(),
      scrap_idempotency_key = p_idempotency_key
  where id = p_copy_id
    and user_id = p_user_id
    and scrapped_at is null
  returning * into scrapped_copy;

  if not found then
    raise exception 'Dice copy % is not live', p_copy_id
      using errcode = '55000';
  end if;

  return scrapped_copy;
end;
$$;

-- Authenticated wrapper binds the owner to auth.uid(). It only records the
-- irreversible marker; Dust valuation and wallet credit remain delta 12.
create or replace function public.scrap_dice_copy_marker(
  p_copy_id uuid,
  p_idempotency_key text
)
returns public.dice_copies
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller_id uuid := (select auth.uid());
begin
  if caller_id is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;

  return private.record_dice_copy_scrap(
    caller_id,
    p_copy_id,
    p_idempotency_key
  );
end;
$$;

comment on function public.scrap_dice_copy_marker(uuid, text) is
  'Authenticated self-only idempotent marker transition. No Dust is credited; the valued scrap RPC remains a later economy delta.';

alter table public.dice_copies enable row level security;
alter table public.dice_copies force row level security;

create policy "users read their own dice copies"
  on public.dice_copies
  for select
  to authenticated
  using ((select auth.uid()) = user_id);

revoke all on table public.dice_copies
  from public, anon, authenticated, service_role;
grant select on table public.dice_copies
  to authenticated, service_role;

revoke all on function public.record_dice_copy_grant(
  uuid, text, text, text, text
) from public, anon, authenticated, service_role;
grant execute on function public.record_dice_copy_grant(
  uuid, text, text, text, text
) to service_role;

revoke all on function private.record_dice_copy_scrap(uuid, uuid, text)
  from public, anon, authenticated, service_role;

revoke all on function public.scrap_dice_copy_marker(uuid, text)
  from public, anon, authenticated, service_role;
grant execute on function public.scrap_dice_copy_marker(uuid, text)
  to authenticated;
