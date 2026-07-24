-- Migration: 0022_scrap_craft_economy
-- Monetization economy spec sections 1.6 and 6.1 deltas 12-13.
--
-- This free backend rail values every catalog rarity, credits earned Dust when
-- a live copy is scrapped, and lets a player spend earned Dust to duplicate a
-- die they currently own. It does not change prepare, seal, commit, or any
-- other pull path.

-- ---------------------------------------------------------------------------
-- Economy values are data, not function constants.
--
-- PROPOSED / PO-pending values from the spec section 7 table and
-- economy/drafts/monetization/DUST-SIM-REPORT.md rev 2:
--   standard 1/210, rare 4/220, epic 10/615, signature 25/2500,
--   mythic 50/non-craftable.
--
-- catalog_items has six rarity values. The production economy maps common and
-- uncommon to the standard tier, so both get their own directly joinable row.
-- Service-role UPDATE is intentional: a PO retune changes these rows, not the
-- schema or RPC bodies.
-- ---------------------------------------------------------------------------
create table public.dice_economy_values (
  catalog_rarity  text        primary key check (
    catalog_rarity in (
      'common', 'uncommon', 'rare', 'epic', 'legendary', 'mythic'
    )
  ),
  economy_tier    text        not null check (
    economy_tier in ('standard', 'rare', 'epic', 'signature', 'mythic')
  ),
  scrap_yield     bigint      not null check (scrap_yield > 0),
  craft_cost      bigint      check (
    craft_cost is null or craft_cost > scrap_yield
  ),
  value_version   integer     not null default 1 check (value_version > 0),
  status          text        not null default 'proposed-po-pending' check (
    status in ('proposed-po-pending', 'approved')
  ),
  updated_at      timestamptz not null default now(),

  constraint dice_economy_values_catalog_tier_mapping check (
    (catalog_rarity in ('common', 'uncommon') and economy_tier = 'standard') or
    (catalog_rarity = 'rare' and economy_tier = 'rare') or
    (catalog_rarity = 'epic' and economy_tier = 'epic') or
    (catalog_rarity = 'legendary' and economy_tier = 'signature') or
    (catalog_rarity = 'mythic' and economy_tier = 'mythic')
  ),
  constraint dice_economy_values_mythic_noncraftable check (
    (catalog_rarity = 'mythic' and craft_cost is null) or
    (catalog_rarity <> 'mythic' and craft_cost is not null)
  )
);

comment on table public.dice_economy_values is
  'Publicly inspectable, service-retunable Scrap Dust and craft values. Initial rows are PROPOSED / PO-pending per spec section 7 and DUST-SIM-REPORT rev 2.';

insert into public.dice_economy_values (
  catalog_rarity,
  economy_tier,
  scrap_yield,
  craft_cost,
  value_version,
  status
) values
  ('common',    'standard',  1,  210, 1, 'proposed-po-pending'),
  ('uncommon',  'standard',  1,  210, 1, 'proposed-po-pending'),
  ('rare',      'rare',      4,  220, 1, 'proposed-po-pending'),
  ('epic',      'epic',     10,  615, 1, 'proposed-po-pending'),
  ('legendary', 'signature', 25, 2500, 1, 'proposed-po-pending'),
  ('mythic',    'mythic',    50, null, 1, 'proposed-po-pending')
on conflict (catalog_rarity) do update
set economy_tier = excluded.economy_tier,
    scrap_yield = excluded.scrap_yield,
    craft_cost = excluded.craft_cost,
    value_version = excluded.value_version,
    status = excluded.status,
    updated_at = now()
where (
  dice_economy_values.economy_tier,
  dice_economy_values.scrap_yield,
  dice_economy_values.craft_cost,
  dice_economy_values.value_version,
  dice_economy_values.status
) is distinct from (
  excluded.economy_tier,
  excluded.scrap_yield,
  excluded.craft_cost,
  excluded.value_version,
  excluded.status
);

-- value_version identifies the economic payload consumed by receipts:
-- economy_tier, scrap_yield, and craft_cost. Changing any of those fields must
-- advance exactly one version. `status` is governance metadata only, so a
-- status-only transition keeps the current version. Every accepted update gets
-- a server timestamp; callers cannot rewrite history or choose updated_at.
create or replace function private.enforce_dice_economy_value_update()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  economic_payload_changed boolean;
begin
  if new.catalog_rarity is distinct from old.catalog_rarity then
    raise exception 'Dice economy catalog rarity is immutable'
      using errcode = '22023';
  end if;

  economic_payload_changed := (
    new.economy_tier,
    new.scrap_yield,
    new.craft_cost
  ) is distinct from (
    old.economy_tier,
    old.scrap_yield,
    old.craft_cost
  );

  if economic_payload_changed then
    if new.value_version <> old.value_version + 1 then
      raise exception 'Economic value changes require value_version %',
        old.value_version + 1
        using errcode = '22023';
    end if;
  elsif new.value_version <> old.value_version then
    raise exception 'value_version may advance only with an economic value change'
      using errcode = '22023';
  end if;

  new.updated_at := clock_timestamp();
  return new;
end;
$$;

create trigger dice_economy_values_enforce_update
  before update on public.dice_economy_values
  for each row execute function private.enforce_dice_economy_value_update();

revoke all on function private.enforce_dice_economy_value_update()
  from public, anon, authenticated, service_role;

-- Catalog rarity remains the join key, but economy_tier is the pricing
-- identity. A non-deferrable statement trigger lets a service retune every
-- rarity in a shared tier atomically while rejecting any statement that leaves
-- the tier split.
create or replace function private.assert_dice_economy_tier_value_equality()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if exists (
    select 1
    from public.dice_economy_values as left_value
    join public.dice_economy_values as right_value
      on right_value.economy_tier = left_value.economy_tier
     and right_value.catalog_rarity > left_value.catalog_rarity
    where (
        left_value.scrap_yield,
        left_value.craft_cost
      ) is distinct from (
        right_value.scrap_yield,
        right_value.craft_cost
      )
  ) then
    raise exception 'Every economy tier must use one Scrap yield and craft cost'
      using errcode = '55000';
  end if;

  return null;
end;
$$;

create trigger dice_economy_values_shared_tier_equality
  after insert or update
  on public.dice_economy_values
  for each statement
  execute function private.assert_dice_economy_tier_value_equality();

revoke all on function private.assert_dice_economy_tier_value_equality()
  from public, anon, authenticated, service_role;

alter table public.dice_economy_values enable row level security;
alter table public.dice_economy_values force row level security;

create policy "economy values are publicly readable"
  on public.dice_economy_values
  for select
  to anon, authenticated
  using (true);

revoke all on table public.dice_economy_values
  from public, anon, authenticated, service_role;
grant select on table public.dice_economy_values
  to anon, authenticated, service_role;
grant insert, update on table public.dice_economy_values
  to service_role;

-- ---------------------------------------------------------------------------
-- Receipt builders keep exact replays derived only from immutable marker,
-- grant, and ledger rows. They deliberately do not reread retunable values.
-- ---------------------------------------------------------------------------
create or replace function private.scrap_dice_copy_receipt(
  p_copy public.dice_copies,
  p_wallet_entry public.wallet_ledger_entries
)
returns jsonb
language sql
stable
set search_path = ''
as $$
  select jsonb_build_object(
    'copy_id', p_copy.id,
    'catalog_item_id', p_copy.catalog_item_id,
    'catalog_rarity', p_wallet_entry.provenance ->> 'catalog_rarity',
    'economy_tier', p_wallet_entry.provenance ->> 'economy_tier',
    'economy_value_version',
      (p_wallet_entry.provenance ->> 'economy_value_version')::integer,
    'dust_credited', p_wallet_entry.delta_amount,
    'dust_balance_after', p_wallet_entry.balance_after,
    'scrapped_at', p_copy.scrapped_at,
    'idempotency_key', p_copy.scrap_idempotency_key
  );
$$;

create or replace function private.craft_dice_copy_receipt(
  p_copy public.dice_copies,
  p_wallet_entry public.wallet_ledger_entries
)
returns jsonb
language sql
stable
set search_path = ''
as $$
  select jsonb_build_object(
    'copy_id', p_copy.id,
    'catalog_item_id', p_copy.catalog_item_id,
    'catalog_rarity', p_wallet_entry.provenance ->> 'catalog_rarity',
    'economy_tier', p_wallet_entry.provenance ->> 'economy_tier',
    'economy_value_version',
      (p_wallet_entry.provenance ->> 'economy_value_version')::integer,
    'dust_debited', -p_wallet_entry.delta_amount,
    'dust_balance_after', p_wallet_entry.balance_after,
    'acquired_via', p_copy.source_kind,
    'is_first_copy', p_copy.is_first_copy,
    'acquired_at', p_copy.acquired_at,
    'idempotency_key', p_wallet_entry.provenance ->> 'craft_idempotency_key'
  );
$$;

revoke all on function private.scrap_dice_copy_receipt(
  public.dice_copies, public.wallet_ledger_entries
) from public, anon, authenticated, service_role;
revoke all on function private.craft_dice_copy_receipt(
  public.dice_copies, public.wallet_ledger_entries
) from public, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Valued scrap engine.
--
-- wallet_accounts is the first mutable lock. The existing 0021 marker
-- primitive retains owner-only, once-only, and account-wide live-hold guards.
-- Its marker and this earned-Dust append share one transaction. A marker
-- written through the pre-0022 RPC is upgraded under the same account lock:
-- the missing deterministic wallet append is created exactly once from the
-- immutable copy's current rarity value. A present-but-mismatched append still
-- fails closed.
-- ---------------------------------------------------------------------------
create or replace function private.scrap_dice_copy_for_user(
  p_user_id uuid,
  p_copy_id uuid,
  p_idempotency_key text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_account public.wallet_accounts%rowtype;
  existing_copy public.dice_copies%rowtype;
  target_copy public.dice_copies%rowtype;
  scrapped_copy public.dice_copies%rowtype;
  economy_value public.dice_economy_values%rowtype;
  wallet_entry public.wallet_ledger_entries%rowtype;
  wallet_key text;
  expected_provenance jsonb;
  has_wallet_entry boolean;
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

  target_account := private.lock_wallet_account(p_user_id);
  wallet_key := 'scrap-dust:' || encode(
    extensions.digest(convert_to(p_idempotency_key, 'UTF8'), 'sha256'),
    'hex'
  );

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

    select *
    into wallet_entry
    from public.wallet_ledger_entries
    where account_id = target_account.id
      and idempotency_key = wallet_key;
    has_wallet_entry := found;

    if has_wallet_entry then
      if wallet_entry.user_id <> p_user_id or
         wallet_entry.currency_id <> 'dust' or
         wallet_entry.balance_bucket <> 'earned' or
         wallet_entry.delta_amount <= 0 or
         wallet_entry.reason_code <> 'dice.scrap.dust.credit' or
         wallet_entry.economy_edition_id <> 'earned-collection@1' or
         wallet_entry.provenance ->> 'catalog_rarity' is null or
         wallet_entry.provenance ->> 'economy_tier' is null or
         wallet_entry.provenance ->> 'economy_value_version' is null or
         wallet_entry.provenance ->> 'operation'
           is distinct from 'scrap' or
         wallet_entry.provenance ->> 'copy_id'
           is distinct from p_copy_id::text or
         wallet_entry.provenance ->> 'catalog_item_id'
           is distinct from
           existing_copy.catalog_item_id or
         wallet_entry.provenance ->> 'scrap_idempotency_key'
           is distinct from
           p_idempotency_key then
        raise exception 'Scrap replay receipt drifted from its wallet append'
          using errcode = '55000';
      end if;

      return private.scrap_dice_copy_receipt(existing_copy, wallet_entry);
    end if;

    -- Compatibility upgrade for a marker written before 0022 existed.
    select economy.*
    into economy_value
    from public.catalog_items as items
    join public.dice_economy_values as economy
      on economy.catalog_rarity = items.rarity
    where items.id = existing_copy.catalog_item_id
      and items.item_kind = 'die';

    if not found then
      raise exception 'Dice-copy rarity has no Scrap economy value'
        using errcode = '55000';
    end if;

    expected_provenance := jsonb_build_object(
      'operation', 'scrap',
      'copy_id', existing_copy.id,
      'catalog_item_id', existing_copy.catalog_item_id,
      'catalog_rarity', economy_value.catalog_rarity,
      'economy_tier', economy_value.economy_tier,
      'economy_value_version', economy_value.value_version,
      'scrap_idempotency_key', p_idempotency_key
    );

    wallet_entry := public.append_wallet_ledger_entry(
      p_user_id,
      'dust',
      'earned',
      economy_value.scrap_yield,
      'dice.scrap.dust.credit',
      wallet_key,
      'earned-collection@1',
      expected_provenance
    );

    return private.scrap_dice_copy_receipt(existing_copy, wallet_entry);
  end if;

  select copies.*
  into target_copy
  from public.dice_copies as copies
  where copies.id = p_copy_id
    and copies.user_id = p_user_id
  for update;

  if not found then
    raise exception 'Live dice copy is not owned by the caller'
      using errcode = '42501';
  end if;
  if target_copy.scrapped_at is not null then
    raise exception 'Dice copy % is already scrapped', p_copy_id
      using errcode = '55000';
  end if;

  select economy.*
  into economy_value
  from public.catalog_items as items
  join public.dice_economy_values as economy
    on economy.catalog_rarity = items.rarity
  where items.id = target_copy.catalog_item_id
    and items.item_kind = 'die';

  if not found then
    raise exception 'Dice-copy rarity has no Scrap economy value'
      using errcode = '55000';
  end if;

  expected_provenance := jsonb_build_object(
    'operation', 'scrap',
    'copy_id', target_copy.id,
    'catalog_item_id', target_copy.catalog_item_id,
    'catalog_rarity', economy_value.catalog_rarity,
    'economy_tier', economy_value.economy_tier,
    'economy_value_version', economy_value.value_version,
    'scrap_idempotency_key', p_idempotency_key
  );

  -- 0021's marker primitive performs the live-hold check after the account
  -- lock and records the irreversible transition exactly once.
  scrapped_copy := private.record_dice_copy_scrap(
    p_user_id,
    p_copy_id,
    p_idempotency_key
  );

  wallet_entry := public.append_wallet_ledger_entry(
    p_user_id,
    'dust',
    'earned',
    economy_value.scrap_yield,
    'dice.scrap.dust.credit',
    wallet_key,
    'earned-collection@1',
    expected_provenance
  );

  return private.scrap_dice_copy_receipt(scrapped_copy, wallet_entry);
end;
$$;

comment on function private.scrap_dice_copy_for_user(uuid, uuid, text) is
  'Wallet-first valued scrap engine. Atomically records the 0021 hold-safe marker and credits the rarity row scrap_yield to earned Dust.';

revoke all on function private.scrap_dice_copy_for_user(uuid, uuid, text)
  from public, anon, authenticated, service_role;

create or replace function public.scrap_dice_copy(
  p_copy_id uuid,
  p_idempotency_key text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller_id uuid;
begin
  caller_id := private.require_non_anonymous_user();
  return private.scrap_dice_copy_for_user(
    caller_id,
    p_copy_id,
    p_idempotency_key
  );
end;
$$;

comment on function public.scrap_dice_copy(uuid, text) is
  'Authenticated self-only idempotent Scrap RPC. Removes one owned live copy and returns the exact earned-Dust credit receipt.';

revoke all on function public.scrap_dice_copy(uuid, text)
  from public, anon, authenticated, service_role;
grant execute on function public.scrap_dice_copy(uuid, text)
  to authenticated;

-- Keep the 0020 name as a compatibility wrapper, but eliminate its old
-- marker-only behavior so no authenticated caller can scrap without Dust.
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
  caller_id uuid;
  receipt jsonb;
  scrapped_copy public.dice_copies%rowtype;
begin
  caller_id := private.require_non_anonymous_user();
  receipt := private.scrap_dice_copy_for_user(
    caller_id,
    p_copy_id,
    p_idempotency_key
  );

  select *
  into strict scrapped_copy
  from public.dice_copies
  where id = (receipt ->> 'copy_id')::uuid
    and user_id = caller_id;

  return scrapped_copy;
end;
$$;

comment on function public.scrap_dice_copy_marker(uuid, text) is
  'Deprecated compatibility name. Performs the full valued Scrap operation; use scrap_dice_copy for the Dust receipt.';

revoke all on function public.scrap_dice_copy_marker(uuid, text)
  from public, anon, authenticated, service_role;
grant execute on function public.scrap_dice_copy_marker(uuid, text)
  to authenticated;

-- ---------------------------------------------------------------------------
-- Owned-only craft engine.
--
-- Per spec section 1.6, ownership is the live copy count, not ever-owned
-- history. The wallet debit precedes the copy grant under the account lock.
-- record_dice_copy_grant's 0021 insert trigger automatically rejects the grant
-- with SQLSTATE 55000 during a live pull hold; the transaction then rolls the
-- debit back. This assertion intentionally reuses, rather than reimplements,
-- the ownership-snapshot freeze.
-- ---------------------------------------------------------------------------
create or replace function private.craft_dice_copy_for_user(
  p_user_id uuid,
  p_catalog_item_id text,
  p_idempotency_key text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_account public.wallet_accounts%rowtype;
  economy_value public.dice_economy_values%rowtype;
  existing_wallet_entry public.wallet_ledger_entries%rowtype;
  existing_copy public.dice_copies%rowtype;
  wallet_entry public.wallet_ledger_entries%rowtype;
  granted_copy public.dice_copies%rowtype;
  wallet_key text;
  grant_key text;
  source_reference text;
  expected_provenance jsonb;
  has_wallet_replay boolean;
  has_copy_replay boolean;
begin
  if p_user_id is null then
    raise exception 'Dice-copy user id is required' using errcode = '22023';
  end if;
  if p_catalog_item_id is null then
    raise exception 'Dice-copy catalog item is required' using errcode = '22023';
  end if;
  if p_idempotency_key is null or
     char_length(p_idempotency_key) not between 8 and 200 or
     p_idempotency_key !~ '^[A-Za-z0-9][A-Za-z0-9._:-]+$' then
    raise exception 'Invalid dice-copy idempotency key'
      using errcode = '22023';
  end if;

  target_account := private.lock_wallet_account(p_user_id);
  wallet_key := 'craft-dust:' || encode(
    extensions.digest(convert_to(p_idempotency_key, 'UTF8'), 'sha256'),
    'hex'
  );
  grant_key := 'craft-copy:' || encode(
    extensions.digest(convert_to(p_idempotency_key, 'UTF8'), 'sha256'),
    'hex'
  );
  source_reference := 'craft:' || p_idempotency_key;

  select *
  into existing_wallet_entry
  from public.wallet_ledger_entries
  where account_id = target_account.id
    and idempotency_key = wallet_key;
  has_wallet_replay := found;

  select *
  into existing_copy
  from public.dice_copies
  where user_id = p_user_id
    and grant_idempotency_key = grant_key;
  has_copy_replay := found;

  if has_wallet_replay or has_copy_replay then
    if not has_wallet_replay or not has_copy_replay or
       existing_wallet_entry.user_id <> p_user_id or
       existing_wallet_entry.currency_id <> 'dust' or
       existing_wallet_entry.balance_bucket <> 'earned' or
       existing_wallet_entry.delta_amount >= 0 or
       existing_wallet_entry.reason_code <> 'dice.craft.dust.debit' or
       existing_wallet_entry.economy_edition_id <> 'earned-collection@1' or
       existing_wallet_entry.provenance ->> 'catalog_rarity' is null or
       existing_wallet_entry.provenance ->> 'economy_tier' is null or
       existing_wallet_entry.provenance ->> 'economy_value_version' is null or
       existing_wallet_entry.provenance ->> 'operation'
         is distinct from 'craft' or
       existing_wallet_entry.provenance ->> 'catalog_item_id'
         is distinct from
         p_catalog_item_id or
       existing_wallet_entry.provenance ->> 'craft_idempotency_key'
         is distinct from
         p_idempotency_key or
       existing_copy.catalog_item_id <> p_catalog_item_id or
       existing_copy.source_kind <> 'craft' or
       existing_copy.source_reference <> source_reference or
       existing_copy.is_first_copy then
      raise exception 'Craft idempotency replay drifted from its original payload'
        using errcode = '55000';
    end if;

    return private.craft_dice_copy_receipt(
      existing_copy,
      existing_wallet_entry
    );
  end if;

  select economy.*
  into economy_value
  from public.catalog_items as items
  join public.dice_economy_values as economy
    on economy.catalog_rarity = items.rarity
  where items.id = p_catalog_item_id
    and items.item_kind = 'die';

  if not found then
    raise exception 'Dice-copy catalog item has no craft economy value'
      using errcode = '22023';
  end if;
  if economy_value.craft_cost is null then
    raise exception 'This dice rarity is not craftable'
      using errcode = '55000';
  end if;

  -- Owned-only means at least one LIVE copy now. The retained ever-owned latch
  -- is deliberately insufficient after a player scraps their live count to 0.
  if not exists (
    select 1
    from public.dice_copies
    where user_id = p_user_id
      and catalog_item_id = p_catalog_item_id
      and scrapped_at is null
  ) then
    raise exception 'Craft requires an owned live copy of the target die'
      using errcode = '55000';
  end if;

  expected_provenance := jsonb_build_object(
    'operation', 'craft',
    'catalog_item_id', p_catalog_item_id,
    'catalog_rarity', economy_value.catalog_rarity,
    'economy_tier', economy_value.economy_tier,
    'economy_value_version', economy_value.value_version,
    'craft_idempotency_key', p_idempotency_key
  );

  wallet_entry := public.append_wallet_ledger_entry(
    p_user_id,
    'dust',
    'earned',
    -economy_value.craft_cost,
    'dice.craft.dust.debit',
    wallet_key,
    'earned-collection@1',
    expected_provenance
  );

  granted_copy := public.record_dice_copy_grant(
    p_user_id,
    p_catalog_item_id,
    'craft',
    source_reference,
    grant_key
  );

  if granted_copy.is_first_copy then
    raise exception 'Owned-only craft unexpectedly created a first-ever copy'
      using errcode = '55000';
  end if;

  return private.craft_dice_copy_receipt(granted_copy, wallet_entry);
end;
$$;

comment on function private.craft_dice_copy_for_user(uuid, text, text) is
  'Wallet-first owned-live-copy craft engine. Debits retunable earned-Dust cost and grants exactly one craft copy; 0021 supplies the live-hold freeze.';

revoke all on function private.craft_dice_copy_for_user(uuid, text, text)
  from public, anon, authenticated, service_role;

create or replace function public.craft_dice_copy(
  p_catalog_item_id text,
  p_idempotency_key text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller_id uuid;
begin
  caller_id := private.require_non_anonymous_user();
  return private.craft_dice_copy_for_user(
    caller_id,
    p_catalog_item_id,
    p_idempotency_key
  );
end;
$$;

comment on function public.craft_dice_copy(text, text) is
  'Authenticated self-only idempotent owned-live-copy craft RPC. Returns the exact earned-Dust debit and granted-copy receipt.';

revoke all on function public.craft_dice_copy(text, text)
  from public, anon, authenticated, service_role;
grant execute on function public.craft_dice_copy(text, text)
  to authenticated;
