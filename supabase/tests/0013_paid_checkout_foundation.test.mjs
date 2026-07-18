function createOrderSql(userId, catalogItemId) {
  return `
    set role service_role;
    select (public.create_payment_order(
      '${userId}',
      '${catalogItemId}',
      499,
      'USD',
      true
    )).external_id;
  `
}

function fulfillSql(externalId, txn, eventType) {
  return `
    set role service_role;
    select (public.fulfill_payment_order(
      '${externalId}',
      ${txn},
      '${eventType}',
      true,
      '{}'::jsonb
    )).status;
  `
}

export async function run({ psql, psqlAsync }) {
  const duplicateUser = 'd0130000-0000-4000-8000-000000000001'
  const reorderUser = 'd0130000-0000-4000-8000-000000000002'
  const catalogItem = 'void-crystal/d20/legendary@1'

  psql(
    `insert into auth.users (id) values ('${duplicateUser}'), ('${reorderUser}');`,
    '0013 concurrency users',
  )

  // Two identical webhook deliveries for one transaction race to fulfill the
  // same order. The order-row lock serializes them into a single grant.
  const duplicateExternalId = psql(
    createOrderSql(duplicateUser, catalogItem),
    '0013 duplicate-webhook order create',
  )
  if (!/^[0-9a-f-]{36}$/.test(duplicateExternalId)) {
    throw new Error(`create_payment_order did not return one external id: ${duplicateExternalId}`)
  }

  const duplicateTxn = 910000001
  const duplicate = await Promise.all([
    psqlAsync(fulfillSql(duplicateExternalId, duplicateTxn, 'payment')),
    psqlAsync(fulfillSql(duplicateExternalId, duplicateTxn, 'payment')),
  ])
  if (duplicate.some(result => result.status !== 0)) {
    throw new Error(`Concurrent duplicate fulfillment failed: ${JSON.stringify(duplicate)}`)
  }
  if (duplicate.some(result => result.stdout !== 'fulfilled')) {
    throw new Error(`Concurrent duplicate fulfillment did not both settle fulfilled: ${JSON.stringify(duplicate)}`)
  }

  const duplicateState = psql(`
    select
      (select status from public.payment_orders where external_id = '${duplicateExternalId}') || ':' ||
      (select count(*) from public.payment_events
       where order_id = (select id from public.payment_orders where external_id = '${duplicateExternalId}')) || ':' ||
      (select count(*) from public.user_entitlements
       where user_id = '${duplicateUser}' and catalog_item_id = '${catalogItem}');
  `, '0013 duplicate-webhook reconciliation')
  if (duplicateState !== 'fulfilled:1:1') {
    throw new Error(`Concurrent duplicate webhooks did not single-grant: ${duplicateState}`)
  }

  // Two distinct webhook types for one transaction race. Exactly one grants; the
  // other is recorded as an audit event without a second entitlement.
  const reorderExternalId = psql(
    createOrderSql(reorderUser, catalogItem),
    '0013 out-of-order order create',
  )
  if (!/^[0-9a-f-]{36}$/.test(reorderExternalId)) {
    throw new Error(`create_payment_order did not return one external id: ${reorderExternalId}`)
  }

  const reorderTxn = 910000002
  const reordered = await Promise.all([
    psqlAsync(fulfillSql(reorderExternalId, reorderTxn, 'payment')),
    psqlAsync(fulfillSql(reorderExternalId, reorderTxn, 'order_paid')),
  ])
  if (reordered.some(result => result.status !== 0)) {
    throw new Error(`Concurrent out-of-order fulfillment failed: ${JSON.stringify(reordered)}`)
  }
  if (reordered.some(result => result.stdout !== 'fulfilled')) {
    throw new Error(`Concurrent out-of-order fulfillment did not both settle fulfilled: ${JSON.stringify(reordered)}`)
  }

  const reorderState = psql(`
    select
      (select status from public.payment_orders where external_id = '${reorderExternalId}') || ':' ||
      (select count(*) from public.payment_events
       where order_id = (select id from public.payment_orders where external_id = '${reorderExternalId}')) || ':' ||
      (select count(*) from public.user_entitlements
       where user_id = '${reorderUser}' and catalog_item_id = '${catalogItem}');
  `, '0013 out-of-order reconciliation')
  if (reorderState !== 'fulfilled:2:1') {
    throw new Error(`Concurrent out-of-order webhooks did not single-grant: ${reorderState}`)
  }
}
