-- Migration: 0025_pity_read
-- Authenticated, server-owned pity meter state for the pull screen.
--
-- A banner family is append-only. Its active configuration is therefore the
-- row with the greatest banner_version, served by the existing
-- (banner_family_id, banner_version desc) index. The read never creates a
-- wallet account, takes a lock, or mutates guarantee state.

create or replace function private.get_pull_pity_for_user(
  p_user_id uuid,
  p_banner_family_id text
)
returns table (
  banner_family_id text,
  banner_version_id text,
  banner_version integer,
  total_pulls bigint,
  rare_misses bigint,
  epic_misses bigint,
  selected_misses bigint,
  rare_hard_guarantee_pull integer,
  epic_hard_guarantee_pull integer,
  selected_hard_guarantee_pull integer,
  soft_pity_model text,
  soft_pity_start_pull integer,
  soft_pity_per_pull_increment numeric
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  active_banner public.pull_banner_versions%rowtype;
  active_banner_version integer;
  active_banner_count bigint;
begin
  if p_user_id is null then
    raise exception 'Pull pity user is required' using errcode = '22023';
  end if;

  -- ASSUMPTION (economy model): a banner_family_id holds exactly one banner
  -- lineage and only its latest version is intended-live, so max(version) is
  -- the active banner. Two distinct banner_ids sharing a family's top version
  -- would fail closed below (22023) rather than mis-select. If multi-lineage
  -- families are ever introduced, replace this with an explicit active-banner
  -- marker.
  -- Consumer note: the returned *_misses counters are 0-based cursors while
  -- the *_guarantee/soft-pity thresholds are 1-based attempt indices (next
  -- attempt n = misses + 1; guarantee fires when n >= threshold). "Pulls
  -- remaining" = threshold - misses, with no further +/-1.
  select max(versions.banner_version)
  into active_banner_version
  from public.pull_banner_versions as versions
  where versions.banner_family_id = p_banner_family_id;

  if active_banner_version is null then
    raise exception 'Unknown or unversioned pull banner family %',
      p_banner_family_id
      using errcode = '22023';
  end if;

  select count(*)
  into active_banner_count
  from public.pull_banner_versions as versions
  where versions.banner_family_id = p_banner_family_id
    and versions.banner_version = active_banner_version;

  if active_banner_count <> 1 then
    raise exception 'Ambiguous active pull banner version for family %',
      p_banner_family_id
      using errcode = '22023';
  end if;

  select versions.*
  into strict active_banner
  from public.pull_banner_versions as versions
  where versions.banner_family_id = p_banner_family_id
    and versions.banner_version = active_banner_version;

  return query
  select
    active_banner.banner_family_id,
    active_banner.id,
    active_banner.banner_version,
    coalesce(guarantee.total_pulls, 0::bigint),
    coalesce(guarantee.rare_misses, 0::bigint),
    coalesce(guarantee.epic_misses, 0::bigint),
    coalesce(guarantee.selected_misses, 0::bigint),
    active_banner.rare_hard_guarantee_pull,
    active_banner.epic_hard_guarantee_pull,
    active_banner.selected_hard_guarantee_pull,
    active_banner.soft_pity_model,
    active_banner.soft_pity_start_pull,
    active_banner.soft_pity_per_pull_increment
  from (values (true)) as singleton(present)
  left join public.wallet_accounts as account
    on account.user_id = p_user_id
  left join public.pull_guarantee_states as guarantee
    on guarantee.account_id = account.id
   and guarantee.user_id = p_user_id
   and guarantee.banner_family_id = active_banner.banner_family_id;
end;
$$;

comment on function private.get_pull_pity_for_user(uuid, text) is
  'Private stable self-scoped pity read. Resolves one unambiguous highest append-only banner version and returns zero counters when the user has no family guarantee row. It never creates or locks a wallet account.';

revoke all on function private.get_pull_pity_for_user(uuid, text)
  from public, anon, authenticated, service_role;

create or replace function public.get_my_pull_pity(
  p_banner_family_id text
)
returns table (
  banner_family_id text,
  banner_version_id text,
  banner_version integer,
  total_pulls bigint,
  rare_misses bigint,
  epic_misses bigint,
  selected_misses bigint,
  rare_hard_guarantee_pull integer,
  epic_hard_guarantee_pull integer,
  selected_hard_guarantee_pull integer,
  soft_pity_model text,
  soft_pity_start_pull integer,
  soft_pity_per_pull_increment numeric
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  caller_user_id uuid;
begin
  caller_user_id := private.require_non_anonymous_user();

  return query
  select *
  from private.get_pull_pity_for_user(
    caller_user_id,
    p_banner_family_id
  );
end;
$$;

comment on function public.get_my_pull_pity(text) is
  'Authenticated non-anonymous self-only pity meter read for the active version of one pull banner family.';

revoke all on function public.get_my_pull_pity(text)
  from public, anon, authenticated, service_role;
grant execute on function public.get_my_pull_pity(text)
  to authenticated;
