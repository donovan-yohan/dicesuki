begin;

insert into auth.users (id) values
  ('a1411111-1111-4111-8111-111111111111'),
  ('a1422222-2222-4222-8222-222222222222');

do $$
begin
  if exists (
    select 1
    from pg_class
    where oid in (
      'public.roll_ticket_balances'::regclass,
      'public.roll_ticket_ledger_entries'::regclass
    )
      and (not relrowsecurity or not relforcerowsecurity)
  ) then
    raise exception 'Every roll-ticket table must force RLS';
  end if;

  if has_table_privilege(
       'authenticated', 'public.roll_ticket_balances', 'INSERT'
     ) or
     has_table_privilege(
       'authenticated', 'public.roll_ticket_balances', 'UPDATE'
     ) or
     has_table_privilege(
       'authenticated', 'public.roll_ticket_ledger_entries', 'INSERT'
     ) or
     has_table_privilege(
       'service_role', 'public.roll_ticket_ledger_entries', 'INSERT'
     ) then
    raise exception 'Direct roll-ticket mutation privilege leaked to an API role';
  end if;

  if has_function_privilege(
       'authenticated',
       'public.record_roll_ticket_ledger_entry(uuid,text,bigint,text,text,jsonb)',
       'EXECUTE'
     ) or not has_function_privilege(
       'service_role',
       'public.record_roll_ticket_ledger_entry(uuid,text,bigint,text,text,jsonb)',
       'EXECUTE'
     ) then
    raise exception 'Roll-ticket record execution grants are not service-role-only';
  end if;
end;
$$;

set local role service_role;

do $$
declare
  grant_entry public.roll_ticket_ledger_entries%rowtype;
  replay_entry public.roll_ticket_ledger_entries%rowtype;
  spend_entry public.roll_ticket_ledger_entries%rowtype;
begin
  grant_entry := public.record_roll_ticket_ledger_entry(
    'a1411111-1111-4111-8111-111111111111',
    'standard_roll',
    5,
    'test.ticket-grant',
    'ticket:test:grant:0001',
    '{"source":"slice-6"}'::jsonb
  );
  replay_entry := public.record_roll_ticket_ledger_entry(
    'a1411111-1111-4111-8111-111111111111',
    'standard_roll',
    5,
    'test.ticket-grant',
    'ticket:test:grant:0001',
    '{"source":"slice-6"}'::jsonb
  );

  if replay_entry.id <> grant_entry.id or
     replay_entry is distinct from grant_entry then
    raise exception 'Exact roll-ticket replay did not return the original row';
  end if;

  begin
    perform public.record_roll_ticket_ledger_entry(
      'a1411111-1111-4111-8111-111111111111',
      'standard_roll',
      5,
      'test.ticket-grant',
      'ticket:test:grant:0001',
      '{"source":"payload-drift"}'::jsonb
    );
    raise exception 'Payload-drift roll-ticket replay unexpectedly succeeded';
  exception when sqlstate '22023' then
    null;
  end;

  begin
    perform public.record_roll_ticket_ledger_entry(
      'a1411111-1111-4111-8111-111111111111',
      'premium_roll',
      5,
      'test.ticket-grant',
      'ticket:test:grant:0001',
      '{"source":"slice-6"}'::jsonb
    );
    raise exception 'Cross-roll-type idempotency-key reuse unexpectedly succeeded';
  exception when sqlstate '22023' then
    null;
  end;

  spend_entry := public.record_roll_ticket_ledger_entry(
    'a1411111-1111-4111-8111-111111111111',
    'standard_roll',
    -2,
    'test.ticket-spend',
    'ticket:test:spend:0001',
    '{"sink":"slice-6"}'::jsonb
  );

  if row(
       grant_entry.delta_quantity,
       grant_entry.quantity_before,
       grant_entry.quantity_after
     ) is distinct from row(5::bigint, 0::bigint, 5::bigint) or
     row(
       spend_entry.delta_quantity,
       spend_entry.quantity_before,
       spend_entry.quantity_after
     ) is distinct from row(-2::bigint, 5::bigint, 3::bigint) then
    raise exception 'Roll-ticket grant/spend quantity chain is incorrect';
  end if;

  begin
    perform public.record_roll_ticket_ledger_entry(
      'a1411111-1111-4111-8111-111111111111',
      'standard_roll',
      -4,
      'test.ticket-overspend',
      'ticket:test:overspend:0001',
      '{}'::jsonb
    );
    raise exception 'Negative roll-ticket quantity unexpectedly succeeded';
  exception when sqlstate '22003' then
    null;
  end;

  perform public.record_roll_ticket_ledger_entry(
    'a1422222-2222-4222-8222-222222222222',
    'premium_roll',
    7,
    'test.ticket-grant',
    'ticket:test:other:0001',
    '{"source":"other-user"}'::jsonb
  );

  if (select count(*) from public.roll_ticket_ledger_entries
      where user_id = 'a1411111-1111-4111-8111-111111111111') <> 2 or
     (select current_quantity from public.roll_ticket_balances
      where user_id = 'a1411111-1111-4111-8111-111111111111'
        and roll_type = 'standard_roll') <> 3 then
    raise exception 'Replay or rejected roll-ticket write changed materialized state';
  end if;
end;
$$;

reset role;
set local "request.jwt.claim.sub" = 'a1411111-1111-4111-8111-111111111111';
set local role authenticated;

do $$
begin
  if (select count(*) from public.roll_ticket_balances) <> 1 or
     (select count(*) from public.roll_ticket_ledger_entries) <> 2 or
     (select current_quantity from public.roll_ticket_balances) <> 3 then
    raise exception 'Authenticated owner cannot read exactly their roll-ticket state';
  end if;

  begin
    insert into public.roll_ticket_balances (
      user_id, roll_type, current_quantity
    ) values (
      'a1411111-1111-4111-8111-111111111111', 'premium_roll', 99
    );
    raise exception 'Authenticated direct roll-ticket balance insert unexpectedly succeeded';
  exception when insufficient_privilege then
    null;
  end;

  begin
    update public.roll_ticket_balances set current_quantity = 99;
    raise exception 'Authenticated direct roll-ticket balance update unexpectedly succeeded';
  exception when insufficient_privilege then
    null;
  end;

  begin
    insert into public.roll_ticket_ledger_entries (
      user_id, roll_type, delta_quantity, quantity_before, quantity_after,
      reason_code, idempotency_key
    ) values (
      'a1411111-1111-4111-8111-111111111111',
      'standard_roll', 1, 3, 4, 'test.direct-write', 'ticket:test:direct:0001'
    );
    raise exception 'Authenticated direct roll-ticket ledger insert unexpectedly succeeded';
  exception when insufficient_privilege then
    null;
  end;

  begin
    perform public.record_roll_ticket_ledger_entry(
      'a1411111-1111-4111-8111-111111111111',
      'standard_roll',
      1,
      'test.client-write',
      'ticket:test:client:0001',
      '{}'::jsonb
    );
    raise exception 'Authenticated caller entered service-only ticket boundary';
  exception when insufficient_privilege then
    null;
  end;
end;
$$;

reset role;
set local "request.jwt.claim.sub" = 'a1422222-2222-4222-8222-222222222222';
set local role authenticated;

do $$
begin
  if (select count(*) from public.roll_ticket_balances) <> 1 or
     (select count(*) from public.roll_ticket_ledger_entries) <> 1 or
     (select current_quantity from public.roll_ticket_balances) <> 7 then
    raise exception 'Authenticated RLS exposed another user roll-ticket state';
  end if;
end;
$$;

rollback;
