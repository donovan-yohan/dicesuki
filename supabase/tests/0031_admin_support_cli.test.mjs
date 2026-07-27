// Live proof that the support CLI's call plans match the deployed database.
//
// The numeric prefix is HARNESS ORDERING ONLY — this suite is not bound to a
// migration. `0031` places it after every migration and every migration suite in
// supabase/migrations/, which is what it needs: it replays the exact SQL that
// `scripts/admin/dicesuki-admin.mjs --dry-run` prints, through `set role
// service_role`, against the real migration stack.
//
// What this pins down:
//   * the three grant RPCs are service_role-executable and the CLI's argument
//     names, order, and value domains still satisfy them;
//   * a `--key` replay is idempotent because the CLI's provenance carries no
//     wall-clock value;
//   * `record_dice_copy_grant` is the die-grant path and `service_role` has no
//     INSERT on dice_copies — i.e. the README's die-grant design answer;
//   * `service_role` can neither execute `public.cancel_pull_session` nor insert
//     a `pull_session_transitions` row — i.e. why `cancel-session` prints SQL
//     instead of executing it.

import {
  GRANT_WRITE_TARGETS,
  buildDieGrantPlan,
  buildTicketGrantPlan,
  buildWalletGrantPlan,
  formatSqlCall,
} from '../../scripts/admin/lib/plans.mjs'

const USER_ID = 'ad300000-0000-4030-8030-000000000001'
const CATALOG_ITEM_ID = 'adventurer-starter/d20/common@1'
const GRANT = { operator: 'harness-operator', note: 'supabase harness proof' }

/** Run a CLI plan exactly as printed, under the role the CLI actually uses. */
function callAs(plan, field = 'id') {
  return `set role service_role;\nselect (${formatSqlCall(plan)}).${field};`
}

function expectEqual(actual, expected, label) {
  if (actual !== expected) {
    throw new Error(`${label}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`)
  }
}

async function expectFailure(psqlAsync, sql, label, expectedFragment) {
  const result = await psqlAsync(sql)
  if (result.status === 0) {
    throw new Error(`${label} unexpectedly succeeded: ${result.stdout}`)
  }
  if (!result.stderr.includes(expectedFragment)) {
    throw new Error(`${label} raised the wrong error (want "${expectedFragment}"): ${result.stderr}`)
  }
}

export async function run({ psql, psqlAsync }) {
  psql(`insert into auth.users (id) values ('${USER_ID}');`, '0031 admin CLI target user')

  // --- The privilege boundary the CLI is designed around ------------------
  const privileges = psql(
    `
    select
      has_function_privilege('service_role',
        'public.append_wallet_ledger_entry(uuid,text,text,bigint,text,text,text,jsonb)',
        'EXECUTE')::text || ':' ||
      has_function_privilege('service_role',
        'public.record_roll_ticket_ledger_entry(uuid,text,bigint,text,text,jsonb)',
        'EXECUTE')::text || ':' ||
      has_function_privilege('service_role',
        'public.record_dice_copy_grant(uuid,text,text,text,text)', 'EXECUTE')::text || ':' ||
      has_function_privilege('service_role',
        'public.cancel_pull_session(uuid)', 'EXECUTE')::text || ':' ||
      has_table_privilege('service_role', 'public.dice_copies', 'INSERT')::text || ':' ||
      has_table_privilege('service_role', 'public.pull_session_transitions', 'INSERT')::text;
  `,
    '0031 service_role privilege boundary',
  )
  expectEqual(
    privileges,
    'true:true:true:false:false:false',
    '0031 service_role may run the three grant RPCs and nothing else the CLI would need',
  )

  // --- grant-stars --------------------------------------------------------
  const starsPlan = buildWalletGrantPlan({
    kind: 'stars',
    userId: USER_ID,
    amount: 20000,
    ...GRANT,
    idempotencyKey: 'admin-grant:2026-07-27:aa000001',
  })
  const starsEntryId = psql(callAs(starsPlan), '0031 grant-stars')
  const starsReplayId = psql(callAs(starsPlan), '0031 grant-stars replay')
  expectEqual(starsReplayId, starsEntryId, '0031 identical --key replay returns the original entry')

  const starsRow = psql(
    `
    select entries.reason_code || ':' || (entries.provenance ->> 'source') || ':' ||
      (entries.provenance ->> 'operator') || ':' || entries.economy_edition_id || ':' ||
      balances.current_balance || ':' || count(*) over ()
    from public.wallet_ledger_entries as entries
    join public.wallet_balances as balances
      on balances.user_id = entries.user_id
     and balances.currency_id = entries.currency_id
     and balances.balance_bucket = entries.balance_bucket
    where entries.user_id = '${USER_ID}' and entries.currency_id = 'stars';
  `,
    '0031 grant-stars reconciliation',
  )
  expectEqual(
    starsRow,
    'support.manual.stars.credit:admin-grant:harness-operator:earned-collection@1:20000:1',
    '0031 grant-stars wrote exactly one promotional Stars credit with admin-grant provenance',
  )

  // --- negative correction, and the balance floor -------------------------
  const correctionPlan = buildWalletGrantPlan({
    kind: 'stars',
    userId: USER_ID,
    amount: -5000,
    ...GRANT,
    note: 'correcting an over-grant',
    idempotencyKey: 'admin-grant:2026-07-27:aa000002',
  })
  psql(callAs(correctionPlan), '0031 grant-stars negative correction')
  expectEqual(
    psql(
      `select current_balance from public.wallet_balances
       where user_id = '${USER_ID}' and currency_id = 'stars' and balance_bucket = 'promotional';`,
      '0031 corrected Stars balance',
    ),
    '15000',
    '0031 negative delta debits promotional Stars',
  )
  expectEqual(
    psql(
      `select reason_code from public.wallet_ledger_entries
       where user_id = '${USER_ID}' and delta_amount < 0;`,
      '0031 correction reason code',
    ),
    'support.manual.stars.debit',
    '0031 a negative delta picks the debit reason code',
  )

  const overdraftPlan = buildWalletGrantPlan({
    kind: 'stars',
    userId: USER_ID,
    amount: -999999,
    ...GRANT,
    note: 'floor probe',
    idempotencyKey: 'admin-grant:2026-07-27:aa000003',
  })
  await expectFailure(
    psqlAsync,
    callAs(overdraftPlan),
    '0031 overdraft',
    'Insufficient stars/promotional balance',
  )

  // --- grant-dust and grant-tickets ---------------------------------------
  psql(
    callAs(
      buildWalletGrantPlan({
        kind: 'dust',
        userId: USER_ID,
        amount: 12,
        ...GRANT,
        idempotencyKey: 'admin-grant:2026-07-27:aa000004',
      }),
    ),
    '0031 grant-dust',
  )
  expectEqual(
    psql(
      `select currency_id || '/' || balance_bucket || ':' || current_balance
       from public.wallet_balances where user_id = '${USER_ID}' and currency_id = 'dust';`,
      '0031 dust balance',
    ),
    'dust/earned:12',
    '0031 grant-dust credits the earned Dust bucket',
  )

  const ticketPlan = buildTicketGrantPlan({
    userId: USER_ID,
    amount: 3,
    rollType: 'standard_roll',
    ...GRANT,
    idempotencyKey: 'admin-grant:2026-07-27:aa000005',
  })
  const ticketEntryId = psql(callAs(ticketPlan), '0031 grant-tickets')
  expectEqual(
    psql(callAs(ticketPlan), '0031 grant-tickets replay'),
    ticketEntryId,
    '0031 identical ticket --key replay returns the original entry',
  )
  expectEqual(
    psql(
      `select roll_type || ':' || current_quantity from public.roll_ticket_balances
       where user_id = '${USER_ID}';`,
      '0031 ticket balance',
    ),
    'standard_roll:3',
    '0031 grant-tickets credits standard_roll once despite the replay',
  )

  // --- grant-die ----------------------------------------------------------
  const diePlan = buildDieGrantPlan({
    userId: USER_ID,
    catalogItemId: CATALOG_ITEM_ID,
    ...GRANT,
    idempotencyKey: 'admin-grant:2026-07-27:aa000010',
  })
  const copyId = psql(callAs(diePlan), '0031 grant-die')
  expectEqual(
    psql(callAs(diePlan), '0031 grant-die replay'),
    copyId,
    '0031 identical die --key replay returns the original copy',
  )
  expectEqual(
    psql(
      `select catalog_item_id || ':' || source_kind || ':' || is_first_copy || ':' ||
        coalesce(scrapped_at::text, 'live') || ':' || source_reference || ':' || count(*) over ()
       from public.dice_copies where user_id = '${USER_ID}';`,
      '0031 dice copy reconciliation',
    ),
    `${CATALOG_ITEM_ID}:reward:true:live:admin-grant:harness-operator:supabase harness proof:1`,
    '0031 grant-die mints exactly one live reward copy with an auditable source reference',
  )

  // --- the die appears on the surface the client actually reads ------------
  expectEqual(
    psql(
      `select count(*)::text from public.dice_copies as copies
       join public.catalog_items as items on items.id = copies.catalog_item_id
       where copies.user_id = '${USER_ID}' and copies.scrapped_at is null
         and items.item_kind = 'die';`,
      '0031 live playable copies',
    ),
    '1',
    '0031 the granted die is a live dice_copies row, the authoritative inventory surface',
  )

  // --- the replay pre-flight finds exactly the rows the RPCs wrote ---------
  // The CLI checks for an existing write before calling, so it can report a
  // replay instead of claiming a fresh grant. That check must query the right
  // table and the right key column for each RPC; a rename here would silently
  // turn every replay back into a false "DONE".
  for (const [rpc, key] of [
    ['append_wallet_ledger_entry', 'admin-grant:2026-07-27:aa000001'],
    ['record_roll_ticket_ledger_entry', 'admin-grant:2026-07-27:aa000005'],
    ['record_dice_copy_grant', 'admin-grant:2026-07-27:aa000010'],
  ]) {
    const target = GRANT_WRITE_TARGETS[rpc]
    expectEqual(
      psql(
        `select count(*)::text || ':' ||
           count(${target.createdColumn})::text
         from public.${target.table}
         where user_id = '${USER_ID}' and ${target.keyColumn} = '${key}';`,
        `0031 replay pre-flight for ${rpc}`,
      ),
      '1:1',
      `0031 the CLI replay pre-flight for ${rpc} resolves the row it wrote`,
    )
  }

  // --- the CLI cannot cancel a pull session, by construction ---------------
  await expectFailure(
    psqlAsync,
    `set role service_role;
     select public.cancel_pull_session('${USER_ID}'::uuid);`,
    '0031 service_role cancel_pull_session',
    'permission denied',
  )
  await expectFailure(
    psqlAsync,
    `set role service_role;
     insert into public.pull_session_transitions
       (session_id, account_id, user_id, banner_version_id, kind)
     values ('${USER_ID}'::uuid, '${USER_ID}'::uuid, '${USER_ID}'::uuid, 'x', 'cancelled');`,
    '0031 service_role transition insert',
    'permission denied',
  )
}
