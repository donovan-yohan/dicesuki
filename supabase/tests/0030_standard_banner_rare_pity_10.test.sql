begin;

insert into auth.users (id) values
  ('d0300000-0000-4030-8030-000000000008'),
  ('d0300000-0000-4030-8030-000000000009'),
  ('d0300000-0000-4030-8030-000000000010'),
  ('d0300000-0000-4030-8030-000000000025');

-- Reuse the client activation contract: ticket-bound standard banners ordered
-- by descending version, with the first row selected as active.
create temporary table slice21_standard_discovery
on commit drop
as
select
  id,
  banner_id,
  banner_version,
  banner_family_id,
  banner_class,
  roll_type
from public.pull_banner_versions
where banner_class = 'standard'
  and roll_type = 'standard_roll'
order by banner_version desc;

do $$
declare
  active_banner record;
begin
  select *
  into strict active_banner
  from pg_temp.slice21_standard_discovery
  order by banner_version desc, id
  limit 1;

  if (select count(*) from pg_temp.slice21_standard_discovery) is distinct from 2::bigint or
     active_banner.id is distinct from 'earned-collection-001@3' or
     active_banner.banner_id is distinct from 'earned-collection-001' or
     active_banner.banner_version is distinct from 3 or
     active_banner.banner_family_id is distinct from 'earned-collection' or
     active_banner.banner_class is distinct from 'standard' or
     active_banner.roll_type is distinct from 'standard_roll' then
    raise exception 'Standard discovery did not activate earned-collection-001@3';
  end if;
end;
$$;

-- The predecessor remains the immutable 8/25/20 policy and retains its exact
-- ticket offers and pool cardinalities.
do $$
declare
  version_2 public.pull_banner_versions%rowtype;
begin
  select *
  into strict version_2
  from public.pull_banner_versions
  where id = 'earned-collection-001@2';

  if version_2.banner_version is distinct from 2 or
     version_2.banner_family_id is distinct from 'earned-collection' or
     version_2.banner_class is distinct from 'standard' or
     version_2.roll_type is distinct from 'standard_roll' or
     version_2.rare_hard_guarantee_pull is distinct from 8 or
     version_2.epic_hard_guarantee_pull is distinct from 25 or
     version_2.selected_hard_guarantee_pull is distinct from 20 or
     (select count(*)
      from public.pull_banner_offers
      where banner_version_id = version_2.id) is distinct from 2::bigint or
     (select count(*)
      from public.pull_banner_tiers
      where banner_version_id = version_2.id) is distinct from 4::bigint or
     (select count(*)
      from public.pull_banner_items
      where banner_version_id = version_2.id) is distinct from 45::bigint then
    raise exception 'Version 2 changed while appending rare pity version 3';
  end if;
end;
$$;

set local role service_role;

do $$
declare
  target_user uuid;
  target_key text;
begin
  for target_user, target_key in
    select * from (values
      (
        'd0300000-0000-4030-8030-000000000008'::uuid,
        'slice21:ticket:seed:0008'
      ),
      (
        'd0300000-0000-4030-8030-000000000009'::uuid,
        'slice21:ticket:seed:0009'
      ),
      (
        'd0300000-0000-4030-8030-000000000010'::uuid,
        'slice21:ticket:seed:0010'
      ),
      (
        'd0300000-0000-4030-8030-000000000025'::uuid,
        'slice21:ticket:seed:0025'
      )
    ) as fixture(user_id, idempotency_key)
  loop
    perform public.record_roll_ticket_ledger_entry(
      target_user,
      'standard_roll',
      1,
      'test.slice21.ticket.seed',
      target_key,
      '{}'::jsonb
    );
  end loop;
end;
$$;

reset role;

insert into public.pull_guarantee_states (
  account_id,
  user_id,
  banner_family_id,
  total_pulls,
  rare_misses,
  epic_misses,
  selected_misses
)
select
  accounts.id,
  fixtures.user_id,
  'earned-collection',
  fixtures.total_pulls,
  fixtures.rare_misses,
  fixtures.epic_misses,
  0
from (values
  (
    'd0300000-0000-4030-8030-000000000008'::uuid,
    7::bigint,
    7::bigint,
    0::bigint
  ),
  (
    'd0300000-0000-4030-8030-000000000009'::uuid,
    8::bigint,
    8::bigint,
    0::bigint
  ),
  (
    'd0300000-0000-4030-8030-000000000010'::uuid,
    9::bigint,
    9::bigint,
    0::bigint
  ),
  (
    'd0300000-0000-4030-8030-000000000025'::uuid,
    24::bigint,
    0::bigint,
    24::bigint
  )
) as fixtures(user_id, total_pulls, rare_misses, epic_misses)
join public.wallet_accounts as accounts
  on accounts.user_id = fixtures.user_id;

do $$
declare
  target_user uuid;
  target_key text;
begin
  for target_user, target_key in
    select * from (values
      (
        'd0300000-0000-4030-8030-000000000008'::uuid,
        'slice21:prepare:pull-8'
      ),
      (
        'd0300000-0000-4030-8030-000000000009'::uuid,
        'slice21:prepare:pull-9'
      ),
      (
        'd0300000-0000-4030-8030-000000000010'::uuid,
        'slice21:prepare:pull-10'
      ),
      (
        'd0300000-0000-4030-8030-000000000025'::uuid,
        'slice21:prepare:pull-25'
      )
    ) as fixture(user_id, idempotency_key)
  loop
    perform set_config(
      'request.jwt.claims',
      jsonb_build_object('sub', target_user, 'is_anonymous', false)::text,
      true
    );
    perform public.prepare_pull(
      'earned-collection-001@3',
      1::smallint,
      target_key
    );
  end loop;
end;
$$;

do $$
declare
  pity record;
begin
  if (
    select resolution_reason
    from public.sealed_pull_results
    where user_id = 'd0300000-0000-4030-8030-000000000008'
  ) is distinct from 'base' then
    raise exception 'Rare guarantee fired at pull 8 under version 3';
  end if;

  -- The pull immediately before the new boundary must still be unguaranteed,
  -- proving 10 is exact rather than "8 or later".
  if (
    select resolution_reason
    from public.sealed_pull_results
    where user_id = 'd0300000-0000-4030-8030-000000000009'
  ) is distinct from 'base' then
    raise exception 'Rare guarantee fired at pull 9 under version 3';
  end if;

  if (
    select resolution_reason
    from public.sealed_pull_results
    where user_id = 'd0300000-0000-4030-8030-000000000010'
  ) is distinct from 'rare-guarantee' or
     (
       select row(rare_misses_before, rare_misses_after)
       from public.sealed_pull_results
       where user_id = 'd0300000-0000-4030-8030-000000000010'
     ) is distinct from row(9::bigint, 0::bigint) or
     (
       select tier_rank
       from public.sealed_pull_results
       where user_id = 'd0300000-0000-4030-8030-000000000010'
     ) < 1 then
    raise exception 'Rare guarantee did not fire at pull 10 under version 3';
  end if;

  if (
    select resolution_reason
    from public.sealed_pull_results
    where user_id = 'd0300000-0000-4030-8030-000000000025'
  ) is distinct from 'epic-guarantee' or
     (
       select row(epic_misses_before, epic_misses_after)
       from public.sealed_pull_results
       where user_id = 'd0300000-0000-4030-8030-000000000025'
     ) is distinct from row(24::bigint, 0::bigint) or
     (
       select tier_rank
       from public.sealed_pull_results
       where user_id = 'd0300000-0000-4030-8030-000000000025'
     ) < 2 then
    raise exception 'Epic guarantee did not fire at pull 25 under version 3';
  end if;

  perform set_config(
    'request.jwt.claims',
    jsonb_build_object(
      'sub',
      'd0300000-0000-4030-8030-000000000010'::uuid,
      'is_anonymous',
      false
    )::text,
    true
  );

  select *
  into strict pity
  from public.get_my_pull_pity('earned-collection');

  if pity.banner_version_id is distinct from 'earned-collection-001@3' or
     pity.banner_version is distinct from 3 or
     pity.total_pulls is distinct from 9::bigint or
     pity.rare_misses is distinct from 9::bigint or
     pity.epic_misses is distinct from 0::bigint or
     pity.selected_misses is distinct from 0::bigint or
     pity.rare_hard_guarantee_pull is distinct from 10 or
     pity.epic_hard_guarantee_pull is distinct from 25 or
     pity.selected_hard_guarantee_pull is distinct from 20 then
    raise exception 'Pity read did not expose active version 3 thresholds and carried counters';
  end if;
end;
$$;

rollback;
