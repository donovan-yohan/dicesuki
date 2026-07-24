-- Migration: 0027_paid_stars_bucket
-- Monetization economy spec section 6 delta 1 -- dormant paid Stars bucket.
--
-- Issue #154 gate discipline: this slice makes paid-Star CREDITS possible only
-- through the existing service-role append boundary. It adds no caller and no
-- paid debit. Promotional-before-paid is the documented eventual spend policy;
-- paid participation in conversion, pull holds, and pull commit is deferred to
-- the issue #154 activation slice.

-- The two pair constraints and the ledger's independent bucket-domain check
-- must widen atomically. Explicit NULL guards close CHECK UNKNOWN even though
-- the underlying columns also remain NOT NULL.
alter table public.wallet_balances
  drop constraint wallet_balances_currency_bucket_pair,
  -- [#154] GATE: widen the balance pair by exactly stars/paid.
  add constraint wallet_balances_currency_bucket_pair
  check (
    currency_id is not null and
    balance_bucket is not null and
    (
      (currency_id = 'stars' and balance_bucket = 'promotional') or
      (currency_id = 'stars' and balance_bucket = 'paid') or
      (currency_id = 'dust' and balance_bucket = 'earned')
    )
  );

alter table public.wallet_ledger_entries
  drop constraint wallet_ledger_entries_balance_bucket_check,
  -- [#154] GATE: make paid a legal ledger bucket for the paired check below.
  add constraint wallet_ledger_entries_balance_bucket_check
    check (
      balance_bucket is not null and
      balance_bucket in ('promotional', 'earned', 'paid')
    ),
  drop constraint wallet_ledger_entries_currency_bucket_pair,
  -- [#154] GATE: widen the ledger pair by exactly stars/paid.
  add constraint wallet_ledger_entries_currency_bucket_pair
  check (
    currency_id is not null and
    balance_bucket is not null and
    (
      (currency_id = 'stars' and balance_bucket = 'promotional') or
      (currency_id = 'stars' and balance_bucket = 'paid') or
      (currency_id = 'dust' and balance_bucket = 'earned')
    )
  );

-- Canonical 0017 append body. Only the currency/bucket validator, its error,
-- and the adjacent issue #154 paid-debit gate differ. Every inherited account
-- lock, idempotency, hold, overflow, append, and snapshot guard stays exact.
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
begin
  if p_user_id is null then
    raise exception 'Wallet user id is required' using errcode = '22023';
  end if;
  if p_delta_amount is null or p_delta_amount = 0 then
    raise exception 'Wallet delta must be nonzero' using errcode = '22023';
  end if;
  -- Issue #154 delta 1: exactly one new pair, stars/paid, is admitted.
  if p_currency_id is null or p_balance_bucket is null or not (
    (p_currency_id = 'stars' and p_balance_bucket = 'promotional') or
    (p_currency_id = 'stars' and p_balance_bucket = 'paid') or
    (p_currency_id = 'dust' and p_balance_bucket = 'earned')
  ) then
    raise exception 'Unsupported wallet currency/bucket pair %/%',
      p_currency_id, p_balance_bucket
      using errcode = '22023';
  end if;
  -- Issue #154 dormant boundary: paid credits may be staged by service_role,
  -- but no paid spend participates until the activation/debit-policy slice.
  if p_balance_bucket = 'paid' and p_delta_amount < 0 then
    raise exception 'Paid Stars debits remain disabled pending issue #154 activation'
      using errcode = '55000';
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
    -- Account lock plus VOLATILE execution gives this query a fresh snapshot;
    -- wall-clock time is captured only after any prior lock holder commits.
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
  'Service-role-only wallet append boundary. Issue #154 delta 1 admits paid-Star credits while paid debits remain dormant; idempotency, nonnegative balance, overflow, and active-hold guards remain canonical.';

revoke all on function public.append_wallet_ledger_entry(
  uuid, text, text, bigint, text, text, text, jsonb
) from public, anon, authenticated, service_role;

grant execute on function public.append_wallet_ledger_entry(
  uuid, text, text, bigint, text, text, text, jsonb
) to service_role;
