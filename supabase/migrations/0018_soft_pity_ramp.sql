-- Migration: 0018_soft_pity_ramp
-- Dormant engine support for a linear selected-featured soft-pity upgrade.
-- Existing banners retain NULL configuration and canonical 0017 behavior.

alter table public.pull_banner_versions
  add column soft_pity_model text null,
  add column soft_pity_start_pull integer null,
  add column soft_pity_per_pull_increment numeric null;

alter table public.pull_banner_versions
  add constraint pull_banner_versions_soft_pity_model
    check (
      soft_pity_model is null or
      soft_pity_model = 'linear-rate-ramp'
    ),
  add constraint pull_banner_versions_soft_pity_all_or_none
    check (
      (
        soft_pity_model is null and
        soft_pity_start_pull is null and
        soft_pity_per_pull_increment is null
      ) or (
        soft_pity_model = 'linear-rate-ramp' and
        soft_pity_start_pull is not null and
        soft_pity_start_pull > 1 and
        soft_pity_per_pull_increment is not null and
        soft_pity_per_pull_increment > 0 and
        soft_pity_per_pull_increment not in (
          'NaN'::numeric,
          'Infinity'::numeric,
          '-Infinity'::numeric
        )
      )
    ),
  add constraint pull_banner_versions_soft_pity_before_hard_guarantee
    check (
      soft_pity_model is null or (
        selected_hard_guarantee_pull is not null and
        soft_pity_start_pull < selected_hard_guarantee_pull
      )
    );

-- The inherited inline CHECK received PostgreSQL's deterministic default name.
-- Preserve every prior reason and admit the new dormant-engine outcome.
alter table public.sealed_pull_results
  drop constraint sealed_pull_results_resolution_reason_check,
  add constraint sealed_pull_results_resolution_reason_check
    check (
      resolution_reason in (
        'base',
        'rare-guarantee',
        'epic-guarantee',
        'selected-guarantee',
        'soft-pity'
      )
    );

-- Extend only the draw-label allowlist. Tier/item inputs and the rejection-
-- sampled uint32 mapping remain byte-identical to 0011.
create or replace function private.pull_seeded_uint32_below(
  p_seed bytea,
  p_session_id uuid,
  p_result_position smallint,
  p_draw_kind text,
  p_upper_bound integer
)
returns integer
language plpgsql
immutable
strict
set search_path = ''
as $$
declare
  random_bytes bytea;
  random_value bigint;
  acceptance_limit bigint;
  attempt integer := 0;
begin
  if octet_length(p_seed) <> 32 then
    raise exception 'Pull RNG seed must contain 32 bytes' using errcode = '22023';
  end if;
  if p_draw_kind not in ('tier', 'item', 'soft-pity-upgrade') then
    raise exception 'Unsupported pull RNG draw kind' using errcode = '22023';
  end if;
  if p_upper_bound <= 0 then
    raise exception 'Random upper bound must be positive' using errcode = '22023';
  end if;

  acceptance_limit := (4294967296::bigint / p_upper_bound::bigint) * p_upper_bound::bigint;
  loop
    random_bytes := extensions.hmac(
      convert_to(
        'dicesuki.pull.rng.v1' || E'\n' ||
        'session=' || p_session_id::text || E'\n' ||
        'position=' || p_result_position::text || E'\n' ||
        'draw=' || p_draw_kind || E'\n' ||
        'attempt=' || attempt::text,
        'UTF8'
      ),
      p_seed,
      'sha256'
    );
    random_value :=
      get_byte(random_bytes, 0)::bigint * 16777216::bigint +
      get_byte(random_bytes, 1)::bigint * 65536::bigint +
      get_byte(random_bytes, 2)::bigint * 256::bigint +
      get_byte(random_bytes, 3)::bigint;
    if random_value < acceptance_limit then
      return (random_value % p_upper_bound::bigint)::integer;
    end if;
    attempt := attempt + 1;
  end loop;
end;
$$;

revoke all on function private.pull_seeded_uint32_below(
  bytea, uuid, smallint, text, integer
) from public, anon, authenticated, service_role;

-- Copy of the canonical 0017 preparation body. Only soft-pity declarations
-- and the draw section differ.
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
  soft_pity_upgraded boolean;
  soft_pity_base_rate numeric;
  soft_pity_target_rate numeric;
  soft_pity_excess_rate numeric;
  soft_pity_upgrade_draw integer;
  soft_pity_upgrade_threshold integer;
  soft_pity_draw_scale integer := 1000000000;
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
      and not exists (
        select 1
        from public.pull_session_transitions as transitions
        where transitions.session_id = pull_sessions.id
      )
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
      and sessions.expires_at > decision_at
      and not exists (
        select 1
        from public.pull_session_transitions as transitions
        where transitions.session_id = sessions.id
      );

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
      and sessions.expires_at > decision_at
      and not exists (
        select 1
        from public.pull_session_transitions as transitions
        where transitions.session_id = sessions.id
      );

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
      soft_pity_upgraded := false;

      -- A configured ramp upgrades to the selected unowned signature before
      -- the canonical minimum-rank tier/item draw. selected_due was computed
      -- above and still takes precedence over this branch.
      if not selected_due and
         banner.soft_pity_model = 'linear-rate-ramp' and
         selected_item.catalog_item_id is not null and
         not exists (
           select 1
           from public.user_entitlements as entitlements
           where entitlements.user_id = p_user_id
             and entitlements.catalog_item_id = selected_item.catalog_item_id
         ) and
         not (selected_item.catalog_item_id = any(projected_catalog_item_ids)) and
         selected_cursor + 1 >= banner.soft_pity_start_pull then
        -- The fixed base is the selected signature tier's full-banner weight,
        -- normalized by all banner tiers even when an epic/rare minimum-rank
        -- guarantee is also due.
        select tiers.weight_units::numeric / (
            select sum(all_tiers.weight_units)::numeric
            from public.pull_banner_tiers as all_tiers
            where all_tiers.banner_version_id = banner.id
          )
          into strict soft_pity_base_rate
        from public.pull_banner_tiers as tiers
        where tiers.banner_version_id = banner.id
          and tiers.tier_id = selected_item.tier_id;

        if soft_pity_base_rate < 1 then
          soft_pity_target_rate := least(
            1::numeric,
            soft_pity_base_rate +
              banner.soft_pity_per_pull_increment *
              (selected_cursor + 1 - banner.soft_pity_start_pull + 1)::numeric
          );
          soft_pity_excess_rate :=
            (soft_pity_target_rate - soft_pity_base_rate) /
            (1::numeric - soft_pity_base_rate);

          -- Match the design simulator's billion-point integer draw. floor()
          -- deliberately rounds the favorable threshold down.
          soft_pity_upgrade_threshold := floor(
            soft_pity_excess_rate * soft_pity_draw_scale::numeric
          )::integer;
          soft_pity_upgrade_draw := private.pull_seeded_uint32_below(
            pull_seed,
            target_session_id,
            position::smallint,
            'soft-pity-upgrade',
            soft_pity_draw_scale
          );

          if soft_pity_upgrade_draw < soft_pity_upgrade_threshold then
            target_item := selected_item;
            if epic_due then
              resolution_reason := 'epic-guarantee';
            elsif rare_due then
              resolution_reason := 'rare-guarantee';
            else
              resolution_reason := 'soft-pity';
            end if;
            soft_pity_upgraded := true;
          end if;
        end if;
      end if;

      -- Keep this canonical 0017 block byte-identical. A NULL ramp or failed
      -- upgrade reaches the same labeled tier/item draws in the same order.
      if not soft_pity_upgraded then
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
