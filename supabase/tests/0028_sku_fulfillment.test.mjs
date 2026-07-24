function createOrderSql(userId) {
  return `
    set role service_role;
    select (public.create_sku_payment_order(
      '${userId}',
      'stars_handful',
      'USD',
      true
    )).external_id;
  `
}

function fulfillSql(externalId, transactionId) {
  return `
    set statement_timeout = '10s';
    set role service_role;
    select (public.fulfill_payment_order(
      '${externalId}',
      ${transactionId},
      'payment',
      true,
      '{"notification_type":"payment","transaction":{"id":${transactionId}}}'::jsonb
    )).status;
  `
}

function refundSql(transactionId) {
  return `
    set statement_timeout = '10s';
    set role service_role;
    select (public.refund_payment_order(
      ${transactionId},
      'refund',
      true,
      '{"notification_type":"refund","transaction":{"id":${transactionId}}}'::jsonb
    )).status;
  `
}

export async function run({ psql, psqlAsync }) {
  const userId = 'd0280000-0000-4028-8028-000000000001'
  const firstTransaction = 928000001
  const secondTransaction = 928000002

  psql(
    `insert into auth.users (id) values ('${userId}');`,
    '0028 lock-order user',
  )
  const firstExternalId = psql(
    createOrderSql(userId),
    '0028 first bundle order',
  )
  const secondExternalId = psql(
    createOrderSql(userId),
    '0028 second bundle order',
  )
  psql(
    fulfillSql(firstExternalId, firstTransaction),
    '0028 first bundle fulfillment',
  )

  // Both paths lock order-specific state first, then the shared first-purchase
  // anchor, then the wallet. They may settle in either order, but must not
  // deadlock and must leave one exact refund plus one exact second credit.
  const [refund, fulfill] = await Promise.all([
    psqlAsync(refundSql(firstTransaction)),
    psqlAsync(fulfillSql(secondExternalId, secondTransaction)),
  ])
  if (refund.status !== 0 || refund.stdout !== 'refunded') {
    throw new Error(`Concurrent 0028 refund failed: ${JSON.stringify(refund)}`)
  }
  if (fulfill.status !== 0 || fulfill.stdout !== 'fulfilled') {
    throw new Error(`Concurrent 0028 fulfillment failed: ${JSON.stringify(fulfill)}`)
  }

  const state = psql(`
    select
      (select status from public.payment_orders where external_id = '${firstExternalId}') || ':' ||
      (select status from public.payment_orders where external_id = '${secondExternalId}') || ':' ||
      (select count(*) from public.wallet_ledger_entries
       where user_id = '${userId}' and balance_bucket = 'paid') || ':' ||
      (select count(*) from public.star_bundle_first_purchase_events
       where event_type = 'reversed'
         and first_purchase_id = (
           select id from public.star_bundle_first_purchases
           where user_id = '${userId}' and sku_id = 'stars_handful'
         )) || ':' ||
      (select current_balance from public.wallet_balances
       where user_id = '${userId}' and currency_id = 'stars'
         and balance_bucket = 'paid');
  `, '0028 concurrent fulfill/refund reconciliation')

  if (state !== 'refunded:fulfilled:3:1:60' &&
      state !== 'refunded:fulfilled:3:1:120') {
    throw new Error(`0028 anchor-wallet lock order drifted: ${state}`)
  }
}
