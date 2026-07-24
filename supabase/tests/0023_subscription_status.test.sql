begin;

insert into auth.users (id) values
  ('23000000-0000-4000-8000-000000000001'),
  ('23000000-0000-4000-8000-000000000002'),
  ('23000000-0000-4000-8000-000000000003'),
  ('23000000-0000-4000-8000-000000000004'),
  ('23000000-0000-4000-8000-000000000005'),
  ('23000000-0000-4000-8000-000000000006');

do $$
begin
  if exists (
    select 1
    from pg_class
    where oid in (
      'public.subscription_events'::regclass,
      'public.user_subscriptions'::regclass
    )
      and (not relrowsecurity or not relforcerowsecurity)
  ) then
    raise exception 'Every subscription table must force RLS';
  end if;

  if has_table_privilege(
       'authenticated', 'public.subscription_events', 'INSERT'
     ) or
     has_table_privilege(
       'authenticated', 'public.user_subscriptions', 'UPDATE'
     ) or
     has_table_privilege(
       'service_role', 'public.subscription_events', 'INSERT'
     ) or
     has_table_privilege(
       'service_role', 'public.user_subscriptions', 'UPDATE'
     ) then
    raise exception 'Direct subscription DML leaked to an API role';
  end if;

  if has_function_privilege(
       'authenticated',
       'public.record_subscription_event(uuid,text,text,text,text,timestamptz,timestamptz,timestamptz,jsonb,text)',
       'EXECUTE'
     ) or
     not has_function_privilege(
       'service_role',
       'public.record_subscription_event(uuid,text,text,text,text,timestamptz,timestamptz,timestamptz,jsonb,text)',
       'EXECUTE'
     ) or
     has_function_privilege(
       'service_role',
       'private.record_subscription_event(uuid,text,text,text,text,timestamptz,timestamptz,timestamptz,jsonb,text)',
       'EXECUTE'
     ) then
    raise exception 'Subscription record exposure is not service-only and public-wrapper-only';
  end if;

  if not has_function_privilege(
       'authenticated',
       'public.is_lunar_pass_active(uuid,timestamptz,text)',
       'EXECUTE'
     ) or
     not has_function_privilege(
       'service_role',
       'public.is_lunar_pass_active(uuid,timestamptz,text)',
       'EXECUTE'
     ) or
     has_function_privilege(
       'anon',
       'public.is_lunar_pass_active(uuid,timestamptz,text)',
       'EXECUTE'
     ) then
    raise exception 'Lunar Pass predicate grants are wrong';
  end if;

  if not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'user_subscriptions'
  ) or exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'subscription_events'
  ) then
    raise exception 'Realtime must publish only the subscription projection';
  end if;
end;
$$;

set local "request.jwt.claims" = '{"role":"service_role"}';
set local role service_role;

-- Every documented event rejects both missing required dates and forbidden
-- dates with SQLSTATE 22023. Rejections append no receipt and create no
-- projection.
do $$
begin
  begin
    perform public.record_subscription_event(
      '23000000-0000-4000-8000-000000000006',
      'xsolla-sub-invalid',
      'create_subscription',
      'lunar-invalid',
      'lunar-pass',
      null,
      '2026-02-01 00:00:00+00',
      null,
      '{}'::jsonb,
      repeat('4', 64)
    );
    raise exception 'create_subscription without date_create unexpectedly succeeded';
  exception when sqlstate '22023' then
    null;
  end;

  begin
    perform public.record_subscription_event(
      '23000000-0000-4000-8000-000000000006',
      'xsolla-sub-invalid',
      'create_subscription',
      'lunar-invalid',
      'lunar-pass',
      '2026-01-01 00:00:00+00',
      '2026-02-01 00:00:00+00',
      '2026-03-01 00:00:00+00',
      '{}'::jsonb,
      repeat('5', 64)
    );
    raise exception 'create_subscription with date_end unexpectedly succeeded';
  exception when sqlstate '22023' then
    null;
  end;

  begin
    perform public.record_subscription_event(
      '23000000-0000-4000-8000-000000000006',
      'xsolla-sub-invalid',
      'update_subscription',
      'lunar-invalid',
      'lunar-pass',
      null,
      null,
      null,
      '{}'::jsonb,
      repeat('6', 64)
    );
    raise exception 'update_subscription without date_next_charge unexpectedly succeeded';
  exception when sqlstate '22023' then
    null;
  end;

  begin
    perform public.record_subscription_event(
      '23000000-0000-4000-8000-000000000006',
      'xsolla-sub-invalid',
      'update_subscription',
      'lunar-invalid',
      'lunar-pass',
      '2026-01-01 00:00:00+00',
      '2026-02-01 00:00:00+00',
      null,
      '{}'::jsonb,
      repeat('7', 64)
    );
    raise exception 'update_subscription with date_create unexpectedly succeeded';
  exception when sqlstate '22023' then
    null;
  end;

  begin
    perform public.record_subscription_event(
      '23000000-0000-4000-8000-000000000006',
      'xsolla-sub-invalid',
      'non_renewal_subscription',
      'lunar-invalid',
      'lunar-pass',
      null,
      null,
      null,
      '{}'::jsonb,
      repeat('8', 64)
    );
    raise exception 'non_renewal_subscription without date_next_charge unexpectedly succeeded';
  exception when sqlstate '22023' then
    null;
  end;

  begin
    perform public.record_subscription_event(
      '23000000-0000-4000-8000-000000000006',
      'xsolla-sub-invalid',
      'non_renewal_subscription',
      'lunar-invalid',
      'lunar-pass',
      null,
      '2026-02-01 00:00:00+00',
      '2026-03-01 00:00:00+00',
      '{}'::jsonb,
      repeat('9', 64)
    );
    raise exception 'non_renewal_subscription with date_end unexpectedly succeeded';
  exception when sqlstate '22023' then
    null;
  end;

  begin
    perform public.record_subscription_event(
      '23000000-0000-4000-8000-000000000006',
      'xsolla-sub-invalid',
      'cancel_subscription',
      'lunar-invalid',
      'lunar-pass',
      null,
      null,
      null,
      '{}'::jsonb,
      repeat('a', 64)
    );
    raise exception 'cancel_subscription without date_end unexpectedly succeeded';
  exception when sqlstate '22023' then
    null;
  end;

  begin
    perform public.record_subscription_event(
      '23000000-0000-4000-8000-000000000006',
      'xsolla-sub-invalid',
      'cancel_subscription',
      'lunar-invalid',
      'lunar-pass',
      null,
      '2026-02-01 00:00:00+00',
      '2026-03-01 00:00:00+00',
      '{}'::jsonb,
      repeat('b', 64)
    );
    raise exception 'cancel_subscription with date_next_charge unexpectedly succeeded';
  exception when sqlstate '22023' then
    null;
  end;

  if exists (
       select 1
       from public.subscription_events
       where user_id = '23000000-0000-4000-8000-000000000006'
         and subscription_id = 'xsolla-sub-invalid'
     ) or exists (
       select 1
       from public.user_subscriptions
       where user_id = '23000000-0000-4000-8000-000000000006'
         and subscription_id = 'xsolla-sub-invalid'
     ) then
    raise exception 'Rejected event shape changed receipt or projection state';
  end if;
end;
$$;

-- Full happy lifecycle: create_subscription -> update_subscription renewal ->
-- non_renewal_subscription -> cancel_subscription.
do $$
declare
  receipt public.subscription_events%rowtype;
begin
  receipt := public.record_subscription_event(
    '23000000-0000-4000-8000-000000000001',
    'xsolla-sub-happy',
    'create_subscription',
    'lunar-basic',
    'lunar-pass',
    '2026-01-01 00:00:00+00',
    '2026-02-01 00:00:00+00',
    null,
    '{"notification_type":"create_subscription"}'::jsonb,
    repeat('a', 64)
  );

  if not receipt.processed or receipt.notification_type <> 'create_subscription' or
     (select row(status, plan_id, date_next_charge, date_end)
      from public.user_subscriptions
      where user_id = '23000000-0000-4000-8000-000000000001'
        and subscription_id = 'xsolla-sub-happy')
       is distinct from row(
         'active'::text,
         'lunar-basic'::text,
         '2026-02-01 00:00:00+00'::timestamptz,
         null::timestamptz
       ) then
    raise exception 'create_subscription did not establish active state';
  end if;

  -- Active ignores dates because Xsolla exposes no failed-renewal grace state.
  if not public.is_lunar_pass_active(
    '23000000-0000-4000-8000-000000000001',
    '2099-01-01 00:00:00+00'
  ) then
    raise exception 'Active subscription was incorrectly date-gated';
  end if;

  perform public.record_subscription_event(
    '23000000-0000-4000-8000-000000000001',
    'xsolla-sub-happy',
    'update_subscription',
    'lunar-pro',
    'lunar-pass',
    null,
    '2026-03-01 00:00:00+00',
    null,
    '{"notification_type":"update_subscription","renewal":true}'::jsonb,
    repeat('b', 64)
  );

  if (select row(status, plan_id, date_next_charge)
      from public.user_subscriptions
      where user_id = '23000000-0000-4000-8000-000000000001'
        and subscription_id = 'xsolla-sub-happy')
       is distinct from row(
         'active'::text,
         'lunar-pro'::text,
         '2026-03-01 00:00:00+00'::timestamptz
       ) then
    raise exception 'Renewal update did not advance active dates and plan';
  end if;

  -- Product filter truth table: exact match is entitled, mismatch is not,
  -- and explicit NULL retains any-subscription behavior.
  if not public.is_lunar_pass_active(
       '23000000-0000-4000-8000-000000000001',
       '2099-01-01 00:00:00+00',
       'lunar-pass'
     ) or public.is_lunar_pass_active(
       '23000000-0000-4000-8000-000000000001',
       '2099-01-01 00:00:00+00',
       'future-second-subscription-product'
     ) or not public.is_lunar_pass_active(
       '23000000-0000-4000-8000-000000000001',
       '2099-01-01 00:00:00+00',
       null
     ) then
    raise exception 'Lunar Pass product filter truth table failed';
  end if;

  perform public.record_subscription_event(
    '23000000-0000-4000-8000-000000000001',
    'xsolla-sub-happy',
    'non_renewal_subscription',
    'lunar-pro',
    'lunar-pass',
    null,
    '2026-04-01 00:00:00+00',
    null,
    '{"notification_type":"non_renewal_subscription"}'::jsonb,
    repeat('c', 64)
  );

  if (select row(status, date_next_charge)
      from public.user_subscriptions
      where user_id = '23000000-0000-4000-8000-000000000001'
        and subscription_id = 'xsolla-sub-happy')
       is distinct from row(
         'non_renewing'::text,
         '2026-04-01 00:00:00+00'::timestamptz
       ) then
    raise exception 'non_renewal_subscription did not advance to rank one';
  end if;

  -- Nonrenewing boundary is strict: entitled before, not at date_next_charge.
  if not public.is_lunar_pass_active(
       '23000000-0000-4000-8000-000000000001',
       '2026-03-31 23:59:59+00'
     ) or public.is_lunar_pass_active(
       '23000000-0000-4000-8000-000000000001',
       '2026-04-01 00:00:00+00'
     ) then
    raise exception 'Nonrenewing entitlement boundary is wrong';
  end if;

  perform public.record_subscription_event(
    '23000000-0000-4000-8000-000000000001',
    'xsolla-sub-happy',
    'cancel_subscription',
    'lunar-pro',
    'lunar-pass',
    null,
    null,
    '2026-03-15 00:00:00+00',
    '{"notification_type":"cancel_subscription"}'::jsonb,
    repeat('d', 64)
  );

  if (select row(status, plan_id, date_next_charge, date_end)
      from public.user_subscriptions
      where user_id = '23000000-0000-4000-8000-000000000001'
        and subscription_id = 'xsolla-sub-happy')
       is distinct from row(
         'canceled'::text,
         'lunar-pro'::text,
         '2026-04-01 00:00:00+00'::timestamptz,
         '2026-03-15 00:00:00+00'::timestamptz
       ) then
    raise exception 'cancel_subscription did not establish terminal state';
  end if;

  -- Canceled boundary is strict: entitled before, not at date_end.
  if not public.is_lunar_pass_active(
       '23000000-0000-4000-8000-000000000001',
       '2026-03-14 23:59:59+00'
     ) or public.is_lunar_pass_active(
       '23000000-0000-4000-8000-000000000001',
       '2026-03-15 00:00:00+00'
     ) then
    raise exception 'Canceled entitlement boundary is wrong';
  end if;
end;
$$;

-- Cancel first, then deliver a late update: canceled is absorbing and every
-- projected date/plan remains unchanged.
do $$
declare
  snapshot_before public.user_subscriptions%rowtype;
  snapshot_after public.user_subscriptions%rowtype;
begin
  perform public.record_subscription_event(
    '23000000-0000-4000-8000-000000000002',
    'xsolla-sub-terminal',
    'cancel_subscription',
    'lunar-terminal',
    'lunar-pass',
    null,
    null,
    '2030-01-01 00:00:00+00',
    '{"notification_type":"cancel_subscription","order":"first"}'::jsonb,
    repeat('e', 64)
  );

  select * into strict snapshot_before
  from public.user_subscriptions
  where user_id = '23000000-0000-4000-8000-000000000002'
    and subscription_id = 'xsolla-sub-terminal';

  perform public.record_subscription_event(
    '23000000-0000-4000-8000-000000000002',
    'xsolla-sub-terminal',
    'update_subscription',
    'late-plan-must-not-land',
    'lunar-pass',
    null,
    '2040-01-01 00:00:00+00',
    null,
    '{"notification_type":"update_subscription","order":"late"}'::jsonb,
    repeat('f', 64)
  );

  select * into strict snapshot_after
  from public.user_subscriptions
  where user_id = '23000000-0000-4000-8000-000000000002'
    and subscription_id = 'xsolla-sub-terminal';

  if snapshot_after is distinct from snapshot_before then
    raise exception 'Late update changed a canceled projection';
  end if;

  -- Create after cancel on the same subscription id appends an event but cannot
  -- resurrect it. A genuine signup must use a new Xsolla subscription_id.
  perform public.record_subscription_event(
    '23000000-0000-4000-8000-000000000002',
    'xsolla-sub-terminal',
    'create_subscription',
    'late-create-must-not-land',
    'lunar-pass',
    '2031-01-01 00:00:00+00',
    '2031-02-01 00:00:00+00',
    null,
    '{"notification_type":"create_subscription","order":"after-cancel"}'::jsonb,
    repeat('0', 64)
  );

  select * into strict snapshot_after
  from public.user_subscriptions
  where user_id = '23000000-0000-4000-8000-000000000002'
    and subscription_id = 'xsolla-sub-terminal';

  if snapshot_after is distinct from snapshot_before or
     (select count(*) from public.subscription_events
      where user_id = '23000000-0000-4000-8000-000000000002'
        and subscription_id = 'xsolla-sub-terminal') <> 3 then
    raise exception 'Create-after-cancel resurrected state or skipped its receipt';
  end if;
end;
$$;

-- Stale same-rank events remain auditable but do not overwrite newer fields.
do $$
declare
  snapshot_before public.user_subscriptions%rowtype;
  snapshot_after public.user_subscriptions%rowtype;
  receipt_count_before bigint;
begin
  perform public.record_subscription_event(
    '23000000-0000-4000-8000-000000000004',
    'xsolla-sub-stale-ranks',
    'create_subscription',
    'lunar-initial',
    'lunar-pass',
    '2026-04-01 00:00:00+00',
    '2026-05-01 00:00:00+00',
    null,
    '{"notification_type":"create_subscription","case":"stale-ranks"}'::jsonb,
    repeat('2', 64)
  );
  perform public.record_subscription_event(
    '23000000-0000-4000-8000-000000000004',
    'xsolla-sub-stale-ranks',
    'update_subscription',
    'lunar-current',
    'lunar-pass',
    null,
    '2026-06-01 00:00:00+00',
    null,
    '{"notification_type":"update_subscription","case":"current"}'::jsonb,
    repeat('3', 64)
  );

  select * into strict snapshot_before
  from public.user_subscriptions
  where user_id = '23000000-0000-4000-8000-000000000004'
    and subscription_id = 'xsolla-sub-stale-ranks';
  select count(*) into receipt_count_before
  from public.subscription_events
  where user_id = '23000000-0000-4000-8000-000000000004'
    and subscription_id = 'xsolla-sub-stale-ranks';

  -- Stale active update appends a receipt but cannot roll plan/date backward.
  perform public.record_subscription_event(
    '23000000-0000-4000-8000-000000000004',
    'xsolla-sub-stale-ranks',
    'update_subscription',
    'lunar-stale',
    'lunar-pass',
    null,
    '2026-04-15 00:00:00+00',
    null,
    '{"notification_type":"update_subscription","case":"stale"}'::jsonb,
    repeat('4', 64)
  );

  select * into strict snapshot_after
  from public.user_subscriptions
  where user_id = '23000000-0000-4000-8000-000000000004'
    and subscription_id = 'xsolla-sub-stale-ranks';
  if snapshot_after is distinct from snapshot_before or
     (select count(*) from public.subscription_events
      where user_id = '23000000-0000-4000-8000-000000000004'
        and subscription_id = 'xsolla-sub-stale-ranks')
       <> receipt_count_before + 1 then
    raise exception 'Stale active update changed projection or skipped receipt';
  end if;

  select * into strict snapshot_before
  from public.user_subscriptions
  where user_id = '23000000-0000-4000-8000-000000000004'
    and subscription_id = 'xsolla-sub-stale-ranks';
  select count(*) into receipt_count_before
  from public.subscription_events
  where user_id = '23000000-0000-4000-8000-000000000004'
    and subscription_id = 'xsolla-sub-stale-ranks';

  -- Stale active-to-nonrenewal cannot shorten the projected entitlement date.
  perform public.record_subscription_event(
    '23000000-0000-4000-8000-000000000004',
    'xsolla-sub-stale-ranks',
    'non_renewal_subscription',
    'lunar-nonrenew-stale-active',
    'lunar-pass',
    null,
    '2026-05-15 00:00:00+00',
    null,
    '{"notification_type":"non_renewal_subscription","case":"stale-active"}'::jsonb,
    repeat('9', 64)
  );

  select * into strict snapshot_after
  from public.user_subscriptions
  where user_id = '23000000-0000-4000-8000-000000000004'
    and subscription_id = 'xsolla-sub-stale-ranks';
  if snapshot_after is distinct from snapshot_before or
     (select count(*) from public.subscription_events
      where user_id = '23000000-0000-4000-8000-000000000004'
        and subscription_id = 'xsolla-sub-stale-ranks')
       <> receipt_count_before + 1 then
    raise exception 'Stale active-to-nonrenewal changed projection or skipped receipt';
  end if;

  perform public.record_subscription_event(
    '23000000-0000-4000-8000-000000000004',
    'xsolla-sub-stale-ranks',
    'non_renewal_subscription',
    'lunar-nonrenew-current',
    'lunar-pass',
    null,
    '2026-08-01 00:00:00+00',
    null,
    '{"notification_type":"non_renewal_subscription","case":"current"}'::jsonb,
    repeat('5', 64)
  );
  select * into strict snapshot_before
  from public.user_subscriptions
  where user_id = '23000000-0000-4000-8000-000000000004'
    and subscription_id = 'xsolla-sub-stale-ranks';
  select count(*) into receipt_count_before
  from public.subscription_events
  where user_id = '23000000-0000-4000-8000-000000000004'
    and subscription_id = 'xsolla-sub-stale-ranks';

  -- Stale non-renewal appends a receipt but cannot roll rank-one fields back.
  perform public.record_subscription_event(
    '23000000-0000-4000-8000-000000000004',
    'xsolla-sub-stale-ranks',
    'non_renewal_subscription',
    'lunar-nonrenew-stale',
    'lunar-pass',
    null,
    '2026-07-01 00:00:00+00',
    null,
    '{"notification_type":"non_renewal_subscription","case":"stale"}'::jsonb,
    repeat('6', 64)
  );

  select * into strict snapshot_after
  from public.user_subscriptions
  where user_id = '23000000-0000-4000-8000-000000000004'
    and subscription_id = 'xsolla-sub-stale-ranks';
  if snapshot_after is distinct from snapshot_before or
     (select count(*) from public.subscription_events
      where user_id = '23000000-0000-4000-8000-000000000004'
        and subscription_id = 'xsolla-sub-stale-ranks')
       <> receipt_count_before + 1 then
    raise exception 'Stale non-renewal changed projection or skipped receipt';
  end if;

  perform public.record_subscription_event(
    '23000000-0000-4000-8000-000000000004',
    'xsolla-sub-stale-ranks',
    'cancel_subscription',
    'lunar-cancel-current',
    'lunar-pass',
    null,
    null,
    '2026-09-01 00:00:00+00',
    '{"notification_type":"cancel_subscription","case":"current"}'::jsonb,
    repeat('7', 64)
  );
  select * into strict snapshot_before
  from public.user_subscriptions
  where user_id = '23000000-0000-4000-8000-000000000004'
    and subscription_id = 'xsolla-sub-stale-ranks';
  select count(*) into receipt_count_before
  from public.subscription_events
  where user_id = '23000000-0000-4000-8000-000000000004'
    and subscription_id = 'xsolla-sub-stale-ranks';

  -- Earlier second cancellation appends a receipt but preserves the later end.
  perform public.record_subscription_event(
    '23000000-0000-4000-8000-000000000004',
    'xsolla-sub-stale-ranks',
    'cancel_subscription',
    'lunar-cancel-stale',
    'lunar-pass',
    null,
    null,
    '2026-08-15 00:00:00+00',
    '{"notification_type":"cancel_subscription","case":"stale"}'::jsonb,
    repeat('8', 64)
  );

  select * into strict snapshot_after
  from public.user_subscriptions
  where user_id = '23000000-0000-4000-8000-000000000004'
    and subscription_id = 'xsolla-sub-stale-ranks';
  if snapshot_after is distinct from snapshot_before or
     (select count(*) from public.subscription_events
      where user_id = '23000000-0000-4000-8000-000000000004'
        and subscription_id = 'xsolla-sub-stale-ranks')
       <> receipt_count_before + 1 then
    raise exception 'Earlier second cancellation changed projection or skipped receipt';
  end if;
end;
$$;

-- Exact dedupe replay returns the prior receipt, appends zero rows, and performs
-- no projection refresh.
do $$
declare
  original_event public.subscription_events%rowtype;
  replay_event public.subscription_events%rowtype;
  event_count_before bigint;
  projection_ctid_before tid;
begin
  select * into strict original_event
  from public.subscription_events
  where user_id = '23000000-0000-4000-8000-000000000001'
    and subscription_id = 'xsolla-sub-happy'
    and notification_type = 'create_subscription';

  select count(*) into event_count_before
  from public.subscription_events;
  select ctid into strict projection_ctid_before
  from public.user_subscriptions
  where user_id = '23000000-0000-4000-8000-000000000001'
    and subscription_id = 'xsolla-sub-happy';

  replay_event := public.record_subscription_event(
    '23000000-0000-4000-8000-000000000001',
    'xsolla-sub-happy',
    'create_subscription',
    'lunar-basic',
    'lunar-pass',
    '2026-01-01 00:00:00+00',
    '2026-02-01 00:00:00+00',
    null,
    '{"notification_type":"create_subscription"}'::jsonb,
    repeat('a', 64)
  );

  if replay_event is distinct from original_event or
     (select count(*) from public.subscription_events) <> event_count_before or
     (select ctid from public.user_subscriptions
      where user_id = '23000000-0000-4000-8000-000000000001'
        and subscription_id = 'xsolla-sub-happy')
       is distinct from projection_ctid_before then
    raise exception 'Exact replay changed the receipt ledger or projection';
  end if;
end;
$$;

-- An unknown notification type is retained as an unprocessed receipt and never
-- creates a projection.
do $$
declare
  receipt public.subscription_events%rowtype;
begin
  receipt := public.record_subscription_event(
    '23000000-0000-4000-8000-000000000003',
    'xsolla-sub-unknown',
    'mystery_subscription',
    null,
    null,
    null,
    null,
    null,
    '{"notification_type":"mystery_subscription","future_shape":true}'::jsonb,
    repeat('1', 64)
  );

  if receipt.notification_type <> 'unknown' or receipt.processed or
     receipt.raw_payload ->> 'notification_type' <> 'mystery_subscription' or
     exists (
       select 1 from public.user_subscriptions
       where user_id = '23000000-0000-4000-8000-000000000003'
     ) then
    raise exception 'Unknown notification was not retained unprocessed';
  end if;
end;
$$;

reset role;

-- Predicate NULL truth table: active ignores dates; nonrenewing and canceled
-- with missing boundary dates are never entitled.
insert into public.user_subscriptions (
  user_id, subscription_id, status, plan_id, product_id,
  date_next_charge, date_end
) values
  (
    '23000000-0000-4000-8000-000000000004',
    'truth-active-null',
    'active',
    'lunar-truth',
    'lunar-pass',
    null,
    null
  ),
  (
    '23000000-0000-4000-8000-000000000005',
    'truth-nonrenew-null',
    'non_renewing',
    'lunar-truth',
    'lunar-pass',
    null,
    null
  ),
  (
    '23000000-0000-4000-8000-000000000006',
    'truth-cancel-null',
    'canceled',
    'lunar-truth',
    'lunar-pass',
    null,
    null
  );

set local "request.jwt.claims" = '{"role":"service_role"}';
set local role service_role;
do $$
begin
  if not public.is_lunar_pass_active(
       '23000000-0000-4000-8000-000000000004',
       '2099-01-01 00:00:00+00'
     ) or public.is_lunar_pass_active(
       '23000000-0000-4000-8000-000000000005',
       '2026-01-01 00:00:00+00'
     ) or public.is_lunar_pass_active(
       '23000000-0000-4000-8000-000000000006',
       '2026-01-01 00:00:00+00'
     ) or public.is_lunar_pass_active(
       '23000000-0000-4000-8000-000000000004',
       null
     ) then
    raise exception 'Lunar Pass predicate NULL truth table failed';
  end if;
end;
$$;
reset role;

-- The append-only ledger rejects update/delete/truncate with pinned SQLSTATE.
do $$
begin
  begin
    update public.subscription_events
    set processed = processed
    where id = (select id from public.subscription_events limit 1);
    raise exception 'Subscription event update unexpectedly succeeded';
  exception when sqlstate '55000' then
    null;
  end;

  begin
    delete from public.subscription_events
    where id = (select id from public.subscription_events limit 1);
    raise exception 'Subscription event delete unexpectedly succeeded';
  exception when sqlstate '55000' then
    null;
  end;

  begin
    truncate table public.subscription_events;
    raise exception 'Subscription event truncate unexpectedly succeeded';
  exception when sqlstate '55000' then
    null;
  end;
end;
$$;

-- Owner can read exactly their rows. RLS leaked another user's subscription if
-- either count below includes data for users two through six.
set local "request.jwt.claims" =
  '{"sub":"23000000-0000-4000-8000-000000000001","role":"authenticated","is_anonymous":false}';
set local role authenticated;
do $$
begin
  if (select count(*) from public.subscription_events) <> 4 or
     (select count(*) from public.user_subscriptions) <> 1 then
    raise exception 'RLS leaked another user''s subscription or hid owner rows';
  end if;

  if not public.is_lunar_pass_active(
    '23000000-0000-4000-8000-000000000001',
    '2026-03-01 00:00:00+00'
  ) then
    raise exception 'Authenticated owner could not read self entitlement';
  end if;

  begin
    perform public.is_lunar_pass_active(
      '23000000-0000-4000-8000-000000000002',
      '2026-03-01 00:00:00+00'
    );
    raise exception 'Authenticated user queried another user entitlement';
  exception when sqlstate '42501' then
    null;
  end;

  begin
    insert into public.user_subscriptions (
      user_id, subscription_id, status
    ) values (
      '23000000-0000-4000-8000-000000000001',
      'direct-client-write',
      'active'
    );
    raise exception 'Authenticated direct projection insert unexpectedly succeeded';
  exception when insufficient_privilege then
    null;
  end;

  begin
    update public.user_subscriptions set status = 'active';
    raise exception 'Authenticated direct projection update unexpectedly succeeded';
  exception when insufficient_privilege then
    null;
  end;

  begin
    insert into public.subscription_events (
      user_id,
      subscription_id,
      notification_type,
      raw_payload,
      body_sha256,
      processed
    ) values (
      '23000000-0000-4000-8000-000000000001',
      'direct-client-write',
      'unknown',
      '{}'::jsonb,
      repeat('2', 64),
      false
    );
    raise exception 'Authenticated direct event insert unexpectedly succeeded';
  exception when insufficient_privilege then
    null;
  end;

  begin
    perform public.record_subscription_event(
      '23000000-0000-4000-8000-000000000001',
      'direct-client-rpc',
      'mystery_subscription',
      null,
      null,
      null,
      null,
      null,
      '{}'::jsonb,
      repeat('3', 64)
    );
    raise exception 'Authenticated caller entered the service-only record RPC';
  exception when insufficient_privilege then
    null;
  end;
end;
$$;

reset role;

rollback;
