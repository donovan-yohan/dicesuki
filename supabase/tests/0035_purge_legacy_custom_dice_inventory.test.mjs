export async function run({ psqlAsync, read }) {
  const seed = await psqlAsync(`
    insert into auth.users (id)
    values ('d3500000-0000-4350-8350-000000000003');
    insert into public.inventory (user_id, data)
    values (
      'd3500000-0000-4350-8350-000000000003',
      '{
        "v": 5,
        "dice": [
          {"id":"legacy-artist","setId":"custom-artist","customAsset":{"storage":"bundled"}},
          {"setId":"custom-artist"},
          {"id":"legacy-indexeddb","setId":"configured-set","customAsset":{"storage":"indexeddb"}},
          {"id":"legacy-missing-storage","setId":"configured-set","customAsset":{}},
          {"id":"bundled","customAsset":{"storage":"bundled"}}
        ],
        "localDice": [
          {"id":"legacy-local","setId":"custom-artist"},
          {"id":"bundled-local","customAsset":{"storage":"bundled"}}
        ],
        "assignments": {
          "legacy-artist":"legacy-artist",
          "legacy-indexeddb":"legacy-indexeddb",
          "legacy-missing-storage":"legacy-missing-storage",
          "bundled":"bundled"
        },
        "localAssignments": {"legacy-local":"legacy-local","bundled-local":"bundled-local"},
        "currency":{"coins":17}
      }'::jsonb
    );
    insert into public.saved_rolls (user_id, data)
    values (
      'd3500000-0000-4350-8350-000000000003',
      '{
        "v": 1,
        "savedRolls": [{
          "id": "roll-with-retired-dice",
          "name": "Keep this roll",
          "dice": [{
            "type": "d6",
            "quantity": 3,
            "modifier": 2,
            "sources": [
              {"kind":"specific","dieId":"legacy-artist","skinId":"crimson","stale":"drop-me"},
              {"kind":"specific","dieId":"bundled","skinId":"gold"},
              {"kind":"anonymous","quantity":1}
            ]
          }]
        }],
        "deletedRolls": {"old-roll":"2026-08-01T00:00:00.000Z"}
      }'::jsonb
    );
  `)
  if (seed.status !== 0) {
    throw new Error(`0035 idempotence seed failed\\n${seed.stdout}\\n${seed.stderr}`)
  }

  const migration = read('supabase/migrations/0035_purge_legacy_custom_dice_inventory.sql')
  if (!/from public\.inventory[\s\S]*for update/i.test(migration)
    || !/from public\.saved_rolls[\s\S]*for update/i.test(migration)) {
    throw new Error('0035 must lock current inventory and saved-roll rows before rewriting JSONB')
  }
  const firstReplay = await psqlAsync(migration)
  if (firstReplay.status !== 0) {
    throw new Error(`0035 first idempotent replay failed\\n${firstReplay.stdout}\\n${firstReplay.stderr}`)
  }
  const replay = await psqlAsync(
    migration,
  )
  if (replay.status !== 0) {
    throw new Error(`0035 idempotent replay failed\n${replay.stdout}\n${replay.stderr}`)
  }

  const assertClean = await psqlAsync(`
    do $$
    declare
      cleaned jsonb;
      cleaned_rolls jsonb;
    begin
      select data into cleaned
      from public.inventory
      where user_id = 'd3500000-0000-4350-8350-000000000003';
      if cleaned ->> 'v' <> '6'
        or cleaned -> 'dice' <> '[{"id":"bundled","customAsset":{"storage":"bundled"}}]'::jsonb
        or cleaned -> 'localDice' <> '[{"id":"bundled-local","customAsset":{"storage":"bundled"}}]'::jsonb
        or cleaned -> 'assignments' <> '{"bundled":"bundled"}'::jsonb
        or cleaned -> 'localAssignments' <> '{"bundled-local":"bundled-local"}'::jsonb
        or cleaned -> 'currency' <> '{"coins":17}'::jsonb then
        raise exception '0035 replay did not remain idempotent';
      end if;

      select data into cleaned_rolls
      from public.saved_rolls
      where user_id = 'd3500000-0000-4350-8350-000000000003';
      if cleaned_rolls <> '{
        "v": 1,
        "savedRolls": [{
          "id": "roll-with-retired-dice",
          "name": "Keep this roll",
          "dice": [{
            "type": "d6",
            "quantity": 3,
            "modifier": 2,
            "sources": [
              {"kind":"anonymous","quantity":1,"skinId":"crimson"},
              {"kind":"specific","dieId":"bundled","skinId":"gold"},
              {"kind":"anonymous","quantity":1}
            ]
          }]
        }],
        "deletedRolls": {"old-roll":"2026-08-01T00:00:00.000Z"}
      }'::jsonb then
        raise exception '0035 did not repair saved-roll sources idempotently: %', cleaned_rolls;
      end if;
    end;
    $$;
  `)
  if (assertClean.status !== 0) {
    throw new Error(`0035 idempotence assertion failed\n${assertClean.stdout}\n${assertClean.stderr}`)
  }
}
