begin;

insert into auth.users (id) values
  ('11111111-1111-4111-8111-111111111111'),
  ('22222222-2222-4222-8222-222222222222');

do $$
begin
  if not exists (
    select 1 from public.economy_editions
    where id = 'earned-collection@1'
      and config_sha256 = '6e198c0f3a3a96975ada45b27334583b5c17d84549db9eefe4e3671b296aba09'
      and config #>> '{acquisition,banner,tiers,0,weightUnits}' = '72'
      and config #>> '{acquisition,banner,guarantees,rareOrBetter,hardGuaranteePull}' = '8'
      and config #>> '{acquisition,banner,guarantees,epicOrBetter,hardGuaranteePull}' = '25'
      and config #>> '{acquisition,banner,guarantees,selectedFeaturedUnowned,hardGuaranteePull}' = '20'
      and config #>> '{rewards,weeklyAuthoritativeRolls,maximumPeriodReward}' = '1600'
      and config #>> '{rewards,newCollectorPassport,durationWeeks}' = '12'
      and config #>> '{rewards,communityDie,intervalWeeks}' = '4'
  ) then
    raise exception 'Production economy edition seed is incomplete or drifted';
  end if;

  if exists (
    select 1
    from pg_class
    where oid in (
      'public.economy_editions'::regclass,
      'public.wallet_accounts'::regclass,
      'public.wallet_balances'::regclass,
      'public.wallet_ledger_entries'::regclass
    )
      and (not relrowsecurity or not relforcerowsecurity)
  ) then
    raise exception 'Every earned-economy table must force RLS';
  end if;

  if has_table_privilege('authenticated', 'public.wallet_accounts', 'INSERT') or
     has_table_privilege('authenticated', 'public.wallet_balances', 'UPDATE') or
     has_table_privilege('authenticated', 'public.wallet_ledger_entries', 'INSERT') or
     has_table_privilege('service_role', 'public.wallet_ledger_entries', 'INSERT') then
    raise exception 'Direct wallet mutation privilege leaked to an API role';
  end if;

  if has_function_privilege(
    'authenticated',
    'public.append_wallet_ledger_entry(uuid,text,text,bigint,text,text,text,jsonb)',
    'EXECUTE'
  ) or not has_function_privilege(
    'service_role',
    'public.append_wallet_ledger_entry(uuid,text,text,bigint,text,text,text,jsonb)',
    'EXECUTE'
  ) then
    raise exception 'Wallet append execution grants are not service-role-only';
  end if;
end;
$$;

set local role service_role;

do $$
declare
  first_entry_id bigint;
  replay_entry_id bigint;
begin
  select (public.append_wallet_ledger_entry(
    '11111111-1111-4111-8111-111111111111',
    'stars',
    'promotional',
    160,
    'weekly.authoritative-roll',
    'test:weekly:0001',
    'earned-collection@1',
    '{"roll":1}'::jsonb
  )).id into first_entry_id;

  select (public.append_wallet_ledger_entry(
    '11111111-1111-4111-8111-111111111111',
    'stars',
    'promotional',
    160,
    'weekly.authoritative-roll',
    'test:weekly:0001',
    'earned-collection@1',
    '{"roll":1}'::jsonb
  )).id into replay_entry_id;

  if replay_entry_id <> first_entry_id then
    raise exception 'Exact idempotent replay returned a different ledger row';
  end if;

  begin
    perform public.append_wallet_ledger_entry(
      '11111111-1111-4111-8111-111111111111',
      'stars',
      'promotional',
      320,
      'weekly.authoritative-roll',
      'test:weekly:0001',
      'earned-collection@1',
      '{"roll":1}'::jsonb
    );
    raise exception 'Mismatched idempotency replay unexpectedly succeeded';
  exception when sqlstate '22023' then
    null;
  end;

  begin
    perform public.append_wallet_ledger_entry(
      '11111111-1111-4111-8111-111111111111',
      'stars',
      'promotional',
      -200,
      'test.overspend',
      'test:overspend:0001',
      'earned-collection@1',
      '{}'::jsonb
    );
    raise exception 'Negative wallet balance unexpectedly succeeded';
  exception when sqlstate '22003' then
    null;
  end;

  begin
    perform public.append_wallet_ledger_entry(
      '11111111-1111-4111-8111-111111111111',
      'stars',
      'paid',
      1,
      'test.paid-credit',
      'test:paid:0001',
      'earned-collection@1',
      '{}'::jsonb
    );
    raise exception 'Paid wallet bucket unexpectedly exists';
  exception when sqlstate '22023' then
    null;
  end;

  if (select count(*) from public.wallet_ledger_entries where user_id = '11111111-1111-4111-8111-111111111111') <> 1 then
    raise exception 'Replay or rejected writes changed ledger cardinality';
  end if;
  if not exists (
    select 1
    from public.wallet_ledger_entries
    where user_id = '11111111-1111-4111-8111-111111111111'
      and currency_id = 'stars'
      and balance_bucket = 'promotional'
      and delta_amount = 160
      and balance_before = 0
      and balance_after = 160
      and reason_code = 'weekly.authoritative-roll'
      and idempotency_key = 'test:weekly:0001'
      and economy_edition_id = 'earned-collection@1'
      and provenance = '{"roll":1}'::jsonb
  ) then
    raise exception 'Ledger entry lost reason, idempotency, edition, or provenance';
  end if;
  if (select current_balance from public.wallet_balances where user_id = '11111111-1111-4111-8111-111111111111') <> 160 then
    raise exception 'Replay or rejected writes changed materialized balance';
  end if;
end;
$$;

reset role;
set local "request.jwt.claim.sub" = '11111111-1111-4111-8111-111111111111';
set local role authenticated;

do $$
begin
  if (select count(*) from public.wallet_accounts) <> 1 or
     (select count(*) from public.wallet_balances) <> 1 or
     (select count(*) from public.wallet_ledger_entries) <> 1 then
    raise exception 'Authenticated owner cannot read their own wallet';
  end if;

  begin
    insert into public.wallet_accounts (user_id)
    values ('22222222-2222-4222-8222-222222222222');
    raise exception 'Authenticated direct wallet account insert unexpectedly succeeded';
  exception when insufficient_privilege then
    null;
  end;

  begin
    update public.wallet_balances set current_balance = 999;
    raise exception 'Authenticated direct balance update unexpectedly succeeded';
  exception when insufficient_privilege then
    null;
  end;

  begin
    perform public.append_wallet_ledger_entry(
      '11111111-1111-4111-8111-111111111111',
      'stars',
      'promotional',
      160,
      'test.client',
      'test:client:0001',
      'earned-collection@1',
      '{}'::jsonb
    );
    raise exception 'Authenticated client called the server-only append function';
  exception when insufficient_privilege then
    null;
  end;
end;
$$;

reset role;
set local "request.jwt.claim.sub" = '22222222-2222-4222-8222-222222222222';
set local role authenticated;

do $$
begin
  if (select count(*) from public.wallet_accounts) <> 0 or
     (select count(*) from public.wallet_balances) <> 0 or
     (select count(*) from public.wallet_ledger_entries) <> 0 then
    raise exception 'RLS exposed another user wallet';
  end if;
end;
$$;

reset role;
set local role anon;

do $$
begin
  if (select count(*) from public.economy_editions) <> 1 then
    raise exception 'Anonymous clients cannot read the public production edition';
  end if;
end;
$$;

reset role;

do $$
begin
  begin
    update public.wallet_ledger_entries set reason_code = 'tampered';
    raise exception 'Ledger update unexpectedly succeeded';
  exception when sqlstate '55000' then
    null;
  end;

  begin
    delete from public.wallet_ledger_entries;
    raise exception 'Ledger delete unexpectedly succeeded';
  exception when sqlstate '55000' then
    null;
  end;

  begin
    truncate table public.wallet_ledger_entries cascade;
    raise exception 'Ledger truncate unexpectedly succeeded';
  exception when sqlstate '55000' then
    null;
  end;

  begin
    delete from auth.users where id = '11111111-1111-4111-8111-111111111111';
    raise exception 'Auth-user cascade unexpectedly erased an anchored wallet';
  exception when foreign_key_violation then
    null;
  end;

  if exists (
    select 1
    from public.wallet_balances as balances
    left join lateral (
      select coalesce(sum(delta_amount), 0) as ledger_total
      from public.wallet_ledger_entries as entries
      where entries.account_id = balances.account_id
        and entries.currency_id = balances.currency_id
        and entries.balance_bucket = balances.balance_bucket
    ) as ledger on true
    where balances.current_balance <> ledger.ledger_total
  ) then
    raise exception 'Materialized balance does not reconcile to immutable ledger';
  end if;
end;
$$;

rollback;
