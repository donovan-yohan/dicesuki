function appendSql(userId, delta, idempotencyKey) {
  return `
    set role service_role;
    select (public.append_wallet_ledger_entry(
      '${userId}',
      'stars',
      'promotional',
      ${delta},
      'test.concurrent',
      '${idempotencyKey}',
      'earned-collection@1',
      '{"harness":"concurrency"}'::jsonb
    )).id;
  `
}

export async function run({ psql, psqlAsync }) {
  const replayUser = '33333333-3333-4333-8333-333333333333'
  const overspendUser = '44444444-4444-4444-8444-444444444444'
  psql(
    `insert into auth.users (id) values ('${replayUser}'), ('${overspendUser}');`,
    '0009 concurrency users',
  )

  const identical = await Promise.all([
    psqlAsync(appendSql(replayUser, 160, 'concurrent:replay:0001')),
    psqlAsync(appendSql(replayUser, 160, 'concurrent:replay:0001')),
  ])
  if (identical.some(result => result.status !== 0)) {
    throw new Error(`Concurrent identical replay failed: ${JSON.stringify(identical)}`)
  }
  if (new Set(identical.map(result => result.stdout)).size !== 1) {
    throw new Error(`Concurrent identical replay returned different rows: ${JSON.stringify(identical)}`)
  }
  const replayState = psql(`
    select current_balance || ':' || (
      select count(*) from public.wallet_ledger_entries where user_id = '${replayUser}'
    )
    from public.wallet_balances where user_id = '${replayUser}';
  `, '0009 concurrent replay reconciliation')
  if (replayState !== '160:1') {
    throw new Error(`Concurrent replay changed balance more than once: ${replayState}`)
  }

  psql(appendSql(overspendUser, 160, 'concurrent:credit:0001'), '0009 overspend seed credit')
  const debits = await Promise.all([
    psqlAsync(appendSql(overspendUser, -120, 'concurrent:debit:a')),
    psqlAsync(appendSql(overspendUser, -120, 'concurrent:debit:b')),
  ])
  if (debits.filter(result => result.status === 0).length !== 1) {
    throw new Error(`Exactly one concurrent debit should succeed: ${JSON.stringify(debits)}`)
  }
  if (!debits.find(result => result.status !== 0)?.stderr.includes('Insufficient stars/promotional balance')) {
    throw new Error(`Rejected concurrent debit did not fail for insufficient balance: ${JSON.stringify(debits)}`)
  }
  const debitState = psql(`
    select balances.current_balance || ':' || count(entries.id) || ':' || sum(entries.delta_amount)
    from public.wallet_balances as balances
    join public.wallet_ledger_entries as entries
      on entries.account_id = balances.account_id
     and entries.currency_id = balances.currency_id
     and entries.balance_bucket = balances.balance_bucket
    where balances.user_id = '${overspendUser}'
    group by balances.current_balance;
  `, '0009 concurrent debit reconciliation')
  if (debitState !== '40:2:40') {
    throw new Error(`Concurrent debit broke ledger reconciliation: ${debitState}`)
  }
}
