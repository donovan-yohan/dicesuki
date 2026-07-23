function recordSql(userId, idempotencyKey) {
  return `
    set role service_role;
    select (public.record_roll_ticket_ledger_entry(
      '${userId}',
      'standard_roll',
      3,
      'test.concurrent-replay',
      '${idempotencyKey}',
      '{"harness":"concurrency"}'::jsonb
    )).id;
  `
}

export async function run({ psql, psqlAsync }) {
  const userId = 'a14ccccc-cccc-4ccc-8ccc-cccccccccccc'
  const idempotencyKey = 'ticket:concurrent:replay:0001'

  psql(
    `insert into auth.users (id) values ('${userId}');`,
    '0014 concurrent replay user',
  )

  const replays = await Promise.all([
    psqlAsync(recordSql(userId, idempotencyKey)),
    psqlAsync(recordSql(userId, idempotencyKey)),
  ])
  if (replays.some(result => result.status !== 0)) {
    throw new Error(`Concurrent identical ticket replay failed: ${JSON.stringify(replays)}`)
  }
  if (new Set(replays.map(result => result.stdout)).size !== 1) {
    throw new Error(`Concurrent identical ticket replay returned different rows: ${JSON.stringify(replays)}`)
  }

  const state = psql(`
    select balances.current_quantity || ':' || count(entries.id) || ':' ||
      sum(entries.delta_quantity)
    from public.roll_ticket_balances as balances
    join public.roll_ticket_ledger_entries as entries
      on entries.user_id = balances.user_id
     and entries.roll_type = balances.roll_type
    where balances.user_id = '${userId}'
      and balances.roll_type = 'standard_roll'
    group by balances.current_quantity;
  `, '0014 concurrent replay reconciliation')

  if (state !== '3:1:3') {
    throw new Error(`Concurrent ticket replay changed state more than once: ${state}`)
  }
}
