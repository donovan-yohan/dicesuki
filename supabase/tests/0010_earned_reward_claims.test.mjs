const completionTime = '2026-07-13 12:00:00+00'

function rollSql(userId, eventId, payloadHash, completedAt = completionTime) {
  return `
    set role service_role;
    select event.id || ':' || coalesce(event.credited_slot::text, 'none')
    from public.record_authoritative_roll_completion(
      '${userId}',
      '${eventId}',
      '${payloadHash}',
      '${completedAt}'::timestamptz
    ) as event;
  `
}

function claimSql(userId, idempotencyKey) {
  return `
    set "request.jwt.claims" = '{"sub":"${userId}","is_anonymous":false}';
    set role authenticated;
    select claim.id || ':' || claim.catalog_item_id
    from public.claim_new_collector_passport('${idempotencyKey}') as claim;
  `
}

export async function run({ psql, psqlAsync }) {
  const exactReplayUser = '61111111-1111-4111-8111-111111111111'
  const mismatchedReplayUser = '62222222-2222-4222-8222-222222222222'
  const crossUserA = '65555555-5555-4555-8555-555555555555'
  const crossUserB = '66666666-6666-4666-8666-666666666666'
  const slotRaceUser = '63333333-3333-4333-8333-333333333333'
  const duplicateClaimUser = '64444444-4444-4444-8444-444444444444'
  psql(`
    insert into auth.users (id) values
      ('${exactReplayUser}'),
      ('${mismatchedReplayUser}'),
      ('${crossUserA}'),
      ('${crossUserB}'),
      ('${slotRaceUser}'),
      ('${duplicateClaimUser}');
  `, '0010 concurrency users')

  const exactReplay = await Promise.all([
    psqlAsync(rollSql(exactReplayUser, 'concurrent-exact-roll-01', 'a'.repeat(64))),
    psqlAsync(rollSql(exactReplayUser, 'concurrent-exact-roll-01', 'a'.repeat(64))),
  ])
  if (exactReplay.some(result => result.status !== 0)) {
    throw new Error(`Concurrent exact roll replay failed: ${JSON.stringify(exactReplay)}`)
  }
  if (new Set(exactReplay.map(result => result.stdout)).size !== 1) {
    throw new Error(`Concurrent exact roll replay returned different events: ${JSON.stringify(exactReplay)}`)
  }
  const exactReplayState = psql(`
    select balances.current_balance || ':' ||
      (select count(*) from public.authoritative_roll_completion_events where user_id = '${exactReplayUser}') || ':' ||
      (select count(*) from public.wallet_ledger_entries where user_id = '${exactReplayUser}')
    from public.wallet_balances as balances
    where balances.user_id = '${exactReplayUser}' and balances.currency_id = 'stars';
  `, '0010 concurrent exact replay state')
  if (exactReplayState !== '160:1:1') {
    throw new Error(`Concurrent exact replay credited more than once: ${exactReplayState}`)
  }

  const mismatchedReplay = await Promise.all([
    psqlAsync(rollSql(mismatchedReplayUser, 'concurrent-mismatch-roll-01', 'b'.repeat(64))),
    psqlAsync(rollSql(mismatchedReplayUser, 'concurrent-mismatch-roll-01', 'c'.repeat(64))),
  ])
  if (mismatchedReplay.filter(result => result.status === 0).length !== 1) {
    throw new Error(`Exactly one mismatched roll replay must succeed: ${JSON.stringify(mismatchedReplay)}`)
  }
  if (!mismatchedReplay.find(result => result.status !== 0)?.stderr.includes('different roll payload')) {
    throw new Error(`Mismatched roll replay did not fail closed: ${JSON.stringify(mismatchedReplay)}`)
  }
  const mismatchedReplayState = psql(`
    select balances.current_balance || ':' ||
      (select count(*) from public.authoritative_roll_completion_events where user_id = '${mismatchedReplayUser}') || ':' ||
      (select count(*) from public.wallet_ledger_entries where user_id = '${mismatchedReplayUser}')
    from public.wallet_balances as balances
    where balances.user_id = '${mismatchedReplayUser}' and balances.currency_id = 'stars';
  `, '0010 concurrent mismatched replay state')
  if (mismatchedReplayState !== '160:1:1') {
    throw new Error(`Mismatched replay left partial or duplicate credit: ${mismatchedReplayState}`)
  }

  const crossUserReplay = await Promise.all([
    psqlAsync(rollSql(crossUserA, 'cross-user-global-roll-01', '1'.repeat(64))),
    psqlAsync(rollSql(crossUserB, 'cross-user-global-roll-01', '2'.repeat(64))),
  ])
  if (crossUserReplay.filter(result => result.status === 0).length !== 1) {
    throw new Error(`Exactly one cross-user global event-id racer must succeed: ${JSON.stringify(crossUserReplay)}`)
  }
  if (!crossUserReplay.find(result => result.status !== 0)?.stderr.includes('different roll payload')) {
    throw new Error(`Cross-user global event-id loser did not fail closed: ${JSON.stringify(crossUserReplay)}`)
  }
  const crossUserState = psql(`
    select
      (select count(*) from public.wallet_accounts where user_id in ('${crossUserA}', '${crossUserB}')) || ':' ||
      (select count(*) from public.wallet_balances where user_id in ('${crossUserA}', '${crossUserB}')) || ':' ||
      (select coalesce(sum(current_balance), 0) from public.wallet_balances where user_id in ('${crossUserA}', '${crossUserB}')) || ':' ||
      (select count(*) from public.authoritative_roll_completion_events where user_id in ('${crossUserA}', '${crossUserB}')) || ':' ||
      (select count(*) from public.wallet_ledger_entries where user_id in ('${crossUserA}', '${crossUserB}'));
  `, '0010 cross-user global event-id rollback state')
  if (crossUserState !== '1:1:160:1:1') {
    throw new Error(`Cross-user global event-id loser left wallet residue: ${crossUserState}`)
  }

  for (let slot = 1; slot <= 9; slot += 1) {
    psql(
      rollSql(
        slotRaceUser,
        `slot-race-seed-${String(slot).padStart(2, '0')}`,
        'd'.repeat(64),
        `2026-07-13 12:00:${String(slot).padStart(2, '0')}+00`,
      ),
      `0010 slot-race seed ${slot}`,
    )
  }
  const slotRace = await Promise.all([
    psqlAsync(rollSql(
      slotRaceUser,
      'slot-race-final-a',
      'e'.repeat(64),
      '2026-07-13 12:01:00+00',
    )),
    psqlAsync(rollSql(
      slotRaceUser,
      'slot-race-final-b',
      'f'.repeat(64),
      '2026-07-13 12:01:01+00',
    )),
  ])
  if (slotRace.some(result => result.status !== 0)) {
    throw new Error(`Slot-ten race should retain both completion events: ${JSON.stringify(slotRace)}`)
  }
  const racedSlots = slotRace.map(result => result.stdout.split(':').at(-1)).sort()
  if (JSON.stringify(racedSlots) !== JSON.stringify(['10', 'none'])) {
    throw new Error(`Slot-ten race did not produce one credit and one capped event: ${JSON.stringify(slotRace)}`)
  }
  const slotRaceState = psql(`
    select balances.current_balance || ':' ||
      (select count(*) from public.authoritative_roll_completion_events where user_id = '${slotRaceUser}' and credited_slot is not null) || ':' ||
      (select count(*) from public.authoritative_roll_completion_events where user_id = '${slotRaceUser}') || ':' ||
      (select count(*) from public.wallet_ledger_entries where user_id = '${slotRaceUser}')
    from public.wallet_balances as balances
    where balances.user_id = '${slotRaceUser}' and balances.currency_id = 'stars';
  `, '0010 slot-ten race state')
  if (slotRaceState !== '1600:10:11:10') {
    throw new Error(`Slot-ten race exceeded 1600 Stars or lost an event: ${slotRaceState}`)
  }

  const duplicateClaim = await Promise.all([
    psqlAsync(claimSql(duplicateClaimUser, 'concurrent:passport:0001')),
    psqlAsync(claimSql(duplicateClaimUser, 'concurrent:passport:0001')),
  ])
  if (duplicateClaim.some(result => result.status !== 0)) {
    throw new Error(`Concurrent duplicate claim failed: ${JSON.stringify(duplicateClaim)}`)
  }
  if (new Set(duplicateClaim.map(result => result.stdout)).size !== 1) {
    throw new Error(`Concurrent duplicate claim returned different outcomes: ${JSON.stringify(duplicateClaim)}`)
  }
  const duplicateClaimState = psql(`
    select
      (select count(*) from public.earned_reward_passport_enrollments where user_id = '${duplicateClaimUser}') || ':' ||
      (select count(*) from public.earned_reward_claim_outcomes where user_id = '${duplicateClaimUser}') || ':' ||
      (select count(*) from public.user_entitlements where user_id = '${duplicateClaimUser}') || ':' ||
      (select catalog_item_id from public.earned_reward_claim_outcomes where user_id = '${duplicateClaimUser}');
  `, '0010 concurrent duplicate claim state')
  if (duplicateClaimState !== '1:1:1:adventurer-starter/d10/common@1') {
    throw new Error(`Concurrent duplicate claim created duplicate state: ${duplicateClaimState}`)
  }
}
