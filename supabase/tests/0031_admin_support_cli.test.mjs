// Live proof that the support CLI's call plans match the deployed database.
//
// The numeric prefix is HARNESS ORDERING ONLY — this suite is not bound to a
// migration. `0031` places it after every migration and every migration suite in
// supabase/migrations/, which is what it needs: it replays the exact SQL that
// `scripts/admin/dicesuki-admin.mjs --dry-run` prints, through `set role
// service_role`, against the real migration stack. In particular it runs AFTER
// `0034_economy_access_flag.sql`, so `public.set_user_economy_access` and
// `public.user_economy_access` are already in place.
//
// What this pins down:
//   * the four mutating RPCs are service_role-executable and the CLI's argument
//     names, order, and value domains still satisfy them;
//   * a `--key` replay is idempotent because the CLI's provenance carries no
//     wall-clock value;
//   * `record_dice_copy_grant` is the die-grant path and `service_role` has no
//     INSERT on dice_copies — i.e. the README's die-grant design answer;
//   * the first `set-economy-access on` stamps `economy_access_granted_at` and
//     nothing afterwards moves it — i.e. the New Collector Passport anchor the
//     CLI warns about is genuinely write-once;
//   * `service_role` can neither execute `public.cancel_pull_session` nor insert
//     a `pull_session_transitions` row — i.e. why `cancel-session` prints SQL
//     instead of executing it.

import {
  GRANT_WRITE_TARGETS,
  buildDieGrantPlan,
  buildEconomyAccessPlan,
  buildTicketGrantPlan,
  buildWalletGrantPlan,
  formatSqlCall,
  formatSqlPreview,
} from '../../scripts/admin/lib/plans.mjs'

const USER_ID = 'ad300000-0000-4030-8030-000000000001'
/** A second player, so "the FIRST enable" is unambiguous for the access flag. */
const ACCESS_USER_ID = 'ad300000-0000-4030-8030-000000000002'
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
        'public.set_user_economy_access(uuid,boolean,text,text)', 'EXECUTE')::text || ':' ||
      has_function_privilege('service_role',
        'public.cancel_pull_session(uuid)', 'EXECUTE')::text || ':' ||
      has_table_privilege('service_role', 'public.dice_copies', 'INSERT')::text || ':' ||
      has_table_privilege('service_role', 'public.pull_session_transitions', 'INSERT')::text || ':' ||
      has_table_privilege('service_role', 'public.user_economy_access', 'UPDATE')::text;
  `,
    '0031 service_role privilege boundary',
  )
  expectEqual(
    privileges,
    'true:true:true:true:false:false:false:false',
    '0031 service_role may run the four mutating RPCs and nothing else the CLI would need',
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

  // --- set-economy-access --------------------------------------------------
  // Not a grant. There is no idempotency key here because the row is a STATE
  // keyed on user_id, so the property to prove is different: the flag is free to
  // move in both directions, but `economy_access_granted_at` — the New Collector
  // Passport's 12-week anchor — must be stamped by the first enable and then
  // never move again, whatever the CLI does next. That write-once behaviour is
  // the entire reason `set-economy-access` is dry-run by default.
  psql(`insert into auth.users (id) values ('${ACCESS_USER_ID}');`, '0031 economy access user')

  const enableAccessPlan = buildEconomyAccessPlan({
    userId: ACCESS_USER_ID,
    enabled: true,
    ...GRANT,
    note: 'closed beta wave 2',
  })
  // Run the operator-pasteable statement verbatim, not a hand-written variant.
  psql(
    `set role service_role;\n${formatSqlPreview(enableAccessPlan)}`,
    '0031 set-economy-access on',
  )
  expectEqual(
    psql(
      `select economy_access::text || ':' ||
         (economy_access_granted_at is not null)::text || ':' ||
         last_changed_by || ':' || last_change_note
       from public.user_economy_access where user_id = '${ACCESS_USER_ID}';`,
      '0031 economy access after enable',
    ),
    'true:true:harness-operator:closed beta wave 2',
    '0031 the first enable turns access on, stamps the passport anchor, and records the operator',
  )

  const anchor = psql(
    `select economy_access_granted_at::text from public.user_economy_access
     where user_id = '${ACCESS_USER_ID}';`,
    '0031 passport anchor after the first enable',
  )

  // Re-running the identical call is inherently safe: no key, no drift error.
  expectEqual(
    psql(callAs(enableAccessPlan, 'economy_access'), '0031 set-economy-access on again'),
    't',
    '0031 an identical re-enable is accepted rather than raising an idempotency conflict',
  )
  expectEqual(
    psql(
      `select economy_access_granted_at::text from public.user_economy_access
       where user_id = '${ACCESS_USER_ID}';`,
      '0031 passport anchor after a repeated enable',
    ),
    anchor,
    '0031 a repeated enable does not restart the passport clock',
  )

  const disableAccessPlan = buildEconomyAccessPlan({
    userId: ACCESS_USER_ID,
    enabled: false,
    ...GRANT,
    note: 'closing the beta wave',
  })
  expectEqual(
    psql(callAs(disableAccessPlan, 'economy_access'), '0031 set-economy-access off'),
    'f',
    '0031 the disable flips economy_access back off',
  )
  expectEqual(
    psql(
      `select economy_access_granted_at::text || ':' || last_change_note
       from public.user_economy_access where user_id = '${ACCESS_USER_ID}';`,
      '0031 passport anchor after disable',
    ),
    `${anchor}:closing the beta wave`,
    '0031 disabling access refreshes the audit trail but never moves the passport anchor',
  )

  // Unknown auth user -> 23503, which is the SQLSTATE the CLI's hint is keyed
  // on ("no such auth user — check the uuid"). Probed through a DO block so the
  // assertion is on the code rather than on Postgres's message wording, which
  // differs between a raw FK violation and an explicit `raise`.
  await expectFailure(
    psqlAsync,
    `set role service_role;
     do $$ begin
       perform ${formatSqlCall(
         buildEconomyAccessPlan({
           userId: 'ad300000-0000-4030-8030-0000000000ff',
           enabled: true,
           ...GRANT,
         }),
       )};
     exception when others then
       raise exception 'cli-probe sqlstate=%', sqlstate;
     end $$;`,
    '0031 set-economy-access for an unknown auth user',
    'cli-probe sqlstate=23503',
  )

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
