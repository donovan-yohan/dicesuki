begin;

insert into auth.users (id) values
  ('c1700000-0000-4170-8170-000000000001'),
  ('c1700000-0000-4170-8170-000000000002'),
  ('c1700000-0000-4170-8170-000000000003'),
  ('c1700000-0000-4170-8170-000000000004'),
  ('c1700000-0000-4170-8170-000000000005'),
  ('c1700000-0000-4170-8170-000000000006');

-- One featured item makes the two-result lifecycle deterministic: the first
-- result grants its first-ever copy, and the second grants another copy plus
-- 17 duplicate Dust.
insert into public.catalog_items (
  id,
  catalog_key,
  contract_version,
  item_kind,
  set_id,
  dice_type,
  rarity
) values (
  'slice6-commit/d20/legendary@1',
  'slice6-commit/d20/legendary',
  1,
  'die',
  'slice6-commit',
  'd20',
  'legendary'
);

insert into public.pull_banner_families (id) values
  ('slice6-money-core'),
  ('slice6-ticket-core');

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
) values
  (
    'slice6-stars-core@1',
    'slice6-stars-core',
    1,
    'slice6-money-core',
    'earned-collection@1',
    repeat('a', 64),
    'pull-hold@1',
    'stars',
    'promotional',
    'dust',
    'earned',
    100,
    1,
    8,
    2,
    25,
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
  ),
  (
    'slice6-ticket-core@1',
    'slice6-ticket-core',
    1,
    'slice6-ticket-core',
    'earned-collection@1',
    repeat('b', 64),
    'pull-hold@1',
    'stars',
    'promotional',
    'dust',
    'earned',
    100,
    1,
    8,
    2,
    25,
    3,
    1,
    array[
      'selected-featured-unowned',
      'epic-or-better',
      'rare-or-better',
      'base'
    ]::text[],
    'standard',
    'standard_roll'
  );

insert into public.pull_banner_offers (
  banner_version_id,
  pull_count,
  cost
) values
  ('slice6-stars-core@1', 1, 160),
  ('slice6-stars-core@1', 2, 320),
  ('slice6-ticket-core@1', 1, 1);

insert into public.pull_banner_tiers (
  banner_version_id,
  tier_id,
  tier_rank,
  weight_units,
  duplicate_dust
) values
  ('slice6-stars-core@1', 'signature', 3, 100, 17),
  ('slice6-ticket-core@1', 'signature', 3, 100, 17);

insert into public.pull_banner_items (
  banner_version_id,
  tier_id,
  tier_rank,
  canonical_order,
  catalog_item_id,
  selected_featured
) values
  (
    'slice6-stars-core@1',
    'signature',
    3,
    1,
    'slice6-commit/d20/legendary@1',
    true
  ),
  (
    'slice6-ticket-core@1',
    'signature',
    3,
    1,
    'slice6-commit/d20/legendary@1',
    true
  );

-- Seed Stars for the Stars lifecycle and terminal-state scenarios.
do $$
declare
  target record;
begin
  for target in
    select * from (values
      (
        'c1700000-0000-4170-8170-000000000001'::uuid,
        640::bigint,
        'slice6:commit:seed:main'
      ),
      (
        'c1700000-0000-4170-8170-000000000003'::uuid,
        320::bigint,
        'slice6:commit:seed:cancelled'
      ),
      (
        'c1700000-0000-4170-8170-000000000004'::uuid,
        160::bigint,
        'slice6:commit:seed:committed'
      ),
      (
        'c1700000-0000-4170-8170-000000000005'::uuid,
        160::bigint,
        'slice6:commit:seed:expired'
      )
    ) as seeded(user_id, stars, idempotency_key)
  loop
    perform public.append_wallet_ledger_entry(
      target.user_id,
      'stars',
      'promotional',
      target.stars,
      'test.slice6.commit.seed',
      target.idempotency_key,
      'earned-collection@1',
      '{}'::jsonb
    );
  end loop;
end;
$$;

-- Full Stars-funded lifecycle. Commitment and root verification deliberately
-- reconstruct the public scheme from reveal fields instead of calling either
-- private commitment helper or reading sealed rows.
set local "request.jwt.claims" =
  '{"sub":"c1700000-0000-4170-8170-000000000001","is_anonymous":false}';
set local role authenticated;

do $$
declare
  prepared record;
  commit_receipt jsonb;
begin
  select * into strict prepared
  from public.prepare_pull(
    'slice6-stars-core@1',
    2::smallint,
    'slice6:commit:main:prepare:0001'
  );

  if prepared.held_amount is distinct from 320 or
     prepared.pull_count is distinct from 2 or
     prepared.session_id is null then
    raise exception 'Stars lifecycle prepared the wrong reservation';
  end if;

  commit_receipt := public.commit_pull_session(prepared.session_id);

  if jsonb_typeof(commit_receipt) is distinct from 'object' or
     jsonb_typeof(commit_receipt -> 'session_id') is distinct from 'string' or
     jsonb_typeof(commit_receipt -> 'banner_version_id') is distinct from 'string' or
     jsonb_typeof(commit_receipt -> 'pull_count') is distinct from 'number' or
     jsonb_typeof(commit_receipt -> 'held_amount') is distinct from 'number' or
     jsonb_typeof(commit_receipt -> 'committed_at') is distinct from 'string' or
     jsonb_typeof(commit_receipt -> 'commitment_scheme') is distinct from 'string' or
     jsonb_typeof(commit_receipt -> 'commitment_root') is distinct from 'string' or
     jsonb_typeof(commit_receipt -> 'rng_scheme') is distinct from 'string' or
     jsonb_typeof(commit_receipt -> 'rng_seed') is distinct from 'string' or
     jsonb_typeof(commit_receipt -> 'results') is distinct from 'array' then
    raise exception 'Stars commit reveal omitted or mistyped a required field';
  end if;

  if (commit_receipt ->> 'session_id')::uuid is distinct from prepared.session_id or
     (commit_receipt ->> 'banner_version_id') is distinct from
       'slice6-stars-core@1' or
     (commit_receipt ->> 'held_amount')::bigint is distinct from 320 or
     (commit_receipt ->> 'pull_count')::integer is distinct from 2 or
     (commit_receipt ->> 'committed_at')::timestamptz is null or
     (commit_receipt ->> 'commitment_scheme') is distinct from
       'sha256-result-v1+sha256-root-v1' or
     (commit_receipt ->> 'commitment_root') !~ '^[0-9a-f]{64}$' or
     (commit_receipt ->> 'rng_scheme') is distinct from
       'hmac-sha256-seed-v1' or
     (commit_receipt ->> 'rng_seed') !~ '^[0-9a-f]{64}$' or
     jsonb_array_length(commit_receipt -> 'results') is distinct from 2 or
     (select count(*)
      from jsonb_array_elements(commit_receipt -> 'results')
        as revealed(result)
      where (revealed.result ->> 'is_duplicate')::boolean) is distinct from 1 or
     (select count(*)
      from jsonb_array_elements(commit_receipt -> 'results')
      as revealed(result)
      where not (revealed.result ->> 'is_duplicate')::boolean)
        is distinct from 1 or
     (select count(*)
      from jsonb_array_elements(commit_receipt -> 'results')
        as revealed(result)
      where (revealed.result ->> 'is_first_copy')::boolean)
        is distinct from 1 or
     (select count(*)
      from jsonb_array_elements(commit_receipt -> 'results')
        as revealed(result)
      where not (revealed.result ->> 'is_first_copy')::boolean)
        is distinct from 1 or
     (select coalesce(
        sum((revealed.result ->> 'duplicate_dust_amount')::bigint),
        0
      )
      from jsonb_array_elements(commit_receipt -> 'results')
        as revealed(result)) is distinct from 17 then
    raise exception 'Stars commit did not return the exact deterministic reveal';
  end if;

  perform set_config(
    'slice6.main_session_id',
    prepared.session_id::text,
    true
  );
  perform set_config(
    'slice6.main_commit_receipt',
    commit_receipt::text,
    true
  );
end;
$$;

reset role;

-- Capture physical row identity after the first commit and before replay.
-- An UPDATE, including a same-values guarantee upsert, creates a new CTID.
do $$
declare
  guarantee_ctid tid;
begin
  select guarantee.ctid into strict guarantee_ctid
  from public.pull_guarantee_states as guarantee
  join public.pull_sessions as session
    on session.account_id = guarantee.account_id
   and session.banner_family_id = guarantee.banner_family_id
  where session.id = current_setting('slice6.main_session_id')::uuid
    and guarantee.user_id = 'c1700000-0000-4170-8170-000000000001';

  perform set_config(
    'slice6.main_guarantee_ctid',
    guarantee_ctid::text,
    true
  );
end;
$$;

-- This is an independent client verifier expressed in SQL. It consumes only
-- the public reveal receipt saved above; it does not invoke a private pull
-- helper or inspect sealed-result storage.
do $$
declare
  commit_receipt jsonb :=
    current_setting('slice6.main_commit_receipt')::jsonb;
  revealed_result record;
  computed_commitment text;
  computed_commitments text[] := array[]::text[];
  computed_root text;
begin
  for revealed_result in
    select revealed.value as result, revealed.ordinality
    from jsonb_array_elements(commit_receipt -> 'results')
      with ordinality as revealed(value, ordinality)
    order by revealed.ordinality
  loop
    if jsonb_typeof(revealed_result.result) is distinct from 'object' or
       jsonb_typeof(revealed_result.result -> 'position')
         is distinct from 'number' or
       jsonb_typeof(revealed_result.result -> 'catalog_item_id')
         is distinct from 'string' or
       jsonb_typeof(revealed_result.result -> 'tier_id')
         is distinct from 'string' or
       jsonb_typeof(revealed_result.result -> 'tier_rank')
         is distinct from 'number' or
       not (
         revealed_result.result ? 'selected_target_catalog_item_id'
       ) or
       (
         jsonb_typeof(
           revealed_result.result -> 'selected_target_catalog_item_id'
         ) is distinct from 'string' and
         jsonb_typeof(
           revealed_result.result -> 'selected_target_catalog_item_id'
         ) is distinct from 'null'
       ) or
       jsonb_typeof(revealed_result.result -> 'reason')
         is distinct from 'string' or
       jsonb_typeof(revealed_result.result -> 'rare_before')
         is distinct from 'number' or
       jsonb_typeof(revealed_result.result -> 'rare_after')
         is distinct from 'number' or
       jsonb_typeof(revealed_result.result -> 'epic_before')
         is distinct from 'number' or
       jsonb_typeof(revealed_result.result -> 'epic_after')
         is distinct from 'number' or
       jsonb_typeof(revealed_result.result -> 'selected_before')
         is distinct from 'number' or
       jsonb_typeof(revealed_result.result -> 'selected_after')
         is distinct from 'number' or
       jsonb_typeof(revealed_result.result -> 'is_duplicate')
         is distinct from 'boolean' or
       jsonb_typeof(revealed_result.result -> 'duplicate_dust_amount')
         is distinct from 'number' or
       jsonb_typeof(revealed_result.result -> 'is_first_copy')
         is distinct from 'boolean' or
       jsonb_typeof(revealed_result.result -> 'nonce')
         is distinct from 'string' or
       jsonb_typeof(revealed_result.result -> 'commitment')
         is distinct from 'string' then
      raise exception 'Reveal result omitted or mistyped a required field';
    end if;

    if (revealed_result.result ->> 'position') !~ '^[1-9][0-9]*$' or
       (revealed_result.result ->> 'tier_rank') !~ '^[0-9]+$' or
       (revealed_result.result ->> 'rare_before') !~ '^[0-9]+$' or
       (revealed_result.result ->> 'rare_after') !~ '^[0-9]+$' or
       (revealed_result.result ->> 'epic_before') !~ '^[0-9]+$' or
       (revealed_result.result ->> 'epic_after') !~ '^[0-9]+$' or
       (revealed_result.result ->> 'selected_before') !~ '^[0-9]+$' or
       (revealed_result.result ->> 'selected_after') !~ '^[0-9]+$' or
       (revealed_result.result ->> 'duplicate_dust_amount')
         !~ '^[0-9]+$' or
       (revealed_result.result ->> 'reason') not in (
         'base',
         'rare-guarantee',
         'epic-guarantee',
         'selected-guarantee',
         'soft-pity'
       ) or
       (revealed_result.result ->> 'nonce') !~ '^[0-9a-f]{64}$' or
       (revealed_result.result ->> 'commitment') !~ '^[0-9a-f]{64}$' or
       (revealed_result.result ->> 'position')::bigint
         is distinct from revealed_result.ordinality then
      raise exception 'Reveal result positions are not contiguous and ordered';
    end if;

    computed_commitment := encode(
      extensions.digest(
        convert_to(
          'dicesuki.pull.result.v1' || E'\n' ||
          'session=' || (commit_receipt ->> 'session_id') || E'\n' ||
          'position=' || (revealed_result.result ->> 'position') || E'\n' ||
          'catalogItemId=' ||
            (revealed_result.result ->> 'catalog_item_id') || E'\n' ||
          'tierId=' || (revealed_result.result ->> 'tier_id') || E'\n' ||
          'tierRank=' || (revealed_result.result ->> 'tier_rank') || E'\n' ||
          'selectedTargetCatalogItemId=' ||
            coalesce(
              revealed_result.result ->> 'selected_target_catalog_item_id',
              ''
            ) || E'\n' ||
          'reason=' || (revealed_result.result ->> 'reason') || E'\n' ||
          'rareBefore=' ||
            (revealed_result.result ->> 'rare_before') || E'\n' ||
          'rareAfter=' ||
            (revealed_result.result ->> 'rare_after') || E'\n' ||
          'epicBefore=' ||
            (revealed_result.result ->> 'epic_before') || E'\n' ||
          'epicAfter=' ||
            (revealed_result.result ->> 'epic_after') || E'\n' ||
          'selectedBefore=' ||
            (revealed_result.result ->> 'selected_before') || E'\n' ||
          'selectedAfter=' ||
            (revealed_result.result ->> 'selected_after') || E'\n' ||
          'duplicate=' ||
            (revealed_result.result ->> 'is_duplicate') || E'\n' ||
          'duplicateDust=' ||
            (revealed_result.result ->> 'duplicate_dust_amount') || E'\n' ||
          'nonce=' || (revealed_result.result ->> 'nonce'),
          'UTF8'
        ),
        'sha256'
      ),
      'hex'
    );

    if computed_commitment is distinct from
       (revealed_result.result ->> 'commitment') then
      raise exception 'Client-style result commitment verification failed';
    end if;

    computed_commitments := array_append(
      computed_commitments,
      computed_commitment
    );
  end loop;

  if cardinality(computed_commitments) is distinct from
     jsonb_array_length(commit_receipt -> 'results') then
    raise exception 'Client verifier did not consume every revealed result';
  end if;

  select encode(
    extensions.digest(
      convert_to(
        'dicesuki.pull.root.v1' || E'\n' ||
        'session=' || (commit_receipt ->> 'session_id') || E'\n' ||
        'count=' || cardinality(computed_commitments)::text || E'\n' ||
        coalesce((
          select string_agg(
            entry.ordinality::text || ':' || entry.commitment,
            E'\n'
            order by entry.ordinality
          )
          from unnest(computed_commitments)
            with ordinality as entry(commitment, ordinality)
        ), ''),
        'UTF8'
      ),
      'sha256'
    ),
    'hex'
  ) into computed_root;

  if computed_root is distinct from
     (commit_receipt ->> 'commitment_root') then
    raise exception 'Client-style ordered commitment-root verification failed';
  end if;
end;
$$;

-- Replay through the public boundary only after recording the guarantee CTID.
set local "request.jwt.claims" =
  '{"sub":"c1700000-0000-4170-8170-000000000001","is_anonymous":false}';
set local role authenticated;

do $$
declare
  commit_receipt jsonb :=
    current_setting('slice6.main_commit_receipt')::jsonb;
  replay_receipt jsonb;
  fetched_receipt jsonb;
begin
  replay_receipt := public.commit_pull_session(
    current_setting('slice6.main_session_id')::uuid
  );
  fetched_receipt := public.get_committed_pull_reveal(
    current_setting('slice6.main_session_id')::uuid
  );

  if replay_receipt is distinct from commit_receipt or
     fetched_receipt is distinct from commit_receipt then
    raise exception 'Commit replay or committed reveal getter changed receipt';
  end if;
end;
$$;

reset role;

do $$
begin
  if (select guarantee.ctid::text
      from public.pull_guarantee_states as guarantee
      join public.pull_sessions as session
        on session.account_id = guarantee.account_id
       and session.banner_family_id = guarantee.banner_family_id
      where session.id = current_setting('slice6.main_session_id')::uuid
        and guarantee.user_id =
          'c1700000-0000-4170-8170-000000000001')
       is distinct from current_setting('slice6.main_guarantee_ctid') then
    raise exception 'Exact commit replay rewrote the durable guarantee row';
  end if;
end;
$$;

-- The committed transition releases the family gate immediately. Preparation
-- remains read-only with respect to the durable guarantee row.
set local "request.jwt.claims" =
  '{"sub":"c1700000-0000-4170-8170-000000000001","is_anonymous":false}';
set local role authenticated;

do $$
declare
  next_prepared record;
begin
  select * into strict next_prepared
  from public.prepare_pull(
    'slice6-stars-core@1',
    2::smallint,
    'slice6:commit:main:prepare:0002'
  );
  if next_prepared.session_id =
       current_setting('slice6.main_session_id')::uuid or
     next_prepared.held_amount is distinct from 320 then
    raise exception 'Terminal exclusion did not permit a new same-family prepare';
  end if;
end;
$$;

reset role;

-- Exact cardinalities prove that commit replay did not append another
-- transition, debit, Dust credit, dice copy, or guarantee effect.
do $$
begin
  if (select current_balance
      from public.wallet_balances
      where user_id = 'c1700000-0000-4170-8170-000000000001'
        and currency_id = 'stars'
        and balance_bucket = 'promotional') <> 320 or
     (select current_balance
      from public.wallet_balances
      where user_id = 'c1700000-0000-4170-8170-000000000001'
        and currency_id = 'dust'
        and balance_bucket = 'earned') <> 17 or
     (select count(*)
      from public.wallet_ledger_entries
      where user_id = 'c1700000-0000-4170-8170-000000000001'
        and reason_code = 'pull.commit.stars.debit'
        and delta_amount = -320) <> 1 or
     (select count(*)
      from public.wallet_ledger_entries
      where user_id = 'c1700000-0000-4170-8170-000000000001'
        and reason_code = 'pull.commit.duplicate_dust.credit'
        and delta_amount = 17) <> 1 or
     (select count(*)
      from public.pull_session_transitions
      where user_id = 'c1700000-0000-4170-8170-000000000001'
        and kind = 'committed') <> 1 or
     (select count(*)
      from public.dice_copies
      where user_id = 'c1700000-0000-4170-8170-000000000001'
        and catalog_item_id = 'slice6-commit/d20/legendary@1'
        and source_kind = 'pull'
        and scrapped_at is null) <> 2 or
     (select count(*)
      from public.dice_copies
      where user_id = 'c1700000-0000-4170-8170-000000000001'
        and catalog_item_id = 'slice6-commit/d20/legendary@1'
        and is_first_copy) <> 1 or
     exists (
       select 1
       from public.user_entitlements
       where user_id = 'c1700000-0000-4170-8170-000000000001'
         and catalog_item_id = 'slice6-commit/d20/legendary@1'
         and grant_reason = 'pull'
     ) or
     not exists (
       select 1
       from public.pull_guarantee_states as guarantee
       join public.pull_sessions as session
         on session.account_id = guarantee.account_id
        and session.banner_family_id = guarantee.banner_family_id
       where session.id =
             current_setting('slice6.main_session_id')::uuid
         and guarantee.user_id =
             'c1700000-0000-4170-8170-000000000001'
         and (
           guarantee.total_pulls,
           guarantee.rare_misses,
           guarantee.epic_misses,
           guarantee.selected_misses
         ) = (
           session.total_pulls_projected,
           session.rare_misses_projected,
           session.epic_misses_projected,
           session.selected_misses_projected
         )
     ) or
     (select guarantee.ctid::text
      from public.pull_guarantee_states as guarantee
      join public.pull_sessions as session
        on session.account_id = guarantee.account_id
       and session.banner_family_id = guarantee.banner_family_id
      where session.id = current_setting('slice6.main_session_id')::uuid
        and guarantee.user_id =
          'c1700000-0000-4170-8170-000000000001')
       is distinct from current_setting('slice6.main_guarantee_ctid') or
     (select count(*)
      from public.pull_sessions
      where user_id = 'c1700000-0000-4170-8170-000000000001') <> 2 or
     (select count(*)
      from public.pull_sessions as session
      where session.user_id =
            'c1700000-0000-4170-8170-000000000001'
        and not exists (
          select 1
          from public.pull_session_transitions as transition
          where transition.session_id = session.id
        )) <> 1 then
    raise exception 'Commit/replay effects or terminal family release drifted';
  end if;
end;
$$;

-- Neither commit nor the committed reveal getter may cross the owner boundary.
set local "request.jwt.claims" =
  '{"sub":"c1700000-0000-4170-8170-000000000002","is_anonymous":false}';
set local role authenticated;

do $$
begin
  begin
    perform public.commit_pull_session(
      current_setting('slice6.main_session_id')::uuid
    );
    raise exception 'Cross-user commit unexpectedly succeeded';
  exception when sqlstate '23503' then
    null;
  end;

  begin
    perform public.get_committed_pull_reveal(
      current_setting('slice6.main_session_id')::uuid
    );
    raise exception 'Cross-user committed reveal unexpectedly succeeded';
  exception when sqlstate '23503' then
    null;
  end;
end;
$$;

reset role;

-- Cancel is terminal and reservation-only; a later commit must fail.
set local "request.jwt.claims" =
  '{"sub":"c1700000-0000-4170-8170-000000000003","is_anonymous":false}';
set local role authenticated;

do $$
declare
  prepared record;
  cancelled public.pull_session_transitions%rowtype;
begin
  select * into strict prepared
  from public.prepare_pull(
    'slice6-stars-core@1',
    1::smallint,
    'slice6:commit:cancelled:prepare:0001'
  );
  cancelled := public.cancel_pull_session(prepared.session_id);

  if cancelled.kind <> 'cancelled' then
    raise exception 'Cancellation did not append a cancelled transition';
  end if;

  begin
    perform public.commit_pull_session(prepared.session_id);
    raise exception 'Cancelled session unexpectedly committed';
  exception when sqlstate '55000' then
    null;
  end;
end;
$$;

reset role;

do $$
begin
  if (select current_balance
      from public.wallet_balances
      where user_id = 'c1700000-0000-4170-8170-000000000003'
        and currency_id = 'stars'
        and balance_bucket = 'promotional') <> 320 or
     (select count(*)
      from public.wallet_ledger_entries
      where user_id = 'c1700000-0000-4170-8170-000000000003') <> 1 or
     exists (
       select 1
       from public.dice_copies
       where user_id = 'c1700000-0000-4170-8170-000000000003'
         and source_kind = 'pull'
     ) or
     exists (
       select 1
       from public.pull_guarantee_states
       where user_id = 'c1700000-0000-4170-8170-000000000003'
     ) or
     (select count(*)
      from public.pull_session_transitions
      where user_id = 'c1700000-0000-4170-8170-000000000003'
        and kind = 'cancelled') <> 1 then
    raise exception 'Cancel-then-commit changed settlement state';
  end if;
end;
$$;

-- Commit is terminal; a later cancellation must fail.
set local "request.jwt.claims" =
  '{"sub":"c1700000-0000-4170-8170-000000000004","is_anonymous":false}';
set local role authenticated;

do $$
declare
  prepared record;
  reveal jsonb;
begin
  select * into strict prepared
  from public.prepare_pull(
    'slice6-stars-core@1',
    1::smallint,
    'slice6:commit:committed:prepare:0001'
  );
  reveal := public.commit_pull_session(prepared.session_id);

  if (reveal ->> 'session_id')::uuid <> prepared.session_id then
    raise exception 'Commit-then-cancel fixture did not commit';
  end if;

  begin
    perform public.cancel_pull_session(prepared.session_id);
    raise exception 'Committed session unexpectedly cancelled';
  exception when sqlstate '55000' then
    null;
  end;
end;
$$;

reset role;

-- The private time override is test-only and must already be expired.
do $$
declare
  expired public.pull_sessions%rowtype;
begin
  perform set_config(
    'request.jwt.claims',
    '{"sub":"c1700000-0000-4170-8170-000000000005","is_anonymous":false}',
    true
  );
  expired := private.prepare_pull_for_user(
    'c1700000-0000-4170-8170-000000000005',
    'slice6-stars-core@1',
    1::smallint,
    'slice6:commit:expired:prepare:0001',
    statement_timestamp() - interval '121 seconds',
    false
  );
  perform set_config('slice6.expired_session_id', expired.id::text, true);
end;
$$;

set local "request.jwt.claims" =
  '{"sub":"c1700000-0000-4170-8170-000000000005","is_anonymous":false}';
set local role authenticated;

do $$
begin
  begin
    perform public.commit_pull_session(
      current_setting('slice6.expired_session_id')::uuid
    );
    raise exception 'Expired session unexpectedly committed';
  exception when sqlstate '55000' then
    null;
  end;
end;
$$;

reset role;

do $$
begin
  if (select current_balance
      from public.wallet_balances
      where user_id = 'c1700000-0000-4170-8170-000000000005'
        and currency_id = 'stars'
        and balance_bucket = 'promotional') <> 160 or
     (select count(*)
      from public.wallet_ledger_entries
      where user_id = 'c1700000-0000-4170-8170-000000000005') <> 1 or
     exists (
       select 1
       from public.pull_session_transitions
       where session_id =
         current_setting('slice6.expired_session_id')::uuid
     ) then
    raise exception 'Expired commit rejection left a settlement effect';
  end if;
end;
$$;

-- Ticket-funded settlement debits the held ticket quantity exactly once.
do $$
begin
  perform public.record_roll_ticket_ledger_entry(
    'c1700000-0000-4170-8170-000000000006',
    'standard_roll',
    2,
    'test.slice6.commit.ticket.seed',
    'slice6:commit:ticket:seed:0001',
    '{}'::jsonb
  );
end;
$$;

set local "request.jwt.claims" =
  '{"sub":"c1700000-0000-4170-8170-000000000006","is_anonymous":false}';
set local role authenticated;

do $$
declare
  prepared record;
  first_receipt jsonb;
  replay_receipt jsonb;
begin
  select * into strict prepared
  from public.prepare_pull(
    'slice6-ticket-core@1',
    1::smallint,
    'slice6:commit:ticket:prepare:0001'
  );

  first_receipt := public.commit_pull_session(prepared.session_id);
  replay_receipt := public.commit_pull_session(prepared.session_id);

  if prepared.held_amount <> 1 or
     (first_receipt ->> 'held_amount')::bigint <> 1 or
     jsonb_array_length(first_receipt -> 'results') <> 1 or
     replay_receipt is distinct from first_receipt then
    raise exception 'Ticket-funded commit or replay receipt drifted';
  end if;
end;
$$;

reset role;

do $$
begin
  if (select current_quantity
      from public.roll_ticket_balances
      where user_id = 'c1700000-0000-4170-8170-000000000006'
        and roll_type = 'standard_roll') <> 1 or
     (select count(*)
      from public.roll_ticket_ledger_entries
      where user_id = 'c1700000-0000-4170-8170-000000000006') <> 2 or
     (select count(*)
      from public.roll_ticket_ledger_entries
      where user_id = 'c1700000-0000-4170-8170-000000000006'
        and roll_type = 'standard_roll'
        and delta_quantity = -1
        and quantity_before = 2
        and quantity_after = 1
        and reason_code = 'pull.commit.standard_roll.debit') <> 1 or
     (select count(*)
      from public.pull_session_transitions
      where user_id = 'c1700000-0000-4170-8170-000000000006'
        and kind = 'committed') <> 1 or
     (select count(*)
      from public.dice_copies
      where user_id = 'c1700000-0000-4170-8170-000000000006'
        and source_kind = 'pull'
        and scrapped_at is null) <> 1 then
    raise exception 'Ticket commit did not debit held quantity exactly once';
  end if;
end;
$$;

rollback;
