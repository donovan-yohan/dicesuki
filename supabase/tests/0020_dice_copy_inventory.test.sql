begin;

insert into auth.users (id) values
  ('d2000000-0000-4200-8200-000000000001'),
  ('d2000000-0000-4200-8200-000000000002');

insert into public.catalog_items (
  id,
  catalog_key,
  contract_version,
  item_kind,
  set_id,
  dice_type,
  rarity
) values (
  'slice7-copy/d6/rare@1',
  'slice7-copy/d6/rare',
  1,
  'die',
  'slice7-copy',
  'd6',
  'rare'
);

do $$
begin
  if not (
    select relrowsecurity and relforcerowsecurity
    from pg_class
    where oid = 'public.dice_copies'::regclass
  ) then
    raise exception 'dice_copies must force RLS';
  end if;

  if has_table_privilege(
       'authenticated', 'public.dice_copies', 'INSERT'
     ) or
     has_table_privilege(
       'authenticated', 'public.dice_copies', 'UPDATE'
     ) or
     has_table_privilege(
       'authenticated', 'public.dice_copies', 'DELETE'
     ) or
     has_table_privilege(
       'service_role', 'public.dice_copies', 'INSERT'
     ) or
     has_table_privilege(
       'service_role', 'public.dice_copies', 'UPDATE'
     ) then
    raise exception 'Direct dice-copy mutation privilege leaked to an API role';
  end if;

  if has_function_privilege(
       'authenticated',
       'public.record_dice_copy_grant(uuid,text,text,text,text)',
       'EXECUTE'
     ) or not has_function_privilege(
       'service_role',
       'public.record_dice_copy_grant(uuid,text,text,text,text)',
       'EXECUTE'
     ) or not has_function_privilege(
       'authenticated',
       'public.scrap_dice_copy_marker(uuid,text)',
       'EXECUTE'
     ) or has_function_privilege(
       'anon',
       'public.scrap_dice_copy_marker(uuid,text)',
       'EXECUTE'
     ) then
    raise exception 'Dice-copy function execution grants are incorrect';
  end if;

  if not exists (
    select 1
    from pg_indexes
    where schemaname = 'public'
      and tablename = 'dice_copies'
      and indexname = 'dice_copies_live_count_idx'
      and indexdef ilike '%(user_id, catalog_item_id)%where (scrapped_at is null)%'
  ) then
    raise exception 'Live-copy count partial index is missing or malformed';
  end if;
end;
$$;

set local role service_role;

do $$
declare
  first_grant public.dice_copies%rowtype;
  replay_grant public.dice_copies%rowtype;
  matched_set_grant public.dice_copies%rowtype;
  other_grant public.dice_copies%rowtype;
begin
  first_grant := public.record_dice_copy_grant(
    'd2000000-0000-4200-8200-000000000001',
    'slice7-copy/d6/rare@1',
    'reward',
    'slice7:test:first',
    'dice-copy:grant:first:0001'
  );
  replay_grant := public.record_dice_copy_grant(
    'd2000000-0000-4200-8200-000000000001',
    'slice7-copy/d6/rare@1',
    'reward',
    'slice7:test:first',
    'dice-copy:grant:first:0001'
  );

  if replay_grant is distinct from first_grant or
     first_grant.is_first_copy is distinct from true or
     first_grant.scrapped_at is not null then
    raise exception 'First grant or exact idempotent replay is incorrect';
  end if;

  begin
    perform public.record_dice_copy_grant(
      'd2000000-0000-4200-8200-000000000001',
      'slice7-copy/d6/rare@1',
      'pull',
      'slice7:test:drift',
      'dice-copy:grant:first:0001'
    );
    raise exception 'Mismatched grant replay unexpectedly succeeded';
  exception when sqlstate '22023' then
    null;
  end;

  matched_set_grant := public.record_dice_copy_grant(
    'd2000000-0000-4200-8200-000000000001',
    'slice7-copy/d6/rare@1',
    'reward',
    'slice7:test:matched-set',
    'dice-copy:grant:matched:0001'
  );

  if matched_set_grant.is_first_copy is distinct from false or
     (select count(*)
      from public.dice_copies
      where user_id = 'd2000000-0000-4200-8200-000000000001'
        and catalog_item_id = 'slice7-copy/d6/rare@1'
        and scrapped_at is null) <> 2 then
    raise exception 'Two simultaneous copies did not form a live matched set';
  end if;

  other_grant := public.record_dice_copy_grant(
    'd2000000-0000-4200-8200-000000000002',
    'slice7-copy/d6/rare@1',
    'purchase',
    'slice7:test:other',
    'dice-copy:grant:other:0001'
  );

  if other_grant.is_first_copy is distinct from true then
    raise exception 'Ever-owned latch was not scoped per user and catalog item';
  end if;

  perform set_config('slice7.first_copy_id', first_grant.id::text, true);
  perform set_config(
    'slice7.matched_set_copy_id',
    matched_set_grant.id::text,
    true
  );
end;
$$;

reset role;
set local "request.jwt.claim.sub" = 'd2000000-0000-4200-8200-000000000001';
set local role authenticated;

do $$
declare
  first_copy_id uuid := current_setting('slice7.first_copy_id')::uuid;
  matched_set_copy_id uuid :=
    current_setting('slice7.matched_set_copy_id')::uuid;
  scrap_result public.dice_copies%rowtype;
  replay_result public.dice_copies%rowtype;
begin
  if (select count(*) from public.dice_copies) <> 2 or
     (select count(*) from public.dice_copies where scrapped_at is null) <> 2 then
    raise exception 'Owner cannot read exactly their two-copy matched set';
  end if;

  scrap_result := public.scrap_dice_copy_marker(
    first_copy_id,
    'dice-copy:scrap:first:0001'
  );
  replay_result := public.scrap_dice_copy_marker(
    first_copy_id,
    'dice-copy:scrap:first:0001'
  );

  if replay_result is distinct from scrap_result or
     scrap_result.scrapped_at is null or
     scrap_result.is_first_copy is distinct from true or
     (select count(*) from public.dice_copies) <> 2 or
     (select count(*) from public.dice_copies where scrapped_at is null) <> 1 then
    raise exception 'Scrap did not retain the row, lower matched-set count, and replay exactly';
  end if;

  begin
    perform public.scrap_dice_copy_marker(
      first_copy_id,
      'dice-copy:scrap:first:0002'
    );
    raise exception 'Second scrap with a different key unexpectedly succeeded';
  exception when sqlstate '55000' then
    null;
  end;

  perform public.scrap_dice_copy_marker(
    matched_set_copy_id,
    'dice-copy:scrap:matched:0001'
  );

  if (select count(*) from public.dice_copies) <> 2 or
     (select count(*) from public.dice_copies where scrapped_at is null) <> 0 then
    raise exception 'Scrapping the matched-set copy did not reach live count zero';
  end if;

  begin
    insert into public.dice_copies (
      user_id,
      catalog_item_id,
      source_kind,
      source_reference,
      grant_idempotency_key,
      is_first_copy
    ) values (
      'd2000000-0000-4200-8200-000000000001',
      'slice7-copy/d6/rare@1',
      'reward',
      'slice7:test:direct',
      'dice-copy:grant:direct:0001',
      false
    );
    raise exception 'Authenticated direct dice-copy insert unexpectedly succeeded';
  exception when insufficient_privilege then
    null;
  end;

  begin
    update public.dice_copies
    set source_reference = source_reference
    where id = first_copy_id;
    raise exception 'Authenticated direct dice-copy update unexpectedly succeeded';
  exception when insufficient_privilege then
    null;
  end;

  begin
    delete from public.dice_copies
    where id = first_copy_id;
    raise exception 'Authenticated direct dice-copy delete unexpectedly succeeded';
  exception when insufficient_privilege then
    null;
  end;
end;
$$;

reset role;

do $$
declare
  first_copy_id uuid := current_setting('slice7.first_copy_id')::uuid;
begin
  begin
    update public.dice_copies
    set scrapped_at = null
    where id = first_copy_id;
    raise exception 'Owner unexpectedly reversed a dice-copy scrap';
  exception when sqlstate '55000' then
    null;
  end;

  begin
    update public.dice_copies
    set is_first_copy = false
    where id = first_copy_id;
    raise exception 'Owner unexpectedly changed the first-copy latch';
  exception when sqlstate '55000' then
    null;
  end;

  begin
    update public.dice_copies
    set user_id = 'd2000000-0000-4200-8200-000000000002'
    where id = first_copy_id;
    raise exception 'Owner unexpectedly changed dice-copy ownership';
  exception when sqlstate '55000' then
    null;
  end;

  begin
    delete from public.dice_copies
    where id = first_copy_id;
    raise exception 'Owner unexpectedly deleted a dice-copy row';
  exception when sqlstate '55000' then
    null;
  end;
end;
$$;

set local "request.jwt.claim.sub" = 'd2000000-0000-4200-8200-000000000002';
set local role authenticated;

do $$
declare
  first_copy_id uuid := current_setting('slice7.first_copy_id')::uuid;
begin
  if (select count(*) from public.dice_copies) <> 1 or
     exists (
       select 1
       from public.dice_copies
       where id = first_copy_id
     ) then
    raise exception 'RLS exposed another user dice-copy row';
  end if;

  begin
    perform public.scrap_dice_copy_marker(
      first_copy_id,
      'dice-copy:scrap:cross:0001'
    );
    raise exception 'Cross-user scrap unexpectedly succeeded';
  exception when sqlstate '42501' then
    null;
  end;
end;
$$;

reset role;
set local role service_role;

do $$
declare
  second_grant public.dice_copies%rowtype;
begin
  second_grant := public.record_dice_copy_grant(
    'd2000000-0000-4200-8200-000000000001',
    'slice7-copy/d6/rare@1',
    'pull',
    'slice7:test:regrant',
    'dice-copy:grant:second:0001'
  );

  if second_grant.is_first_copy is distinct from false or
     (select count(*)
      from public.dice_copies
      where user_id = 'd2000000-0000-4200-8200-000000000001'
        and catalog_item_id = 'slice7-copy/d6/rare@1') <> 3 or
     (select count(*)
      from public.dice_copies
      where user_id = 'd2000000-0000-4200-8200-000000000001'
        and catalog_item_id = 'slice7-copy/d6/rare@1'
        and scrapped_at is null) <> 1 or
     (select count(*)
      from public.dice_copies
      where user_id = 'd2000000-0000-4200-8200-000000000001'
        and catalog_item_id = 'slice7-copy/d6/rare@1'
        and is_first_copy) <> 1 then
    raise exception 'Re-grant after scrap-all re-fired or lost the ever-owned latch';
  end if;

  if exists (
    select 1
    from public.wallet_ledger_entries
    where user_id in (
      'd2000000-0000-4200-8200-000000000001',
      'd2000000-0000-4200-8200-000000000002'
    )
  ) then
    raise exception 'Marker-only inventory foundation unexpectedly changed wallet history';
  end if;
end;
$$;

rollback;
