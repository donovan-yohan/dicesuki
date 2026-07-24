begin;

insert into auth.users (id) values
  ('81111111-1111-4111-8111-111111111111'),
  ('82222222-2222-4222-8222-222222222222'),
  ('83333333-3333-4333-8333-333333333333'),
  ('84444444-4444-4444-8444-444444444444'),
  ('85555555-5555-4555-8555-555555555555'),
  ('86666666-6666-4666-8666-666666666666'),
  ('87777777-7777-4777-8777-777777777777'),
  ('88888888-8888-4888-8888-888888888888'),
  ('89999999-9999-4999-8999-999999999999'),
  ('8aaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'),
  ('8bbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb');

-- The normalized version is exactly the immutable edition pool. An appended
-- catalog row must not leak into the already-published banner version.
insert into public.catalog_items (
  id, catalog_key, contract_version, item_kind, set_id, dice_type, rarity
) values (
  'future-catalog/d20/legendary@1',
  'future-catalog/d20/legendary',
  1,
  'die',
  'future-catalog',
  'd20',
  'legendary'
);

-- Reusable pricing schema accepts a new version and new amounts without
-- altering historical constraints. The current v1 still exposes only its
-- exact normalized one- and ten-pull offers.
insert into public.pull_banner_versions (
  id, banner_id, banner_version, banner_family_id, economy_edition_id,
  source_config_sha256, hold_policy_id, currency_id, balance_bucket,
  duplicate_currency_id, duplicate_balance_bucket, weight_scale,
  rare_minimum_rank, rare_hard_guarantee_pull,
  epic_minimum_rank, epic_hard_guarantee_pull,
  selected_minimum_rank, selected_hard_guarantee_pull, resolution_order
) values (
  'test-pricing@1', 'test-pricing', 1, 'earned-collection', 'earned-collection@1',
  '6e198c0f3a3a96975ada45b27334583b5c17d84549db9eefe4e3671b296aba09',
  'pull-hold@1', 'stars', 'promotional', 'dust', 'earned', 100,
  1, 8, 2, 25, 3, 20,
  array['selected-featured-unowned', 'epic-or-better', 'rare-or-better', 'base']::text[]
);
insert into public.pull_banner_offers (banner_version_id, pull_count, cost)
values
  ('test-pricing@1', 1, 175),
  ('test-pricing@1', 5, 825),
  ('test-pricing@1', 10, 1725);

do $$
begin
  if not exists (
    select 1
    from public.pull_hold_policy_versions
    where id = 'pull-hold@1'
      and policy_version = 1
      and hold_ttl_seconds = 120
  ) then
    raise exception 'The versioned 0011 hold policy is not exactly 120 seconds';
  end if;

  if not exists (
    select 1
    from public.pull_banner_versions
    where id = 'earned-collection-001@1'
      and banner_id = 'earned-collection-001'
      and banner_version = 1
      and banner_family_id = 'earned-collection'
      and economy_edition_id = 'earned-collection@1'
      and source_config_sha256 = '6e198c0f3a3a96975ada45b27334583b5c17d84549db9eefe4e3671b296aba09'
      and hold_policy_id = 'pull-hold@1'
      and currency_id = 'stars'
      and balance_bucket = 'promotional'
      and duplicate_currency_id = 'dust'
      and duplicate_balance_bucket = 'earned'
      and weight_scale = 100
      and rare_minimum_rank = 1
      and rare_hard_guarantee_pull = 8
      and epic_minimum_rank = 2
      and epic_hard_guarantee_pull = 25
      and selected_minimum_rank = 3
      and selected_hard_guarantee_pull = 20
      and resolution_order = array[
        'selected-featured-unowned', 'epic-or-better', 'rare-or-better', 'base'
      ]::text[]
  ) then
    raise exception 'Normalized banner version drifted from earned-collection@1';
  end if;

  if (select config #>> '{acquisition,banner,guarantees,selectedFeaturedUnowned,selection}'
      from public.economy_editions where id = 'earned-collection@1') <>
     'lowest-canonical-id-unowned' then
    raise exception 'Selected guarantee selection contract drifted from lowest canonical unowned';
  end if;

  if (select count(*) from public.pull_banner_offers where banner_version_id = 'earned-collection-001@1') <> 2 or
     not exists (
       select 1 from public.pull_banner_offers
       where banner_version_id = 'earned-collection-001@1' and pull_count = 1 and cost = 160
     ) or
     not exists (
       select 1 from public.pull_banner_offers
       where banner_version_id = 'earned-collection-001@1' and pull_count = 10 and cost = 1600
     ) then
    raise exception 'Normalized banner offers drifted from earned-collection@1';
  end if;

  if not exists (
    select 1 from public.pull_banner_offers
    where banner_version_id = 'test-pricing@1' and pull_count = 5 and cost = 825
  ) then
    raise exception 'Future version could not append a new count and changed price';
  end if;

  if exists (
    with source as (
      select
        tier.value ->> 'tierId' as tier_id,
        (tier.value ->> 'rank')::smallint as tier_rank,
        (tier.value ->> 'weightUnits')::integer as weight_units,
        (edition.config #>> array[
          'duplicateConversion', 'amountByTier', tier.value ->> 'tierId'
        ])::bigint as duplicate_dust,
        item.ordinality::integer as canonical_order,
        item.catalog_item_id
      from public.economy_editions as edition
      cross join lateral jsonb_array_elements(
        edition.config #> '{acquisition,banner,tiers}'
      ) as tier(value)
      cross join lateral jsonb_array_elements_text(
        tier.value -> 'catalogItemIds'
      ) with ordinality as item(catalog_item_id, ordinality)
      where edition.id = 'earned-collection@1'
    ),
    actual as (
      select
        tiers.tier_id,
        tiers.tier_rank,
        tiers.weight_units,
        tiers.duplicate_dust,
        items.canonical_order,
        items.catalog_item_id
      from public.pull_banner_tiers as tiers
      join public.pull_banner_items as items
        on items.banner_version_id = tiers.banner_version_id
       and items.tier_id = tiers.tier_id
      where tiers.banner_version_id = 'earned-collection-001@1'
    ),
    drift as (
      (select * from source except all select * from actual)
      union all
      (select * from actual except all select * from source)
    )
    select 1 from drift
  ) then
    raise exception 'Normalized pull membership differs from immutable edition JSON';
  end if;

  if (select count(*) from public.pull_banner_items where banner_version_id = 'earned-collection-001@1') <> 45 or
     (select count(distinct catalog_item_id) from public.pull_banner_items where banner_version_id = 'earned-collection-001@1') <> 45 or
     exists (
       select 1 from public.pull_banner_items
       where catalog_item_id = 'future-catalog/d20/legendary@1'
     ) then
    raise exception 'Banner membership count/uniqueness or future-catalog isolation failed';
  end if;

  if exists (
    select 1
    from pg_class
    where oid in (
      'public.pull_hold_policy_versions'::regclass,
      'public.pull_banner_families'::regclass,
      'public.pull_banner_versions'::regclass,
      'public.pull_banner_offers'::regclass,
      'public.pull_banner_tiers'::regclass,
      'public.pull_banner_items'::regclass,
      'public.pull_guarantee_states'::regclass,
      'public.pull_sessions'::regclass,
      'public.sealed_pull_results'::regclass
    ) and (not relrowsecurity or not relforcerowsecurity)
  ) then
    raise exception 'Every public 0011 table must force RLS';
  end if;

  if not has_function_privilege(
       'authenticated', 'public.prepare_pull(text,smallint,text)', 'EXECUTE'
     ) or
     has_function_privilege('anon', 'public.prepare_pull(text,smallint,text)', 'EXECUTE') or
     has_function_privilege('service_role', 'public.prepare_pull(text,smallint,text)', 'EXECUTE') then
    raise exception 'prepare_pull execution grants are not authenticated-only';
  end if;

  if has_table_privilege('authenticated', 'public.pull_sessions', 'SELECT') or
     has_table_privilege('authenticated', 'public.sealed_pull_results', 'SELECT') or
     has_table_privilege('anon', 'public.pull_sessions', 'SELECT') or
     not has_table_privilege('service_role', 'public.pull_sessions', 'SELECT') or
     not has_table_privilege('service_role', 'public.sealed_pull_results', 'SELECT') then
    raise exception 'Sealed/session table read grants expose secrets or block audit';
  end if;

  if has_table_privilege('authenticated', 'public.pull_sessions', 'INSERT') or
     has_table_privilege('authenticated', 'public.pull_banner_offers', 'INSERT') or
     has_table_privilege('authenticated', 'public.pull_guarantee_states', 'UPDATE') or
     has_table_privilege('service_role', 'public.pull_sessions', 'INSERT') or
     has_table_privilege('service_role', 'public.sealed_pull_results', 'UPDATE') then
    raise exception 'Direct 0011 DML leaked to an API role';
  end if;

  if has_function_privilege(
       'authenticated',
       'private.prepare_pull_for_user(uuid,text,smallint,text,timestamptz,boolean)',
       'EXECUTE'
     ) or
     has_function_privilege(
       'service_role',
       'private.pull_seeded_uint32_below(bytea,uuid,smallint,text,integer)',
       'EXECUTE'
     ) or
     has_function_privilege(
       'authenticated',
       'private.pull_selected_misses_after(bigint,boolean,boolean)',
       'EXECUTE'
     ) then
    raise exception 'A private pull helper is API-executable';
  end if;

  if exists (
    select 1
    from pg_proc
    where oid in (
      'private.prepare_pull_for_user(uuid,text,smallint,text,timestamptz,boolean)'::regprocedure,
      'public.prepare_pull(text,smallint,text)'::regprocedure,
      'public.append_wallet_ledger_entry(uuid,text,text,bigint,text,text,text,jsonb)'::regprocedure,
      'private.preserve_active_pull_holds_on_balance_change()'::regprocedure,
      'private.preserve_pull_ownership_snapshot()'::regprocedure
    ) and provolatile <> 'v'
  ) then
    raise exception 'Lock-sensitive pull functions must remain VOLATILE for fresh command snapshots';
  end if;
  if current_setting('transaction_isolation') <> 'read committed' then
    raise exception 'Pull lock-time visibility proof requires Read Committed';
  end if;

  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.pull_sessions'::regclass
      and conname = 'pull_sessions_offer_fkey'
      and contype = 'f'
  ) or not exists (
    select 1 from pg_indexes
    where schemaname = 'public'
      and tablename = 'pull_sessions'
      and indexname = 'pull_sessions_offer_idx'
      and indexdef like '%(banner_version_id, pull_count, held_amount)%'
  ) then
    raise exception 'Session offer FK or supporting index is missing';
  end if;
end;
$$;

-- Hard-coded known-answer vectors computed independently with Node's
-- node:crypto HMAC-SHA-256/SHA-256 implementation. These do not derive their
-- expected values from any migration helper.
do $known_answers$
declare
  seed constant bytea := decode(
    '000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f',
    'hex'
  );
  session_id constant uuid := '12345678-1234-4234-8234-1234567890ab';
  position constant smallint := 2;
  upper_bound constant integer := 1073741825;
  acceptance_limit constant bigint := 3221225475;
  attempt_zero bytea;
  attempt_one bytea;
  attempt_zero_word bigint;
  attempt_one_word bigint;
  expected_nonce constant bytea := decode(
    'dc7ad54478f8a7c25e18472d7537d54f35f0f188a3e29d509c204ab1a3590f06',
    'hex'
  );
  expected_result constant text :=
    '993ec29e70339a3112b9185d3248f3595d2ef153092541aa83c3f2f67a1a0d93';
begin
  attempt_zero := extensions.hmac(
    convert_to(
      'dicesuki.pull.rng.v1' || E'\n' ||
      'session=' || session_id::text || E'\n' ||
      'position=' || position::text || E'\n' ||
      'draw=tier' || E'\n' ||
      'attempt=0',
      'UTF8'
    ),
    seed,
    'sha256'
  );
  attempt_one := extensions.hmac(
    convert_to(
      'dicesuki.pull.rng.v1' || E'\n' ||
      'session=' || session_id::text || E'\n' ||
      'position=' || position::text || E'\n' ||
      'draw=tier' || E'\n' ||
      'attempt=1',
      'UTF8'
    ),
    seed,
    'sha256'
  );
  attempt_zero_word :=
    get_byte(attempt_zero, 0)::bigint * 16777216::bigint +
    get_byte(attempt_zero, 1)::bigint * 65536::bigint +
    get_byte(attempt_zero, 2)::bigint * 256::bigint +
    get_byte(attempt_zero, 3)::bigint;
  attempt_one_word :=
    get_byte(attempt_one, 0)::bigint * 16777216::bigint +
    get_byte(attempt_one, 1)::bigint * 65536::bigint +
    get_byte(attempt_one, 2)::bigint * 256::bigint +
    get_byte(attempt_one, 3)::bigint;

  if encode(attempt_zero, 'hex') <>
       'e38c47a833a3b7604253cbcf89e44e8c5534ed7bb859703807e62f2b98fb0c98' or
     attempt_zero_word <> 3817621416 or
     attempt_zero_word < acceptance_limit or
     encode(attempt_one, 'hex') <>
       '7815248cff057857f25afb21d6df44a2dcd2a2a4607de88ea8ebcf585538f483' or
     attempt_one_word <> 2014651532 or
     attempt_one_word >= acceptance_limit or
     private.pull_seeded_uint32_below(
       seed, session_id, position, 'tier', upper_bound
     ) <> 940909707 then
    raise exception 'Seeded uint32 rejection-sampling known-answer vector drifted';
  end if;

  if private.pull_result_nonce(seed, session_id, position) <> expected_nonce then
    raise exception 'Result nonce known-answer vector drifted';
  end if;

  if private.pull_selected_misses_after(19, true, false) <> 0 or
     private.pull_selected_misses_after(19, true, true) <> 20 or
     private.pull_selected_misses_after(19, false, false) <> 20 then
    raise exception 'Selected counter known-answer vectors drifted';
  end if;

  if private.pull_result_commitment(
       session_id,
       position,
       'void-crystal/d12/legendary@1',
       'signature',
       3::smallint,
       'void-crystal/d10/legendary@1',
       'base',
       7::bigint,
       0::bigint,
       24::bigint,
       0::bigint,
       19::bigint,
       0::bigint,
       false,
       0::bigint,
       expected_nonce
     ) <> expected_result then
    raise exception 'Result commitment known-answer vector drifted';
  end if;

  if private.pull_commitment_root(
       session_id,
       array[
         expected_result,
         repeat('0', 64),
         repeat('f', 64)
       ]::text[]
     ) <> '09a9e73d3056b54bd33dec6ff33633242370bd40de59c5f80fb27bfeda4d2e7c' then
    raise exception 'Ordered commitment-root known-answer vector drifted';
  end if;
end;
$known_answers$;

-- The SECURITY DEFINER trigger may take the private account lock without
-- breaking the existing trusted SECURITY DEFINER starter writer through its
-- authenticated caller role. Migration 0010's direct service-role DML revoke
-- remains intact.
set local "request.jwt.claims" = '{"sub":"8bbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb","is_anonymous":false}';
set local role authenticated;
select public.ensure_starter_entitlements();
reset role;

do $$
begin
  if (select count(*) from public.user_entitlements
      where user_id = '8bbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb') <> 8 or
     has_table_privilege('service_role', 'public.user_entitlements', 'INSERT') then
    raise exception 'Trusted no-hold writer failed or direct service-role entitlement DML was regranted';
  end if;
end;
$$;

-- API denial includes the anon role, an anonymous JWT using authenticated,
-- and service_role. Only a non-anonymous authenticated JWT may enter the RPC.
set local role anon;
do $$
begin
  perform public.prepare_pull('earned-collection-001@1', 1::smallint, 'prepare:anon:0001');
  raise exception 'anon unexpectedly executed prepare_pull';
exception when insufficient_privilege then
  null;
end;
$$;
reset role;

set local "request.jwt.claims" = '{"sub":"89999999-9999-4999-8999-999999999999","is_anonymous":true}';
set local role authenticated;
do $$
begin
  perform public.prepare_pull('earned-collection-001@1', 1::smallint, 'prepare:anonymous-jwt:0001');
  raise exception 'Anonymous JWT unexpectedly prepared a pull';
exception when sqlstate '28000' then
  null;
end;
$$;
reset role;

set local role service_role;
do $$
begin
  perform public.prepare_pull('earned-collection-001@1', 1::smallint, 'prepare:service:0001');
  raise exception 'service_role unexpectedly executed public prepare_pull';
exception when insufficient_privilege then
  null;
end;
$$;
reset role;

-- Seed promotional Stars through the one existing ledger append boundary.
do $$
declare
  target record;
begin
  for target in
    select * from (values
      ('81111111-1111-4111-8111-111111111111'::uuid, 160::bigint, 'prepare-seed:exact'),
      ('82222222-2222-4222-8222-222222222222'::uuid, 1600::bigint, 'prepare-seed:ten'),
      ('83333333-3333-4333-8333-333333333333'::uuid, 160::bigint, 'prepare-seed:expiry'),
      ('84444444-4444-4444-8444-444444444444'::uuid, 160::bigint, 'prepare-seed:selected'),
      ('85555555-5555-4555-8555-555555555555'::uuid, 160::bigint, 'prepare-seed:epic'),
      ('86666666-6666-4666-8666-666666666666'::uuid, 160::bigint, 'prepare-seed:rare'),
      ('87777777-7777-4777-8777-777777777777'::uuid, 160::bigint, 'prepare-seed:base'),
      ('88888888-8888-4888-8888-888888888888'::uuid, 160::bigint, 'prepare-seed:all-owned'),
      ('8aaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'::uuid, 1600::bigint, 'prepare-seed:atomic')
    ) as values(user_id, stars, idempotency_key)
  loop
    perform public.append_wallet_ledger_entry(
      target.user_id,
      'stars',
      'promotional',
      target.stars,
      'test.pull-seed',
      target.idempotency_key,
      'earned-collection@1',
      '{}'::jsonb
    );
  end loop;
end;
$$;

-- Establish the owed fixed starter bundle before measuring that preparation
-- itself grants no pull outcome. The engine repeats this idempotently before
-- every new ownership snapshot.
do $$
declare
  target_user uuid;
begin
  foreach target_user in array array[
    '81111111-1111-4111-8111-111111111111'::uuid,
    '82222222-2222-4222-8222-222222222222'::uuid,
    '83333333-3333-4333-8333-333333333333'::uuid,
    '84444444-4444-4444-8444-444444444444'::uuid,
    '85555555-5555-4555-8555-555555555555'::uuid,
    '86666666-6666-4666-8666-666666666666'::uuid,
    '87777777-7777-4777-8777-777777777777'::uuid,
    '8aaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'::uuid
  ] loop
    perform set_config(
      'request.jwt.claims',
      jsonb_build_object('sub', target_user, 'is_anonymous', false)::text,
      true
    );
    perform public.ensure_starter_entitlements();
  end loop;
end;
$$;

-- Exact replay returns an identical result-free receipt before expiry/funds
-- checks. Mismatch and a second live family preparation fail closed. The hold
-- does not debit, grant a pull result, reveal, or mutate the guarantee anchor.
insert into public.pull_guarantee_states (
  account_id, user_id, banner_family_id,
  total_pulls, rare_misses, epic_misses, selected_misses
)
select id, user_id, 'earned-collection', 9, 2, 3, 4
from public.wallet_accounts
where user_id = '81111111-1111-4111-8111-111111111111';

set local "request.jwt.claims" = '{"sub":"81111111-1111-4111-8111-111111111111","is_anonymous":false}';
set local role authenticated;
do $$
declare
  first_receipt record;
  replay_receipt record;
begin
  select * into strict first_receipt
  from public.prepare_pull('earned-collection-001@1', 1::smallint, 'prepare:exact:0001');
  select * into strict replay_receipt
  from public.prepare_pull('earned-collection-001@1', 1::smallint, 'prepare:exact:0001');

  if row(
    first_receipt.session_id,
    first_receipt.banner_version_id,
    first_receipt.pull_count,
    first_receipt.held_amount,
    first_receipt.prepared_at,
    first_receipt.expires_at,
    first_receipt.commitment_scheme,
    first_receipt.commitment_root,
    first_receipt.rng_scheme
  ) is distinct from row(
    replay_receipt.session_id,
    replay_receipt.banner_version_id,
    replay_receipt.pull_count,
    replay_receipt.held_amount,
    replay_receipt.prepared_at,
    replay_receipt.expires_at,
    replay_receipt.commitment_scheme,
    replay_receipt.commitment_root,
    replay_receipt.rng_scheme
  ) or first_receipt.held_amount <> 160 or
     first_receipt.expires_at <> first_receipt.prepared_at + interval '120 seconds' then
    raise exception 'Exact replay changed the safe pull receipt';
  end if;

  begin
    perform public.prepare_pull('earned-collection-001@1', 10::smallint, 'prepare:exact:0001');
    raise exception 'Mismatched replay unexpectedly succeeded';
  exception when sqlstate '22023' then
    null;
  end;

  begin
    perform public.prepare_pull('earned-collection-001@1', 1::smallint, 'prepare:exact:0002');
    raise exception 'Second live family pull unexpectedly succeeded';
  exception when sqlstate '55000' then
    null;
  end;

  begin
    perform public.prepare_pull('earned-collection-001@1', 5::smallint, 'prepare:invalid-count');
    raise exception 'Unsupported pull count unexpectedly succeeded';
  exception when sqlstate '22023' then
    null;
  end;

  begin
    perform 1 from public.pull_sessions;
    raise exception 'Authenticated caller read raw pull sessions';
  exception when insufficient_privilege then
    null;
  end;

  begin
    perform 1 from public.sealed_pull_results;
    raise exception 'Authenticated caller read sealed results/nonces';
  exception when insufficient_privilege then
    null;
  end;
end;
$$;
reset role;

do $$
begin
  if (select count(*) from public.pull_sessions where user_id = '81111111-1111-4111-8111-111111111111') <> 1 or
     (select count(*) from public.sealed_pull_results where user_id = '81111111-1111-4111-8111-111111111111') <> 1 or
     (select current_balance from public.wallet_balances where user_id = '81111111-1111-4111-8111-111111111111' and currency_id = 'stars') <> 160 or
     (select count(*) from public.wallet_ledger_entries where user_id = '81111111-1111-4111-8111-111111111111') <> 1 or
     (select count(*) from public.user_entitlements where user_id = '81111111-1111-4111-8111-111111111111') <> 8 or
     exists (
       select 1 from public.user_entitlements
       where user_id = '81111111-1111-4111-8111-111111111111'
         and grant_reason like 'pull%'
     ) or
     not exists (
       select 1 from public.pull_guarantee_states
       where user_id = '81111111-1111-4111-8111-111111111111'
         and (total_pulls, rare_misses, epic_misses, selected_misses) = (9, 2, 3, 4)
     ) then
    raise exception 'Prepare mutated balance/grants/guarantee or sealed wrong cardinality';
  end if;

  begin
    perform public.append_wallet_ledger_entry(
      '81111111-1111-4111-8111-111111111111',
      'stars', 'promotional', -1,
      'test.blocked-debit', 'prepare-debit:blocked',
      'earned-collection@1', '{}'::jsonb
    );
    raise exception 'A debit consumed held Stars';
  exception when sqlstate '22003' then
    null;
  end;

  begin
    update public.wallet_balances
    set current_balance = 0
    where user_id = '81111111-1111-4111-8111-111111111111'
      and currency_id = 'stars';
    raise exception 'Direct balance update bypassed active hold';
  exception when sqlstate '22003' then
    null;
  end;

  begin
    insert into public.user_entitlements (
      user_id, catalog_item_id, grant_reason, grant_ref
    ) values (
      '81111111-1111-4111-8111-111111111111',
      'void-crystal/d10/legendary@1',
      'test.concurrent-grant',
      'test:blocked-during-hold'
    );
    raise exception 'Entitlement grant invalidated the sealed ownership snapshot';
  exception when sqlstate '55000' then
    null;
  end;
end;
$$;

-- Ten-pull cost/cardinality are exact and remain a hold rather than a debit.
set local "request.jwt.claims" = '{"sub":"82222222-2222-4222-8222-222222222222","is_anonymous":false}';
set local role authenticated;
do $$
declare
  receipt record;
begin
  select * into strict receipt
  from public.prepare_pull('earned-collection-001@1', 10::smallint, 'prepare:ten:0001');
  if receipt.pull_count <> 10 or receipt.held_amount <> 1600 or
     receipt.commitment_root !~ '^[0-9a-f]{64}$' or
     receipt.rng_scheme <> 'hmac-sha256-seed-v1' then
    raise exception 'Ten-pull receipt is not exact';
  end if;
end;
$$;
reset role;

do $$
begin
  if (select count(*) from public.sealed_pull_results where user_id = '82222222-2222-4222-8222-222222222222') <> 10 or
     (select current_balance from public.wallet_balances where user_id = '82222222-2222-4222-8222-222222222222' and currency_id = 'stars') <> 1600 or
     (select count(*) from public.wallet_ledger_entries where user_id = '82222222-2222-4222-8222-222222222222') <> 1 or
     (select count(*) from public.user_entitlements where user_id = '82222222-2222-4222-8222-222222222222') <> 8 then
    raise exception 'Ten-pull did not seal exactly ten without debit/grant';
  end if;
end;
$$;

-- Expiry releases availability without rewriting history. Exact replay of an
-- expired key remains stable even after a new active session exists.
do $$
declare
  expired public.pull_sessions%rowtype;
begin
  perform set_config(
    'request.jwt.claims',
    '{"sub":"83333333-3333-4333-8333-333333333333","is_anonymous":false}',
    true
  );
  expired := private.prepare_pull_for_user(
    '83333333-3333-4333-8333-333333333333',
    'earned-collection-001@1',
    1::smallint,
    'prepare:expired:0001',
    statement_timestamp() - interval '121 seconds',
    false
  );
  if expired.expires_at >= statement_timestamp() then
    raise exception 'Past preparation did not expire';
  end if;
end;
$$;

set local "request.jwt.claims" = '{"sub":"83333333-3333-4333-8333-333333333333","is_anonymous":false}';
set local role authenticated;
do $$
declare
  expired_receipt record;
  active_receipt record;
  replay_receipt record;
begin
  select * into strict expired_receipt
  from public.prepare_pull('earned-collection-001@1', 1::smallint, 'prepare:expired:0001');
  select * into strict active_receipt
  from public.prepare_pull('earned-collection-001@1', 1::smallint, 'prepare:expired:0002');
  select * into strict replay_receipt
  from public.prepare_pull('earned-collection-001@1', 1::smallint, 'prepare:expired:0001');

  if expired_receipt.session_id <> replay_receipt.session_id or
     expired_receipt.commitment_root <> replay_receipt.commitment_root or
     expired_receipt.session_id = active_receipt.session_id then
    raise exception 'Expired exact replay or released-balance reuse is unstable';
  end if;

  begin
    perform public.prepare_pull('earned-collection-001@1', 10::smallint, 'prepare:expired:0001');
    raise exception 'Expired mismatched replay unexpectedly succeeded';
  exception when sqlstate '22023' then
    null;
  end;
end;
$$;
reset role;

do $$
begin
  if (select count(*) from public.pull_sessions where user_id = '83333333-3333-4333-8333-333333333333') <> 2 or
     (select coalesce(sum(held_amount), 0) from public.pull_sessions where user_id = '83333333-3333-4333-8333-333333333333' and prepared_at <= statement_timestamp() and expires_at > statement_timestamp()) <> 160 or
     (select current_balance from public.wallet_balances where user_id = '83333333-3333-4333-8333-333333333333' and currency_id = 'stars') <> 160 then
    raise exception 'Expiry did not release exactly one hold without mutation';
  end if;
end;
$$;

-- Exact guarantee boundaries and precedence. Starter ownership is established
-- first, then the persisted state is snapshotted but never advanced.
insert into public.pull_guarantee_states (
  account_id, user_id, banner_family_id,
  total_pulls, rare_misses, epic_misses, selected_misses
)
select id, user_id, 'earned-collection', 100, 7, 24, 19
from public.wallet_accounts where user_id = '84444444-4444-4444-8444-444444444444';

insert into public.pull_guarantee_states (
  account_id, user_id, banner_family_id,
  total_pulls, rare_misses, epic_misses, selected_misses
)
select id, user_id, 'earned-collection', 100, 7, 24, 0
from public.wallet_accounts where user_id = '85555555-5555-4555-8555-555555555555';

insert into public.pull_guarantee_states (
  account_id, user_id, banner_family_id,
  total_pulls, rare_misses, epic_misses, selected_misses
)
select id, user_id, 'earned-collection', 100, 7, 0, 0
from public.wallet_accounts where user_id = '86666666-6666-4666-8666-666666666666';

insert into public.pull_guarantee_states (
  account_id, user_id, banner_family_id,
  total_pulls, rare_misses, epic_misses, selected_misses
)
select id, user_id, 'earned-collection', 100, 6, 23, 18
from public.wallet_accounts where user_id = '87777777-7777-4777-8777-777777777777';

set local role service_role;
do $$
declare
  item record;
begin
  for item in
    select catalog_item_id, tier_id, canonical_order
    from public.pull_banner_items
    where banner_version_id = 'earned-collection-001@1'
    order by tier_rank, canonical_order
  loop
    perform public.record_dice_copy_grant(
      '88888888-8888-4888-8888-888888888888',
      item.catalog_item_id,
      'reward',
      'test:preowned:' || item.catalog_item_id,
      'test:preowned:' || item.tier_id || ':' || item.canonical_order::text
    );
  end loop;
end;
$$;
reset role;

insert into public.pull_guarantee_states (
  account_id, user_id, banner_family_id,
  total_pulls, rare_misses, epic_misses, selected_misses
)
select id, user_id, 'earned-collection', 100, 7, 24, 19
from public.wallet_accounts where user_id = '88888888-8888-4888-8888-888888888888';

-- The selected counter resets for any newly awarded selected-featured item,
-- not merely the current lowest unowned guarantee target. A duplicate featured
-- award still misses because ownership does not change.
do $$
declare
  lowest_target text;
  alternate_target text;
  alternate_is_featured boolean;
begin
  select catalog_item_id into strict lowest_target
  from public.pull_banner_items
  where banner_version_id = 'earned-collection-001@1' and selected_featured
  order by catalog_item_id
  limit 1;

  select catalog_item_id, selected_featured
    into strict alternate_target, alternate_is_featured
  from public.pull_banner_items
  where banner_version_id = 'earned-collection-001@1' and selected_featured
  order by catalog_item_id
  offset 1 limit 1;

  if alternate_target = lowest_target or
     exists (
       select 1 from public.dice_copies
       where user_id = '84444444-4444-4444-8444-444444444444'
         and catalog_item_id = alternate_target
         and scrapped_at is null
     ) or
     private.pull_selected_misses_after(7, alternate_is_featured, false) <> 0 or
     private.pull_selected_misses_after(7, alternate_is_featured, true) <> 8 or
     private.pull_selected_misses_after(7, false, false) <> 8 then
    raise exception 'Selected-featured award reset semantics are incorrect';
  end if;
end;
$$;

do $$
declare
  target_user uuid;
  key text;
begin
  for target_user, key in
    select * from (values
      ('84444444-4444-4444-8444-444444444444'::uuid, 'prepare:guarantee:selected'),
      ('85555555-5555-4555-8555-555555555555'::uuid, 'prepare:guarantee:epic'),
      ('86666666-6666-4666-8666-666666666666'::uuid, 'prepare:guarantee:rare'),
      ('87777777-7777-4777-8777-777777777777'::uuid, 'prepare:guarantee:base'),
      ('88888888-8888-4888-8888-888888888888'::uuid, 'prepare:guarantee:all-owned')
    ) as values(user_id, idempotency_key)
  loop
    perform set_config(
      'request.jwt.claims',
      jsonb_build_object('sub', target_user, 'is_anonymous', false)::text,
      true
    );
    perform public.prepare_pull('earned-collection-001@1', 1::smallint, key);
  end loop;
end;
$$;

do $$
begin
  if not exists (
    select 1
    from public.sealed_pull_results
    where user_id = '84444444-4444-4444-8444-444444444444'
      and resolution_reason = 'selected-guarantee'
      and catalog_item_id = 'void-crystal/d10/legendary@1'
      and selected_target_catalog_item_id = 'void-crystal/d10/legendary@1'
      and catalog_item_id = (
        select min(items.catalog_item_id)
        from public.pull_banner_items as items
        where items.banner_version_id = 'earned-collection-001@1'
          and items.selected_featured
      )
      and tier_rank = 3
      and rare_misses_after = 0
      and epic_misses_after = 0
      and selected_misses_after = 0
  ) then
    raise exception 'Selected guarantee did not win the 20/25/8 precedence tie';
  end if;

  if not exists (
    select 1 from public.sealed_pull_results
    where user_id = '85555555-5555-4555-8555-555555555555'
      and resolution_reason = 'epic-guarantee' and tier_rank >= 2
  ) or not exists (
    select 1 from public.sealed_pull_results
    where user_id = '86666666-6666-4666-8666-666666666666'
      and resolution_reason = 'rare-guarantee' and tier_rank >= 1
  ) or not exists (
    select 1 from public.sealed_pull_results
    where user_id = '87777777-7777-4777-8777-777777777777'
      and resolution_reason = 'base'
  ) then
    raise exception 'Epic/rare/base exact boundary resolution is incorrect';
  end if;

  if not exists (
    select 1
    from public.sealed_pull_results as results
    join public.pull_banner_tiers as tiers
      on tiers.banner_version_id = results.banner_version_id
     and tiers.tier_id = results.tier_id
    where results.user_id = '88888888-8888-4888-8888-888888888888'
      and results.resolution_reason = 'epic-guarantee'
      and results.selected_target_catalog_item_id is null
      and results.is_duplicate
      and results.duplicate_dust_amount = tiers.duplicate_dust
  ) then
    raise exception 'Exhausted selected pool did not fall through to sealed duplicate Dust';
  end if;

  if exists (
    with expected(
      user_id, total_pulls, rare_misses, epic_misses, selected_misses
    ) as (
      values
        ('84444444-4444-4444-8444-444444444444'::uuid, 100::bigint, 7::bigint, 24::bigint, 19::bigint),
        ('85555555-5555-4555-8555-555555555555'::uuid, 100::bigint, 7::bigint, 24::bigint, 0::bigint),
        ('86666666-6666-4666-8666-666666666666'::uuid, 100::bigint, 7::bigint, 0::bigint, 0::bigint),
        ('87777777-7777-4777-8777-777777777777'::uuid, 100::bigint, 6::bigint, 23::bigint, 18::bigint),
        ('88888888-8888-4888-8888-888888888888'::uuid, 100::bigint, 7::bigint, 24::bigint, 19::bigint)
    ),
    actual as (
      select
        states.user_id,
        states.total_pulls,
        states.rare_misses,
        states.epic_misses,
        states.selected_misses
      from public.pull_guarantee_states as states
      where states.user_id in (select expected.user_id from expected)
    ),
    drift as (
      (select * from expected except all select * from actual)
      union all
      (select * from actual except all select * from expected)
    )
    select 1 from drift
  ) then
    raise exception 'prepare_pull advanced durable guarantee state';
  end if;
end;
$$;

-- Independently recompute every per-result commitment, ordered root, HMAC
-- nonce, tier draw, item draw, and duplicate/Dust projection from the sealed
-- seed plus immutable configuration. This proves the stored result followed
-- the disclosed algorithm rather than merely having a post-hoc nonce hash.
do $$
begin
  if exists (
    select 1
    from public.sealed_pull_results as results
    where results.commitment_sha256 <> private.pull_result_commitment(
      results.session_id,
      results.result_position,
      results.catalog_item_id,
      results.tier_id,
      results.tier_rank,
      results.selected_target_catalog_item_id,
      results.resolution_reason,
      results.rare_misses_before,
      results.rare_misses_after,
      results.epic_misses_before,
      results.epic_misses_after,
      results.selected_misses_before,
      results.selected_misses_after,
      results.is_duplicate,
      results.duplicate_dust_amount,
      results.nonce
    )
  ) then
    raise exception 'A sealed result commitment is not reproducible';
  end if;

  if exists (
    select 1
    from public.pull_sessions as sessions
    where sessions.commitment_root <> (
      select private.pull_commitment_root(
        sessions.id,
        array_agg(results.commitment_sha256 order by results.result_position)
      )
      from public.sealed_pull_results as results
      where results.session_id = sessions.id
    )
  ) then
    raise exception 'A pull root commitment is not reproducible';
  end if;

  if exists (
    select 1
    from public.sealed_pull_results as results
    join public.pull_sessions as sessions on sessions.id = results.session_id
    where results.nonce <> private.pull_result_nonce(
      sessions.rng_seed, sessions.id, results.result_position
    )
  ) then
    raise exception 'A result nonce is not derived from the sealed HMAC seed';
  end if;

  if exists (
    select 1
    from public.sealed_pull_results as results
    join public.pull_sessions as sessions on sessions.id = results.session_id
    where results.sealed_at <> sessions.prepared_at
      or sessions.expires_at <> sessions.prepared_at + make_interval(secs => sessions.hold_ttl_seconds)
  ) then
    raise exception 'Persisted session and sealed-result times do not share one post-lock decision time';
  end if;

  if exists (
    select 1
    from public.sealed_pull_results as results
    join public.pull_sessions as sessions on sessions.id = results.session_id
    join public.pull_banner_versions as banner on banner.id = results.banner_version_id
    cross join lateral (
      select case results.resolution_reason
        when 'epic-guarantee' then banner.epic_minimum_rank
        when 'rare-guarantee' then banner.rare_minimum_rank
        else 0
      end as minimum_rank
    ) as required
    left join lateral (
      select sum(tiers.weight_units)::integer as eligible_weight
      from public.pull_banner_tiers as tiers
      where tiers.banner_version_id = banner.id
        and tiers.tier_rank >= required.minimum_rank
    ) as weights on results.resolution_reason <> 'selected-guarantee'
    left join lateral (
      select private.pull_seeded_uint32_below(
        sessions.rng_seed,
        sessions.id,
        results.result_position,
        'tier',
        weights.eligible_weight
      ) as tier_draw
    ) as draws on results.resolution_reason <> 'selected-guarantee'
    left join lateral (
      select tiers.tier_id, tiers.tier_rank
      from public.pull_banner_tiers as tiers
      where tiers.banner_version_id = banner.id
        and tiers.tier_rank >= required.minimum_rank
        and draws.tier_draw < (
          select sum(previous.weight_units)
          from public.pull_banner_tiers as previous
          where previous.banner_version_id = banner.id
            and previous.tier_rank >= required.minimum_rank
            and previous.tier_rank <= tiers.tier_rank
        )
      order by tiers.tier_rank
      limit 1
    ) as expected_tier on results.resolution_reason <> 'selected-guarantee'
    left join lateral (
      select count(*)::integer as item_count
      from public.pull_banner_items as items
      where items.banner_version_id = banner.id
        and items.tier_id = expected_tier.tier_id
    ) as item_pool on results.resolution_reason <> 'selected-guarantee'
    left join lateral (
      select items.catalog_item_id
      from public.pull_banner_items as items
      where items.banner_version_id = banner.id
        and items.tier_id = expected_tier.tier_id
        and items.canonical_order = private.pull_seeded_uint32_below(
          sessions.rng_seed,
          sessions.id,
          results.result_position,
          'item',
          item_pool.item_count
        ) + 1
    ) as expected_item on results.resolution_reason <> 'selected-guarantee'
    where (
      results.resolution_reason = 'selected-guarantee' and
      results.catalog_item_id is distinct from results.selected_target_catalog_item_id
    ) or (
      results.resolution_reason <> 'selected-guarantee' and
      (results.tier_id, results.tier_rank, results.catalog_item_id)
        is distinct from
      (expected_tier.tier_id, expected_tier.tier_rank, expected_item.catalog_item_id)
    )
  ) then
    raise exception 'A sealed result does not replay from its HMAC seed and immutable odds';
  end if;

  if exists (
    select 1
    from public.sealed_pull_results as results
    join public.pull_banner_tiers as tiers
      on tiers.banner_version_id = results.banner_version_id
     and tiers.tier_id = results.tier_id
    cross join lateral (
      select exists (
        select 1 from public.dice_copies as copies
        where copies.user_id = results.user_id
          and copies.catalog_item_id = results.catalog_item_id
          and copies.scrapped_at is null
      ) or exists (
        select 1 from public.sealed_pull_results as earlier
        where earlier.session_id = results.session_id
          and earlier.result_position < results.result_position
          and earlier.catalog_item_id = results.catalog_item_id
      ) as expected_duplicate
    ) as expected
    where results.is_duplicate is distinct from expected.expected_duplicate or
      results.duplicate_dust_amount <> case
        when expected.expected_duplicate then tiers.duplicate_dust else 0
      end
  ) then
    raise exception 'Projected ownership did not seal exact duplicate Dust';
  end if;

  if exists (
    select 1
    from public.sealed_pull_results as results
    join public.pull_banner_items as items
      on items.banner_version_id = results.banner_version_id
     and items.catalog_item_id = results.catalog_item_id
    where results.selected_misses_after <>
      private.pull_selected_misses_after(
        results.selected_misses_before,
        items.selected_featured,
        results.is_duplicate
      )
  ) then
    raise exception 'A selected counter did not follow immutable featured membership and duplicate state';
  end if;
end;
$$;

-- A constraint-style failure on result two rolls back the already-inserted
-- session and all result rows, leaving the hold, wallet, grants, and guarantee
-- state exactly as they were before the statement.
create or replace function pg_temp.reject_second_pull_result()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.result_position = 2 then
    raise exception 'Injected result constraint failure' using errcode = 'ZX011';
  end if;
  return new;
end;
$$;

create trigger test_reject_second_pull_result
  before insert on public.sealed_pull_results
  for each row execute function pg_temp.reject_second_pull_result();

do $$
begin
  perform set_config(
    'request.jwt.claims',
    '{"sub":"8aaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa","is_anonymous":false}',
    true
  );
  begin
    perform private.prepare_pull_for_user(
      '8aaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      'earned-collection-001@1',
      10::smallint,
      'prepare:atomic:0001',
      null,
      false
    );
    raise exception 'Injected result failure unexpectedly committed';
  exception when sqlstate 'ZX011' then
    null;
  end;

  if exists (
       select 1 from public.pull_sessions
       where user_id = '8aaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
     ) or exists (
       select 1 from public.sealed_pull_results
       where user_id = '8aaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
     ) or
     (select current_balance from public.wallet_balances where user_id = '8aaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' and currency_id = 'stars') <> 1600 or
     (select count(*) from public.wallet_ledger_entries where user_id = '8aaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa') <> 1 or
     (select count(*) from public.user_entitlements where user_id = '8aaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa') <> 8 or
     exists (
       select 1 from public.pull_guarantee_states
       where user_id = '8aaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
     ) then
    raise exception 'Failed pull preparation left partial session/hold/result state';
  end if;
end;
$$;

drop trigger test_reject_second_pull_result on public.sealed_pull_results;

-- Every immutable table has both row and statement mutation guards. Exercise
-- one populated leaf at runtime in addition to catalog-wide trigger discovery.
do $$
declare
  table_name text;
begin
  foreach table_name in array array[
    'pull_hold_policy_versions',
    'pull_banner_families',
    'pull_banner_versions',
    'pull_banner_offers',
    'pull_banner_tiers',
    'pull_banner_items',
    'pull_sessions',
    'sealed_pull_results'
  ] loop
    if not exists (
      select 1 from pg_trigger
      where tgrelid = format('public.%I', table_name)::regclass
        and not tgisinternal
        and tgname = table_name || '_reject_update_delete'
    ) or not exists (
      select 1 from pg_trigger
      where tgrelid = format('public.%I', table_name)::regclass
        and not tgisinternal
        and tgname = table_name || '_reject_truncate'
    ) then
      raise exception 'Missing append-only mutation trigger for %', table_name;
    end if;
  end loop;

  begin
    update public.sealed_pull_results
    set commitment_sha256 = commitment_sha256
    where session_id = (
      select session_id from public.sealed_pull_results limit 1
    );
    raise exception 'Sealed result update unexpectedly succeeded';
  exception when sqlstate '55000' then
    null;
  end;

  begin
    delete from public.sealed_pull_results
    where session_id = (
      select session_id from public.sealed_pull_results limit 1
    );
    raise exception 'Sealed result delete unexpectedly succeeded';
  exception when sqlstate '55000' then
    null;
  end;

  begin
    truncate table public.sealed_pull_results;
    raise exception 'Sealed result truncate unexpectedly succeeded';
  exception when sqlstate '55000' then
    null;
  end;

  if exists (
    select 1
    from public.wallet_balances as balances
    where balances.currency_id = 'stars'
      and balances.balance_bucket = 'promotional'
      and balances.current_balance - coalesce((
        select sum(sessions.held_amount)
        from public.pull_sessions as sessions
        where sessions.account_id = balances.account_id
          and sessions.currency_id = balances.currency_id
          and sessions.balance_bucket = balances.balance_bucket
          and sessions.prepared_at <= statement_timestamp()
          and sessions.expires_at > statement_timestamp()
      ), 0) < 0
  ) then
    raise exception 'An account has negative available promotional Stars';
  end if;
end;
$$;

rollback;
