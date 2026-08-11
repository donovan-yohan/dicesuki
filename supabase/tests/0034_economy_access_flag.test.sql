begin;

insert into auth.users (id) values
  ('d0340000-0000-4034-8034-000000000001'),
  ('d0340000-0000-4034-8034-000000000002'),
  ('d0340000-0000-4034-8034-000000000003'),
  ('d0340000-0000-4034-8034-000000000004'),
  ('d0340000-0000-4034-8034-000000000005'),
  ('d0340000-0000-4034-8034-000000000006');

-- ---------------------------------------------------------------------------
-- Posture. The gate table forces RLS and hands no API role a write privilege;
-- the operator RPC is service-role-only and the anchor helper is callable by
-- no API role at all.
-- ---------------------------------------------------------------------------
do $$
begin
  if not (
       select relrowsecurity and relforcerowsecurity
       from pg_class
       where oid = 'public.user_economy_access'::regclass
     ) or
     has_table_privilege('anon', 'public.user_economy_access', 'SELECT') or
     not has_table_privilege('authenticated', 'public.user_economy_access', 'SELECT') or
     not has_table_privilege('service_role', 'public.user_economy_access', 'SELECT') or
     has_table_privilege('anon', 'public.user_economy_access', 'INSERT') or
     has_table_privilege('anon', 'public.user_economy_access', 'UPDATE') or
     has_table_privilege('anon', 'public.user_economy_access', 'DELETE') or
     has_table_privilege('authenticated', 'public.user_economy_access', 'INSERT') or
     has_table_privilege('authenticated', 'public.user_economy_access', 'UPDATE') or
     has_table_privilege('authenticated', 'public.user_economy_access', 'DELETE') or
     has_table_privilege('service_role', 'public.user_economy_access', 'INSERT') or
     has_table_privilege('service_role', 'public.user_economy_access', 'UPDATE') or
     has_table_privilege('service_role', 'public.user_economy_access', 'DELETE') or
     has_function_privilege(
       'anon', 'public.set_user_economy_access(uuid,boolean,text,text)', 'EXECUTE'
     ) or
     has_function_privilege(
       'authenticated', 'public.set_user_economy_access(uuid,boolean,text,text)', 'EXECUTE'
     ) or
     not has_function_privilege(
       'service_role', 'public.set_user_economy_access(uuid,boolean,text,text)', 'EXECUTE'
     ) or
     has_function_privilege(
       'anon', 'private.passport_enrollment_anchor_period(uuid,date)', 'EXECUTE'
     ) or
     has_function_privilege(
       'authenticated', 'private.passport_enrollment_anchor_period(uuid,date)', 'EXECUTE'
     ) or
     has_function_privilege(
       'service_role', 'private.passport_enrollment_anchor_period(uuid,date)', 'EXECUTE'
     ) then
    raise exception 'Economy access table does not force RLS with select-only API grants';
  end if;
end;
$$;

-- The nullable-column CHECK arms are explicitly guarded, so three-valued logic
-- cannot let an enabled row through without an anchor or accept an empty
-- operator name.
do $$
begin
  begin
    insert into public.user_economy_access (
      user_id, economy_access, economy_access_granted_at
    ) values (
      'd0340000-0000-4034-8034-000000000006', true, null
    );
    raise exception 'Economy access enabled without a grant anchor was accepted';
  exception when check_violation then
    null;
  end;

  begin
    insert into public.user_economy_access (
      user_id, economy_access, last_changed_by
    ) values (
      'd0340000-0000-4034-8034-000000000006', false, ''
    );
    raise exception 'Economy access accepted an empty operator name';
  exception when check_violation then
    null;
  end;

  begin
    insert into public.user_economy_access (
      user_id, economy_access, last_change_note
    ) values (
      'd0340000-0000-4034-8034-000000000006', false, repeat('n', 513)
    );
    raise exception 'Economy access accepted an oversized operator note';
  exception when check_violation then
    null;
  end;
end;
$$;

-- ---------------------------------------------------------------------------
-- Grant fixtures. These rows are written as the migration owner because no API
-- role may write the table; the operator RPC lifecycle is proved separately
-- below and cannot backdate or forward-date a grant.
-- ---------------------------------------------------------------------------
insert into public.user_economy_access (
  user_id,
  economy_access,
  economy_access_granted_at,
  last_changed_by,
  last_change_note
) values
  (
    'd0340000-0000-4034-8034-000000000001',
    true,
    (((private.utc_monday_period_start(statement_timestamp()) - 35) + time '12:00')
      at time zone 'UTC'),
    'slice34-operator',
    'granted five UTC weeks before the first claim'
  ),
  (
    'd0340000-0000-4034-8034-000000000003',
    true,
    (((private.utc_monday_period_start(statement_timestamp()) + 21) + time '12:00')
      at time zone 'UTC'),
    'slice34-operator',
    'future dated grant that must be clamped'
  ),
  (
    'd0340000-0000-4034-8034-000000000004',
    true,
    (((private.utc_monday_period_start(statement_timestamp())) + time '12:00')
      at time zone 'UTC'),
    'slice34-operator',
    'negative control subject'
  );

-- ---------------------------------------------------------------------------
-- A grant five UTC weeks in the past anchors the very first passport claim to
-- the grant week, so the player has six weeks of catch-up immediately.
-- ---------------------------------------------------------------------------
set local "request.jwt.claims" =
  '{"sub":"d0340000-0000-4034-8034-000000000001","is_anonymous":false}';
set local role authenticated;

do $$
declare
  first_claim public.earned_reward_claim_outcomes%rowtype;
  community_claim public.earned_reward_claim_outcomes%rowtype;
  enrollment public.earned_reward_passport_enrollments%rowtype;
  status jsonb;
  claim_period date := (date_trunc('week', statement_timestamp() at time zone 'UTC'))::date;
begin
  first_claim := public.claim_new_collector_passport('slice34:passport:backdated:0001');

  select * into strict enrollment
  from public.earned_reward_passport_enrollments
  where user_id = 'd0340000-0000-4034-8034-000000000001';

  status := public.get_earned_reward_status();

  if enrollment.enrolled_period_start is distinct from (claim_period - 35) or
     first_claim.claim_index is distinct from 1 or
     first_claim.eligible_period_start is distinct from (claim_period - 35) or
     (status #>> '{passport,state}') is distinct from 'active' or
     (status #>> '{passport,enrolledPeriodStart}')::date
       is distinct from (claim_period - 35) or
     (status #>> '{passport,availableClaimCount}')::integer is distinct from 6 or
     (status #>> '{passport,claimedCount}')::integer is distinct from 1 or
     (status #>> '{passport,catchUpClaimCount}')::integer is distinct from 5 then
    raise exception 'Granted access five weeks ago did not anchor the passport to the grant week';
  end if;

  -- Community Die shares enrolled_period_start, so it inherits the new anchor
  -- with no change of its own: five granted weeks already clear the four-week
  -- interval on the first passport claim week.
  if (status #>> '{community,state}') is distinct from 'claimable' or
     (status #>> '{community,availableClaimCount}')::integer is distinct from 1 or
     (status #>> '{community,catchUpClaimCount}')::integer is distinct from 1 then
    raise exception 'Community Die did not inherit the economy access anchor';
  end if;

  community_claim := public.claim_community_die('slice34:community:backdated:0001');

  if community_claim.claim_index is distinct from 1 or
     community_claim.eligible_period_start is distinct from (claim_period - 7) then
    raise exception 'Community Die did not inherit the economy access anchor';
  end if;
end;
$$;

reset role;

-- ---------------------------------------------------------------------------
-- A user with no gate row keeps the pre-0034 behaviour exactly: the anchor is
-- the claim period and there is no catch-up.
-- ---------------------------------------------------------------------------
set local "request.jwt.claims" =
  '{"sub":"d0340000-0000-4034-8034-000000000002","is_anonymous":false}';
set local role authenticated;

do $$
declare
  enrollment public.earned_reward_passport_enrollments%rowtype;
  status jsonb;
  claim_period date := (date_trunc('week', statement_timestamp() at time zone 'UTC'))::date;
begin
  perform public.claim_new_collector_passport('slice34:passport:ungated:0002');

  select * into strict enrollment
  from public.earned_reward_passport_enrollments
  where user_id = 'd0340000-0000-4034-8034-000000000002';

  status := public.get_earned_reward_status();

  if (select count(*)
      from public.user_economy_access
      where user_id = 'd0340000-0000-4034-8034-000000000002') is distinct from 0::bigint or
     enrollment.enrolled_period_start is distinct from claim_period or
     (status #>> '{passport,availableClaimCount}')::integer is distinct from 1 or
     (status #>> '{passport,claimedCount}')::integer is distinct from 1 or
     (status #>> '{passport,catchUpClaimCount}')::integer is distinct from 0 or
     (status #>> '{community,availableClaimCount}')::integer is distinct from 0 or
     (status #>> '{community,state}') is distinct from 'waiting' then
    raise exception 'A user with no economy access row did not anchor the passport to the claim week';
  end if;
end;
$$;

reset role;

-- ---------------------------------------------------------------------------
-- A future-dated grant is clamped to the claim period. Without the least()
-- clamp the enrollment would land ahead of the claim and every later claim
-- would fail with 'Claim time precedes passport enrollment'.
-- ---------------------------------------------------------------------------
set local "request.jwt.claims" =
  '{"sub":"d0340000-0000-4034-8034-000000000003","is_anonymous":false}';
set local role authenticated;

do $$
declare
  enrollment public.earned_reward_passport_enrollments%rowtype;
  status jsonb;
  claim_period date := (date_trunc('week', statement_timestamp() at time zone 'UTC'))::date;
begin
  begin
    perform public.claim_new_collector_passport('slice34:passport:future:0003');
  exception when sqlstate '22023' then
    raise exception 'A future economy access grant was not clamped to the claim week';
  end;

  select * into strict enrollment
  from public.earned_reward_passport_enrollments
  where user_id = 'd0340000-0000-4034-8034-000000000003';

  status := public.get_earned_reward_status();

  if enrollment.enrolled_period_start is distinct from claim_period or
     (status #>> '{passport,availableClaimCount}')::integer is distinct from 1 or
     (status #>> '{passport,catchUpClaimCount}')::integer is distinct from 0 then
    raise exception 'A future economy access grant was not clamped to the claim week';
  end if;
end;
$$;

reset role;

-- ---------------------------------------------------------------------------
-- Negative control. A signed-in player cannot flip their own gate by table DML
-- or by calling the operator RPC, and can read only their own row.
-- ---------------------------------------------------------------------------
set local "request.jwt.claims" =
  '{"sub":"d0340000-0000-4034-8034-000000000004","is_anonymous":false}';
set local role authenticated;

do $$
begin
  begin
    update public.user_economy_access
    set economy_access = true
    where user_id = 'd0340000-0000-4034-8034-000000000004';
    raise exception 'Authenticated economy access update unexpectedly succeeded';
  exception when sqlstate '42501' then
    if sqlerrm not like '%user_economy_access%' then
      raise exception 'Authenticated economy access update unexpectedly succeeded';
    end if;
  end;

  begin
    insert into public.user_economy_access (
      user_id, economy_access, economy_access_granted_at
    ) values (
      'd0340000-0000-4034-8034-000000000005', true, statement_timestamp()
    );
    raise exception 'Authenticated economy access insert unexpectedly succeeded';
  exception when sqlstate '42501' then
    if sqlerrm not like '%user_economy_access%' then
      raise exception 'Authenticated economy access insert unexpectedly succeeded';
    end if;
  end;

  begin
    perform public.set_user_economy_access(
      'd0340000-0000-4034-8034-000000000004',
      true,
      'slice34-operator',
      'self service attempt'
    );
    raise exception 'Authenticated set_user_economy_access unexpectedly succeeded';
  exception when sqlstate '42501' then
    if sqlerrm not like '%set_user_economy_access%' then
      raise exception 'Authenticated set_user_economy_access unexpectedly succeeded';
    end if;
  end;

  if (select count(*) from public.user_economy_access) is distinct from 1::bigint or
     not exists (
       select 1
       from public.user_economy_access
       where user_id = 'd0340000-0000-4034-8034-000000000004'
         and economy_access
     ) then
    raise exception 'Own-row economy access select did not return exactly the caller row';
  end if;
end;
$$;

reset role;

set local "request.jwt.claims" =
  '{"sub":"d0340000-0000-4034-8034-000000000005","is_anonymous":false}';
set local role authenticated;

do $$
begin
  if (select count(*) from public.user_economy_access) is distinct from 0::bigint or
     exists (
       select 1
       from public.user_economy_access
       where user_id = 'd0340000-0000-4034-8034-000000000004'
     ) then
    raise exception 'A different authenticated user could read the economy access row';
  end if;
end;
$$;

reset role;

-- ---------------------------------------------------------------------------
-- Operator lifecycle. Each RPC call is its own top-level statement so that
-- statement_timestamp() advances between them and the set-once guarantee is
-- observable rather than accidental.
-- ---------------------------------------------------------------------------
set local role service_role;

create temporary table slice34_access_lifecycle (
  step            text        primary key,
  economy_access  boolean     not null,
  granted_at      timestamptz,
  updated_at      timestamptz not null,
  changed_by      text,
  change_note     text
) on commit drop;

insert into pg_temp.slice34_access_lifecycle (
  step, economy_access, granted_at, updated_at, changed_by, change_note
)
select
  'enable',
  decision.economy_access,
  decision.economy_access_granted_at,
  decision.updated_at,
  decision.last_changed_by,
  decision.last_change_note
from public.set_user_economy_access(
  'd0340000-0000-4034-8034-000000000006',
  true,
  '  slice34-operator  ',
  '  first enable  '
) as decision;

select pg_sleep(0.02);

insert into pg_temp.slice34_access_lifecycle (
  step, economy_access, granted_at, updated_at, changed_by, change_note
)
select
  'disable',
  decision.economy_access,
  decision.economy_access_granted_at,
  decision.updated_at,
  decision.last_changed_by,
  decision.last_change_note
from public.set_user_economy_access(
  'd0340000-0000-4034-8034-000000000006',
  false,
  'slice34-operator',
  'temporary disable'
) as decision;

select pg_sleep(0.02);

insert into pg_temp.slice34_access_lifecycle (
  step, economy_access, granted_at, updated_at, changed_by, change_note
)
select
  'reenable',
  decision.economy_access,
  decision.economy_access_granted_at,
  decision.updated_at,
  decision.last_changed_by,
  decision.last_change_note
from public.set_user_economy_access(
  'd0340000-0000-4034-8034-000000000006',
  true,
  'slice34-operator',
  'second enable'
) as decision;

do $$
declare
  enabled_step record;
  disabled_step record;
  reenabled_step record;
  final_row public.user_economy_access%rowtype;
begin
  select * into strict enabled_step
  from pg_temp.slice34_access_lifecycle where step = 'enable';
  select * into strict disabled_step
  from pg_temp.slice34_access_lifecycle where step = 'disable';
  select * into strict reenabled_step
  from pg_temp.slice34_access_lifecycle where step = 'reenable';
  select * into strict final_row
  from public.user_economy_access
  where user_id = 'd0340000-0000-4034-8034-000000000006';

  if enabled_step.economy_access is distinct from true or
     enabled_step.granted_at is null or
     enabled_step.granted_at is distinct from enabled_step.updated_at or
     enabled_step.changed_by is distinct from 'slice34-operator' or
     enabled_step.change_note is distinct from 'first enable' then
    raise exception 'First enable did not stamp economy_access_granted_at';
  end if;

  if disabled_step.economy_access is distinct from false or
     disabled_step.granted_at is distinct from enabled_step.granted_at or
     disabled_step.updated_at <= enabled_step.updated_at then
    raise exception 'Disable moved or cleared economy_access_granted_at';
  end if;

  if reenabled_step.economy_access is distinct from true or
     reenabled_step.granted_at is distinct from enabled_step.granted_at or
     reenabled_step.updated_at <= disabled_step.updated_at or
     final_row.economy_access is distinct from true or
     final_row.economy_access_granted_at is distinct from enabled_step.granted_at or
     final_row.updated_at is distinct from reenabled_step.updated_at or
     final_row.last_changed_by is distinct from 'slice34-operator' or
     final_row.last_change_note is distinct from 'second enable' then
    raise exception 'Re-enable moved economy_access_granted_at';
  end if;
end;
$$;

-- Every validation arm fails closed with its own sqlstate and message, so the
-- admin CLI can distinguish an unknown user from a malformed audit note.
do $$
declare
  target_user constant uuid := 'd0340000-0000-4034-8034-000000000006';
begin
  begin
    perform public.set_user_economy_access(
      null::uuid, true, 'slice34-operator', 'null target user'
    );
    raise exception 'set_user_economy_access validation did not fail closed';
  exception when sqlstate '22023' then
    if sqlerrm is distinct from 'A target user id is required' then
      raise exception 'set_user_economy_access validation did not fail closed';
    end if;
  end;

  begin
    perform public.set_user_economy_access(
      target_user, null::boolean, 'slice34-operator', 'null decision'
    );
    raise exception 'set_user_economy_access validation did not fail closed';
  exception when sqlstate '22023' then
    if sqlerrm is distinct from
       'An explicit economy access decision is required' then
      raise exception 'set_user_economy_access validation did not fail closed';
    end if;
  end;

  begin
    perform public.set_user_economy_access(
      target_user, true, null::text, 'missing operator'
    );
    raise exception 'set_user_economy_access validation did not fail closed';
  exception when sqlstate '22023' then
    if sqlerrm is distinct from 'Operator name must be 1-64 characters' then
      raise exception 'set_user_economy_access validation did not fail closed';
    end if;
  end;

  begin
    perform public.set_user_economy_access(
      target_user, true, '     ', 'blank operator'
    );
    raise exception 'set_user_economy_access validation did not fail closed';
  exception when sqlstate '22023' then
    if sqlerrm is distinct from 'Operator name must be 1-64 characters' then
      raise exception 'set_user_economy_access validation did not fail closed';
    end if;
  end;

  begin
    perform public.set_user_economy_access(
      target_user, true, repeat('o', 65), 'oversized operator'
    );
    raise exception 'set_user_economy_access validation did not fail closed';
  exception when sqlstate '22023' then
    if sqlerrm is distinct from 'Operator name must be 1-64 characters' then
      raise exception 'set_user_economy_access validation did not fail closed';
    end if;
  end;

  begin
    perform public.set_user_economy_access(
      target_user, true, 'slice34-operator', null::text
    );
    raise exception 'set_user_economy_access validation did not fail closed';
  exception when sqlstate '22023' then
    if sqlerrm is distinct from 'Operator note must be 1-512 characters' then
      raise exception 'set_user_economy_access validation did not fail closed';
    end if;
  end;

  begin
    perform public.set_user_economy_access(
      target_user, true, 'slice34-operator', repeat('n', 513)
    );
    raise exception 'set_user_economy_access validation did not fail closed';
  exception when sqlstate '22023' then
    if sqlerrm is distinct from 'Operator note must be 1-512 characters' then
      raise exception 'set_user_economy_access validation did not fail closed';
    end if;
  end;

  begin
    perform public.set_user_economy_access(
      'd0340000-0000-4034-8034-0000000000cc'::uuid,
      true,
      'slice34-operator',
      'unknown target user'
    );
    raise exception 'set_user_economy_access accepted an unknown user';
  exception when sqlstate '23503' then
    if sqlerrm is distinct from 'Unknown user for economy access' then
      raise exception 'set_user_economy_access accepted an unknown user';
    end if;
  end;

  -- Every rejected call left the last accepted decision exactly as it was.
  if (select row(economy_access, last_change_note)
      from public.user_economy_access
      where user_id = target_user)
     is distinct from row(true, 'second enable'::text) then
    raise exception 'A rejected economy access decision still mutated the row';
  end if;
end;
$$;

reset role;

rollback;
