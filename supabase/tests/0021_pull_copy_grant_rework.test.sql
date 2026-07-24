begin;

insert into auth.users (id) values
  ('d2100000-0000-4210-8210-000000000001'),
  ('d2100000-0000-4210-8210-000000000002'),
  ('d2100000-0000-4210-8210-000000000003'),
  ('d2100000-0000-4210-8210-000000000004');

insert into public.catalog_items (
  id,
  catalog_key,
  contract_version,
  item_kind,
  set_id,
  dice_type,
  rarity
) values (
  'slice8-copy/d20/signature@1',
  'slice8-copy/d20/signature',
  1,
  'die',
  'slice8-copy',
  'd20',
  'legendary'
);

insert into public.pull_banner_families (id)
values ('slice8-copy-core');

insert into public.pull_banner_versions (
  id,
  banner_id,
  banner_version,
  banner_family_id,
  economy_edition_id,
  source_config_sha256,
  hold_policy_id,
  currency_id,
  balance_bucket,
  duplicate_currency_id,
  duplicate_balance_bucket,
  weight_scale,
  rare_minimum_rank,
  rare_hard_guarantee_pull,
  epic_minimum_rank,
  epic_hard_guarantee_pull,
  selected_minimum_rank,
  selected_hard_guarantee_pull,
  resolution_order,
  banner_class,
  roll_type
) values (
  'slice8-copy-core@1',
  'slice8-copy-core',
  1,
  'slice8-copy-core',
  'earned-collection@1',
  repeat('8', 64),
  'pull-hold@1',
  'stars',
  'promotional',
  'dust',
  'earned',
  100,
  1,
  8,
  2,
  1,
  3,
  1,
  array[
    'selected-featured-unowned',
    'epic-or-better',
    'rare-or-better',
    'base'
  ]::text[],
  'standard',
  null
);

insert into public.pull_banner_offers (
  banner_version_id,
  pull_count,
  cost
) values
  ('slice8-copy-core@1', 1, 160),
  ('slice8-copy-core@1', 2, 320);

insert into public.pull_banner_tiers (
  banner_version_id,
  tier_id,
  tier_rank,
  weight_units,
  duplicate_dust
) values (
  'slice8-copy-core@1',
  'signature',
  3,
  100,
  17
);

insert into public.pull_banner_items (
  banner_version_id,
  tier_id,
  tier_rank,
  canonical_order,
  catalog_item_id,
  selected_featured
) values (
  'slice8-copy-core@1',
  'signature',
  3,
  1,
  'slice8-copy/d20/signature@1',
  true
);

do $$
declare
  target record;
begin
  for target in
    select * from (values
      (
        'd2100000-0000-4210-8210-000000000001'::uuid,
        480::bigint,
        'slice8:seed:main'
      ),
      (
        'd2100000-0000-4210-8210-000000000002'::uuid,
        160::bigint,
        'slice8:seed:commit-hold'
      ),
      (
        'd2100000-0000-4210-8210-000000000003'::uuid,
        160::bigint,
        'slice8:seed:cancel-hold'
      ),
      (
        'd2100000-0000-4210-8210-000000000004'::uuid,
        160::bigint,
        'slice8:seed:fully-owned'
      )
    ) as seeded(user_id, stars, idempotency_key)
  loop
    perform public.append_wallet_ledger_entry(
      target.user_id,
      'stars',
      'promotional',
      target.stars,
      'test.slice8.seed',
      target.idempotency_key,
      'earned-collection@1',
      '{}'::jsonb
    );
  end loop;
end;
$$;

-- Existing copies drive deterministic duplicate, hold, and fully-owned cases.
set local role service_role;

do $$
declare
  target record;
  granted public.dice_copies%rowtype;
begin
  for target in
    select * from (values
      (
        'd2100000-0000-4210-8210-000000000002'::uuid,
        'slice8:fixture:commit-hold',
        'slice8:grant:commit-hold'
      ),
      (
        'd2100000-0000-4210-8210-000000000003'::uuid,
        'slice8:fixture:cancel-hold',
        'slice8:grant:cancel-hold'
      ),
      (
        'd2100000-0000-4210-8210-000000000004'::uuid,
        'slice8:fixture:fully-owned',
        'slice8:grant:fully-owned'
      )
    ) as fixtures(user_id, source_reference, idempotency_key)
  loop
    granted := public.record_dice_copy_grant(
      target.user_id,
      'slice8-copy/d20/signature@1',
      'reward',
      target.source_reference,
      target.idempotency_key
    );
    if granted.is_first_copy is distinct from true then
      raise exception 'Pre-owned fixture did not latch its first-ever copy';
    end if;
  end loop;
end;
$$;

reset role;

-- One two-result commit deterministically proves first copy, duplicate copy
-- plus Dust, and exact replay including the first-copy flags.
set local "request.jwt.claims" =
  '{"sub":"d2100000-0000-4210-8210-000000000001","is_anonymous":false}';
set local role authenticated;

do $$
declare
  prepared record;
  receipt jsonb;
  replay jsonb;
begin
  select * into strict prepared
  from public.prepare_pull(
    'slice8-copy-core@1',
    2::smallint,
    'slice8:main:prepare:0001'
  );

  receipt := public.commit_pull_session(prepared.session_id);
  replay := public.commit_pull_session(prepared.session_id);

  if replay is distinct from receipt or
     jsonb_array_length(receipt -> 'results') <> 2 or
     (receipt #>> '{results,0,is_duplicate}')::boolean is distinct from false or
     (receipt #>> '{results,0,is_first_copy}')::boolean is distinct from true or
     (receipt #>> '{results,1,is_duplicate}')::boolean is distinct from true or
     (receipt #>> '{results,1,is_first_copy}')::boolean is distinct from false or
     (receipt #>> '{results,1,duplicate_dust_amount}')::bigint <> 17 then
    raise exception 'Copy-plus-Dust commit or exact replay receipt drifted';
  end if;

  perform set_config('slice8.main_receipt', receipt::text, true);
end;
$$;

reset role;

do $$
begin
  if (select count(*)
      from public.dice_copies
      where user_id = 'd2100000-0000-4210-8210-000000000001'
        and catalog_item_id = 'slice8-copy/d20/signature@1'
        and source_kind = 'pull'
        and scrapped_at is null) <> 2 or
     (select count(*)
      from public.dice_copies
      where user_id = 'd2100000-0000-4210-8210-000000000001'
        and catalog_item_id = 'slice8-copy/d20/signature@1'
        and is_first_copy) <> 1 or
     (select current_balance
      from public.wallet_balances
      where user_id = 'd2100000-0000-4210-8210-000000000001'
        and currency_id = 'dust'
        and balance_bucket = 'earned') <> 17 or
     (select count(*)
      from public.wallet_ledger_entries
      where user_id = 'd2100000-0000-4210-8210-000000000001'
        and reason_code = 'pull.commit.duplicate_dust.credit'
        and delta_amount = 17) <> 1 or
     exists (
       select 1
       from public.user_entitlements
       where user_id = 'd2100000-0000-4210-8210-000000000001'
         and catalog_item_id = 'slice8-copy/d20/signature@1'
         and grant_reason = 'pull'
     ) then
    raise exception 'Committed duplicate did not grant two copies plus one Dust append';
  end if;
end;
$$;

-- Scrap every live copy after the terminal commit. The next seal sees zero live
-- copies (non-duplicate), while the retained ever-owned latch must not re-fire.
do $$
declare
  copy_ids jsonb;
begin
  select jsonb_agg(id::text order by acquired_at, id)
  into strict copy_ids
  from public.dice_copies
  where user_id = 'd2100000-0000-4210-8210-000000000001'
    and scrapped_at is null;

  if copy_ids is null or jsonb_array_length(copy_ids) <> 2 then
    raise exception 'Scrap-all fixture did not expose exactly two live copies';
  end if;

  perform set_config('slice8.scrap_all_copy_ids', copy_ids::text, true);
end;
$$;

set local "request.jwt.claims" =
  '{"sub":"d2100000-0000-4210-8210-000000000001","is_anonymous":false}';
set local role authenticated;

do $$
declare
  copy_id uuid;
  prepared record;
begin
  for copy_id in
    select value::uuid
    from jsonb_array_elements_text(
      current_setting('slice8.scrap_all_copy_ids')::jsonb
    ) as copy_ids(value)
  loop
    perform public.scrap_dice_copy_marker(
      copy_id,
      'slice8:scrap-all:' || copy_id::text
    );
  end loop;

  select * into strict prepared
  from public.prepare_pull(
    'slice8-copy-core@1',
    1::smallint,
    'slice8:main:prepare:0002'
  );

  perform set_config('slice8.scrap_all_session', prepared.session_id::text, true);
end;
$$;

reset role;

do $$
begin
  if not exists (
    select 1
    from public.sealed_pull_results
    where session_id = current_setting('slice8.scrap_all_session')::uuid
      and is_duplicate is false
  ) then
    raise exception 'Re-pull after scrap-all did not seal as non-duplicate';
  end if;
end;
$$;

set local role authenticated;

do $$
declare
  receipt jsonb;
begin
  receipt := public.commit_pull_session(
    current_setting('slice8.scrap_all_session')::uuid
  );
  if (receipt #>> '{results,0,is_duplicate}')::boolean is distinct from false or
     (receipt #>> '{results,0,is_first_copy}')::boolean is distinct from false then
    raise exception 'Re-pull after scrap-all re-fired the ever-owned latch';
  end if;
end;
$$;

reset role;

do $$
begin
  if (select count(*)
      from public.dice_copies
      where user_id = 'd2100000-0000-4210-8210-000000000001'
        and catalog_item_id = 'slice8-copy/d20/signature@1') <> 3 or
     (select count(*)
      from public.dice_copies
      where user_id = 'd2100000-0000-4210-8210-000000000001'
        and catalog_item_id = 'slice8-copy/d20/signature@1'
        and scrapped_at is null) <> 1 or
     (select count(*)
      from public.dice_copies
      where user_id = 'd2100000-0000-4210-8210-000000000001'
        and catalog_item_id = 'slice8-copy/d20/signature@1'
        and is_first_copy) <> 1 then
    raise exception 'Scrap-all and re-pull history lost live-count or latch semantics';
  end if;
end;
$$;

-- A live hold blocks both a new service grant and a scrap account-wide. Once
-- committed, the same pre-existing copy may be scrapped.
do $$
declare
  copy_id uuid;
begin
  select id into strict copy_id
  from public.dice_copies
  where user_id = 'd2100000-0000-4210-8210-000000000002'
    and scrapped_at is null;

  perform set_config('slice8.commit_hold_copy', copy_id::text, true);
end;
$$;

set local "request.jwt.claims" =
  '{"sub":"d2100000-0000-4210-8210-000000000002","is_anonymous":false}';
set local role authenticated;

do $$
declare
  prepared record;
begin
  select * into strict prepared
  from public.prepare_pull(
    'slice8-copy-core@1',
    1::smallint,
    'slice8:commit-hold:prepare'
  );

  begin
    perform public.scrap_dice_copy_marker(
      current_setting('slice8.commit_hold_copy')::uuid,
      'slice8:scrap:commit-hold:blocked'
    );
    raise exception 'Scrap during a live hold unexpectedly succeeded';
  exception when sqlstate '55000' then
    null;
  end;

  perform set_config('slice8.commit_hold_session', prepared.session_id::text, true);
end;
$$;

reset role;
set local role service_role;

do $$
begin
  begin
    perform public.record_dice_copy_grant(
      'd2100000-0000-4210-8210-000000000002',
      'slice8-copy/d20/signature@1',
      'reward',
      'slice8:grant:during-hold',
      'slice8:grant:during-hold'
    );
    raise exception 'Service grant during a live hold unexpectedly succeeded';
  exception when sqlstate '55000' then
    null;
  end;
end;
$$;

reset role;
set local "request.jwt.claims" =
  '{"sub":"d2100000-0000-4210-8210-000000000002","is_anonymous":false}';
set local role authenticated;

do $$
begin
  perform public.commit_pull_session(
    current_setting('slice8.commit_hold_session')::uuid
  );
  perform public.scrap_dice_copy_marker(
    current_setting('slice8.commit_hold_copy')::uuid,
    'slice8:scrap:commit-hold:allowed'
  );
end;
$$;

reset role;

-- Cancellation also releases the account-wide scrap exclusion without a grant.
do $$
declare
  copy_id uuid;
begin
  select id into strict copy_id
  from public.dice_copies
  where user_id = 'd2100000-0000-4210-8210-000000000003'
    and scrapped_at is null;

  perform set_config('slice8.cancel_hold_copy', copy_id::text, true);
end;
$$;

set local "request.jwt.claims" =
  '{"sub":"d2100000-0000-4210-8210-000000000003","is_anonymous":false}';
set local role authenticated;

do $$
declare
  prepared record;
begin
  select * into strict prepared
  from public.prepare_pull(
    'slice8-copy-core@1',
    1::smallint,
    'slice8:cancel-hold:prepare'
  );

  begin
    perform public.scrap_dice_copy_marker(
      current_setting('slice8.cancel_hold_copy')::uuid,
      'slice8:scrap:cancel-hold:blocked'
    );
    raise exception 'Scrap during the cancellable live hold unexpectedly succeeded';
  exception when sqlstate '55000' then
    null;
  end;

  perform public.cancel_pull_session(prepared.session_id);
  perform public.scrap_dice_copy_marker(
    current_setting('slice8.cancel_hold_copy')::uuid,
    'slice8:scrap:cancel-hold:allowed'
  );
end;
$$;

reset role;

-- Fully owned featured inventory produces no selected target. With both hard
-- thresholds due, the existing resolution order falls through to epic.
set local "request.jwt.claims" =
  '{"sub":"d2100000-0000-4210-8210-000000000004","is_anonymous":false}';
set local role authenticated;

do $$
declare
  prepared record;
begin
  select * into strict prepared
  from public.prepare_pull(
    'slice8-copy-core@1',
    1::smallint,
    'slice8:fully-owned:prepare'
  );

  perform set_config('slice8.fully_owned_session', prepared.session_id::text, true);
end;
$$;

reset role;

do $$
begin
  if not exists (
    select 1
    from public.sealed_pull_results
    where session_id = current_setting('slice8.fully_owned_session')::uuid
      and selected_target_catalog_item_id is null
      and resolution_reason = 'epic-guarantee'
      and is_duplicate
      and selected_misses_before = 0
      and selected_misses_after = 1
  ) or (select selected_misses_projected
        from public.pull_sessions
        where id = current_setting('slice8.fully_owned_session')::uuid) <> 1 then
    raise exception 'Fully owned featured inventory armed selected guarantee';
  end if;
end;
$$;

rollback;
