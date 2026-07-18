begin;

do $$
declare
  failure text;
begin
  with expected (
    constraint_name,
    index_name,
    table_name,
    column_names
  ) as (
    values
      (
        'pull_banner_items_tier_fkey',
        'pull_banner_items_tier_fkey_idx',
        'pull_banner_items',
        array['banner_version_id', 'tier_id', 'tier_rank']::text[]
      ),
      (
        'pull_guarantee_states_banner_family_id_fkey',
        'pull_guarantee_states_banner_family_id_fkey_idx',
        'pull_guarantee_states',
        array['banner_family_id']::text[]
      ),
      (
        'pull_sessions_account_fkey',
        'pull_sessions_account_fkey_idx',
        'pull_sessions',
        array['account_id', 'user_id']::text[]
      ),
      (
        'pull_sessions_banner_fkey',
        'pull_sessions_banner_fkey_idx',
        'pull_sessions',
        array['banner_version_id', 'banner_family_id']::text[]
      ),
      (
        'sealed_pull_results_session_fkey',
        'sealed_pull_results_session_fkey_idx',
        'sealed_pull_results',
        array['session_id', 'account_id', 'user_id', 'banner_version_id']::text[]
      )
  ),
  foreign_keys as (
    select
      constraint_row.conname as constraint_name,
      table_row.relname as table_name,
      array_agg(attribute_row.attname::text order by key_column.ordinality) as column_names
    from pg_catalog.pg_constraint as constraint_row
    join pg_catalog.pg_class as table_row
      on table_row.oid = constraint_row.conrelid
    join pg_catalog.pg_namespace as namespace_row
      on namespace_row.oid = table_row.relnamespace
    cross join lateral unnest(constraint_row.conkey)
      with ordinality as key_column(attnum, ordinality)
    join pg_catalog.pg_attribute as attribute_row
      on attribute_row.attrelid = table_row.oid
     and attribute_row.attnum = key_column.attnum
    where namespace_row.nspname = 'public'
      and constraint_row.contype = 'f'
      and constraint_row.conname in (select constraint_name from expected)
    group by constraint_row.conname, table_row.relname
  )
  select string_agg(expected.constraint_name, ', ' order by expected.constraint_name)
  into failure
  from expected
  left join foreign_keys
    on foreign_keys.constraint_name = expected.constraint_name
   and foreign_keys.table_name = expected.table_name
   and foreign_keys.column_names = expected.column_names
  where foreign_keys.constraint_name is null;

  if failure is not null then
    raise exception 'Target foreign-key definitions are missing or drifted: %', failure;
  end if;

  with expected (
    constraint_name,
    index_name,
    table_name,
    column_names
  ) as (
    values
      (
        'pull_banner_items_tier_fkey',
        'pull_banner_items_tier_fkey_idx',
        'pull_banner_items',
        array['banner_version_id', 'tier_id', 'tier_rank']::text[]
      ),
      (
        'pull_guarantee_states_banner_family_id_fkey',
        'pull_guarantee_states_banner_family_id_fkey_idx',
        'pull_guarantee_states',
        array['banner_family_id']::text[]
      ),
      (
        'pull_sessions_account_fkey',
        'pull_sessions_account_fkey_idx',
        'pull_sessions',
        array['account_id', 'user_id']::text[]
      ),
      (
        'pull_sessions_banner_fkey',
        'pull_sessions_banner_fkey_idx',
        'pull_sessions',
        array['banner_version_id', 'banner_family_id']::text[]
      ),
      (
        'sealed_pull_results_session_fkey',
        'sealed_pull_results_session_fkey_idx',
        'sealed_pull_results',
        array['session_id', 'account_id', 'user_id', 'banner_version_id']::text[]
      )
  ),
  indexes as (
    select
      index_row.relname as index_name,
      table_row.relname as table_name,
      access_method.amname as access_method,
      index_metadata.indisvalid,
      index_metadata.indisready,
      index_metadata.indisunique,
      index_metadata.indpred is null as is_non_partial,
      index_metadata.indexprs is null as has_no_expressions,
      index_metadata.indnkeyatts,
      index_metadata.indnatts,
      array_agg(attribute_row.attname::text order by key_column.ordinality) as column_names
    from pg_catalog.pg_index as index_metadata
    join pg_catalog.pg_class as index_row
      on index_row.oid = index_metadata.indexrelid
    join pg_catalog.pg_class as table_row
      on table_row.oid = index_metadata.indrelid
    join pg_catalog.pg_namespace as namespace_row
      on namespace_row.oid = table_row.relnamespace
    join pg_catalog.pg_am as access_method
      on access_method.oid = index_row.relam
    cross join lateral unnest(index_metadata.indkey)
      with ordinality as key_column(attnum, ordinality)
    join pg_catalog.pg_attribute as attribute_row
      on attribute_row.attrelid = table_row.oid
     and attribute_row.attnum = key_column.attnum
    where namespace_row.nspname = 'public'
      and index_row.relname in (select index_name from expected)
    group by
      index_row.relname,
      table_row.relname,
      access_method.amname,
      index_metadata.indisvalid,
      index_metadata.indisready,
      index_metadata.indisunique,
      index_metadata.indpred,
      index_metadata.indexprs,
      index_metadata.indnkeyatts,
      index_metadata.indnatts
  )
  select string_agg(expected.index_name, ', ' order by expected.index_name)
  into failure
  from expected
  left join indexes
    on indexes.index_name = expected.index_name
   and indexes.table_name = expected.table_name
   and indexes.column_names = expected.column_names
   and indexes.access_method = 'btree'
   and indexes.indisvalid
   and indexes.indisready
   and not indexes.indisunique
   and indexes.is_non_partial
   and indexes.has_no_expressions
   and indexes.indnkeyatts = cardinality(expected.column_names)
   and indexes.indnatts = cardinality(expected.column_names)
  where indexes.index_name is null;

  if failure is not null then
    raise exception 'FK indexes are missing, invalid, partial, or do not exactly lead with their FK keys: %', failure;
  end if;

  if (
    select count(*)
    from pg_catalog.pg_class as index_row
    join pg_catalog.pg_namespace as namespace_row
      on namespace_row.oid = index_row.relnamespace
    where namespace_row.nspname = 'public'
      and index_row.relkind = 'i'
      and index_row.relname in (
        'pull_banner_items_tier_fkey_idx',
        'pull_guarantee_states_banner_family_id_fkey_idx',
        'pull_sessions_account_fkey_idx',
        'pull_sessions_banner_fkey_idx',
        'sealed_pull_results_session_fkey_idx'
      )
  ) <> 5 then
    raise exception 'Migration 0012 did not create exactly its five named indexes';
  end if;
end;
$$;

rollback;
