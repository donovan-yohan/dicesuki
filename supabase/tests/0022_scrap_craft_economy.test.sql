begin;

insert into auth.users (id) values
  ('d2200000-0000-4220-8220-000000000001'),
  ('d2200000-0000-4220-8220-000000000002'),
  ('d2200000-0000-4220-8220-000000000003'),
  ('d2200000-0000-4220-8220-000000000004'),
  ('d2200000-0000-4220-8220-000000000005'),
  ('d2200000-0000-4220-8220-000000000006'),
  ('d2200000-0000-4220-8220-000000000007'),
  ('d2200000-0000-4220-8220-000000000008'),
  ('d2200000-0000-4220-8220-000000000009');

insert into public.catalog_items (
  id,
  catalog_key,
  contract_version,
  item_kind,
  set_id,
  dice_type,
  rarity
) values
  (
    'slice9-economy/d6/common@1',
    'slice9-economy/d6/common',
    1,
    'die',
    'slice9-economy',
    'd6',
    'common'
  ),
  (
    'slice9-economy/d6/uncommon@1',
    'slice9-economy/d6/uncommon',
    1,
    'die',
    'slice9-economy',
    'd6',
    'uncommon'
  ),
  (
    'slice9-economy/d6/rare@1',
    'slice9-economy/d6/rare',
    1,
    'die',
    'slice9-economy',
    'd6',
    'rare'
  ),
  (
    'slice9-economy/d6/epic@1',
    'slice9-economy/d6/epic',
    1,
    'die',
    'slice9-economy',
    'd6',
    'epic'
  ),
  (
    'slice9-economy/d6/legendary@1',
    'slice9-economy/d6/legendary',
    1,
    'die',
    'slice9-economy',
    'd6',
    'legendary'
  ),
  (
    'slice9-economy/d6/mythic@1',
    'slice9-economy/d6/mythic',
    1,
    'die',
    'slice9-economy',
    'd6',
    'mythic'
  );

-- The six actual catalog rarities are present as public data. Common and
-- uncommon deliberately share the standard-tier proposal.
set local role anon;

do $$
begin
  if (select count(*) from public.dice_economy_values) <> 6 or
     not exists (
       select 1
       from public.dice_economy_values
       where catalog_rarity = 'common'
         and economy_tier = 'standard'
         and scrap_yield = 1
         and craft_cost = 210
     ) or
     not exists (
       select 1
       from public.dice_economy_values
       where catalog_rarity = 'uncommon'
         and economy_tier = 'standard'
         and scrap_yield = 1
         and craft_cost = 210
     ) or
     not exists (
       select 1
       from public.dice_economy_values
       where catalog_rarity = 'rare'
         and economy_tier = 'rare'
         and scrap_yield = 4
         and craft_cost = 220
     ) or
     not exists (
       select 1
       from public.dice_economy_values
       where catalog_rarity = 'epic'
         and economy_tier = 'epic'
         and scrap_yield = 10
         and craft_cost = 615
     ) or
     not exists (
       select 1
       from public.dice_economy_values
       where catalog_rarity = 'legendary'
         and economy_tier = 'signature'
         and scrap_yield = 25
         and craft_cost = 2500
     ) or
     not exists (
       select 1
       from public.dice_economy_values
       where catalog_rarity = 'mythic'
         and economy_tier = 'mythic'
         and scrap_yield = 50
         and craft_cost is null
     ) then
    raise exception 'Public economy-value rows drifted from the rev-2 proposal';
  end if;
end;
$$;

reset role;
set local role authenticated;

do $$
begin
  begin
    update public.dice_economy_values
    set scrap_yield = scrap_yield
    where catalog_rarity = 'common';
    raise exception 'Authenticated economy-value update unexpectedly succeeded';
  exception when insufficient_privilege then
    null;
  end;
end;
$$;

reset role;

do $$
begin
  if not (
    select relrowsecurity and relforcerowsecurity
    from pg_class
    where oid = 'public.dice_economy_values'::regclass
  ) or
     has_table_privilege(
       'anon', 'public.dice_economy_values', 'UPDATE'
     ) or
     has_table_privilege(
       'authenticated', 'public.dice_economy_values', 'UPDATE'
     ) or
     not has_table_privilege(
       'service_role', 'public.dice_economy_values', 'UPDATE'
     ) or
     has_function_privilege(
       'anon', 'public.scrap_dice_copy(uuid,text)', 'EXECUTE'
     ) or
     has_function_privilege(
       'service_role', 'public.scrap_dice_copy(uuid,text)', 'EXECUTE'
     ) or
     not has_function_privilege(
       'authenticated', 'public.scrap_dice_copy(uuid,text)', 'EXECUTE'
     ) or
     has_function_privilege(
       'anon', 'public.craft_dice_copy(text,text)', 'EXECUTE'
     ) or
     has_function_privilege(
       'service_role', 'public.craft_dice_copy(text,text)', 'EXECUTE'
     ) or
     not has_function_privilege(
       'authenticated', 'public.craft_dice_copy(text,text)', 'EXECUTE'
     ) then
    raise exception 'Economy-value RLS or Scrap/craft execution grants drifted';
  end if;

  begin
    update public.dice_economy_values
    set craft_cost = scrap_yield,
        value_version = value_version + 1
    where catalog_rarity = 'common';
    raise exception 'Craft-to-scrap pump floor unexpectedly accepted equality';
  exception when check_violation then
    null;
  end;
end;
$$;

-- Value versions are enforced runtime contracts, not advisory labels.
-- Economic changes require exactly old+1. Status is governance metadata and
-- changes without a version bump. updated_at is always server-owned.
set local role service_role;

do $$
begin
  begin
    update public.dice_economy_values
    set catalog_rarity = 'epic'
    where catalog_rarity = 'rare';
    raise exception 'Economy rarity identity update unexpectedly succeeded';
  exception when sqlstate '22023' then
    null;
  end;

  begin
    update public.dice_economy_values
    set scrap_yield = 5
    where catalog_rarity = 'rare';
    raise exception 'Same-version economic retune unexpectedly succeeded';
  exception when sqlstate '22023' then
    null;
  end;

  begin
    update public.dice_economy_values
    set value_version = value_version + 1
    where catalog_rarity = 'rare';
    raise exception 'Payload-free value-version bump unexpectedly succeeded';
  exception when sqlstate '22023' then
    null;
  end;

  begin
    update public.dice_economy_values
    set scrap_yield = 2,
        craft_cost = 211,
        value_version = 2
    where catalog_rarity = 'common';
    raise exception 'Partial standard-tier retune unexpectedly succeeded';
  exception when sqlstate '55000' then
    null;
  end;

  update public.dice_economy_values
  set scrap_yield = 5,
      craft_cost = 221,
      value_version = 2,
      updated_at = '1970-01-01 00:00:00+00'
  where catalog_rarity = 'rare';

  update public.dice_economy_values
  set status = 'approved',
      updated_at = '1970-01-01 00:00:00+00'
  where catalog_rarity = 'uncommon';
end;
$$;

reset role;

do $$
begin
  if not exists (
       select 1
       from public.dice_economy_values
       where catalog_rarity = 'rare'
         and scrap_yield = 5
         and craft_cost = 221
         and value_version = 2
         and updated_at <> '1970-01-01 00:00:00+00'
     ) or
     not exists (
       select 1
       from public.dice_economy_values
       where catalog_rarity = 'uncommon'
         and status = 'approved'
         and value_version = 1
         and updated_at <> '1970-01-01 00:00:00+00'
     ) then
    raise exception 'Value-version or server-timestamp enforcement drifted';
  end if;
end;
$$;

set local role service_role;

update public.dice_economy_values
set scrap_yield = 4,
    craft_cost = 220,
    value_version = 3
where catalog_rarity = 'rare';

update public.dice_economy_values
set status = 'proposed-po-pending'
where catalog_rarity = 'uncommon';

reset role;

do $$
begin
  if not exists (
       select 1
       from public.dice_economy_values
       where catalog_rarity = 'rare'
         and scrap_yield = 4
         and craft_cost = 220
         and value_version = 3
     ) or
     not exists (
       select 1
       from public.dice_economy_values
       where catalog_rarity = 'uncommon'
         and status = 'proposed-po-pending'
         and value_version = 1
     ) then
    raise exception 'Economy-value trigger test did not restore live values';
  end if;
end;
$$;

-- Fixture grants are service-only. All privileged table assertions happen only
-- after RESET ROLE; authenticated blocks invoke RPCs and retain receipts via
-- transaction-local settings.
set local role service_role;

do $$
declare
  target record;
  granted public.dice_copies%rowtype;
  scrap_ids jsonb := '{}'::jsonb;
begin
  -- Scrap every catalog rarity, including both standard mappings and mythic.
  for target in
    select * from (values
      ('common', 'slice9-economy/d6/common@1'),
      ('uncommon', 'slice9-economy/d6/uncommon@1'),
      ('rare', 'slice9-economy/d6/rare@1'),
      ('epic', 'slice9-economy/d6/epic@1'),
      ('legendary', 'slice9-economy/d6/legendary@1'),
      ('mythic', 'slice9-economy/d6/mythic@1')
    ) as targets(catalog_rarity, catalog_item_id)
  loop
    granted := public.record_dice_copy_grant(
      'd2200000-0000-4220-8220-000000000001',
      target.catalog_item_id,
      'reward',
      'slice9:fixture:scrap:' || target.catalog_rarity,
      'slice9:grant:scrap:' || target.catalog_rarity
    );
    scrap_ids := scrap_ids || jsonb_build_object(
      target.catalog_rarity,
      granted.id
    );
  end loop;

  granted := public.record_dice_copy_grant(
    'd2200000-0000-4220-8220-000000000002',
    'slice9-economy/d6/common@1',
    'reward',
    'slice9:fixture:craft-happy',
    'slice9:grant:craft-happy'
  );
  perform set_config(
    'slice9.craft_happy_original_copy_id',
    granted.id::text,
    true
  );

  granted := public.record_dice_copy_grant(
    'd2200000-0000-4220-8220-000000000003',
    'slice9-economy/d6/rare@1',
    'reward',
    'slice9:fixture:zero-live',
    'slice9:grant:zero-live'
  );
  perform set_config('slice9.zero_live_copy_id', granted.id::text, true);

  granted := public.record_dice_copy_grant(
    'd2200000-0000-4220-8220-000000000005',
    'slice9-economy/d6/epic@1',
    'reward',
    'slice9:fixture:insufficient',
    'slice9:grant:insufficient'
  );

  granted := public.record_dice_copy_grant(
    'd2200000-0000-4220-8220-000000000006',
    'slice9-economy/d6/mythic@1',
    'reward',
    'slice9:fixture:mythic',
    'slice9:grant:mythic'
  );

  granted := public.record_dice_copy_grant(
    'd2200000-0000-4220-8220-000000000007',
    'slice9-economy/d6/common@1',
    'reward',
    'slice9:fixture:live-hold',
    'slice9:grant:live-hold'
  );
  perform set_config('slice9.live_hold_copy_id', granted.id::text, true);

  granted := public.record_dice_copy_grant(
    'd2200000-0000-4220-8220-000000000008',
    'slice9-economy/d6/common@1',
    'reward',
    'slice9:fixture:legacy-marker',
    'slice9:grant:legacy-marker'
  );
  perform set_config('slice9.legacy_copy_id', granted.id::text, true);

  granted := public.record_dice_copy_grant(
    'd2200000-0000-4220-8220-000000000009',
    'slice9-economy/d6/common@1',
    'reward',
    'slice9:fixture:corrupt-legacy-marker',
    'slice9:grant:corrupt-legacy-marker'
  );
  perform set_config('slice9.corrupt_legacy_copy_id', granted.id::text, true);

  perform set_config('slice9.scrap_ids', scrap_ids::text, true);
end;
$$;

reset role;

-- Simulate the state left by the pre-0022 marker-only RPC: the immutable Scrap
-- marker exists, but its deterministic earned-Dust wallet append does not.
do $$
begin
  perform private.record_dice_copy_scrap(
    'd2200000-0000-4220-8220-000000000008',
    current_setting('slice9.legacy_copy_id')::uuid,
    'slice9:scrap:legacy-marker'
  );

  if not exists (
       select 1
       from public.dice_copies
       where id = current_setting('slice9.legacy_copy_id')::uuid
         and user_id = 'd2200000-0000-4220-8220-000000000008'
         and scrapped_at is not null
         and scrap_idempotency_key = 'slice9:scrap:legacy-marker'
     ) or
     exists (
       select 1
       from public.wallet_ledger_entries
       where user_id = 'd2200000-0000-4220-8220-000000000008'
         and reason_code = 'dice.scrap.dust.credit'
     ) then
    raise exception 'Legacy marker-only fixture was not isolated';
  end if;

  -- Corrupted pre-0022 fixture: exact immutable marker and deterministic
  -- same-key Dust append with every non-provenance column matching. Required
  -- economy_tier provenance is intentionally absent.
  perform private.record_dice_copy_scrap(
    'd2200000-0000-4220-8220-000000000009',
    current_setting('slice9.corrupt_legacy_copy_id')::uuid,
    'slice9:scrap:corrupt-legacy'
  );
  perform public.append_wallet_ledger_entry(
    'd2200000-0000-4220-8220-000000000009',
    'dust',
    'earned',
    1,
    'dice.scrap.dust.credit',
    'scrap-dust:' || encode(
      extensions.digest(
        convert_to('slice9:scrap:corrupt-legacy', 'UTF8'),
        'sha256'
      ),
      'hex'
    ),
    'earned-collection@1',
    jsonb_build_object(
      'operation', 'scrap',
      'copy_id', current_setting('slice9.corrupt_legacy_copy_id')::uuid,
      'catalog_item_id', 'slice9-economy/d6/common@1',
      'catalog_rarity', 'common',
      'economy_value_version', 1,
      'scrap_idempotency_key', 'slice9:scrap:corrupt-legacy'
    )
  );
end;
$$;

do $$
declare
  target record;
begin
  for target in
    select * from (values
      (
        'd2200000-0000-4220-8220-000000000002'::uuid,
        'dust',
        'earned',
        500::bigint,
        'slice9:seed:dust:craft-happy'
      ),
      (
        'd2200000-0000-4220-8220-000000000005'::uuid,
        'dust',
        'earned',
        100::bigint,
        'slice9:seed:dust:insufficient'
      ),
      (
        'd2200000-0000-4220-8220-000000000006'::uuid,
        'dust',
        'earned',
        3000::bigint,
        'slice9:seed:dust:mythic'
      ),
      (
        'd2200000-0000-4220-8220-000000000007'::uuid,
        'dust',
        'earned',
        500::bigint,
        'slice9:seed:dust:live-hold'
      ),
      (
        'd2200000-0000-4220-8220-000000000007'::uuid,
        'stars',
        'promotional',
        160::bigint,
        'slice9:seed:stars:live-hold'
      )
    ) as seeded(
      user_id,
      currency_id,
      balance_bucket,
      amount,
      idempotency_key
    )
  loop
    perform public.append_wallet_ledger_entry(
      target.user_id,
      target.currency_id,
      target.balance_bucket,
      target.amount,
      'test.slice9.seed',
      target.idempotency_key,
      'earned-collection@1',
      '{}'::jsonb
    );
  end loop;
end;
$$;

-- Cross-owner Scrap fails with 42501 and cannot mark or credit either account.
-- The API role observes only the RPC error; privileged assertions follow reset.
set local "request.jwt.claims" =
  '{"sub":"d2200000-0000-4220-8220-000000000004","is_anonymous":false}';
set local role authenticated;

do $$
begin
  begin
    perform public.scrap_dice_copy(
      current_setting('slice9.craft_happy_original_copy_id')::uuid,
      'slice9:scrap:cross-owner'
    );
    raise exception 'Cross-owner Scrap unexpectedly succeeded';
  exception when sqlstate '42501' then
    null;
  end;
end;
$$;

reset role;

do $$
begin
  if not exists (
       select 1
       from public.dice_copies
       where id = current_setting('slice9.craft_happy_original_copy_id')::uuid
         and user_id = 'd2200000-0000-4220-8220-000000000002'
         and scrapped_at is null
         and scrap_idempotency_key is null
     ) or
     exists (
       select 1
       from public.wallet_ledger_entries
       where user_id = 'd2200000-0000-4220-8220-000000000004'
         and reason_code = 'dice.scrap.dust.credit'
     ) then
    raise exception 'Cross-owner Scrap changed a marker or credited Dust';
  end if;
end;
$$;

-- The valued wrapper upgrades a legacy marker exactly once and exact replay
-- returns the same receipt without a second wallet mutation.
set local "request.jwt.claims" =
  '{"sub":"d2200000-0000-4220-8220-000000000008","is_anonymous":false}';
set local role authenticated;

do $$
declare
  receipt jsonb;
  replay jsonb;
begin
  receipt := public.scrap_dice_copy(
    current_setting('slice9.legacy_copy_id')::uuid,
    'slice9:scrap:legacy-marker'
  );
  replay := public.scrap_dice_copy(
    current_setting('slice9.legacy_copy_id')::uuid,
    'slice9:scrap:legacy-marker'
  );

  if replay::text is distinct from receipt::text or
     (receipt ->> 'dust_credited')::bigint <> 1 then
    raise exception 'Legacy marker upgrade or exact replay receipt drifted';
  end if;

  perform set_config('slice9.legacy_receipt', receipt::text, true);
end;
$$;

reset role;

do $$
begin
  if (select count(*)
      from public.wallet_ledger_entries
      where user_id = 'd2200000-0000-4220-8220-000000000008'
        and reason_code = 'dice.scrap.dust.credit'
        and delta_amount = 1) <> 1 or
     (select current_balance
      from public.wallet_balances
      where user_id = 'd2200000-0000-4220-8220-000000000008'
        and currency_id = 'dust'
        and balance_bucket = 'earned') <> 1 or
     (current_setting('slice9.legacy_receipt')::jsonb ->>
       'economy_value_version')::integer <> 1 then
    raise exception 'Legacy marker wrapper did not append Dust exactly once';
  end if;
end;
$$;

-- A deterministic wallet row with missing required provenance is corruption,
-- not an upgrade candidate. Exact replay fails closed and adds no mutation.
set local "request.jwt.claims" =
  '{"sub":"d2200000-0000-4220-8220-000000000009","is_anonymous":false}';
set local role authenticated;

do $$
begin
  begin
    perform public.scrap_dice_copy(
      current_setting('slice9.corrupt_legacy_copy_id')::uuid,
      'slice9:scrap:corrupt-legacy'
    );
    raise exception 'Corrupted legacy-marker replay unexpectedly succeeded';
  exception when sqlstate '55000' then
    null;
  end;
end;
$$;

reset role;

do $$
begin
  if (select count(*)
      from public.wallet_ledger_entries
      where user_id = 'd2200000-0000-4220-8220-000000000009'
        and reason_code = 'dice.scrap.dust.credit'
        and delta_amount = 1) <> 1 or
     (select current_balance
      from public.wallet_balances
      where user_id = 'd2200000-0000-4220-8220-000000000009'
        and currency_id = 'dust'
        and balance_bucket = 'earned') <> 1 or
     (select count(*)
      from public.dice_copies
      where user_id = 'd2200000-0000-4220-8220-000000000009') <> 1 or
     not exists (
       select 1
       from public.dice_copies
       where id = current_setting('slice9.corrupt_legacy_copy_id')::uuid
         and scrapped_at is not null
         and scrap_idempotency_key = 'slice9:scrap:corrupt-legacy'
     ) then
    raise exception 'Corrupted replay added a wallet or copy mutation';
  end if;
end;
$$;

-- Scrap every actual catalog rarity and prove exact replay/payload drift at the
-- authenticated boundary. No privileged tables are read under this role.
set local "request.jwt.claims" =
  '{"sub":"d2200000-0000-4220-8220-000000000001","is_anonymous":false}';
set local role authenticated;

do $$
declare
  target record;
  receipt jsonb;
  receipts jsonb := '{}'::jsonb;
  replay jsonb;
begin
  for target in
    select key as catalog_rarity, value::text::uuid as copy_id
    from jsonb_each_text(current_setting('slice9.scrap_ids')::jsonb)
  loop
    receipt := public.scrap_dice_copy(
      target.copy_id,
      'slice9:scrap:' || target.catalog_rarity
    );
    receipts := receipts || jsonb_build_object(
      target.catalog_rarity,
      receipt
    );
  end loop;

  replay := public.scrap_dice_copy(
    (current_setting('slice9.scrap_ids')::jsonb ->> 'common')::uuid,
    'slice9:scrap:common'
  );

  if replay is distinct from receipts -> 'common' then
    raise exception 'Scrap exact replay drifted';
  end if;

  begin
    perform public.scrap_dice_copy(
      (current_setting('slice9.scrap_ids')::jsonb ->> 'uncommon')::uuid,
      'slice9:scrap:common'
    );
    raise exception 'Scrap replay with a different copy unexpectedly succeeded';
  exception when sqlstate '22023' then
    null;
  end;

  perform set_config('slice9.scrap_receipts', receipts::text, true);
end;
$$;

reset role;

do $$
declare
  expected record;
  receipts jsonb := current_setting('slice9.scrap_receipts')::jsonb;
begin
  for expected in
    select * from (values
      ('common', 1::bigint),
      ('uncommon', 1::bigint),
      ('rare', 4::bigint),
      ('epic', 10::bigint),
      ('legendary', 25::bigint),
      ('mythic', 50::bigint)
    ) as expected_values(catalog_rarity, scrap_yield)
  loop
    if (receipts -> expected.catalog_rarity ->> 'dust_credited')::bigint
         is distinct from expected.scrap_yield or
       (select count(*)
        from public.wallet_ledger_entries
        where user_id = 'd2200000-0000-4220-8220-000000000001'
          and reason_code = 'dice.scrap.dust.credit'
          and delta_amount = expected.scrap_yield
          and provenance ->> 'catalog_rarity' = expected.catalog_rarity) <> 1 or
       not exists (
         select 1
         from public.dice_copies
         where user_id = 'd2200000-0000-4220-8220-000000000001'
           and catalog_item_id =
             'slice9-economy/d6/' || expected.catalog_rarity || '@1'
           and scrapped_at is not null
           and scrap_idempotency_key =
             'slice9:scrap:' || expected.catalog_rarity
       ) then
      raise exception 'Scrap marker or exact Dust credit drifted for %',
        expected.catalog_rarity;
    end if;
  end loop;

  if (select current_balance
      from public.wallet_balances
      where user_id = 'd2200000-0000-4220-8220-000000000001'
        and currency_id = 'dust'
        and balance_bucket = 'earned') is distinct from 91 or
     (select count(*)
      from public.wallet_ledger_entries
      where user_id = 'd2200000-0000-4220-8220-000000000001'
        and reason_code = 'dice.scrap.dust.credit') <> 6 then
    raise exception 'Scrap replay credited Dust more than once';
  end if;
end;
$$;

-- Happy craft: exact debit, one extra live copy, source_kind/acquired_via
-- craft, immutable false first-copy flag, and exact idempotent receipt replay.
set local "request.jwt.claims" =
  '{"sub":"d2200000-0000-4220-8220-000000000002","is_anonymous":false}';
set local role authenticated;

do $$
declare
  receipt jsonb;
  replay jsonb;
begin
  receipt := public.craft_dice_copy(
    'slice9-economy/d6/common@1',
    'slice9:craft:happy'
  );
  replay := public.craft_dice_copy(
    'slice9-economy/d6/common@1',
    'slice9:craft:happy'
  );

  if replay is distinct from receipt or
     (receipt ->> 'dust_debited')::bigint is distinct from 210 or
     receipt ->> 'acquired_via' is distinct from 'craft' or
     (receipt ->> 'is_first_copy')::boolean is distinct from false then
    raise exception 'Craft happy path or exact replay drifted';
  end if;

  begin
    perform public.craft_dice_copy(
      'slice9-economy/d6/rare@1',
      'slice9:craft:happy'
    );
    raise exception 'Craft replay with a different catalog item unexpectedly succeeded';
  exception when sqlstate '55000' then
    null;
  end;

  perform set_config('slice9.craft_happy_receipt', receipt::text, true);
end;
$$;

reset role;

do $$
begin
  if (select current_balance
      from public.wallet_balances
      where user_id = 'd2200000-0000-4220-8220-000000000002'
        and currency_id = 'dust'
        and balance_bucket = 'earned') <> 290 or
     (select count(*)
      from public.wallet_ledger_entries
      where user_id = 'd2200000-0000-4220-8220-000000000002'
        and reason_code = 'dice.craft.dust.debit'
        and delta_amount = -210) <> 1 or
     (select count(*)
      from public.dice_copies
      where user_id = 'd2200000-0000-4220-8220-000000000002'
        and catalog_item_id = 'slice9-economy/d6/common@1'
        and scrapped_at is null) <> 2 or
     not exists (
       select 1
       from public.dice_copies
       where id =
         (current_setting('slice9.craft_happy_receipt')::jsonb ->> 'copy_id')::uuid
         and user_id = 'd2200000-0000-4220-8220-000000000002'
         and source_kind = 'craft'
         and is_first_copy is false
     ) then
    raise exception 'Craft debit or copy grant was not exactly once';
  end if;
end;
$$;

-- Retune the common values with a real version bump. Both existing Scrap and
-- craft idempotency receipts must remain byte-identical and must not mutate
-- wallet or inventory again. Restore the economic values afterward with the
-- next required version.
set local role service_role;

update public.dice_economy_values
set scrap_yield = 2,
    craft_cost = 211,
    value_version = 2
where economy_tier = 'standard';

reset role;

do $$
begin
  if (select count(*)
      from public.dice_economy_values
      where economy_tier = 'standard'
        and scrap_yield = 2
        and craft_cost = 211
        and value_version = 2) <> 2 then
    raise exception 'Atomic standard-tier retune did not update both rarity rows';
  end if;
end;
$$;

set local "request.jwt.claims" =
  '{"sub":"d2200000-0000-4220-8220-000000000001","is_anonymous":false}';
set local role authenticated;

do $$
declare
  replay jsonb;
  original jsonb :=
    current_setting('slice9.scrap_receipts')::jsonb -> 'common';
begin
  replay := public.scrap_dice_copy(
    (current_setting('slice9.scrap_ids')::jsonb ->> 'common')::uuid,
    'slice9:scrap:common'
  );
  if replay::text is distinct from original::text then
    raise exception 'Scrap replay changed after a service retune';
  end if;
end;
$$;

reset role;
set local "request.jwt.claims" =
  '{"sub":"d2200000-0000-4220-8220-000000000002","is_anonymous":false}';
set local role authenticated;

do $$
declare
  replay jsonb;
  original jsonb := current_setting('slice9.craft_happy_receipt')::jsonb;
begin
  replay := public.craft_dice_copy(
    'slice9-economy/d6/common@1',
    'slice9:craft:happy'
  );
  if replay::text is distinct from original::text then
    raise exception 'Craft replay changed after a service retune';
  end if;
end;
$$;

reset role;

do $$
begin
  if (select count(*)
      from public.wallet_ledger_entries
      where user_id = 'd2200000-0000-4220-8220-000000000001'
        and reason_code = 'dice.scrap.dust.credit'
        and provenance ->> 'catalog_rarity' = 'common') <> 1 or
     (select count(*)
      from public.wallet_ledger_entries
      where user_id = 'd2200000-0000-4220-8220-000000000002'
        and reason_code = 'dice.craft.dust.debit') <> 1 or
     (select count(*)
      from public.dice_copies
      where user_id = 'd2200000-0000-4220-8220-000000000002'
        and catalog_item_id = 'slice9-economy/d6/common@1') <> 2 then
    raise exception 'A post-retune replay repeated a wallet or copy mutation';
  end if;
end;
$$;

set local role service_role;

update public.dice_economy_values
set scrap_yield = 1,
    craft_cost = 210,
    value_version = 3
where economy_tier = 'standard';

reset role;

do $$
begin
  if not exists (
    select 1
    from public.dice_economy_values
    where catalog_rarity = 'common'
      and scrap_yield = 1
      and craft_cost = 210
      and value_version = 3
  ) or
     (select count(*)
      from public.dice_economy_values
      where economy_tier = 'standard'
        and scrap_yield = 1
        and craft_cost = 210
        and value_version = 3) <> 2 then
    raise exception 'Standard economy values were not restored after replay proof';
  end if;
end;
$$;

-- Crafting a die whose retained history exists but whose live count is zero is
-- rejected. The Scrap call also exercises the valued wrapper on another user.
set local "request.jwt.claims" =
  '{"sub":"d2200000-0000-4220-8220-000000000003","is_anonymous":false}';
set local role authenticated;

do $$
begin
  perform public.scrap_dice_copy(
    current_setting('slice9.zero_live_copy_id')::uuid,
    'slice9:scrap:zero-live'
  );

  begin
    perform public.craft_dice_copy(
      'slice9-economy/d6/rare@1',
      'slice9:craft:zero-live'
    );
    raise exception 'Zero-live-copy craft unexpectedly succeeded';
  exception when sqlstate '55000' then
    null;
  end;
end;
$$;

reset role;

-- Never-owned is also rejected; an ever-owned latch is not created by failure.
set local "request.jwt.claims" =
  '{"sub":"d2200000-0000-4220-8220-000000000004","is_anonymous":false}';
set local role authenticated;

do $$
begin
  begin
    perform public.craft_dice_copy(
      'slice9-economy/d6/common@1',
      'slice9:craft:never-owned'
    );
    raise exception 'Never-owned craft unexpectedly succeeded';
  exception when sqlstate '55000' then
    null;
  end;
end;
$$;

reset role;

-- The canonical wallet append rejects an earned-Dust overdraft with 22003 and
-- the failed transaction grants no copy.
set local "request.jwt.claims" =
  '{"sub":"d2200000-0000-4220-8220-000000000005","is_anonymous":false}';
set local role authenticated;

do $$
begin
  begin
    perform public.craft_dice_copy(
      'slice9-economy/d6/epic@1',
      'slice9:craft:insufficient'
    );
    raise exception 'Insufficient-Dust craft unexpectedly succeeded';
  exception when sqlstate '22003' then
    null;
  end;
end;
$$;

reset role;

-- Mythic is scrappable but its NULL craft cost is an explicit policy rejection.
set local "request.jwt.claims" =
  '{"sub":"d2200000-0000-4220-8220-000000000006","is_anonymous":false}';
set local role authenticated;

do $$
begin
  begin
    perform public.craft_dice_copy(
      'slice9-economy/d6/mythic@1',
      'slice9:craft:mythic'
    );
    raise exception 'Mythic craft unexpectedly succeeded';
  exception when sqlstate '55000' then
    null;
  end;
end;
$$;

reset role;

do $$
begin
  if exists (
       select 1
       from public.dice_copies
       where user_id in (
         'd2200000-0000-4220-8220-000000000004',
         'd2200000-0000-4220-8220-000000000005',
         'd2200000-0000-4220-8220-000000000006'
       )
         and source_kind = 'craft'
     ) or
     exists (
       select 1
       from public.wallet_ledger_entries
       where user_id in (
         'd2200000-0000-4220-8220-000000000004',
         'd2200000-0000-4220-8220-000000000005',
         'd2200000-0000-4220-8220-000000000006'
       )
         and reason_code = 'dice.craft.dust.debit'
     ) or
     (select current_balance
      from public.wallet_balances
      where user_id = 'd2200000-0000-4220-8220-000000000005'
        and currency_id = 'dust'
        and balance_bucket = 'earned') <> 100 or
     (select current_balance
      from public.wallet_balances
      where user_id = 'd2200000-0000-4220-8220-000000000006'
        and currency_id = 'dust'
        and balance_bucket = 'earned') <> 3000 then
    raise exception 'A rejected craft mutated inventory or earned Dust';
  end if;
end;
$$;

-- 0021's existing copy mutation triggers freeze both craft and valued Scrap
-- during a live pull hold. The attempted wallet changes roll back with each
-- rejected copy mutation; Scrap succeeds only after the hold is terminated.
set local "request.jwt.claims" =
  '{"sub":"d2200000-0000-4220-8220-000000000007","is_anonymous":false}';
set local role authenticated;

do $$
declare
  prepared record;
  scrap_receipt jsonb;
begin
  select *
  into strict prepared
  from public.prepare_pull(
    'earned-collection-001@1',
    1::smallint,
    'slice9:hold:prepare'
  );

  begin
    perform public.craft_dice_copy(
      'slice9-economy/d6/common@1',
      'slice9:craft:during-hold'
    );
    raise exception 'Craft during a live hold unexpectedly succeeded';
  exception when sqlstate '55000' then
    null;
  end;

  begin
    perform public.scrap_dice_copy(
      current_setting('slice9.live_hold_copy_id')::uuid,
      'slice9:scrap:during-hold'
    );
    raise exception 'Scrap during a live hold unexpectedly succeeded';
  exception when sqlstate '55000' then
    null;
  end;

  perform public.cancel_pull_session(prepared.session_id);

  scrap_receipt := public.scrap_dice_copy(
    current_setting('slice9.live_hold_copy_id')::uuid,
    'slice9:scrap:after-hold'
  );

  if (scrap_receipt ->> 'dust_credited')::bigint is distinct from 1 then
    raise exception 'Scrap after hold termination credited the wrong Dust';
  end if;
end;
$$;

reset role;

do $$
begin
  if (select current_balance
      from public.wallet_balances
      where user_id = 'd2200000-0000-4220-8220-000000000007'
        and currency_id = 'dust'
        and balance_bucket = 'earned') is distinct from 501 or
     exists (
       select 1
       from public.wallet_ledger_entries
       where user_id = 'd2200000-0000-4220-8220-000000000007'
         and reason_code = 'dice.craft.dust.debit'
     ) or
     exists (
       select 1
       from public.wallet_ledger_entries
       where user_id = 'd2200000-0000-4220-8220-000000000007'
         and provenance ->> 'scrap_idempotency_key' =
           'slice9:scrap:during-hold'
     ) or
     (select count(*)
      from public.wallet_ledger_entries
      where user_id = 'd2200000-0000-4220-8220-000000000007'
        and reason_code = 'dice.scrap.dust.credit'
        and delta_amount = 1
        and provenance ->> 'scrap_idempotency_key' =
          'slice9:scrap:after-hold') <> 1 or
     exists (
       select 1
       from public.dice_copies
       where user_id = 'd2200000-0000-4220-8220-000000000007'
         and source_kind = 'craft'
     ) then
    raise exception 'Live-hold craft or Scrap rollback/success invariant drifted';
  end if;
end;
$$;

-- Scrap the just-crafted copy. The live table itself proves every craftable
-- row has scrap_yield < craft_cost, and the happy user ends at 500-210+1=291.
set local "request.jwt.claims" =
  '{"sub":"d2200000-0000-4220-8220-000000000002","is_anonymous":false}';
set local role authenticated;

do $$
begin
  perform public.scrap_dice_copy(
    (current_setting('slice9.craft_happy_receipt')::jsonb ->> 'copy_id')::uuid,
    'slice9:scrap:crafted-copy'
  );
end;
$$;

reset role;

do $$
begin
  if exists (
       select 1
       from public.dice_economy_values
       where craft_cost is not null
         and scrap_yield >= craft_cost
     ) or
     (select current_balance
      from public.wallet_balances
      where user_id = 'd2200000-0000-4220-8220-000000000002'
        and currency_id = 'dust'
        and balance_bucket = 'earned') <> 291 or
     (select coalesce(sum(delta_amount), 0)
      from public.wallet_ledger_entries
      where user_id = 'd2200000-0000-4220-8220-000000000002'
        and reason_code in (
          'dice.craft.dust.debit',
          'dice.scrap.dust.credit'
        )) <> -209 then
    raise exception 'Craft-then-scrap did not remain a net Dust sink';
  end if;
end;
$$;

rollback;
