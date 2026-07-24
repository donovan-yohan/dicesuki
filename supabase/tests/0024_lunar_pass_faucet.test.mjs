function grantSql(applicationName, userId, transactionId, subscriptionId) {
  return `
    set application_name = '${applicationName}';
    set role service_role;
    select grant_receipt.id || ':' || grant_receipt.wallet_ledger_entry_id
    from public.grant_lunar_purchase_stars(
      '${userId}',
      ${transactionId},
      '${subscriptionId}',
      'lunar-plan',
      'lunar-pass'
    ) as grant_receipt;
  `
}

function stateSql(userId) {
  return `
    select
      (select count(*) from public.lunar_purchase_star_grants
       where user_id = '${userId}') || ':' ||
      (select count(*) from public.wallet_ledger_entries
       where user_id = '${userId}' and reason_code = 'lunar.purchase') || ':' ||
      (select current_balance from public.wallet_balances
       where user_id = '${userId}'
         and currency_id = 'stars'
         and balance_bucket = 'promotional');
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

async function runWalletRace({
  psql,
  psqlAsync,
  userId,
  label,
  transactionId,
  subscriptionIds,
}) {
  const blockerName = `0024-${label}-blocker`
  const firstName = `0024-${label}-first`
  const secondName = `0024-${label}-second`
  const blocker = psqlAsync(`
    set application_name = '${blockerName}';
    begin;
    select id from public.wallet_accounts
    where user_id = '${userId}'
    for update;
    select pg_sleep(30);
    rollback;
  `)
  const racers = []
  let results = []
  let blockerResult
  let primaryError
  let cleanupError

  try {
    await waitForActivity(
      psql,
      blockerName,
      state => state.includes('Timeout:PgSleep'),
      `${label} blocker`,
    )

    racers.push(
      psqlAsync(grantSql(firstName, userId, transactionId, subscriptionIds[0])),
      psqlAsync(grantSql(secondName, userId, transactionId, subscriptionIds[1])),
    )

    await waitForActivity(
      psql,
      firstName,
      state => state.includes(':Lock:'),
      `${label} first grant`,
    )
    await waitForActivity(
      psql,
      secondName,
      state => state.includes(':Lock:'),
      `${label} second grant`,
    )
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

    const allResults = await Promise.all([blocker, ...racers])
    blockerResult = allResults[0]
    results = allResults.slice(1)
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
  if (results.length !== 2) {
    throw new Error(`${label} did not start and await both grant racers`)
  }
  return results
}

export async function run({ psql, psqlAsync }) {
  const replayUser = 'd0240000-0000-4000-8000-000000000001'
  const driftUser = 'd0240000-0000-4000-8000-000000000002'

  psql(`
    insert into auth.users (id) values ('${replayUser}'), ('${driftUser}');
    insert into public.wallet_accounts (user_id)
    values ('${replayUser}'), ('${driftUser}');
  `, '0024 concurrency users and wallet locks')

  const initialState = psql(`
    select
      (select count(*) from public.wallet_accounts
       where user_id in ('${replayUser}', '${driftUser}')) || ':' ||
      (select count(*) from public.lunar_purchase_star_grants
       where user_id in ('${replayUser}', '${driftUser}')) || ':' ||
      (select count(*) from public.wallet_ledger_entries
       where user_id in ('${replayUser}', '${driftUser}')) || ':' ||
      (select count(*) from public.wallet_balances
       where user_id in ('${replayUser}', '${driftUser}'));
  `, '0024 precreated-wallet empty-state precondition')
  if (initialState !== '2:0:0:0') {
    throw new Error(`0024 concurrency precondition drifted: ${initialState}`)
  }

  // Concurrent identical invoice replay: both named grant sessions are forced
  // to wait on the same precreated account lock before either can commit.
  const identical = await runWalletRace({
    psql,
    psqlAsync,
    userId: replayUser,
    label: 'identical-invoice',
    transactionId: 924000001,
    subscriptionIds: ['concurrent-replay-sub', 'concurrent-replay-sub'],
  })
  if (identical.some(result => result.status !== 0)) {
    throw new Error(`Concurrent identical invoice replay failed: ${JSON.stringify(identical)}`)
  }
  if (new Set(identical.map(result => result.stdout)).size !== 1) {
    throw new Error(
      `Concurrent identical invoice replay returned different receipts: ${JSON.stringify(identical)}`,
    )
  }

  const replayState = psql(
    stateSql(replayUser),
    '0024 identical invoice replay state',
  )
  if (replayState !== '1:1:300') {
    throw new Error(`Concurrent identical invoice replay changed state more than once: ${replayState}`)
  }

  // Concurrent same-invoice subscription drift: both named sessions reach the
  // same Lock wait, then account-first serialization selects one canonical
  // payload and makes the other fail closed.
  const drift = await runWalletRace({
    psql,
    psqlAsync,
    userId: driftUser,
    label: 'subscription-drift',
    transactionId: 924000002,
    subscriptionIds: ['concurrent-drift-sub-a', 'concurrent-drift-sub-b'],
  })
  if (drift.filter(result => result.status === 0).length !== 1) {
    throw new Error(
      `Concurrent same-invoice subscription drift should have one winner: ${JSON.stringify(drift)}`,
    )
  }
  if (
    !drift.find(result => result.status !== 0)?.stderr.includes(
      'Xsolla transaction id was already used with different Lunar purchase semantics',
    )
  ) {
    throw new Error(
      `Concurrent same-invoice subscription drift loser had the wrong error: ${JSON.stringify(drift)}`,
    )
  }

  const driftState = psql(
    stateSql(driftUser),
    '0024 same-invoice drift state',
  )
  if (driftState !== '1:1:300') {
    throw new Error(`Concurrent same-invoice subscription drift changed state twice: ${driftState}`)
  }
}
