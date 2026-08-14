-- Migration: 0035_purge_legacy_custom_dice_inventory
--
-- Customer-authored dice and their IndexedDB model bytes are retired. The
-- client v6 migration removes the browser records; this one removes matching
-- historical inventory JSONB payloads already synced to Supabase and repairs
-- saved-roll sources that pinned the removed ids. Catalog assets are immutable
-- and always declare `customAsset.storage = "bundled"`.
--
-- The block is intentionally idempotent: after a row is cleaned it has no
-- matching ids, so a retry does not update it again.
do $$
declare
  inventory_row record;
  legacy_ids text[];
  cleaned jsonb;
  scrubbed jsonb;
  saved_roll_data jsonb;
  cleaned_saved_roll_data jsonb;
begin
  for inventory_row in
    select inventory.user_id, inventory.data
    from public.inventory as inventory
    where exists (
      select 1
      from jsonb_array_elements(
        case when jsonb_typeof(inventory.data -> 'dice') = 'array'
          then inventory.data -> 'dice'
          else '[]'::jsonb
        end ||
        case when jsonb_typeof(inventory.data -> 'localDice') = 'array'
          then inventory.data -> 'localDice'
          else '[]'::jsonb
        end
      ) as candidate(die)
      where coalesce(die ->> 'setId', '') = 'custom-artist'
        or (
          jsonb_typeof(die -> 'customAsset') = 'object'
          and coalesce(die -> 'customAsset' ->> 'storage', '') <> 'bundled'
        )
    )
    -- A client can write either JSON blob while this migration runs. Lock the
    -- current inventory row before deriving ids so the final write cannot
    -- overwrite a concurrent client update based on an older snapshot.
    order by inventory.user_id
    for update
  loop
    select array_agg(distinct die ->> 'id')
    into legacy_ids
    from jsonb_array_elements(
      case when jsonb_typeof(inventory_row.data -> 'dice') = 'array'
        then inventory_row.data -> 'dice'
        else '[]'::jsonb
      end ||
      case when jsonb_typeof(inventory_row.data -> 'localDice') = 'array'
        then inventory_row.data -> 'localDice'
        else '[]'::jsonb
      end
    ) as candidate(die)
    where nullif(die ->> 'id', '') is not null
      and (
        coalesce(die ->> 'setId', '') = 'custom-artist'
        or (
          jsonb_typeof(die -> 'customAsset') = 'object'
          and coalesce(die -> 'customAsset' ->> 'storage', '') <> 'bundled'
        )
      );

    cleaned := inventory_row.data;

    if jsonb_typeof(cleaned -> 'dice') = 'array' then
      select coalesce(jsonb_agg(die), '[]'::jsonb)
      into scrubbed
      from jsonb_array_elements(cleaned -> 'dice') as candidate(die)
      where not (
        coalesce(die ->> 'setId', '') = 'custom-artist'
        or (
          jsonb_typeof(die -> 'customAsset') = 'object'
          and coalesce(die -> 'customAsset' ->> 'storage', '') <> 'bundled'
        )
      );
      cleaned := jsonb_set(cleaned, '{dice}', scrubbed, true);
    end if;

    if jsonb_typeof(cleaned -> 'localDice') = 'array' then
      select coalesce(jsonb_agg(die), '[]'::jsonb)
      into scrubbed
      from jsonb_array_elements(cleaned -> 'localDice') as candidate(die)
      where not (
        coalesce(die ->> 'setId', '') = 'custom-artist'
        or (
          jsonb_typeof(die -> 'customAsset') = 'object'
          and coalesce(die -> 'customAsset' ->> 'storage', '') <> 'bundled'
        )
      );
      cleaned := jsonb_set(cleaned, '{localDice}', scrubbed, true);
    end if;

    if jsonb_typeof(cleaned -> 'assignments') = 'object' then
      select coalesce(jsonb_object_agg(key, value), '{}'::jsonb)
      into scrubbed
      from jsonb_each(cleaned -> 'assignments') as assignment(key, value)
      where coalesce(value #>> '{}', '') <> all(coalesce(legacy_ids, '{}'::text[]));
      cleaned := jsonb_set(cleaned, '{assignments}', scrubbed, true);
    end if;

    if jsonb_typeof(cleaned -> 'localAssignments') = 'object' then
      select coalesce(jsonb_object_agg(key, value), '{}'::jsonb)
      into scrubbed
      from jsonb_each(cleaned -> 'localAssignments') as assignment(key, value)
      where coalesce(value #>> '{}', '') <> all(coalesce(legacy_ids, '{}'::text[]));
      cleaned := jsonb_set(cleaned, '{localAssignments}', scrubbed, true);
    end if;

    if jsonb_typeof(cleaned -> 'v') = 'number' then
      cleaned := jsonb_set(cleaned, '{v}', '6'::jsonb, true);
    end if;

    update public.inventory
    set data = cleaned
    where user_id = inventory_row.user_id;

    -- Lock the matching saved-roll row before reading it for the same reason.
    -- The lock order is deterministic (inventory, then saved_rolls, by user),
    -- which also keeps concurrent migration sessions from deadlocking.
    saved_roll_data := null;
    select data
    into saved_roll_data
    from public.saved_rolls
    where user_id = inventory_row.user_id
    for update;

    if saved_roll_data is not null
      and cardinality(coalesce(legacy_ids, '{}'::text[])) > 0
      and jsonb_typeof(saved_roll_data -> 'savedRolls') = 'array' then
      select jsonb_set(
        saved_roll_data,
        '{savedRolls}',
        coalesce(jsonb_agg(
          case when jsonb_typeof(saved_roll -> 'dice') = 'array' then
            jsonb_set(
              saved_roll,
              '{dice}',
              coalesce((
                select jsonb_agg(
                  case when jsonb_typeof(die_entry -> 'sources') = 'array' then
                    jsonb_set(
                      die_entry,
                      '{sources}',
                      coalesce((
                        select jsonb_agg(
                          case
                            when source ->> 'kind' = 'specific'
                              and source ->> 'dieId' = any(legacy_ids)
                            then jsonb_strip_nulls(jsonb_build_object(
                              'kind', 'anonymous',
                              'quantity', 1,
                              'skinId', source -> 'skinId'
                            ))
                            else source
                          end
                        )
                        from jsonb_array_elements(die_entry -> 'sources') as roll_source(source)
                      ), '[]'::jsonb),
                      true
                    )
                    else die_entry
                  end
                )
                from jsonb_array_elements(saved_roll -> 'dice') as roll_die(die_entry)
              ), '[]'::jsonb),
              true
            )
            else saved_roll
          end
        ), '[]'::jsonb),
        true
      )
      into cleaned_saved_roll_data
      from jsonb_array_elements(saved_roll_data -> 'savedRolls') as roll(saved_roll);

      if cleaned_saved_roll_data is distinct from saved_roll_data then
        update public.saved_rolls
        set data = cleaned_saved_roll_data
        where user_id = inventory_row.user_id;
      end if;
    end if;
  end loop;
end;
$$;
