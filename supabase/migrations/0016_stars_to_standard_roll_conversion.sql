-- Migration: 0016_stars_to_standard_roll_conversion
-- Promotional Stars-to-standard-roll conversion for authenticated players.
-- Premium conversion remains legally gated by issue #154 and is not added here.

-- The private engine accepts an explicit user so trusted callers have one
-- implementation seam. The public wrapper below derives that user from the
-- authenticated session and therefore cannot convert currency for anyone else.
create or replace function private.convert_stars_to_standard_roll_for_user(
  p_user_id uuid,
  p_roll_count integer,
  p_idempotency_key text
)
returns table (
  wallet_ledger_entry_id bigint,
  roll_ticket_ledger_entry_id bigint,
  roll_count integer,
  stars_debited bigint,
  promotional_stars_balance_after bigint,
  standard_roll_tickets_credited bigint,
  standard_roll_quantity_after bigint
)
language plpgsql
volatile
set search_path = ''
as $$
declare
  -- Spec delta #4: 160 Stars ≡ 1 roll; matches singlePullCost.
  stars_per_standard_roll constant bigint := 160;
  economy_edition_id constant text := 'earned-collection@1';
  wallet_idempotency_key constant text :=
    'stars-to-standard-roll:wallet:' || p_idempotency_key;
  ticket_idempotency_key constant text :=
    'stars-to-standard-roll:ticket:' || p_idempotency_key;
  stars_to_debit bigint;
  conversion_provenance jsonb;
  target_account public.wallet_accounts%rowtype;
  wallet_entry public.wallet_ledger_entries%rowtype;
  ticket_entry public.roll_ticket_ledger_entries%rowtype;
begin
  if p_user_id is null then
    raise exception 'Stars conversion user is required' using errcode = '22023';
  end if;
  -- One hundred matches the existing pull preparation ceiling, prevents an
  -- accidentally huge conversion, and caps one request at 16,000 Stars.
  if p_roll_count is null or p_roll_count not between 1 and 100 then
    raise exception 'Roll count must be between one and one hundred'
      using errcode = '22023';
  end if;
  -- The longest derived key is 30 characters plus this bounded client key,
  -- remaining within both ledger boundaries' 200-character maximum.
  if p_idempotency_key is null or
     char_length(p_idempotency_key) not between 8 and 160 or
     p_idempotency_key !~ '^[A-Za-z0-9][A-Za-z0-9._:-]+$' then
    raise exception 'Invalid Stars conversion idempotency key'
      using errcode = '22023';
  end if;

  stars_to_debit := stars_per_standard_roll * p_roll_count::bigint;
  conversion_provenance := jsonb_build_object(
    'conversion_idempotency_key', p_idempotency_key,
    'roll_count', p_roll_count,
    'stars_per_standard_roll', stars_per_standard_roll
  );

  -- wallet_accounts is the first mutable lock, matching the canonical wallet,
  -- ticket, and pull lock order. The nested append functions reacquire this
  -- same row, so this adds no lock edge before either ledger write.
  target_account := private.lock_wallet_account(p_user_id);

  -- Use 0015's canonical append boundary. Its negative-delta guard computes
  -- available promotional Stars after active Star holds and preserves the
  -- existing 22003 insufficient-funds convention.
  wallet_entry := public.append_wallet_ledger_entry(
    p_user_id,
    'stars',
    'promotional',
    -stars_to_debit,
    'conversion.stars_to_standard_roll.debit',
    wallet_idempotency_key,
    economy_edition_id,
    conversion_provenance
  );

  ticket_entry := public.record_roll_ticket_ledger_entry(
    p_user_id,
    'standard_roll',
    p_roll_count::bigint,
    'conversion.stars_to_standard_roll.credit',
    ticket_idempotency_key,
    conversion_provenance
  );

  -- Both writes are idempotent appends in this single transaction. A crash
  -- rolls back both or commits both; retrying the conversion key reconstructs
  -- the same distinct inner keys, returning these original ledger rows without
  -- another debit or credit. Either append rejects payload drift with 22023.
  return query values (
    wallet_entry.id,
    ticket_entry.id,
    p_roll_count,
    -wallet_entry.delta_amount,
    wallet_entry.balance_after,
    ticket_entry.delta_quantity,
    ticket_entry.quantity_after
  );
end;
$$;

comment on function private.convert_stars_to_standard_roll_for_user(uuid, integer, text) is
  'Private atomic promotional-Stars-to-standard-roll engine with deterministic two-ledger idempotency and exact replay receipts.';

revoke all on function private.convert_stars_to_standard_roll_for_user(
  uuid, integer, text
) from public, anon, authenticated, service_role;

create or replace function public.convert_stars_to_standard_roll(
  p_roll_count integer,
  p_idempotency_key text
)
returns table (
  wallet_ledger_entry_id bigint,
  roll_ticket_ledger_entry_id bigint,
  roll_count integer,
  stars_debited bigint,
  promotional_stars_balance_after bigint,
  standard_roll_tickets_credited bigint,
  standard_roll_quantity_after bigint
)
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  caller_user_id uuid;
begin
  caller_user_id := private.require_non_anonymous_user();

  return query
  select
    conversion.wallet_ledger_entry_id,
    conversion.roll_ticket_ledger_entry_id,
    conversion.roll_count,
    conversion.stars_debited,
    conversion.promotional_stars_balance_after,
    conversion.standard_roll_tickets_credited,
    conversion.standard_roll_quantity_after
  from private.convert_stars_to_standard_roll_for_user(
    caller_user_id,
    p_roll_count,
    p_idempotency_key
  ) as conversion;
end;
$$;

comment on function public.convert_stars_to_standard_roll(integer, text) is
  'Authenticated self-only promotional-Stars-to-standard-roll conversion. Exact retries return the original two-ledger receipt.';

revoke all on function public.convert_stars_to_standard_roll(integer, text)
  from public, anon, authenticated, service_role;
grant execute on function public.convert_stars_to_standard_roll(integer, text)
  to authenticated;
