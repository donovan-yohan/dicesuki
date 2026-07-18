function prepareSessionSql(userId, idempotencyKey, pullCount = 1) {
  return `
    set "request.jwt.claims" = '{"sub":"${userId}","is_anonymous":false}';
    set role authenticated;
    select receipt.session_id
    from public.prepare_pull(
      'earned-collection-001@1',
      ${pullCount}::smallint,
      '${idempotencyKey}'
    ) as receipt;
  `
}

function prepareReceiptSql(userId, idempotencyKey, pullCount = 1) {
  return `
    set "request.jwt.claims" = '{"sub":"${userId}","is_anonymous":false}';
    set role authenticated;
    select row_to_json(receipt)::text
    from public.prepare_pull(
      'earned-collection-001@1',
      ${pullCount}::smallint,
      '${idempotencyKey}'
    ) as receipt;
  `
}

function seedUserSql(userId, stars, suffix) {
  return `
    insert into auth.users (id) values ('${userId}');
    select public.append_wallet_ledger_entry(
      '${userId}',
      'stars',
      'promotional',
      ${stars},
      'test.concurrent-pull-seed',
      'prepare-race-seed:${suffix}',
      'earned-collection@1',
      '{}'::jsonb
    );
    set "request.jwt.claims" = '{"sub":"${userId}","is_anonymous":false}';
    set role authenticated;
    select public.ensure_starter_entitlements();
  `
}

const delay = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds))

async function waitForActivity(psql, applicationName, expected, label) {
  const deadline = Date.now() + 10_000
  let observed = 'missing'
  while (Date.now() < deadline) {
    observed = psql(`
      select coalesce((
        select concat_ws(':', state, wait_event_type, wait_event)
        from pg_stat_activity
        where application_name = '${applicationName}'
      ), 'missing');
    `, `${label} activity probe`)
    if (expected(observed)) return
    await delay(20)
  }
  throw new Error(`${label} never reached its deterministic gate; last state: ${observed}`)
}

async function terminateBlocker(psql, applicationName, label) {
  const terminated = psql(`
    select coalesce(bool_and(pg_terminate_backend(pid)), false)
    from pg_stat_activity
    where application_name = '${applicationName}';
  `, `${label} blocker termination`)
  if (terminated !== 't') {
    throw new Error(`${label} blocker was not terminated: ${terminated}`)
  }
}

async function runInversion({
  psql,
  psqlAsync,
  gateId,
  label,
  olderSql,
  winnerSql,
  expectedOlderError,
}) {
  const blockerName = `0011-${label}-blocker`
  const olderName = `0011-${label}-older`
  const blocker = psqlAsync(`
    set application_name = '${blockerName}';
    begin;
    update private.pull_race_gates set payload = payload where id = ${gateId};
    select pg_sleep(30);
    rollback;
  `)
  let older
  let blockerResult
  let olderResult
  let winnerOutput
  let primaryError
  let cleanupError
  try {
    await waitForActivity(
      psql,
      blockerName,
      state => state.includes('Timeout:PgSleep'),
      `${label} blocker`,
    )

    older = psqlAsync(`
      set application_name = '${olderName}';
      ${olderSql}
    `)

    await waitForActivity(
      psql,
      olderName,
      state => state.includes(':Lock:'),
      `${label} older statement`,
    )
    winnerOutput = psql(winnerSql, `${label} later winner`)
    if (!/^[0-9a-f-]{36}$/.test(winnerOutput)) {
      throw new Error(`${label} later winner did not return one session id: ${winnerOutput}`)
    }
    const timestampInverted = psql(`
      select sessions.prepared_at > activity.query_start
      from public.pull_sessions as sessions
      cross join pg_stat_activity as activity
      where sessions.id = '${winnerOutput}'
        and activity.application_name = '${olderName}';
    `, `${label} timestamp inversion proof`)
    if (timestampInverted !== 't') {
      throw new Error(
        `${label} did not prove an older statement waiting behind a later-timestamp winner`,
      )
    }
  } catch (error) {
    primaryError = error
  } finally {
    try {
      const blockerStillRunning = psql(`
        select exists (
          select 1 from pg_stat_activity where application_name = '${blockerName}'
        );
      `, `${label} blocker cleanup probe`)
      if (blockerStillRunning === 't') {
        await terminateBlocker(psql, blockerName, `${label} cleanup`)
      }
    } catch (error) {
      cleanupError = error
    }
    blockerResult = await blocker
    if (older) olderResult = await older
  }

  if (primaryError && cleanupError) {
    throw new AggregateError(
      [primaryError, cleanupError],
      `${label} failed and its blocker cleanup also failed`,
    )
  }
  if (primaryError) throw primaryError
  if (cleanupError) throw cleanupError
  if (blockerResult.status === 0) {
    throw new Error(`${label} blocker exited normally instead of being released explicitly`)
  }
  if (!olderResult || olderResult.status === 0 || !olderResult.stderr.includes(expectedOlderError)) {
    throw new Error(
      `${label} older statement did not lose to the later committed hold: ${JSON.stringify(olderResult)}`,
    )
  }
  return winnerOutput
}

export async function run({ psql, psqlAsync }) {
  const prepareInversionUser = '91111111-1111-4111-8111-111111111111'
  const exactReplayUser = '92222222-2222-4222-8222-222222222222'
  const debitInversionUser = '93333333-3333-4333-8333-333333333333'
  const entitlementInversionUser = '94444444-4444-4444-8444-444444444444'

  psql(
    seedUserSql(prepareInversionUser, 160, 'prepare-inversion'),
    '0011 prepare inversion user seed',
  )
  psql(
    seedUserSql(exactReplayUser, 160, 'exact-replay'),
    '0011 exact replay user seed',
  )
  psql(
    seedUserSql(debitInversionUser, 160, 'debit-inversion'),
    '0011 debit inversion user seed',
  )
  psql(
    seedUserSql(entitlementInversionUser, 160, 'entitlement-inversion'),
    '0011 entitlement inversion user seed',
  )

  psql(`
    create table private.pull_race_gates (
      id integer primary key,
      payload text not null
    );
    insert into private.pull_race_gates (id, payload) values
      (1, 'prepare:inversion:older'),
      (2, 'debit:inversion:older'),
      (3, 'void-crystal/d12/legendary@1');
  `, '0011 deterministic race gates')

  const prepareWinner = await runInversion({
    psql,
    psqlAsync,
    gateId: 1,
    label: 'prepare-inversion',
    olderSql: `
      set "request.jwt.claims" = '{"sub":"${prepareInversionUser}","is_anonymous":false}';
      select receipt.session_id
      from public.prepare_pull(
        'earned-collection-001@1',
        1::smallint,
        (select payload from private.pull_race_gates where id = 1 for update)
      ) as receipt;
    `,
    winnerSql: prepareSessionSql(prepareInversionUser, 'prepare:inversion:winner'),
    expectedOlderError: 'unexpired prepared pull',
  })
  if (!/^[0-9a-f-]{36}$/.test(prepareWinner)) {
    throw new Error(`Prepare inversion winner did not return a session id: ${prepareWinner}`)
  }

  await runInversion({
    psql,
    psqlAsync,
    gateId: 2,
    label: 'debit-inversion',
    olderSql: `
      select public.append_wallet_ledger_entry(
        '${debitInversionUser}',
        'stars',
        'promotional',
        -160,
        'test.inversion-debit',
        (select payload from private.pull_race_gates where id = 2 for update),
        'earned-collection@1',
        '{}'::jsonb
      );
    `,
    winnerSql: prepareSessionSql(debitInversionUser, 'prepare:debit-inversion:winner'),
    expectedOlderError: 'Insufficient available stars/promotional balance after active holds',
  })

  await runInversion({
    psql,
    psqlAsync,
    gateId: 3,
    label: 'entitlement-inversion',
    olderSql: `
      insert into public.user_entitlements (
        user_id, catalog_item_id, grant_reason, grant_ref
      ) values (
        '${entitlementInversionUser}',
        (select payload from private.pull_race_gates where id = 3 for update),
        'test.inversion-grant',
        'test:inversion-grant'
      );
    `,
    winnerSql: prepareSessionSql(entitlementInversionUser, 'prepare:entitlement-inversion:winner'),
    expectedOlderError: 'Collectible grants are paused while a prepared pull hold is active',
  })

  const inversionState = psql(`
    select
      (select count(*) from public.pull_sessions
       where user_id in ('${prepareInversionUser}', '${debitInversionUser}', '${entitlementInversionUser}')) || ':' ||
      (select count(*) from public.sealed_pull_results
       where user_id in ('${prepareInversionUser}', '${debitInversionUser}', '${entitlementInversionUser}')) || ':' ||
      (select sum(current_balance) from public.wallet_balances
       where user_id in ('${prepareInversionUser}', '${debitInversionUser}', '${entitlementInversionUser}')
         and currency_id = 'stars') || ':' ||
      (select count(*) from public.wallet_ledger_entries
       where user_id in ('${prepareInversionUser}', '${debitInversionUser}', '${entitlementInversionUser}')) || ':' ||
      (select count(*) from public.user_entitlements
       where user_id in ('${prepareInversionUser}', '${debitInversionUser}', '${entitlementInversionUser}')) || ':' ||
      (select count(*) from public.user_entitlements
       where user_id = '${entitlementInversionUser}' and grant_ref = 'test:inversion-grant');
  `, '0011 deterministic inversion state')
  if (inversionState !== '3:3:480:3:24:0') {
    throw new Error(`Deterministic inversions left invalid state: ${inversionState}`)
  }

  const exactReplay = await Promise.all([
    psqlAsync(prepareReceiptSql(exactReplayUser, 'prepare:race:exact-key')),
    psqlAsync(prepareReceiptSql(exactReplayUser, 'prepare:race:exact-key')),
  ])
  if (exactReplay.some(result => result.status !== 0)) {
    throw new Error(`Concurrent exact prepare replay failed: ${JSON.stringify(exactReplay)}`)
  }
  if (new Set(exactReplay.map(result => result.stdout)).size !== 1) {
    throw new Error(`Concurrent exact replay returned different receipts: ${JSON.stringify(exactReplay)}`)
  }
  let replayReceipt
  try {
    replayReceipt = JSON.parse(exactReplay[0].stdout)
  } catch (error) {
    throw new Error(`Concurrent exact replay did not return JSON: ${exactReplay[0].stdout}`, {
      cause: error,
    })
  }
  const expectedReceiptKeys = [
    'session_id',
    'banner_version_id',
    'pull_count',
    'held_amount',
    'prepared_at',
    'expires_at',
    'commitment_scheme',
    'commitment_root',
    'rng_scheme',
  ]
  if (JSON.stringify(Object.keys(replayReceipt)) !== JSON.stringify(expectedReceiptKeys) ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(replayReceipt.session_id) ||
      replayReceipt.banner_version_id !== 'earned-collection-001@1' ||
      replayReceipt.pull_count !== 1 ||
      replayReceipt.held_amount !== 160 ||
      !Number.isFinite(Date.parse(replayReceipt.prepared_at)) ||
      Date.parse(replayReceipt.expires_at) - Date.parse(replayReceipt.prepared_at) !== 120_000 ||
      replayReceipt.commitment_scheme !== 'sha256-result-v1+sha256-root-v1' ||
      !/^[0-9a-f]{64}$/.test(replayReceipt.commitment_root) ||
      replayReceipt.rng_scheme !== 'hmac-sha256-seed-v1') {
    throw new Error(`Concurrent exact replay returned an invalid complete receipt: ${exactReplay[0].stdout}`)
  }

  const exactReplayState = psql(`
    select
      (select count(*) from public.pull_sessions where user_id = '${exactReplayUser}') || ':' ||
      (select count(*) from public.sealed_pull_results where user_id = '${exactReplayUser}') || ':' ||
      (select current_balance from public.wallet_balances
       where user_id = '${exactReplayUser}' and currency_id = 'stars') || ':' ||
      (select count(*) from public.wallet_ledger_entries where user_id = '${exactReplayUser}') || ':' ||
      (select count(*) from public.user_entitlements where user_id = '${exactReplayUser}');
  `, '0011 concurrent exact replay state')
  if (exactReplayState !== '1:1:160:1:8') {
    throw new Error(`Concurrent exact replay duplicated state: ${exactReplayState}`)
  }

  psql('drop table private.pull_race_gates;', '0011 deterministic race gate cleanup')
}
