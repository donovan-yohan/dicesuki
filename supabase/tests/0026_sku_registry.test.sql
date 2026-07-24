begin;

insert into auth.users (id) values
  ('c0260000-0000-4026-8026-000000000001');

-- The migration must contain exactly the six PO-locked Star bundles from spec
-- section 2 plus the section 3.1 Lunar Pass SKU. Compare every stored field,
-- including the dormant sandbox status and initial value version.
do $$
begin
  if (select count(*) from public.store_skus) <> 7 or
     exists (
       (
         select
           sku_id,
           sku_class,
           price_usd_cents,
           star_raw,
           star_bonus,
           star_total,
           first_time_total,
           product_id,
           catalog_item_id,
           status,
           value_version
         from public.store_skus
         except all
         select *
         from (values
           ('stars_handful',      'star_bundle',  49,   60,    0,   60,   120, null::text, null::text, 'sandbox', 1),
           ('stars_pouch',        'star_bundle', 249,  300,   30,  330,   600, null::text, null::text, 'sandbox', 1),
           ('stars_bag',          'star_bundle', 749,  980,  110, 1090,  1960, null::text, null::text, 'sandbox', 1),
           ('stars_chest',        'star_bundle', 1499, 1980,  260, 2240,  3960, null::text, null::text, 'sandbox', 1),
           ('stars_vault',        'star_bundle', 2499, 3280,  600, 3880,  6560, null::text, null::text, 'sandbox', 1),
           ('stars_hoard',        'star_bundle', 4999, 6480, 1600, 8080, 12960, null::text, null::text, 'sandbox', 1),
           ('lunar_pass_monthly', 'subscription', 299, null::integer, null::integer, null::integer, null::integer, 'lunar-pass', null::text, 'sandbox', 1)
         ) as expected(
           sku_id,
           sku_class,
           price_usd_cents,
           star_raw,
           star_bonus,
           star_total,
           first_time_total,
           product_id,
           catalog_item_id,
           status,
           value_version
         )
       )
       union all
       (
         select *
         from (values
           ('stars_handful',      'star_bundle',  49,   60,    0,   60,   120, null::text, null::text, 'sandbox', 1),
           ('stars_pouch',        'star_bundle', 249,  300,   30,  330,   600, null::text, null::text, 'sandbox', 1),
           ('stars_bag',          'star_bundle', 749,  980,  110, 1090,  1960, null::text, null::text, 'sandbox', 1),
           ('stars_chest',        'star_bundle', 1499, 1980,  260, 2240,  3960, null::text, null::text, 'sandbox', 1),
           ('stars_vault',        'star_bundle', 2499, 3280,  600, 3880,  6560, null::text, null::text, 'sandbox', 1),
           ('stars_hoard',        'star_bundle', 4999, 6480, 1600, 8080, 12960, null::text, null::text, 'sandbox', 1),
           ('lunar_pass_monthly', 'subscription', 299, null::integer, null::integer, null::integer, null::integer, 'lunar-pass', null::text, 'sandbox', 1)
         ) as expected(
           sku_id,
           sku_class,
           price_usd_cents,
           star_raw,
           star_bonus,
           star_total,
           first_time_total,
           product_id,
           catalog_item_id,
           status,
           value_version
         )
         except all
         select
           sku_id,
           sku_class,
           price_usd_cents,
           star_raw,
           star_bonus,
           star_total,
           first_time_total,
           product_id,
           catalog_item_id,
           status,
           value_version
         from public.store_skus
       )
     ) then
    raise exception 'Store SKU seed rows drifted from spec sections 2 and 3.1';
  end if;
end;
$$;

-- Row-local arithmetic and class ownership are executable constraints. Every
-- nullable comparison gets an explicit NULL probe so CHECK UNKNOWN cannot
-- become an acceptance path.
do $$
begin
  begin
    insert into public.store_skus (
      sku_id, sku_class, price_usd_cents,
      star_raw, star_bonus, star_total, first_time_total
    ) values (
      'test_bad_total', 'star_bundle', 100,
      100, 20, 121, 200
    );
    raise exception 'Mismatched Star total unexpectedly succeeded';
  exception when check_violation then
    null;
  end;

  begin
    insert into public.store_skus (
      sku_id, sku_class, price_usd_cents,
      star_raw, star_bonus, star_total, first_time_total
    ) values (
      'test_bad_first_time', 'star_bundle', 100,
      100, 20, 120, 201
    );
    raise exception 'Mismatched first-time total unexpectedly succeeded';
  exception when check_violation then
    null;
  end;

  begin
    insert into public.store_skus (
      sku_id, sku_class, price_usd_cents,
      star_raw, star_bonus, star_total, first_time_total
    ) values (
      'test_null_star_raw', 'star_bundle', 100,
      null, 20, 120, 200
    );
    raise exception 'NULL star_raw hole unexpectedly succeeded';
  exception when check_violation then
    null;
  end;

  begin
    insert into public.store_skus (
      sku_id, sku_class, price_usd_cents,
      star_raw, star_bonus, star_total, first_time_total
    ) values (
      'test_null_star_bonus', 'star_bundle', 100,
      100, null, 100, 200
    );
    raise exception 'NULL star_bonus hole unexpectedly succeeded';
  exception when check_violation then
    null;
  end;

  begin
    insert into public.store_skus (
      sku_id, sku_class, price_usd_cents,
      star_raw, star_bonus, star_total, first_time_total
    ) values (
      'test_null_star_total', 'star_bundle', 100,
      100, 20, null, 200
    );
    raise exception 'NULL star_total hole unexpectedly succeeded';
  exception when check_violation then
    null;
  end;

  begin
    insert into public.store_skus (
      sku_id, sku_class, price_usd_cents,
      star_raw, star_bonus, star_total, first_time_total
    ) values (
      'test_null_first_time', 'star_bundle', 100,
      100, 20, 120, null
    );
    raise exception 'NULL first_time_total hole unexpectedly succeeded';
  exception when check_violation then
    null;
  end;

  begin
    insert into public.store_skus (
      sku_id, sku_class, price_usd_cents, product_id
    ) values (
      'test_subscription_without_product', 'subscription', 100, null
    );
    raise exception 'Subscription without product_id unexpectedly succeeded';
  exception when check_violation then
    null;
  end;

  begin
    insert into public.store_skus (
      sku_id, sku_class, price_usd_cents,
      star_raw, star_bonus, star_total, first_time_total, product_id
    ) values (
      'test_subscription_with_stars', 'subscription', 100,
      100, 0, 100, 200, 'test-product'
    );
    raise exception 'Subscription with Star fields unexpectedly succeeded';
  exception when check_violation then
    null;
  end;

  begin
    insert into public.store_skus (
      sku_id, sku_class, price_usd_cents,
      star_raw, star_bonus, star_total, first_time_total, catalog_item_id
    ) values (
      'test_star_with_catalog', 'star_bundle', 100,
      100, 0, 100, 200, 'void-crystal/d20/legendary@1'
    );
    raise exception 'Star bundle with catalog_item_id unexpectedly succeeded';
  exception when check_violation then
    null;
  end;

  begin
    insert into public.store_skus (
      sku_id, sku_class, price_usd_cents, product_id, catalog_item_id
    ) values (
      'test_subscription_with_catalog', 'subscription', 100,
      'test-product', 'void-crystal/d20/legendary@1'
    );
    raise exception 'Subscription with catalog_item_id unexpectedly succeeded';
  exception when check_violation then
    null;
  end;

  begin
    insert into public.store_skus (
      sku_id, sku_class, price_usd_cents
    ) values (
      'test_die_without_catalog', 'die', 100
    );
    raise exception 'Die SKU without catalog_item_id unexpectedly succeeded';
  exception when check_violation then
    null;
  end;

  begin
    insert into public.store_skus (
      sku_id, sku_class, price_usd_cents, product_id, catalog_item_id
    ) values (
      'test_die_with_product', 'die', 100,
      'wrong-owner', 'void-crystal/d20/legendary@1'
    );
    raise exception 'Die SKU with product_id unexpectedly succeeded';
  exception when check_violation then
    null;
  end;

  begin
    insert into public.store_skus (
      sku_id, sku_class, price_usd_cents,
      star_raw, star_bonus, star_total, first_time_total, catalog_item_id
    ) values (
      'test_die_with_stars', 'die', 100,
      100, 0, 100, 200, 'void-crystal/d20/legendary@1'
    );
    raise exception 'Die SKU with Star fields unexpectedly succeeded';
  exception when check_violation then
    null;
  end;

  begin
    insert into public.store_skus (
      sku_id, sku_class, price_usd_cents,
      star_raw, star_bonus, star_total, first_time_total, product_id
    ) values (
      'test_star_with_product', 'star_bundle', 100,
      100, 0, 100, 200, 'wrong-owner'
    );
    raise exception 'Star bundle with product_id unexpectedly succeeded';
  exception when check_violation then
    null;
  end;

  begin
    insert into public.store_skus (
      sku_id, sku_class, price_usd_cents, product_id
    ) values (
      'test_zero_price', 'subscription', 0, 'test-zero'
    );
    raise exception 'Non-positive Store SKU price unexpectedly succeeded';
  exception when check_violation then
    null;
  end;
end;
$$;

-- Delta 7 accepts either the legacy catalog binding or the new SKU binding,
-- never both and never neither. Exercise the real 0013 creation boundary after
-- the row type widens, and prove its die result retains exactly one binding.
set local role service_role;
do $$
declare
  created public.payment_orders%rowtype;
begin
  select *
  into strict created
  from public.create_payment_order(
    'c0260000-0000-4026-8026-000000000001',
    'void-crystal/d20/legendary@1',
    499,
    'USD',
    true
  );

  if created.sku_id is not null then
    raise exception 'Post-0026 create_payment_order returned non-NULL sku_id';
  end if;

  if created.catalog_item_id is distinct from 'void-crystal/d20/legendary@1' or
     num_nonnulls(created.catalog_item_id, created.sku_id) <> 1 then
    raise exception 'Post-0026 create_payment_order did not return exactly one die binding';
  end if;

  if (
    select count(*)
    from public.payment_orders
    where id = created.id
      and catalog_item_id is not null
      and sku_id is null
  ) <> 1 then
    raise exception 'Post-0026 create_payment_order did not persist exactly one die order';
  end if;
end;
$$;
reset role;

do $$
begin
  if not exists (
    select 1
    from public.payment_orders
    where user_id = 'c0260000-0000-4026-8026-000000000001'
      and catalog_item_id = 'void-crystal/d20/legendary@1'
      and sku_id is null
      and status = 'pending'
      and amount_minor = 499
      and currency = 'USD'
      and dry_run
  ) then
    raise exception 'Old-style catalog payment order was not preserved';
  end if;

  -- This both-bindings rejection must remain a raw insert because neither
  -- production order RPC can construct the intentionally invalid binding.
  -- Supply the canonical stars_handful snapshot so the 0028 snapshot CHECK is
  -- satisfied and this scenario continues to isolate the 0026 binding CHECK.
  begin
    insert into public.payment_orders (
      user_id,
      catalog_item_id,
      sku_id,
      sku_value_version,
      sku_price_usd_cents,
      sku_star_total,
      sku_first_time_total,
      sku_product_id,
      amount_minor,
      currency,
      dry_run
    ) values (
      'c0260000-0000-4026-8026-000000000001',
      'void-crystal/d20/legendary@1',
      'stars_handful',
      1,
      49,
      60,
      120,
      null,
      49,
      'USD',
      true
    );
    raise exception 'Both payment-order bindings unexpectedly succeeded';
  exception when check_violation then
    null;
  end;

  -- This neither-binding rejection also must remain raw because an RPC cannot
  -- construct the invalid row. With sku_id NULL, omitting all snapshot columns
  -- is the valid legacy-side 0028 snapshot shape, leaving only the binding
  -- CHECK under test.
  begin
    insert into public.payment_orders (
      user_id, catalog_item_id, sku_id, amount_minor, currency, dry_run
    ) values (
      'c0260000-0000-4026-8026-000000000001',
      null,
      null,
      49,
      'USD',
      true
    );
    raise exception 'Neither payment-order binding unexpectedly succeeded';
  exception when check_violation then
    null;
  end;
end;
$$;

-- The valid SKU-bound scenario permits the production boundary, so use the
-- service-only RPC instead of duplicating its raw insert. This proves the RPC
-- derives the canonical price and complete immutable stars_handful snapshot.
set local role service_role;
do $$
declare
  created public.payment_orders%rowtype;
begin
  created := public.create_sku_payment_order(
    'c0260000-0000-4026-8026-000000000001',
    'stars_handful',
    'USD',
    true
  );

  if created.catalog_item_id is not null or
     created.sku_id is distinct from 'stars_handful' or
     created.sku_value_version is distinct from 1 or
     created.sku_price_usd_cents is distinct from 49 or
     created.sku_star_total is distinct from 60 or
     created.sku_first_time_total is distinct from 120 or
     created.sku_product_id is not null or
     created.amount_minor is distinct from 49 then
    raise exception 'Production SKU order boundary returned a malformed snapshot';
  end if;
end;
$$;
reset role;

-- Service inserts exercise all three visibility states without changing the
-- seven canonical rows used by the exact seed assertion above.
set local role service_role;

insert into public.store_skus (
  sku_id, sku_class, price_usd_cents, product_id, catalog_item_id, status
) values
  ('test_draft_subscription', 'subscription', 111, 'test-draft', null, 'draft'),
  ('test_live_subscription', 'subscription', 222, 'test-live', null, 'live'),
  ('test_draft_die', 'die', 333, null, 'void-crystal/d20/legendary@1', 'draft');

do $$
begin
  if (select count(*) from public.store_skus) <> 10 or
     (select count(*) from public.store_skus where status = 'draft') <> 2 or
     not exists (
       select 1
       from public.store_skus
       where sku_id = 'test_draft_die'
         and sku_class = 'die'
         and catalog_item_id = 'void-crystal/d20/legendary@1'
     ) then
    raise exception 'Service role could not read every Store SKU state';
  end if;
end;
$$;

reset role;

set local role anon;
do $$
begin
  begin
    perform 1 from public.store_skus;
    raise exception 'Anonymous Store SKU read unexpectedly succeeded';
  exception when insufficient_privilege then
    null;
  end;
end;
$$;
reset role;

set local role authenticated;
do $$
begin
  if (select count(*) from public.store_skus) <> 8 or
     exists (
       select 1
       from public.store_skus
       where status = 'draft'
     ) or
     not exists (
       select 1
       from public.store_skus
       where sku_id = 'stars_handful' and status = 'sandbox'
     ) or
     not exists (
       select 1
       from public.store_skus
       where sku_id = 'test_live_subscription' and status = 'live'
     ) then
    raise exception 'Authenticated SKU read surface leaked draft or hid available rows';
  end if;

  begin
    update public.store_skus
    set price_usd_cents = price_usd_cents
    where sku_id = 'stars_handful';
    raise exception 'Authenticated Store SKU update unexpectedly succeeded';
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
       where oid = 'public.store_skus'::regclass
     ) or
     has_table_privilege('anon', 'public.store_skus', 'SELECT') or
     not has_table_privilege('authenticated', 'public.store_skus', 'SELECT') or
     has_table_privilege('authenticated', 'public.store_skus', 'INSERT') or
     has_table_privilege('authenticated', 'public.store_skus', 'UPDATE') or
     not has_table_privilege('service_role', 'public.store_skus', 'SELECT') or
     not has_table_privilege('service_role', 'public.store_skus', 'INSERT') or
     not has_table_privilege('service_role', 'public.store_skus', 'UPDATE') or
     has_table_privilege('service_role', 'public.store_skus', 'DELETE') then
    raise exception 'Store SKU RLS or table grants drifted';
  end if;
end;
$$;

-- Economic payload retunes require exactly old+1. Status is metadata and keeps
-- the version. updated_at is controlled by the trigger in both cases.
set local role service_role;
do $$
begin
  begin
    update public.store_skus
    set sku_id = 'test_live_subscription_renamed'
    where sku_id = 'test_live_subscription';
    raise exception 'Store SKU identity update unexpectedly succeeded';
  exception when sqlstate '22023' then
    null;
  end;

  begin
    update public.store_skus
    set sku_class = 'die',
        product_id = null,
        catalog_item_id = 'void-crystal/d20/legendary@1',
        value_version = value_version + 1
    where sku_id = 'test_live_subscription';
    raise exception 'Store SKU reclass unexpectedly succeeded';
  exception when sqlstate '55000' then
    null;
  end;

  begin
    update public.store_skus
    set price_usd_cents = 223
    where sku_id = 'test_live_subscription';
    raise exception 'Same-version Store SKU retune unexpectedly succeeded';
  exception when sqlstate '22023' then
    null;
  end;

  begin
    update public.store_skus
    set value_version = value_version + 1
    where sku_id = 'test_live_subscription';
    raise exception 'Payload-free Store SKU version bump unexpectedly succeeded';
  exception when sqlstate '22023' then
    null;
  end;

  update public.store_skus
  set status = 'sandbox',
      updated_at = '1970-01-01 00:00:00+00'
  where sku_id = 'test_live_subscription';

  update public.store_skus
  set price_usd_cents = 223,
      value_version = 2,
      updated_at = '1970-01-01 00:00:00+00'
  where sku_id = 'test_live_subscription';
end;
$$;
reset role;

do $$
begin
  if not exists (
    select 1
    from public.store_skus
    where sku_id = 'test_live_subscription'
      and status = 'sandbox'
      and price_usd_cents = 223
      and value_version = 2
      and updated_at <> '1970-01-01 00:00:00+00'
  ) then
    raise exception 'Store SKU retune/version/timestamp discipline drifted';
  end if;
end;
$$;

rollback;
