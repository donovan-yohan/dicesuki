-- Migration: 0034_economy_access_flag
-- Monetization economy spec — per-user economy access gate and passport anchor.
--
-- The flag lives in its own table rather than on public.profiles. 0005_security
-- _hardening.sql line 30 grants table-wide `update` on public.profiles to the
-- `authenticated` role, and public.profiles is only `enable row level security`,
-- never `force row level security`. Any column added there would therefore be
-- self-writable by the player: they could flag themselves on and mint New
-- Collector Passport catch-up claims out of nothing. public.user_economy_access
-- instead forces RLS, grants no write privilege to any API role, and exposes a
-- single service-role SECURITY DEFINER RPC as the only write path.
--
-- The New Collector Passport is re-anchored from "the UTC-Monday period of the
-- first passport claim" (0010) to "the UTC-Monday period of
-- economy_access_granted_at". Existing public.earned_reward_passport_enrollments
-- rows are NOT backfilled or rewritten: they are append-only behind the
-- reject-update/delete triggers installed at 0010 lines 262-267, and rewriting
-- an anchor would either confiscate already-earned catch-up or gift claims that
-- were never earned. Existing enrollments keep their original anchor; the new
-- anchor applies only to enrollments created from now on.
--
-- Deliberate non-changes:
--   * public.get_earned_reward_status() is untouched. It derives passport and
--     Community state entirely from enrollment.enrolled_period_start, so it
--     follows the new anchor for free once an enrollment row exists, and its
--     pre-enrollment 'not_enrolled' projection is unchanged from 0010.
--   * The Community Die faucet is untouched. It shares the same
--     enrolled_period_start anchor and so inherits this change for free. It has
--     no expiry cliff to mis-fire on: its availability is an unbounded
--     floor(weeks_since_anchor / 4) with no least() clamp and no claim_index
--     CHECK, unlike the 12-claim passport.
--   * No existing economy RPC gains an economy-access check. Enforcement in this
--     slice is UI-only; earned faucets keep accruing silently for un-flagged
--     users so that flagging a user on later hands them their full history.

-- ---------------------------------------------------------------------------
-- Per-user monetization access gate.
-- ---------------------------------------------------------------------------
create table public.user_economy_access (
  user_id                     uuid        primary key
    references auth.users (id) on delete cascade,
  economy_access              boolean     not null default false,
  economy_access_granted_at   timestamptz,
  updated_at                  timestamptz not null default now(),
  last_changed_by             text,
  last_change_note            text,

  constraint user_economy_access_granted_at_required
    check (economy_access = false or economy_access_granted_at is not null),
  constraint user_economy_access_last_changed_by
    check (
      last_changed_by is null or
      char_length(last_changed_by) between 1 and 64
    ),
  constraint user_economy_access_last_change_note
    check (
      last_change_note is null or
      char_length(last_change_note) between 1 and 512
    )
);

comment on table public.user_economy_access is
  'Per-user monetization access gate. Deliberately not a profiles column: that table grants table-wide update to authenticated and does not force RLS, so a player could self-grant. Writes here go only through public.set_user_economy_access.';
comment on column public.user_economy_access.user_id is
  'Owning auth.users id. One row per user; the row is absent until an operator first makes a decision.';
comment on column public.user_economy_access.economy_access is
  'Current gate state. False (or an absent row) means the monetization surfaces stay hidden; earned faucets keep accruing regardless.';
comment on column public.user_economy_access.economy_access_granted_at is
  'Null until access is first enabled, then set once and never cleared or moved -- not on disable, not on a later re-enable. This is the New Collector Passport anchor, so moving it would re-gift or confiscate catch-up claims.';
comment on column public.user_economy_access.updated_at is
  'Statement timestamp of the most recent operator decision, including no-op-shaped repeats of the current state.';
comment on column public.user_economy_access.last_changed_by is
  'Trimmed operator name supplied by the admin CLI for the most recent decision.';
comment on column public.user_economy_access.last_change_note is
  'Trimmed operator audit note supplied by the admin CLI for the most recent decision.';

alter table public.user_economy_access enable row level security;
alter table public.user_economy_access force row level security;

create policy "users read their own economy access"
  on public.user_economy_access
  for select
  to authenticated
  using ((select auth.uid()) = user_id);

revoke all on table public.user_economy_access
  from public, anon, authenticated, service_role;
grant select on table public.user_economy_access to authenticated;
grant select on table public.user_economy_access to service_role;

-- ---------------------------------------------------------------------------
-- Service-only operator write boundary. Players never reach this function; the
-- table carries no insert/update/delete grant for any API role.
-- ---------------------------------------------------------------------------
create or replace function public.set_user_economy_access(
  p_user_id uuid,
  p_enabled boolean,
  p_operator text,
  p_note text
)
returns public.user_economy_access
language plpgsql
security definer
set search_path = ''
as $$
declare
  normalized_operator text := btrim(coalesce(p_operator, ''));
  normalized_note text := btrim(coalesce(p_note, ''));
  decided_row public.user_economy_access%rowtype;
begin
  if p_user_id is null then
    raise exception 'A target user id is required' using errcode = '22023';
  end if;
  if p_enabled is null then
    raise exception 'An explicit economy access decision is required'
      using errcode = '22023';
  end if;
  if char_length(normalized_operator) not between 1 and 64 then
    raise exception 'Operator name must be 1-64 characters' using errcode = '22023';
  end if;
  if char_length(normalized_note) not between 1 and 512 then
    raise exception 'Operator note must be 1-512 characters' using errcode = '22023';
  end if;
  if not exists (select 1 from auth.users as users where users.id = p_user_id) then
    raise exception 'Unknown user for economy access' using errcode = '23503';
  end if;

  -- The coalesce is the set-once rule: an already-stamped grant time survives
  -- every later enable, and a disable never touches it at all.
  insert into public.user_economy_access as access (
    user_id,
    economy_access,
    economy_access_granted_at,
    updated_at,
    last_changed_by,
    last_change_note
  ) values (
    p_user_id,
    p_enabled,
    case when p_enabled then statement_timestamp() else null end,
    statement_timestamp(),
    normalized_operator,
    normalized_note
  )
  on conflict (user_id) do update
  set economy_access = excluded.economy_access,
      economy_access_granted_at = case
        when excluded.economy_access
          then coalesce(access.economy_access_granted_at, statement_timestamp())
        else access.economy_access_granted_at
      end,
      updated_at = statement_timestamp(),
      last_changed_by = excluded.last_changed_by,
      last_change_note = excluded.last_change_note
  returning * into decided_row;

  return decided_row;
end;
$$;

comment on function public.set_user_economy_access(uuid, boolean, text, text) is
  'Service-role-only operator gate write. Enabling stamps economy_access_granted_at exactly once; disabling and re-enabling never move it. Repeating the current decision is a safe no-op-shaped write that returns the current row.';

revoke all on function public.set_user_economy_access(uuid, boolean, text, text)
  from public, anon, authenticated, service_role;
grant execute on function public.set_user_economy_access(uuid, boolean, text, text)
  to service_role;

-- ---------------------------------------------------------------------------
-- Re-anchor the New Collector Passport to the access grant.
--
-- 0010 anchored the 12-week window lazily at the first passport claim, not at
-- account creation: private.issue_earned_reward_claim inserted the enrollment
-- with enrolled_period_start = private.utc_monday_period_start(p_effective_at).
-- The anchor now comes from economy_access_granted_at instead, so the window a
-- flagged player sees starts the week they were let into the economy.
-- ---------------------------------------------------------------------------
create or replace function private.passport_enrollment_anchor_period(
  p_user_id uuid,
  p_fallback_period date
)
returns date
language sql
stable
parallel safe
set search_path = ''
as $$
  -- least() is a fail-safe clamp, not a preference. A future-dated or
  -- clock-skewed economy_access_granted_at must never produce an anchor after
  -- the claim time, because private.issue_earned_reward_claim raises
  -- 'Claim time precedes passport enrollment' in exactly that case and the
  -- player would be permanently unable to claim.
  select least(
    p_fallback_period,
    coalesce(
      (
        select private.utc_monday_period_start(access.economy_access_granted_at)
        from public.user_economy_access as access
        where access.user_id = p_user_id
      ),
      p_fallback_period
    )
  );
$$;

comment on function private.passport_enrollment_anchor_period(uuid, date) is
  'UTC-Monday passport anchor for a user: the grant week when economy_access_granted_at exists, clamped to never exceed the claim period, and the claim period itself for users with no gate row.';

revoke all on function private.passport_enrollment_anchor_period(uuid, date)
  from public, anon, authenticated, service_role;

-- The body below is 0010_earned_reward_claims.sql lines 594-819 verbatim, with
-- exactly two changes: the anchor_period declaration, and the enrollment insert
-- taking that anchor instead of target_period_start.
create or replace function private.issue_earned_reward_claim(
  p_user_id uuid,
  p_claim_kind text,
  p_idempotency_key text,
  p_effective_at timestamptz
)
returns public.earned_reward_claim_outcomes
language plpgsql
set search_path = ''
as $$
declare
  target_account public.wallet_accounts%rowtype;
  program public.earned_reward_program_versions%rowtype;
  enrollment public.earned_reward_passport_enrollments%rowtype;
  existing_claim public.earned_reward_claim_outcomes%rowtype;
  inserted_claim public.earned_reward_claim_outcomes%rowtype;
  ledger_entry public.wallet_ledger_entries%rowtype;
  target_period_start date;
  eligible_claim_count integer;
  existing_claim_count integer;
  next_claim_index integer;
  target_eligible_period date;
  target_catalog_item_id text;
  target_entitlement_id uuid;
  target_claim_id uuid := gen_random_uuid();
  target_dust bigint := 0;
  anchor_period date;
begin
  if p_claim_kind not in ('passport', 'community') then
    raise exception 'Unsupported earned reward claim kind %', p_claim_kind
      using errcode = '22023';
  end if;
  if p_idempotency_key is null or char_length(p_idempotency_key) not between 8 and 160 then
    raise exception 'Invalid earned reward idempotency key' using errcode = '22023';
  end if;
  if p_effective_at is null then
    raise exception 'Claim time is required' using errcode = '22023';
  end if;

  select * into strict program
  from public.earned_reward_program_versions
  where id = 'earned-collection@1/rewards@1';

  target_account := private.lock_wallet_account(p_user_id);

  select * into existing_claim
  from public.earned_reward_claim_outcomes
  where account_id = target_account.id
    and idempotency_key = p_idempotency_key;

  if found then
    if existing_claim.user_id <> p_user_id or
       existing_claim.program_id <> program.id or
       existing_claim.claim_kind <> p_claim_kind then
      raise exception 'Claim idempotency key % was already used for another reward',
        p_idempotency_key
        using errcode = '22023';
    end if;
    return existing_claim;
  end if;

  target_period_start := private.utc_monday_period_start(p_effective_at);
  select * into enrollment
  from public.earned_reward_passport_enrollments
  where account_id = target_account.id and program_id = program.id;

  if not found then
    if p_claim_kind = 'community' then
      raise exception 'Community Die requires New Collector Passport enrollment'
        using errcode = '55000';
    end if;
    anchor_period := private.passport_enrollment_anchor_period(
      p_user_id,
      target_period_start
    );
    insert into public.earned_reward_passport_enrollments (
      account_id,
      user_id,
      program_id,
      enrolled_period_start,
      enrolled_at
    ) values (
      target_account.id,
      p_user_id,
      program.id,
      anchor_period,
      p_effective_at
    )
    returning * into enrollment;
  end if;

  if target_period_start < enrollment.enrolled_period_start then
    raise exception 'Claim time precedes passport enrollment' using errcode = '22023';
  end if;

  select count(*) into existing_claim_count
  from public.earned_reward_claim_outcomes
  where account_id = target_account.id
    and program_id = program.id
    and claim_kind = p_claim_kind;

  if p_claim_kind = 'passport' then
    eligible_claim_count := least(
      program.passport_duration_weeks::integer,
      ((target_period_start - enrollment.enrolled_period_start) / program.period_days)::integer + 1
    );
    if existing_claim_count >= program.passport_duration_weeks then
      raise exception 'New Collector Passport is complete after twelve claims'
        using errcode = '55000';
    end if;
    if existing_claim_count >= eligible_claim_count then
      raise exception 'No New Collector Passport claim is currently available'
        using errcode = '55000';
    end if;
    next_claim_index := existing_claim_count + 1;
    target_eligible_period := enrollment.enrolled_period_start
      + ((next_claim_index - 1) * program.period_days);
    target_dust := program.passport_exhausted_dust;
  else
    eligible_claim_count := ((target_period_start - enrollment.enrolled_period_start)
      / (program.community_interval_weeks * program.period_days))::integer;
    if existing_claim_count >= eligible_claim_count then
      raise exception 'No Community Die claim is currently available'
        using errcode = '55000';
    end if;
    next_claim_index := existing_claim_count + 1;
    target_eligible_period := enrollment.enrolled_period_start
      + (next_claim_index * program.community_interval_weeks * program.period_days);
    target_dust := program.community_exhausted_dust;
  end if;

  -- A concurrent starter grant does not make a claim nondeterministic. If its
  -- uniqueness insert wins after candidate selection, retry the canonical
  -- query and award the next lowest never-granted item.
  loop
    select items.catalog_item_id into target_catalog_item_id
    from public.earned_reward_program_items as items
    where items.program_id = program.id
      and items.reward_kind = p_claim_kind
      and not exists (
        select 1
        from public.user_entitlements as entitlements
        where entitlements.user_id = p_user_id
          and entitlements.catalog_item_id = items.catalog_item_id
      )
    order by items.catalog_item_id
    limit 1;

    exit when target_catalog_item_id is null;
    target_entitlement_id := gen_random_uuid();
    insert into public.user_entitlements (
      id,
      user_id,
      catalog_item_id,
      grant_reason,
      grant_ref,
      provenance
    ) values (
      target_entitlement_id,
      p_user_id,
      target_catalog_item_id,
      'earned.' || p_claim_kind,
      'earned-claim:' || target_claim_id::text,
      jsonb_build_object(
        'programId', program.id,
        'claimKind', p_claim_kind,
        'claimIndex', next_claim_index
      )
    )
    on conflict (user_id, catalog_item_id) do nothing
    returning id into target_entitlement_id;

    exit when target_entitlement_id is not null;
    target_catalog_item_id := null;
  end loop;

  if target_catalog_item_id is null then
    ledger_entry := public.append_wallet_ledger_entry(
      p_user_id,
      'dust',
      'earned',
      target_dust,
      'earned.' || p_claim_kind || '.all-owned',
      'earned-claim:' || target_claim_id::text,
      program.economy_edition_id,
      jsonb_build_object(
        'claimId', target_claim_id,
        'programId', program.id,
        'claimKind', p_claim_kind,
        'claimIndex', next_claim_index,
        'outcome', 'all-owned-dust'
      )
    );
  end if;

  insert into public.earned_reward_claim_outcomes (
    id,
    program_id,
    account_id,
    user_id,
    claim_kind,
    claim_index,
    eligible_period_start,
    idempotency_key,
    outcome_kind,
    catalog_item_id,
    entitlement_id,
    wallet_ledger_entry_id,
    dust_amount,
    claimed_at
  ) values (
    target_claim_id,
    program.id,
    target_account.id,
    p_user_id,
    p_claim_kind,
    next_claim_index,
    target_eligible_period,
    p_idempotency_key,
    case when target_catalog_item_id is null then 'dust' else 'entitlement' end,
    target_catalog_item_id,
    case when target_catalog_item_id is null then null else target_entitlement_id end,
    case when target_catalog_item_id is null then ledger_entry.id else null end,
    case when target_catalog_item_id is null then target_dust else 0 end,
    p_effective_at
  )
  returning * into inserted_claim;

  return inserted_claim;
end;
$$;

revoke all on function private.issue_earned_reward_claim(uuid, text, text, timestamptz)
  from public, anon, authenticated, service_role;
