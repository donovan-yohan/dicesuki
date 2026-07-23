-- Migration: 0014_roll_ticket_ledger
-- Monetization economy schema delta #2 -- durable roll-ticket balances and ledger
--
-- Migration 0013 added the paid-checkout foundation. This migration follows
-- that merged schema and remains the next contiguous number.
--
-- This is a roll-ticket ledger foundation only. It creates no banner binding,
-- Stars-to-ticket conversion, pull consumption, entitlement, checkout, or RNG
-- path. Trusted server code may record standard or premium roll-ticket deltas
-- through one service-role-only function. Normal clients can read only their
-- own ticket balances and history.

-- ---------------------------------------------------------------------------
-- roll_ticket_balances: current materialized quantity, always reconciled
-- atomically with the append-only ledger by record_roll_ticket_ledger_entry().
-- ---------------------------------------------------------------------------
create table public.roll_ticket_balances (
  user_id           uuid        not null references auth.users (id) on delete restrict,
  roll_type         text        not null check (roll_type in ('standard_roll', 'premium_roll')),
  current_quantity  bigint      not null default 0 check (current_quantity >= 0),
  updated_at        timestamptz not null default now(),

  primary key (user_id, roll_type)
);

comment on table public.roll_ticket_balances is
  'Materialized nonnegative roll-ticket quantities. Standard and premium rolls remain distinct types and may change only through the trusted ledger record boundary.';

-- ---------------------------------------------------------------------------
-- roll_ticket_ledger_entries: immutable, append-only quantity history.
-- ---------------------------------------------------------------------------
create table public.roll_ticket_ledger_entries (
  id                 bigint      generated always as identity primary key,
  user_id            uuid        not null references auth.users (id) on delete restrict,
  roll_type          text        not null check (roll_type in ('standard_roll', 'premium_roll')),
  delta_quantity     bigint      not null check (delta_quantity <> 0),
  quantity_before    bigint      not null check (quantity_before >= 0),
  quantity_after     bigint      not null check (quantity_after >= 0),
  reason_code        text        not null,
  idempotency_key    text        not null,
  provenance         jsonb       not null default '{}'::jsonb,
  created_at         timestamptz not null default now(),

  constraint roll_ticket_ledger_entries_balance_fkey
    foreign key (user_id, roll_type)
    references public.roll_ticket_balances (user_id, roll_type)
    on delete restrict,
  constraint roll_ticket_ledger_entries_user_idempotency_unique
    unique (user_id, idempotency_key),
  constraint roll_ticket_ledger_entries_quantity_chain
    check (quantity_after::numeric = quantity_before::numeric + delta_quantity::numeric),
  constraint roll_ticket_ledger_entries_reason_code
    check (
      char_length(reason_code) between 3 and 128 and
      reason_code ~ '^[a-z][a-z0-9_.:-]+$'
    ),
  constraint roll_ticket_ledger_entries_idempotency_key
    check (char_length(idempotency_key) between 8 and 200),
  constraint roll_ticket_ledger_entries_provenance_object
    check (jsonb_typeof(provenance) = 'object'),
  constraint roll_ticket_ledger_entries_provenance_size
    check (octet_length(provenance::text) <= 8192)
);

create index roll_ticket_ledger_entries_user_created_idx
  on public.roll_ticket_ledger_entries (user_id, created_at desc, id desc);

create index roll_ticket_ledger_entries_balance_fkey_idx
  on public.roll_ticket_ledger_entries (user_id, roll_type);

comment on table public.roll_ticket_ledger_entries is
  'Immutable roll-ticket quantity deltas with exact before/after quantities, reason, user-scoped idempotency key, and bounded provenance.';

-- ---------------------------------------------------------------------------
-- Append-only enforcement, including TRUNCATE (which row triggers do not
-- cover). Table owners still retain disaster-recovery authority outside the
-- application boundary; every normal API role is explicitly stripped below.
-- ---------------------------------------------------------------------------
create or replace function public.reject_roll_ticket_history_mutation()
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

create trigger roll_ticket_ledger_entries_reject_update_delete
  before update or delete on public.roll_ticket_ledger_entries
  for each row execute function public.reject_roll_ticket_history_mutation();

create trigger roll_ticket_ledger_entries_reject_truncate
  before truncate on public.roll_ticket_ledger_entries
  for each statement execute function public.reject_roll_ticket_history_mutation();

revoke all on function public.reject_roll_ticket_history_mutation()
  from public, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Service-only record boundary.
--
-- All ticket mutations for one user lock the stable wallet account row first.
-- That consistent order serializes cross-type idempotency keys and prevents
-- concurrent overspend. A replay with the same key and exact payload returns
-- the original row; a mismatched replay fails closed.
-- ---------------------------------------------------------------------------
create or replace function public.record_roll_ticket_ledger_entry(
  p_user_id uuid,
  p_roll_type text,
  p_delta_quantity bigint,
  p_reason_code text,
  p_idempotency_key text,
  p_provenance jsonb default '{}'::jsonb
)
returns public.roll_ticket_ledger_entries
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_account public.wallet_accounts%rowtype;
  target_balance public.roll_ticket_balances%rowtype;
  existing_entry public.roll_ticket_ledger_entries%rowtype;
  inserted_entry public.roll_ticket_ledger_entries%rowtype;
  resulting_quantity numeric;
begin
  if p_user_id is null then
    raise exception 'Roll-ticket user id is required' using errcode = '22023';
  end if;
  if p_delta_quantity is null or p_delta_quantity = 0 then
    raise exception 'Roll-ticket delta must be nonzero' using errcode = '22023';
  end if;
  if p_roll_type is null or
     p_roll_type not in ('standard_roll', 'premium_roll') then
    raise exception 'Unsupported roll-ticket type %', p_roll_type
      using errcode = '22023';
  end if;
  if p_reason_code is null or
     char_length(p_reason_code) not between 3 and 128 or
     p_reason_code !~ '^[a-z][a-z0-9_.:-]+$' then
    raise exception 'Invalid roll-ticket reason code' using errcode = '22023';
  end if;
  if p_idempotency_key is null or
     char_length(p_idempotency_key) not between 8 and 200 then
    raise exception 'Invalid roll-ticket idempotency key' using errcode = '22023';
  end if;
  if p_provenance is null or
     jsonb_typeof(p_provenance) <> 'object' or
     octet_length(p_provenance::text) > 8192 then
    raise exception 'Roll-ticket provenance must be a bounded JSON object'
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
  into existing_entry
  from public.roll_ticket_ledger_entries
  where user_id = p_user_id
    and idempotency_key = p_idempotency_key;

  if found then
    if existing_entry.roll_type <> p_roll_type or
       existing_entry.delta_quantity <> p_delta_quantity or
       existing_entry.reason_code <> p_reason_code or
       existing_entry.provenance is distinct from p_provenance then
      raise exception 'Idempotency key % was already used with a different roll-ticket payload',
        p_idempotency_key
        using errcode = '22023';
    end if;
    return existing_entry;
  end if;

  insert into public.roll_ticket_balances (user_id, roll_type)
  values (p_user_id, p_roll_type)
  on conflict (user_id, roll_type) do nothing;

  select *
  into strict target_balance
  from public.roll_ticket_balances
  where user_id = p_user_id
    and roll_type = p_roll_type
  for update;

  resulting_quantity := target_balance.current_quantity::numeric + p_delta_quantity::numeric;
  if resulting_quantity < 0 then
    raise exception 'Insufficient % roll-ticket quantity', p_roll_type
      using errcode = '22003';
  end if;
  if resulting_quantity > 9223372036854775807::numeric then
    raise exception 'Roll-ticket quantity overflow' using errcode = '22003';
  end if;

  insert into public.roll_ticket_ledger_entries (
    user_id,
    roll_type,
    delta_quantity,
    quantity_before,
    quantity_after,
    reason_code,
    idempotency_key,
    provenance
  ) values (
    p_user_id,
    p_roll_type,
    p_delta_quantity,
    target_balance.current_quantity,
    resulting_quantity::bigint,
    p_reason_code,
    p_idempotency_key,
    p_provenance
  )
  returning * into inserted_entry;

  update public.roll_ticket_balances
  set current_quantity = resulting_quantity::bigint,
      updated_at = now()
  where user_id = p_user_id
    and roll_type = p_roll_type;

  return inserted_entry;
end;
$$;

comment on function public.record_roll_ticket_ledger_entry(uuid, text, bigint, text, text, jsonb) is
  'Service-role-only roll-ticket record boundary: locks the account, returns exact idempotent replays, rejects mismatches and negative/overflow quantities, and atomically updates ledger plus snapshot.';

-- ---------------------------------------------------------------------------
-- RLS and explicit least-privilege grants.
--
-- Authenticated users can read only their own ticket balances and history. No
-- API role receives direct ticket DML.
-- ---------------------------------------------------------------------------
alter table public.roll_ticket_balances enable row level security;
alter table public.roll_ticket_balances force row level security;
alter table public.roll_ticket_ledger_entries enable row level security;
alter table public.roll_ticket_ledger_entries force row level security;

create policy "users read their own roll-ticket balances"
  on public.roll_ticket_balances
  for select
  to authenticated
  using ((select auth.uid()) = user_id);

create policy "users read their own roll-ticket ledger"
  on public.roll_ticket_ledger_entries
  for select
  to authenticated
  using ((select auth.uid()) = user_id);

revoke all on table public.roll_ticket_balances
  from public, anon, authenticated, service_role;
revoke all on table public.roll_ticket_ledger_entries
  from public, anon, authenticated, service_role;

grant select on table public.roll_ticket_balances to authenticated, service_role;
grant select on table public.roll_ticket_ledger_entries to authenticated, service_role;

revoke all on function public.record_roll_ticket_ledger_entry(
  uuid, text, bigint, text, text, jsonb
) from public, anon, authenticated, service_role;

grant execute on function public.record_roll_ticket_ledger_entry(
  uuid, text, bigint, text, text, jsonb
) to service_role;

-- Identity sequences inherit PUBLIC defaults on some Postgres installations.
-- The trusted SECURITY DEFINER function uses the sequence as its owner; API
-- roles need no direct sequence capability.
revoke all on sequence public.roll_ticket_ledger_entries_id_seq
  from public, anon, authenticated, service_role;
