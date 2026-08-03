begin;

-- Active-version fixture. 0030_earned_economy_rare_pity_10.sql restricted
-- preparation to a banner family's single highest version, and the
-- earned-collection family now heads at the ticket-funded
-- earned-collection-001@4. The Stars-funded preparation this suite proves is
-- therefore exercised on an appended test-only family that clones
-- earned-collection-001@1 byte for byte and heads its own lineage. Banner
-- history stays append-only: nothing published is rewritten.
insert into public.pull_banner_families (id) values ('slice18-legacy-stars');

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
  roll_type,
  soft_pity_model,
  soft_pity_start_pull,
  soft_pity_per_pull_increment
)
select
  'slice18-legacy-stars@1',
  'slice18-legacy-stars',
  1,
  'slice18-legacy-stars',
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
  roll_type,
  soft_pity_model,
  soft_pity_start_pull,
  soft_pity_per_pull_increment
from public.pull_banner_versions
where id = 'earned-collection-001@1';

insert into public.pull_banner_offers (banner_version_id, pull_count, cost)
select 'slice18-legacy-stars@1', pull_count, cost
from public.pull_banner_offers
where banner_version_id = 'earned-collection-001@1';

insert into public.pull_banner_tiers (
  banner_version_id,
  tier_id,
  tier_rank,
  weight_units,
  duplicate_dust
)
select 'slice18-legacy-stars@1', tier_id, tier_rank, weight_units, duplicate_dust
from public.pull_banner_tiers
where banner_version_id = 'earned-collection-001@1';

insert into public.pull_banner_items (
  banner_version_id,
  tier_id,
  tier_rank,
  canonical_order,
  catalog_item_id,
  selected_featured
)
select
  'slice18-legacy-stars@1',
  tier_id,
  tier_rank,
  canonical_order,
  catalog_item_id,
  selected_featured
from public.pull_banner_items
where banner_version_id = 'earned-collection-001@1';

do $fixture$
begin
  if (select count(*) from public.pull_banner_offers
      where banner_version_id = 'slice18-legacy-stars@1') <>
     (select count(*) from public.pull_banner_offers
      where banner_version_id = 'earned-collection-001@1') or
     (select count(*) from public.pull_banner_items
      where banner_version_id = 'slice18-legacy-stars@1') <>
     (select count(*) from public.pull_banner_items
      where banner_version_id = 'earned-collection-001@1') or
     (select max(banner_version) from public.pull_banner_versions
      where banner_family_id = 'slice18-legacy-stars') <> 1 then
    raise exception 'Stars-funded active-version fixture is not a complete version-1 clone';
  end if;
end;
$fixture$;

insert into auth.users (id) values
  ('c0270000-0000-4027-8027-000000000001'),
  ('c0270000-0000-4027-8027-000000000002'),
  ('c0270000-0000-4027-8027-000000000003'),
  ('c0270000-0000-4027-8027-000000000004'),
  ('c0270000-0000-4027-8027-000000000005');

-- The canonical append remains service-role-only. No direct table DML or
-- paid append capability is exposed to authenticated callers.
do $$
begin
  if not has_function_privilege(
       'service_role',
       'public.append_wallet_ledger_entry(uuid,text,text,bigint,text,text,text,jsonb)',
       'EXECUTE'
     ) or
     has_function_privilege(
       'authenticated',
       'public.append_wallet_ledger_entry(uuid,text,text,bigint,text,text,text,jsonb)',
       'EXECUTE'
     ) or
     has_function_privilege(
       'anon',
       'public.append_wallet_ledger_entry(uuid,text,text,bigint,text,text,text,jsonb)',
       'EXECUTE'
     ) or
     has_table_privilege(
       'authenticated', 'public.wallet_balances', 'INSERT'
     ) or
     has_table_privilege(
       'authenticated', 'public.wallet_ledger_entries', 'INSERT'
     ) then
    raise exception 'Wallet paid-append privilege boundary drifted';
  end if;
end;
$$;

-- Issue #154 delta 1 works: service_role can stage a paid-Star credit through
-- the one canonical append boundary and its materialized balance row appears.
set local role service_role;

select public.append_wallet_ledger_entry(
  'c0270000-0000-4027-8027-000000000001',
  'stars',
  'paid',
  500,
  'test.paid-stars.credit',
  'slice18:paid-credit:0001',
  'earned-collection@1',
  '{"issue":154,"slice":18}'::jsonb
);

reset role;

do $$
begin
  if not exists (
       select 1
       from public.wallet_balances
       where user_id = 'c0270000-0000-4027-8027-000000000001'
         and currency_id = 'stars'
         and balance_bucket = 'paid'
         and current_balance = 500
     ) or
     not exists (
       select 1
       from public.wallet_ledger_entries
       where user_id = 'c0270000-0000-4027-8027-000000000001'
         and currency_id = 'stars'
         and balance_bucket = 'paid'
         and delta_amount = 500
         and balance_before = 0
         and balance_after = 500
         and reason_code = 'test.paid-stars.credit'
         and idempotency_key = 'slice18:paid-credit:0001'
     ) then
    raise exception 'Service-role paid-Star credit did not materialize exactly';
  end if;
end;
$$;

-- Dormant means credit-only: even the trusted generic boundary cannot create a
-- paid spend before the #154 activation/debit-policy slice.
set local role service_role;

do $$
begin
  begin
    perform public.append_wallet_ledger_entry(
      'c0270000-0000-4027-8027-000000000001',
      'stars',
      'paid',
      -1,
      'test.paid-stars.debit',
      'slice18:paid-debit:0001',
      'earned-collection@1',
      '{}'::jsonb
    );
    raise exception 'Paid-Star debit unexpectedly succeeded before issue #154 activation';
  exception when sqlstate '55000' then
    null;
  end;
end;
$$;

reset role;

-- Privilege probes exercise actual calls as authenticated, for both signs.
set local "request.jwt.claims" =
  '{"sub":"c0270000-0000-4027-8027-000000000001","is_anonymous":false}';
set local role authenticated;

do $$
begin
  begin
    perform public.append_wallet_ledger_entry(
      'c0270000-0000-4027-8027-000000000001',
      'stars',
      'paid',
      1,
      'test.auth-paid.credit',
      'slice18:auth-paid-credit:0001',
      'earned-collection@1',
      '{}'::jsonb
    );
    raise exception 'Authenticated paid-Star append unexpectedly succeeded';
  exception when insufficient_privilege then
    null;
  end;

  begin
    perform public.append_wallet_ledger_entry(
      'c0270000-0000-4027-8027-000000000001',
      'stars',
      'paid',
      -1,
      'test.auth-paid.debit',
      'slice18:auth-paid-debit:0001',
      'earned-collection@1',
      '{}'::jsonb
    );
    raise exception 'Authenticated paid-Star append unexpectedly succeeded';
  exception when insufficient_privilege then
    null;
  end;
end;
$$;

reset role;

-- Existing free conversion remains pinned to promotional Stars. A user with
-- 320 paid Stars and zero promotional Stars cannot buy one standard_roll.
set local role service_role;

select public.append_wallet_ledger_entry(
  'c0270000-0000-4027-8027-000000000002',
  'stars',
  'paid',
  320,
  'test.paid-only.conversion',
  'slice18:paid-only-conversion:seed',
  'earned-collection@1',
  '{}'::jsonb
);

reset role;

set local "request.jwt.claims" =
  '{"sub":"c0270000-0000-4027-8027-000000000002","is_anonymous":false}';
set local role authenticated;

do $$
begin
  begin
    perform public.convert_stars_to_standard_roll(
      1,
      'slice18:paid-only-conversion:attempt'
    );
    raise exception 'Paid-only balance funded a standard-roll conversion';
  exception when sqlstate '22003' then
    null;
  end;
end;
$$;

reset role;

do $$
begin
  if exists (
       select 1
       from public.wallet_balances
       where user_id = 'c0270000-0000-4027-8027-000000000002'
         and currency_id = 'stars'
         and balance_bucket = 'promotional'
         and current_balance <> 0
     ) or
     exists (
       select 1
       from public.roll_ticket_ledger_entries
       where user_id = 'c0270000-0000-4027-8027-000000000002'
     ) or
     (select current_balance
      from public.wallet_balances
      where user_id = 'c0270000-0000-4027-8027-000000000002'
        and currency_id = 'stars'
        and balance_bucket = 'paid') <> 320 then
    raise exception 'Rejected paid-only conversion left a partial effect';
  end if;
end;
$$;

-- Legacy pull availability sums the banner's promotional bucket only. Paid
-- participation in hold reservation remains deferred to #154 activation.
set local role service_role;

select public.append_wallet_ledger_entry(
  'c0270000-0000-4027-8027-000000000003',
  'stars',
  'paid',
  160,
  'test.paid-only.pull',
  'slice18:paid-only-pull:seed',
  'earned-collection@1',
  '{}'::jsonb
);

reset role;

set local "request.jwt.claims" =
  '{"sub":"c0270000-0000-4027-8027-000000000003","is_anonymous":false}';
set local role authenticated;

do $$
begin
  begin
    perform public.prepare_pull(
      'slice18-legacy-stars@1',
      1::smallint,
      'slice18:paid-only-pull:attempt'
    );
    raise exception 'Paid-only balance funded a legacy promotional-Star pull hold';
  exception when sqlstate '22003' then
    null;
  end;
end;
$$;

reset role;

do $$
begin
  if exists (
       select 1
       from public.pull_sessions
       where user_id = 'c0270000-0000-4027-8027-000000000003'
     ) or
     (select current_balance
      from public.wallet_balances
      where user_id = 'c0270000-0000-4027-8027-000000000003'
        and currency_id = 'stars'
        and balance_bucket = 'paid') <> 160 then
    raise exception 'Rejected paid-only pull hold left a partial effect';
  end if;
end;
$$;

-- Lunar daily rewards are a free faucet even when the paid bucket exists.
set local role service_role;

select public.record_subscription_event(
  'c0270000-0000-4027-8027-000000000004',
  'slice18-lunar-subscription',
  'create_subscription',
  'lunar-plan',
  'lunar-pass',
  '2030-01-01 00:00:00+00',
  '2030-02-01 00:00:00+00',
  null,
  '{"fixture":"slice18-lunar"}'::jsonb,
  repeat('2', 64)
);

reset role;

-- Earlier scenarios in this transaction set request.jwt.claims via SET LOCAL,
-- which persists to transaction end; is_lunar_pass_active is self-only, so pin
-- the claims to the claiming user before invoking the private seam.
set local "request.jwt.claims" =
  '{"sub":"c0270000-0000-4027-8027-000000000004","is_anonymous":false}';

select private.claim_lunar_daily_stars_for_user(
  'c0270000-0000-4027-8027-000000000004',
  '2030-01-15 12:00:00+00'
);

do $$
begin
  if not exists (
       select 1
       from public.wallet_ledger_entries
       where user_id = 'c0270000-0000-4027-8027-000000000004'
         and currency_id = 'stars'
         and balance_bucket = 'promotional'
         and delta_amount = 90
         and reason_code = 'lunar.daily'
     ) or
     exists (
       select 1
       from public.wallet_balances
       where user_id = 'c0270000-0000-4027-8027-000000000004'
         and balance_bucket = 'paid'
     ) then
    raise exception 'Lunar daily claim did not remain promotional-only';
  end if;
end;
$$;

-- The post-copy-inventory Scrap source and craft sink stay on earned Dust.
set local role service_role;

do $$
declare
  granted public.dice_copies%rowtype;
begin
  granted := public.record_dice_copy_grant(
    'c0270000-0000-4027-8027-000000000005',
    'adventurer-starter/d6/common@1',
    'reward',
    'slice18:fixture:owned-common',
    'slice18:grant:owned-common'
  );
  perform set_config('slice18.common_copy_id', granted.id::text, true);

  perform public.append_wallet_ledger_entry(
    'c0270000-0000-4027-8027-000000000005',
    'dust',
    'earned',
    500,
    'test.slice18.craft-seed',
    'slice18:craft-dust-seed',
    'earned-collection@1',
    '{}'::jsonb
  );
end;
$$;

reset role;

set local "request.jwt.claims" =
  '{"sub":"c0270000-0000-4027-8027-000000000005","is_anonymous":false}';
set local role authenticated;

select public.craft_dice_copy(
  'adventurer-starter/d6/common@1',
  'slice18:craft-common:0001'
);

select public.scrap_dice_copy(
  current_setting('slice18.common_copy_id')::uuid,
  'slice18:scrap-common:0001'
);

reset role;

do $$
begin
  if not exists (
       select 1
       from public.wallet_ledger_entries
       where user_id = 'c0270000-0000-4027-8027-000000000005'
         and currency_id = 'dust'
         and balance_bucket = 'earned'
         and delta_amount < 0
         and reason_code = 'dice.craft.dust.debit'
     ) or
     not exists (
       select 1
       from public.wallet_ledger_entries
       where user_id = 'c0270000-0000-4027-8027-000000000005'
         and currency_id = 'dust'
         and balance_bucket = 'earned'
         and delta_amount > 0
         and reason_code = 'dice.scrap.dust.credit'
     ) or
     exists (
       select 1
       from public.wallet_ledger_entries
       where user_id = 'c0270000-0000-4027-8027-000000000005'
         and reason_code in (
           'dice.craft.dust.debit',
           'dice.scrap.dust.credit'
         )
         and (currency_id, balance_bucket) is distinct from ('dust', 'earned')
     ) then
    raise exception 'Scrap credit or craft debit escaped earned Dust';
  end if;
end;
$$;

-- The trusted API role still reaches the canonical validator, which rejects
-- every non-NULL pair except the exact three admitted pairs. Failed validation
-- happens before account locking or either wallet insert.
set local role service_role;

do $$
declare
  invalid_pair record;
begin
  for invalid_pair in
    select *
    from (values
      ('dust', 'paid'),
      ('stars', 'earned')
    ) as pairs(currency_id, balance_bucket)
  loop
    begin
      perform public.append_wallet_ledger_entry(
        'c0270000-0000-4027-8027-000000000001',
        invalid_pair.currency_id,
        invalid_pair.balance_bucket,
        1,
        'test.invalid-pair',
        'slice18:service-invalid:' ||
          invalid_pair.currency_id || ':' || invalid_pair.balance_bucket,
        'earned-collection@1',
        '{}'::jsonb
      );
      raise exception 'Canonical append accepted an invalid currency/bucket pair';
    exception when sqlstate '22023' then
      null;
    end;
  end loop;
end;
$$;

reset role;

do $$
begin
  if (select count(*)
      from public.wallet_balances
      where user_id = 'c0270000-0000-4027-8027-000000000001') <> 1 or
     (select count(*)
      from public.wallet_ledger_entries
      where user_id = 'c0270000-0000-4027-8027-000000000001') <> 1 or
     exists (
       select 1
       from public.wallet_balances
       where user_id = 'c0270000-0000-4027-8027-000000000001'
         and (currency_id, balance_bucket) in (
           ('dust', 'paid'),
           ('stars', 'earned')
         )
     ) or
     exists (
       select 1
       from public.wallet_ledger_entries
       where user_id = 'c0270000-0000-4027-8027-000000000001'
         and idempotency_key like 'slice18:service-invalid:%'
     ) then
    raise exception 'Service-role invalid append probes changed wallet state';
  end if;
end;
$$;

-- Inspect the installed constraints, not only migration text. Exact literal
-- counts prove that each pair CHECK admits promotional Stars, paid Stars, and
-- earned Dust only; every touched CHECK independently rejects NULL/UNKNOWN.
do $$
declare
  balances_pair_def text;
  ledger_bucket_def text;
  ledger_pair_def text;
begin
  select lower(pg_get_constraintdef(oid))
  into strict balances_pair_def
  from pg_constraint
  where conrelid = 'public.wallet_balances'::regclass
    and conname = 'wallet_balances_currency_bucket_pair';

  select lower(pg_get_constraintdef(oid))
  into strict ledger_bucket_def
  from pg_constraint
  where conrelid = 'public.wallet_ledger_entries'::regclass
    and conname = 'wallet_ledger_entries_balance_bucket_check';

  select lower(pg_get_constraintdef(oid))
  into strict ledger_pair_def
  from pg_constraint
  where conrelid = 'public.wallet_ledger_entries'::regclass
    and conname = 'wallet_ledger_entries_currency_bucket_pair';

  if position('currency_id is not null' in balances_pair_def) = 0 or
     position('balance_bucket is not null' in balances_pair_def) = 0 or
     regexp_count(balances_pair_def, '''stars''') <> 2 or
     regexp_count(balances_pair_def, '''dust''') <> 1 or
     regexp_count(balances_pair_def, '''promotional''') <> 1 or
     regexp_count(balances_pair_def, '''paid''') <> 1 or
     regexp_count(balances_pair_def, '''earned''') <> 1 or
     balances_pair_def like '%premium%' or
     position('balance_bucket is not null' in ledger_bucket_def) = 0 or
     regexp_count(ledger_bucket_def, '''promotional''') <> 1 or
     regexp_count(ledger_bucket_def, '''paid''') <> 1 or
     regexp_count(ledger_bucket_def, '''earned''') <> 1 or
     ledger_bucket_def like '%premium%' or
     position('currency_id is not null' in ledger_pair_def) = 0 or
     position('balance_bucket is not null' in ledger_pair_def) = 0 or
     regexp_count(ledger_pair_def, '''stars''') <> 2 or
     regexp_count(ledger_pair_def, '''dust''') <> 1 or
     regexp_count(ledger_pair_def, '''promotional''') <> 1 or
     regexp_count(ledger_pair_def, '''paid''') <> 1 or
     regexp_count(ledger_pair_def, '''earned''') <> 1 or
     ledger_pair_def like '%premium%' then
    raise exception 'Runtime constraint definitions did not preserve the exact NULL-safe paid-pair widening';
  end if;
end;
$$;

-- Runtime pair probes distinguish the exact check that rejects each invalid
-- row. The explicit NULL tests prove neither table nor append validation has a
-- CHECK UNKNOWN acceptance path.
do $$
declare
  target_account_id uuid;
  rejected_constraint text;
begin
  select id into strict target_account_id
  from public.wallet_accounts
  where user_id = 'c0270000-0000-4027-8027-000000000001';

  begin
    insert into public.wallet_balances (
      account_id, user_id, currency_id, balance_bucket, current_balance
    ) values (
      target_account_id,
      'c0270000-0000-4027-8027-000000000001',
      'dust',
      'paid',
      0
    );
    raise exception 'wallet_balances accepted an invalid currency/bucket pair';
  exception when check_violation then
    get stacked diagnostics rejected_constraint = constraint_name;
    if rejected_constraint <> 'wallet_balances_currency_bucket_pair' then
      raise exception 'wallet_balances rejected dust/paid through %, not its pair rule',
        rejected_constraint;
    end if;
  end;

  begin
    insert into public.wallet_balances (
      account_id, user_id, currency_id, balance_bucket, current_balance
    ) values (
      target_account_id,
      'c0270000-0000-4027-8027-000000000001',
      'stars',
      'earned',
      0
    );
    raise exception 'wallet_balances accepted an invalid currency/bucket pair';
  exception when check_violation then
    get stacked diagnostics rejected_constraint = constraint_name;
    if rejected_constraint <> 'wallet_balances_currency_bucket_pair' then
      raise exception 'wallet_balances rejected stars/earned through %, not its pair rule',
        rejected_constraint;
    end if;
  end;

  begin
    insert into public.wallet_ledger_entries (
      account_id, user_id, currency_id, balance_bucket,
      delta_amount, balance_before, balance_after,
      reason_code, idempotency_key, economy_edition_id, provenance
    ) values (
      target_account_id,
      'c0270000-0000-4027-8027-000000000001',
      'dust',
      'paid',
      1,
      0,
      1,
      'test.invalid-pair',
      'slice18:invalid-ledger:dust-paid',
      'earned-collection@1',
      '{}'::jsonb
    );
    raise exception 'wallet_ledger_entries accepted an invalid currency/bucket pair';
  exception when check_violation then
    get stacked diagnostics rejected_constraint = constraint_name;
    if rejected_constraint <> 'wallet_ledger_entries_currency_bucket_pair' then
      raise exception 'wallet_ledger_entries rejected dust/paid through %, not its pair rule',
        rejected_constraint;
    end if;
  end;

  begin
    insert into public.wallet_ledger_entries (
      account_id, user_id, currency_id, balance_bucket,
      delta_amount, balance_before, balance_after,
      reason_code, idempotency_key, economy_edition_id, provenance
    ) values (
      target_account_id,
      'c0270000-0000-4027-8027-000000000001',
      'stars',
      'earned',
      1,
      0,
      1,
      'test.invalid-pair',
      'slice18:invalid-ledger:stars-earned',
      'earned-collection@1',
      '{}'::jsonb
    );
    raise exception 'wallet_ledger_entries accepted an invalid currency/bucket pair';
  exception when check_violation then
    get stacked diagnostics rejected_constraint = constraint_name;
    if rejected_constraint <> 'wallet_ledger_entries_currency_bucket_pair' then
      raise exception 'wallet_ledger_entries rejected stars/earned through %, not its pair rule',
        rejected_constraint;
    end if;
  end;

  begin
    insert into public.wallet_ledger_entries (
      account_id, user_id, currency_id, balance_bucket,
      delta_amount, balance_before, balance_after,
      reason_code, idempotency_key, economy_edition_id, provenance
    ) values (
      target_account_id,
      'c0270000-0000-4027-8027-000000000001',
      'dust',
      'promotional',
      1,
      0,
      1,
      'test.invalid-pair',
      'slice18:invalid-ledger:dust-promotional',
      'earned-collection@1',
      '{}'::jsonb
    );
    raise exception 'wallet_ledger_entries accepted an invalid currency/bucket pair';
  exception when check_violation then
    get stacked diagnostics rejected_constraint = constraint_name;
    if rejected_constraint <> 'wallet_ledger_entries_currency_bucket_pair' then
      raise exception 'wallet_ledger_entries rejected dust/promotional through %, not its pair rule',
        rejected_constraint;
    end if;
  end;

  begin
    insert into public.wallet_ledger_entries (
      account_id, user_id, currency_id, balance_bucket,
      delta_amount, balance_before, balance_after,
      reason_code, idempotency_key, economy_edition_id, provenance
    ) values (
      target_account_id,
      'c0270000-0000-4027-8027-000000000001',
      'stars',
      'premium',
      1,
      0,
      1,
      'test.invalid-bucket',
      'slice18:invalid-ledger:premium',
      'earned-collection@1',
      '{}'::jsonb
    );
    raise exception 'wallet_ledger_entries accepted an invalid balance bucket';
  exception when check_violation then
    get stacked diagnostics rejected_constraint = constraint_name;
    if rejected_constraint <> 'wallet_ledger_entries_balance_bucket_check' then
      raise exception 'wallet_ledger_entries rejected premium through %, not its bucket rule',
        rejected_constraint;
    end if;
  end;

  begin
    insert into public.wallet_balances (
      account_id, user_id, currency_id, balance_bucket, current_balance
    ) values (
      target_account_id,
      'c0270000-0000-4027-8027-000000000001',
      null,
      'paid',
      0
    );
    raise exception 'wallet_balances accepted a NULL currency pair';
  exception when not_null_violation then
    null;
  end;

  begin
    insert into public.wallet_balances (
      account_id, user_id, currency_id, balance_bucket, current_balance
    ) values (
      target_account_id,
      'c0270000-0000-4027-8027-000000000001',
      'stars',
      null,
      0
    );
    raise exception 'wallet_balances accepted a NULL bucket pair';
  exception when not_null_violation then
    null;
  end;

  begin
    insert into public.wallet_ledger_entries (
      account_id, user_id, currency_id, balance_bucket,
      delta_amount, balance_before, balance_after,
      reason_code, idempotency_key, economy_edition_id, provenance
    ) values (
      target_account_id,
      'c0270000-0000-4027-8027-000000000001',
      null,
      'paid',
      1,
      0,
      1,
      'test.null-pair',
      'slice18:null-ledger:currency',
      'earned-collection@1',
      '{}'::jsonb
    );
    raise exception 'wallet_ledger_entries accepted a NULL currency pair';
  exception when not_null_violation then
    null;
  end;

  begin
    insert into public.wallet_ledger_entries (
      account_id, user_id, currency_id, balance_bucket,
      delta_amount, balance_before, balance_after,
      reason_code, idempotency_key, economy_edition_id, provenance
    ) values (
      target_account_id,
      'c0270000-0000-4027-8027-000000000001',
      'stars',
      null,
      1,
      0,
      1,
      'test.null-pair',
      'slice18:null-ledger:bucket',
      'earned-collection@1',
      '{}'::jsonb
    );
    raise exception 'wallet_ledger_entries accepted a NULL bucket pair';
  exception when not_null_violation then
    null;
  end;

  begin
    perform public.append_wallet_ledger_entry(
      'c0270000-0000-4027-8027-000000000001',
      null,
      'paid',
      1,
      'test.null-pair',
      'slice18:null-pair:currency',
      'earned-collection@1',
      '{}'::jsonb
    );
    raise exception 'NULL currency/bucket input escaped the canonical validator';
  exception when sqlstate '22023' then
    null;
  end;

  begin
    perform public.append_wallet_ledger_entry(
      'c0270000-0000-4027-8027-000000000001',
      'stars',
      null,
      1,
      'test.null-pair',
      'slice18:null-pair:bucket',
      'earned-collection@1',
      '{}'::jsonb
    );
    raise exception 'NULL currency/bucket input escaped the canonical validator';
  exception when sqlstate '22023' then
    null;
  end;
end;
$$;

-- Rejected debit and caller probes did not disturb the staged paid balance.
do $$
begin
  if (select current_balance
      from public.wallet_balances
      where user_id = 'c0270000-0000-4027-8027-000000000001'
        and currency_id = 'stars'
        and balance_bucket = 'paid') <> 500 or
     (select count(*)
      from public.wallet_ledger_entries
      where user_id = 'c0270000-0000-4027-8027-000000000001'
        and currency_id = 'stars'
        and balance_bucket = 'paid') <> 1 then
    raise exception 'Rejected paid mutations changed the staged paid balance';
  end if;
end;
$$;

rollback;
