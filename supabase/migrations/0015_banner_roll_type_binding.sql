-- Migration: 0015_banner_roll_type_binding
-- Standard banner funding through roll tickets; premium random pulls remain
-- fail-closed pending the legally gated issue #154 path.

-- Adding the NOT NULL/default column directly backfills every immutable
-- pre-0015 banner as standard. roll_type remains NULL on those rows, preserving
-- their promotional-Stars behavior.
alter table public.pull_banner_versions
  add column banner_class text not null default 'standard',
  add column roll_type text null;

alter table public.pull_banner_versions
  add constraint pull_banner_versions_banner_class
    check (banner_class in ('standard', 'premium')),
  add constraint pull_banner_versions_roll_type
    check (roll_type in ('standard_roll', 'premium_roll')),
  add constraint pull_banner_versions_class_roll_type_pairing
    check (
      (banner_class = 'standard' and
        (roll_type is null or roll_type = 'standard_roll')) or
      (banner_class = 'premium' and
        roll_type is not null and roll_type = 'premium_roll')
    );

-- Keep the full 0011 preparation contract intact and add only the funding
-- branch plus premium guard. The legacy roll_type IS NULL block below is the
-- original promotional-Stars availability logic.
create or replace function private.prepare_pull_for_user(
  p_user_id uuid,
  p_banner_version_id text,
  p_pull_count smallint,
  p_idempotency_key text,
  p_test_prepared_at timestamptz,
  p_inject_failure boolean default false
)
returns public.pull_sessions
language plpgsql
volatile
set search_path = ''
as $$
declare
  target_account public.wallet_accounts%rowtype;
  banner public.pull_banner_versions%rowtype;
  offer public.pull_banner_offers%rowtype;
  hold_policy public.pull_hold_policy_versions%rowtype;
  guarantee public.pull_guarantee_states%rowtype;
  existing_session public.pull_sessions%rowtype;
  inserted_session public.pull_sessions%rowtype;
  target_session_id uuid := gen_random_uuid();
  pull_seed bytea := extensions.gen_random_bytes(32);
  target_cost bigint;
  current_balance bigint := 0;
  active_holds bigint := 0;
  total_before bigint := 0;
  rare_before bigint := 0;
  epic_before bigint := 0;
  selected_before bigint := 0;
  rare_cursor bigint := 0;
  epic_cursor bigint := 0;
  selected_cursor bigint := 0;
  position integer;
  selected_item record;
  target_tier record;
  target_item record;
  selected_due boolean;
  epic_due boolean;
  rare_due boolean;
  minimum_rank smallint;
  resolution_reason text;
  tier_draw integer;
  item_draw integer;
  eligible_weight integer;
  item_count integer;
  result_nonce bytea;
  result_commitment text;
  result_is_duplicate boolean;
  result_duplicate_dust bigint;
  result_selected_after bigint;
  result_commitments text[] := array[]::text[];
  sealed_results jsonb := '[]'::jsonb;
  projected_catalog_item_ids text[] := array[]::text[];
  target_root text;
  decision_at timestamptz;
  session_prepared_at timestamptz;
begin
  if p_user_id is null then
    raise exception 'Pull user is required' using errcode = '22023';
  end if;
  if p_pull_count is null or p_pull_count not between 1 and 100 then
    raise exception 'Pull count must be between one and one hundred' using errcode = '22023';
  end if;
  if p_idempotency_key is null or
     char_length(p_idempotency_key) not between 8 and 160 or
     p_idempotency_key !~ '^[A-Za-z0-9][A-Za-z0-9._:-]+$' then
    raise exception 'Invalid pull idempotency key' using errcode = '22023';
  end if;

  select * into strict banner
  from public.pull_banner_versions
  where id = p_banner_version_id;

  -- Premium random pulls remain legally gated by issue #154. This guard is
  -- deliberately inside the trusted preparation engine so hand-inserted rows
  -- cannot make that path reachable.
  if banner.banner_class = 'premium' then
    raise exception 'Premium banner preparation is disabled pending issue #154'
      using errcode = '55000';
  end if;

  select * into strict hold_policy
  from public.pull_hold_policy_versions
  where id = banner.hold_policy_id;

  -- Account is the first mutable lock across credits, claims, debits, and pulls.
  target_account := private.lock_wallet_account(p_user_id);

  select * into existing_session
  from public.pull_sessions
  where account_id = target_account.id
    and idempotency_key = p_idempotency_key;

  if found then
    if existing_session.user_id <> p_user_id or
       existing_session.banner_version_id <> p_banner_version_id or
       existing_session.pull_count <> p_pull_count then
      raise exception 'Pull idempotency key % was already used with a different request',
        p_idempotency_key
        using errcode = '22023';
    end if;
    return existing_session;
  end if;

  -- This function is intentionally VOLATILE. Under READ COMMITTED, each SQL
  -- command after the account lock observes commits from the prior lock holder.
  -- clock_timestamp(), unlike statement_timestamp(), cannot predate that wait.
  decision_at := clock_timestamp();
  session_prepared_at := coalesce(p_test_prepared_at, decision_at);
  if p_test_prepared_at is not null and
     p_test_prepared_at + make_interval(secs => hold_policy.hold_ttl_seconds) >= decision_at then
    raise exception 'Private preparation-time override must already be expired'
      using errcode = '22023';
  end if;

  select * into offer
  from public.pull_banner_offers
  where banner_version_id = banner.id
    and pull_count = p_pull_count;
  if not found then
    raise exception 'Pull count % is not offered by banner version %',
      p_pull_count, banner.id
      using errcode = '22023';
  end if;
  target_cost := offer.cost;

  if exists (
    select 1
    from public.pull_sessions
    where account_id = target_account.id
      and banner_family_id = banner.banner_family_id
      and prepared_at <= decision_at
      and expires_at > decision_at
  ) then
    raise exception 'An unexpired prepared pull already exists for banner family %',
      banner.banner_family_id
      using errcode = '55000';
  end if;

  -- A pull may not charge for a fixed starter item the caller was already owed.
  -- Exact replays returned above do not rerun this entitlement writer while a
  -- hold is active. New preparations establish the fixed bundle before taking
  -- their ownership snapshot.
  perform public.ensure_starter_entitlements();

  if banner.roll_type is null then
    select balances.current_balance into current_balance
    from public.wallet_balances as balances
    where balances.account_id = target_account.id
      and balances.currency_id = banner.currency_id
      and balances.balance_bucket = banner.balance_bucket;
    current_balance := coalesce(current_balance, 0);

    select coalesce(sum(sessions.held_amount), 0) into active_holds
    from public.pull_sessions as sessions
    join public.pull_banner_versions as held_banners
      on held_banners.id = sessions.banner_version_id
     and held_banners.roll_type is null
    where sessions.account_id = target_account.id
      and sessions.currency_id = banner.currency_id
      and sessions.balance_bucket = banner.balance_bucket
      and sessions.prepared_at <= decision_at
      and sessions.expires_at > decision_at;

    if current_balance - active_holds < target_cost then
      raise exception 'Insufficient available promotional Stars after active holds'
        using errcode = '22003';
    end if;
  else
    if target_cost <> p_pull_count::bigint then
      raise exception 'Ticket-funded offer cost must equal its pull count'
        using errcode = '55000';
    end if;

    select balances.current_quantity into current_balance
    from public.roll_ticket_balances as balances
    where balances.user_id = p_user_id
      and balances.roll_type = banner.roll_type;
    current_balance := coalesce(current_balance, 0);

    select coalesce(sum(sessions.held_amount), 0) into active_holds
    from public.pull_sessions as sessions
    join public.pull_banner_versions as held_banners
      on held_banners.id = sessions.banner_version_id
     and held_banners.roll_type = banner.roll_type
    where sessions.user_id = p_user_id
      and sessions.prepared_at <= decision_at
      and sessions.expires_at > decision_at;

    if current_balance - active_holds < p_pull_count then
      raise exception 'Insufficient available % roll tickets after active holds',
        banner.roll_type
        using errcode = '22003';
    end if;

    -- Preparation reserves tickets only. The future commit/reveal boundary
    -- must debit them there without double-counting this active hold.
  end if;

  select * into guarantee
  from public.pull_guarantee_states
  where account_id = target_account.id
    and banner_family_id = banner.banner_family_id;
  if found then
    total_before := guarantee.total_pulls;
    rare_before := guarantee.rare_misses;
    epic_before := guarantee.epic_misses;
    selected_before := guarantee.selected_misses;
  end if;
  rare_cursor := rare_before;
  epic_cursor := epic_before;
  selected_cursor := selected_before;

  for position in 1..p_pull_count loop
    select
      items.catalog_item_id,
      items.tier_id,
      items.tier_rank,
      items.selected_featured
    into selected_item
    from public.pull_banner_items as items
    where items.banner_version_id = banner.id
      and items.selected_featured
      and not exists (
        select 1
        from public.user_entitlements as entitlements
        where entitlements.user_id = p_user_id
          and entitlements.catalog_item_id = items.catalog_item_id
      )
      and not (items.catalog_item_id = any(projected_catalog_item_ids))
    order by items.catalog_item_id
    limit 1;

    selected_due := selected_item.catalog_item_id is not null and
      selected_cursor + 1 >= banner.selected_hard_guarantee_pull;
    epic_due := epic_cursor + 1 >= banner.epic_hard_guarantee_pull;
    rare_due := rare_cursor + 1 >= banner.rare_hard_guarantee_pull;

    if selected_due then
      target_item := selected_item;
      resolution_reason := 'selected-guarantee';
    else
      if epic_due then
        minimum_rank := banner.epic_minimum_rank;
        resolution_reason := 'epic-guarantee';
      elsif rare_due then
        minimum_rank := banner.rare_minimum_rank;
        resolution_reason := 'rare-guarantee';
      else
        minimum_rank := 0;
        resolution_reason := 'base';
      end if;

      select sum(tiers.weight_units)::integer into eligible_weight
      from public.pull_banner_tiers as tiers
      where tiers.banner_version_id = banner.id
        and tiers.tier_rank >= minimum_rank;
      tier_draw := private.pull_seeded_uint32_below(
        pull_seed,
        target_session_id,
        position::smallint,
        'tier',
        eligible_weight
      );

      select tiers.tier_id, tiers.tier_rank, tiers.weight_units into target_tier
      from public.pull_banner_tiers as tiers
      where tiers.banner_version_id = banner.id
        and tiers.tier_rank >= minimum_rank
        and tier_draw < (
          select sum(previous.weight_units)
          from public.pull_banner_tiers as previous
          where previous.banner_version_id = banner.id
            and previous.tier_rank >= minimum_rank
            and previous.tier_rank <= tiers.tier_rank
        )
      order by tiers.tier_rank
      limit 1;

      select count(*)::integer into item_count
      from public.pull_banner_items as items
      where items.banner_version_id = banner.id
        and items.tier_id = target_tier.tier_id;
      item_draw := private.pull_seeded_uint32_below(
        pull_seed,
        target_session_id,
        position::smallint,
        'item',
        item_count
      );

      select
        items.catalog_item_id,
        items.tier_id,
        items.tier_rank,
        items.selected_featured
      into target_item
      from public.pull_banner_items as items
      where items.banner_version_id = banner.id
        and items.tier_id = target_tier.tier_id
      order by items.canonical_order
      offset item_draw
      limit 1;
    end if;

    result_is_duplicate := target_item.catalog_item_id = any(projected_catalog_item_ids) or exists (
      select 1
      from public.user_entitlements as entitlements
      where entitlements.user_id = p_user_id
        and entitlements.catalog_item_id = target_item.catalog_item_id
    );
    select case when result_is_duplicate then tiers.duplicate_dust else 0 end
      into strict result_duplicate_dust
    from public.pull_banner_tiers as tiers
    where tiers.banner_version_id = banner.id
      and tiers.tier_id = target_item.tier_id;
    result_selected_after := private.pull_selected_misses_after(
      selected_cursor,
      target_item.selected_featured,
      result_is_duplicate
    );

    result_nonce := private.pull_result_nonce(
      pull_seed,
      target_session_id,
      position::smallint
    );
    result_commitment := private.pull_result_commitment(
      target_session_id,
      position::smallint,
      target_item.catalog_item_id,
      target_item.tier_id,
      target_item.tier_rank,
      selected_item.catalog_item_id,
      resolution_reason,
      rare_cursor,
      case when target_item.tier_rank >= banner.rare_minimum_rank then 0 else rare_cursor + 1 end,
      epic_cursor,
      case when target_item.tier_rank >= banner.epic_minimum_rank then 0 else epic_cursor + 1 end,
      selected_cursor,
      result_selected_after,
      result_is_duplicate,
      result_duplicate_dust,
      result_nonce
    );

    sealed_results := sealed_results || jsonb_build_array(jsonb_build_object(
      'position', position,
      'catalog_item_id', target_item.catalog_item_id,
      'tier_id', target_item.tier_id,
      'tier_rank', target_item.tier_rank,
      'selected_target_catalog_item_id', selected_item.catalog_item_id,
      'reason', resolution_reason,
      'rare_before', rare_cursor,
      'rare_after', case when target_item.tier_rank >= banner.rare_minimum_rank then 0 else rare_cursor + 1 end,
      'epic_before', epic_cursor,
      'epic_after', case when target_item.tier_rank >= banner.epic_minimum_rank then 0 else epic_cursor + 1 end,
      'selected_before', selected_cursor,
      'selected_after', result_selected_after,
      'is_duplicate', result_is_duplicate,
      'duplicate_dust_amount', result_duplicate_dust,
      'nonce_hex', encode(result_nonce, 'hex'),
      'commitment', result_commitment
    ));
    result_commitments := array_append(result_commitments, result_commitment);
    projected_catalog_item_ids := array_append(
      projected_catalog_item_ids,
      target_item.catalog_item_id
    );

    rare_cursor := case
      when target_item.tier_rank >= banner.rare_minimum_rank then 0
      else rare_cursor + 1
    end;
    epic_cursor := case
      when target_item.tier_rank >= banner.epic_minimum_rank then 0
      else epic_cursor + 1
    end;
    selected_cursor := result_selected_after;
  end loop;

  target_root := private.pull_commitment_root(target_session_id, result_commitments);

  insert into public.pull_sessions (
    id,
    account_id,
    user_id,
    banner_version_id,
    banner_family_id,
    hold_policy_id,
    hold_ttl_seconds,
    pull_count,
    currency_id,
    balance_bucket,
    held_amount,
    idempotency_key,
    prepared_at,
    expires_at,
    total_pulls_before,
    total_pulls_projected,
    rare_misses_before,
    rare_misses_projected,
    epic_misses_before,
    epic_misses_projected,
    selected_misses_before,
    selected_misses_projected,
    commitment_scheme,
    commitment_root,
    rng_scheme,
    rng_seed
  ) values (
    target_session_id,
    target_account.id,
    p_user_id,
    banner.id,
    banner.banner_family_id,
    hold_policy.id,
    hold_policy.hold_ttl_seconds,
    p_pull_count,
    banner.currency_id,
    banner.balance_bucket,
    target_cost,
    p_idempotency_key,
    session_prepared_at,
    session_prepared_at + make_interval(secs => hold_policy.hold_ttl_seconds),
    total_before,
    total_before + p_pull_count,
    rare_before,
    rare_cursor,
    epic_before,
    epic_cursor,
    selected_before,
    selected_cursor,
    'sha256-result-v1+sha256-root-v1',
    target_root,
    'hmac-sha256-seed-v1',
    pull_seed
  )
  returning * into inserted_session;

  if p_inject_failure then
    raise exception 'Injected pull preparation failure after session insert'
      using errcode = 'P0001';
  end if;

  insert into public.sealed_pull_results (
    session_id,
    account_id,
    user_id,
    banner_version_id,
    result_position,
    catalog_item_id,
    tier_id,
    tier_rank,
    selected_target_catalog_item_id,
    resolution_reason,
    rare_misses_before,
    rare_misses_after,
    epic_misses_before,
    epic_misses_after,
    selected_misses_before,
    selected_misses_after,
    is_duplicate,
    duplicate_dust_amount,
    nonce,
    commitment_sha256,
    sealed_at
  )
  select
    target_session_id,
    target_account.id,
    p_user_id,
    banner.id,
    result.position::smallint,
    result.catalog_item_id,
    result.tier_id,
    result.tier_rank::smallint,
    result.selected_target_catalog_item_id,
    result.reason,
    result.rare_before,
    result.rare_after,
    result.epic_before,
    result.epic_after,
    result.selected_before,
    result.selected_after,
    result.is_duplicate,
    result.duplicate_dust_amount,
    decode(result.nonce_hex, 'hex'),
    result.commitment,
    session_prepared_at
  from jsonb_to_recordset(sealed_results) as result(
    position integer,
    catalog_item_id text,
    tier_id text,
    tier_rank integer,
    selected_target_catalog_item_id text,
    reason text,
    rare_before bigint,
    rare_after bigint,
    epic_before bigint,
    epic_after bigint,
    selected_before bigint,
    selected_after bigint,
    is_duplicate boolean,
    duplicate_dust_amount bigint,
    nonce_hex text,
    commitment text
  );

  if (select count(*) from public.sealed_pull_results where session_id = target_session_id)
     <> p_pull_count then
    raise exception 'Prepared pull did not seal exactly % results', p_pull_count
      using errcode = '55000';
  end if;

  return inserted_session;
end;
$$;

revoke all on function private.prepare_pull_for_user(
  uuid, text, smallint, text, timestamptz, boolean
) from public, anon, authenticated, service_role;

-- Ticket ledger writes take the same account lock as preparation. This trigger
-- is the final table-level backstop preventing a later debit from consuming
-- quantities reserved by active same-type ticket sessions.
create or replace function private.preserve_active_roll_ticket_holds_on_balance_change()
returns trigger
language plpgsql
volatile
set search_path = ''
as $$
declare
  active_holds bigint;
  decision_at timestamptz := clock_timestamp();
begin
  select coalesce(sum(sessions.held_amount), 0) into active_holds
  from public.pull_sessions as sessions
  join public.pull_banner_versions as banners
    on banners.id = sessions.banner_version_id
   and banners.roll_type = new.roll_type
  where sessions.user_id = new.user_id
    and sessions.prepared_at <= decision_at
    and sessions.expires_at > decision_at;

  if new.current_quantity < active_holds then
    raise exception 'Roll-ticket balance cannot fall below active pull holds'
      using errcode = '22003';
  end if;
  return new;
end;
$$;

create trigger roll_ticket_balances_preserve_active_pull_holds
  before update of current_quantity on public.roll_ticket_balances
  for each row execute function private.preserve_active_roll_ticket_holds_on_balance_change();

revoke all on function private.preserve_active_roll_ticket_holds_on_balance_change()
  from public, anon, authenticated, service_role;

-- Ticket-backed sessions reserve tickets independently. Preserve the exact
-- Stars guards for legacy NULL-funded sessions without cross-reserving the two
-- funding pools.

create or replace function private.preserve_active_pull_holds_on_balance_change()
returns trigger
language plpgsql
volatile
set search_path = ''
as $$
declare
  active_holds bigint;
  decision_at timestamptz := clock_timestamp();
begin
  select coalesce(sum(sessions.held_amount), 0) into active_holds
  from public.pull_sessions as sessions
  join public.pull_banner_versions as banners
    on banners.id = sessions.banner_version_id
   and banners.roll_type is null
  where sessions.account_id = new.account_id
    and sessions.currency_id = new.currency_id
    and sessions.balance_bucket = new.balance_bucket
    and sessions.prepared_at <= decision_at
    and sessions.expires_at > decision_at;

  if new.current_balance < active_holds then
    raise exception 'Wallet balance cannot fall below active pull holds'
      using errcode = '22003';
  end if;
  return new;
end;
$$;

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
  if not (
    (p_currency_id = 'stars' and p_balance_bucket = 'promotional') or
    (p_currency_id = 'dust' and p_balance_bucket = 'earned')
  ) then
    raise exception 'Unsupported earned-only currency/bucket pair %/%',
      p_currency_id, p_balance_bucket
      using errcode = '22023';
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
      and sessions.expires_at > decision_at;
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

comment on function public.prepare_pull(text, smallint, text) is
  'Authenticated non-anonymous account-idempotent pull preparation. Standard banners use their bound roll tickets when configured; legacy NULL-funded banners retain promotional-Star holds. Premium random pulls remain disabled pending issue #154.';
