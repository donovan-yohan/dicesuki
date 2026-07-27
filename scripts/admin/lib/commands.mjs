// Command implementations. All IO goes through the injected `io` object so the
// entrypoint owns stdout/stderr/prompting and can redact the service-role key.

import { UsageError } from './args.mjs'
import {
  buildCancelSessionSql,
  buildDieGrantPlan,
  buildTicketGrantPlan,
  buildWalletGrantPlan,
  deriveIdempotencyKey,
  formatSqlPreview,
} from './plans.mjs'
import {
  fetchCatalogItem,
  fetchCopySummary,
  fetchOrders,
  fetchPullSessions,
  fetchTicketBalances,
  fetchTicketLedger,
  fetchWalletBalances,
  fetchWalletLedger,
  resolveUserCandidates,
} from './queries.mjs'
import {
  formatInteger,
  formatKeyValues,
  formatTable,
  formatTimestamp,
  heading,
  secondsUntil,
} from './report.mjs'

/** Raised for a well-understood operational failure. Exits with code 1. */
export class OperationError extends Error {
  constructor(message, { code = null } = {}) {
    super(message)
    this.name = 'OperationError'
    this.code = code
  }
}

/**
 * SQLSTATE -> operator guidance, scoped per RPC.
 *
 * The same code means different things depending on which function raised it,
 * so the hint is never generic: `55000` on a die grant is the pull-hold pause,
 * but on a wallet append it would be the paid-Stars guard, which this CLI has
 * no way to trigger — saying "wait for the pull hold" there would send the
 * operator down a dead end.
 */
export function sqlstateHint(code, rpc) {
  switch (String(code)) {
    case '55000':
      return rpc === 'record_dice_copy_grant'
        ? 'A prepared pull hold is live for this player, so collectible grants are paused ' +
            '(0021_pull_copy_grant_rework.sql:968-981). Run `cancel-session <user>` to see when ' +
            'the hold expires, then re-run this exact command — the derived key replays safely.'
        : null
    case '22023':
      return (
        'An argument was rejected, or this idempotency key was already used with different ' +
        'arguments (0028_sku_fulfillment.sql:508-521). Re-run the identical command to replay, ' +
        'or change --note (or pass --key) to make it a genuinely new grant.'
      )
    case '22003':
      return rpc === 'record_roll_ticket_ledger_entry'
        ? 'Ticket floor hit: a negative delta cannot take the balance below zero ' +
            '(0014_roll_ticket_ledger.sql:196-203).'
        : 'Balance floor hit. A negative delta cannot take the balance below zero, and ' +
            'promotional Stars cannot dip below the amount reserved by a live pull hold ' +
            '(0028_sku_fulfillment.sql:536-566).'
    case '23503':
      return 'A referenced row does not exist (unknown economy edition or unknown catalog item).'
    case '42501':
      return (
        'Permission denied. These RPCs are granted to service_role only — the key in use is ' +
        'not a service-role key.'
      )
    default:
      return null
  }
}

function rpcFailure(error, rpc, retryHint) {
  const parts = [error.message, error.details, error.hint].filter(Boolean)
  const hint = sqlstateHint(error.code, rpc)
  if (hint) parts.push(hint)
  if (retryHint) parts.push(retryHint)
  return new OperationError(`${rpc} failed [${error.code ?? 'unknown'}]: ${parts.join(' | ')}`, {
    code: error.code ?? null,
  })
}

function describeCandidate(candidate) {
  return [
    candidate.id,
    candidate.auth?.email ?? '(no email)',
    candidate.profile?.display_name ?? '(no profile)',
  ].join('  ')
}

async function resolveSingleUser(request, context) {
  const candidates = await resolveUserCandidates(context.client, context.environment, request.query)
  if (candidates.length === 0) {
    throw new OperationError(
      `No player matched "${request.query}". Try the exact email or the auth user uuid.`,
    )
  }
  if (candidates.length > 1) {
    const lines = candidates.map(candidate => `  ${describeCandidate(candidate)}`).join('\n')
    throw new OperationError(
      `"${request.query}" matched ${candidates.length} players. Re-run with the uuid:\n${lines}`,
    )
  }
  return candidates[0]
}

function identityBlock(candidate) {
  return formatKeyValues([
    ['user id', candidate.id],
    ['email', candidate.auth?.email ?? '(unavailable)'],
    ['display name', candidate.profile?.display_name ?? '(no profile row)'],
    ['provider', candidate.auth?.provider ?? '-'],
    ['signed up', formatTimestamp(candidate.auth?.createdAt)],
    ['last sign-in', formatTimestamp(candidate.auth?.lastSignInAt)],
    ['banned until', candidate.auth?.bannedUntil ? formatTimestamp(candidate.auth.bannedUntil) : '-'],
  ])
}

function walletRows(balances) {
  return balances.map(balance => ({
    currency: balance.currency_id,
    bucket: balance.balance_bucket,
    balance: formatInteger(balance.current_balance),
    updated: formatTimestamp(balance.updated_at),
  }))
}

const WALLET_COLUMNS = [
  { key: 'currency', label: 'currency' },
  { key: 'bucket', label: 'bucket' },
  { key: 'balance', label: 'balance', align: 'right' },
  { key: 'updated', label: 'updated' },
]

const WALLET_LEDGER_COLUMNS = [
  { key: 'id', label: 'id', align: 'right' },
  { key: 'created', label: 'created' },
  { key: 'currency', label: 'currency' },
  { key: 'bucket', label: 'bucket' },
  { key: 'delta', label: 'delta', align: 'right' },
  { key: 'after', label: 'after', align: 'right' },
  { key: 'reason', label: 'reason_code' },
  { key: 'key', label: 'idempotency_key' },
]

const TICKET_LEDGER_COLUMNS = [
  { key: 'id', label: 'id', align: 'right' },
  { key: 'created', label: 'created' },
  { key: 'rollType', label: 'roll_type' },
  { key: 'delta', label: 'delta', align: 'right' },
  { key: 'after', label: 'after', align: 'right' },
  { key: 'reason', label: 'reason_code' },
  { key: 'key', label: 'idempotency_key' },
]

function walletLedgerRows(entries) {
  return entries.map(entry => ({
    id: entry.id,
    created: formatTimestamp(entry.created_at),
    currency: entry.currency_id,
    bucket: entry.balance_bucket,
    delta: formatInteger(entry.delta_amount),
    after: formatInteger(entry.balance_after),
    reason: entry.reason_code,
    key: entry.idempotency_key,
  }))
}

function ticketLedgerRows(entries) {
  return entries.map(entry => ({
    id: entry.id,
    created: formatTimestamp(entry.created_at),
    rollType: entry.roll_type,
    delta: formatInteger(entry.delta_quantity),
    after: formatInteger(entry.quantity_after),
    reason: entry.reason_code,
    key: entry.idempotency_key,
  }))
}

function renderActiveSession(activeSession, io) {
  if (!activeSession) {
    io.say('  (no live pull hold)')
    return
  }
  io.say(
    formatKeyValues([
      ['session id', activeSession.id],
      ['banner', activeSession.banner_version_id],
      ['pulls held', activeSession.pull_count],
      ['held amount', `${formatInteger(activeSession.held_amount)} ${activeSession.currency_id}/${activeSession.balance_bucket}`],
      ['prepared at', formatTimestamp(activeSession.prepared_at)],
      ['expires at', formatTimestamp(activeSession.expires_at)],
      ['expires in', `${secondsUntil(activeSession.expires_at)}s`],
    ]),
  )
}

/* ------------------------------------------------------------------------- */
/* Read commands                                                              */
/* ------------------------------------------------------------------------- */

async function commandUser(request, context) {
  const candidate = await resolveSingleUser(request, context)
  const { client, io } = context
  const [balances, tickets, copies, walletTail, ticketTail, pulls] = await Promise.all([
    fetchWalletBalances(client, candidate.id),
    fetchTicketBalances(client, candidate.id),
    fetchCopySummary(client, candidate.id),
    fetchWalletLedger(client, candidate.id, request.limit),
    fetchTicketLedger(client, candidate.id, request.limit),
    fetchPullSessions(client, candidate.id),
  ])

  io.say(heading('Identity'))
  io.say(identityBlock(candidate))

  io.say(heading('Wallet balances'))
  io.say(formatTable(walletRows(balances), WALLET_COLUMNS))

  io.say(heading('Roll tickets'))
  io.say(
    formatTable(
      tickets.map(ticket => ({
        rollType: ticket.roll_type,
        quantity: formatInteger(ticket.current_quantity),
        updated: formatTimestamp(ticket.updated_at),
      })),
      [
        { key: 'rollType', label: 'roll_type' },
        { key: 'quantity', label: 'quantity', align: 'right' },
        { key: 'updated', label: 'updated' },
      ],
    ),
  )

  io.say(heading('Dice copies'))
  io.say(
    formatKeyValues([
      ['live copies', formatInteger(copies.liveCopies)],
      ['scrapped', formatInteger(copies.scrappedCopies)],
      ['total ever', formatInteger(copies.totalCopies)],
    ]),
  )
  io.say(
    formatTable(
      copies.recentCopies.map(copy => ({
        item: copy.catalog_item_id,
        source: copy.source_kind,
        acquired: formatTimestamp(copy.acquired_at),
        first: copy.is_first_copy,
        scrapped: copy.scrapped_at ? formatTimestamp(copy.scrapped_at) : '-',
      })),
      [
        { key: 'item', label: 'catalog_item_id' },
        { key: 'source', label: 'source' },
        { key: 'acquired', label: 'acquired' },
        { key: 'first', label: 'first_copy' },
        { key: 'scrapped', label: 'scrapped' },
      ],
    ),
  )

  io.say(heading(`Wallet ledger (last ${request.limit})`))
  io.say(formatTable(walletLedgerRows(walletTail), WALLET_LEDGER_COLUMNS))

  io.say(heading(`Roll-ticket ledger (last ${request.limit})`))
  io.say(formatTable(ticketLedgerRows(ticketTail), TICKET_LEDGER_COLUMNS))

  io.say(heading('Active pull hold'))
  renderActiveSession(pulls.activeSession, io)

  return {
    user: { id: candidate.id, auth: candidate.auth ?? null, profile: candidate.profile ?? null },
    walletBalances: balances,
    ticketBalances: tickets,
    diceCopies: copies,
    walletLedger: walletTail,
    ticketLedger: ticketTail,
    activePullSession: pulls.activeSession,
  }
}

async function commandLedger(request, context) {
  const candidate = await resolveSingleUser(request, context)
  const { client, io } = context
  const [walletTail, ticketTail] = await Promise.all([
    fetchWalletLedger(client, candidate.id, request.limit),
    fetchTicketLedger(client, candidate.id, request.limit),
  ])

  io.say(heading(`Wallet ledger — ${candidate.id} (last ${request.limit})`))
  io.say(formatTable(walletLedgerRows(walletTail), WALLET_LEDGER_COLUMNS))
  io.say(heading(`Roll-ticket ledger — ${candidate.id} (last ${request.limit})`))
  io.say(formatTable(ticketLedgerRows(ticketTail), TICKET_LEDGER_COLUMNS))

  return { user: { id: candidate.id }, walletLedger: walletTail, ticketLedger: ticketTail }
}

async function commandOrders(request, context) {
  const candidate = await resolveSingleUser(request, context)
  const { io } = context
  const { orders, events } = await fetchOrders(context.client, candidate.id, request.limit)

  io.say(heading(`Payment orders — ${candidate.id} (last ${request.limit})`))
  io.say(
    formatTable(
      orders.map(order => ({
        external: order.external_id,
        status: order.status,
        sku: order.sku_id ?? order.catalog_item_id ?? '-',
        amount: `${formatInteger(order.amount_minor)} ${order.currency}`,
        txn: order.xsolla_transaction_id ?? '-',
        sandbox: order.dry_run,
        created: formatTimestamp(order.created_at),
      })),
      [
        { key: 'external', label: 'external_id' },
        { key: 'status', label: 'status' },
        { key: 'sku', label: 'sku / item' },
        { key: 'amount', label: 'amount', align: 'right' },
        { key: 'txn', label: 'xsolla_txn', align: 'right' },
        { key: 'sandbox', label: 'dry_run' },
        { key: 'created', label: 'created' },
      ],
    ),
  )

  const ordersById = new Map(orders.map(order => [order.id, order]))
  io.say(heading('Payment events'))
  io.say(
    formatTable(
      events.map(event => ({
        external: ordersById.get(event.order_id)?.external_id ?? event.order_id,
        type: event.event_type,
        txn: event.xsolla_transaction_id,
        sandbox: event.dry_run,
        processed: formatTimestamp(event.processed_at),
      })),
      [
        { key: 'external', label: 'order' },
        { key: 'type', label: 'event_type' },
        { key: 'txn', label: 'xsolla_txn', align: 'right' },
        { key: 'sandbox', label: 'dry_run' },
        { key: 'processed', label: 'processed' },
      ],
    ),
  )

  return { user: { id: candidate.id }, orders, events }
}

/* ------------------------------------------------------------------------- */
/* Mutating commands                                                          */
/* ------------------------------------------------------------------------- */

async function executePlan(plan, request, context) {
  const { io } = context
  io.say(heading('Planned call'))
  io.say(
    formatKeyValues([
      ['command', plan.command],
      ['rpc', `${plan.schema}.${plan.rpc}`],
      ['effect', plan.effect],
      ['summary', plan.summary],
      ['mode', request.dryRun ? 'DRY RUN (nothing executes)' : 'EXECUTE'],
    ]),
  )
  const provenance = plan.payload.p_provenance
  if (provenance) {
    io.say('\n  provenance: ' + JSON.stringify(provenance))
  }
  io.say('\n' + formatSqlPreview(plan))

  if (request.dryRun) {
    io.say('\nDRY RUN — nothing was executed. Re-run with --no-dry-run to apply.')
    return { plan, dryRun: true, executed: false, result: null }
  }

  if (!request.yes) {
    const approved = await io.confirm(`Execute ${plan.schema}.${plan.rpc}?`)
    if (!approved) {
      throw new OperationError('Aborted by operator — nothing was executed.')
    }
  }

  // Echoed on every failure path: after an ambiguous error the operator cannot
  // tell whether the write landed, and this key is the thing that makes the
  // retry safe either way.
  const idempotencyKey = plan.payload.p_idempotency_key
  const retryHint =
    `Retry with --key '${idempotencyKey}' (or just re-run the identical command): the write ` +
    'is replay-safe, so a retry returns the original row rather than granting twice.'

  let response
  try {
    response = await context.client.rpc(plan.rpc, plan.payload)
  } catch (cause) {
    throw new OperationError(
      `${plan.rpc} did not return a result: ${cause?.message ?? cause}. The write may or may ` +
        `not have landed. ${retryHint}`,
    )
  }
  const { data, error } = response
  if (error) throw rpcFailure(error, plan.rpc, retryHint)
  io.say(`\nDONE — ${plan.summary}`)
  io.say(formatKeyValues(Object.entries(data ?? {}).map(([key, value]) => [key, JSON.stringify(value)])))
  return { plan, dryRun: false, executed: true, result: data ?? null }
}

/**
 * Either the operator's explicit `--key`, or a key derived deterministically
 * from the full intent of the grant, so a re-run after an ambiguous failure
 * replays instead of double-granting.
 */
function resolveKey(request, userId, { subject = null, rollType = null } = {}) {
  return (
    request.idempotencyKey ??
    deriveIdempotencyKey({
      command: request.command,
      userId,
      subject,
      rollType,
      operator: request.operator,
      note: request.note,
    })
  )
}

async function commandWalletGrant(kind, request, context) {
  const candidate = await resolveSingleUser(request, context)
  const plan = buildWalletGrantPlan({
    kind,
    command: request.command,
    userId: candidate.id,
    amount: request.amount,
    operator: request.operator,
    note: request.note,
    idempotencyKey: resolveKey(request, candidate.id, { subject: request.amount }),
    reasonCode: request.reasonCode,
  })
  context.io.say(heading('Target'))
  context.io.say(identityBlock(candidate))
  return { user: { id: candidate.id }, ...(await executePlan(plan, request, context)) }
}

async function commandTicketGrant(request, context) {
  const candidate = await resolveSingleUser(request, context)
  const plan = buildTicketGrantPlan({
    command: request.command,
    userId: candidate.id,
    amount: request.amount,
    rollType: request.rollType,
    operator: request.operator,
    note: request.note,
    idempotencyKey: resolveKey(request, candidate.id, {
      subject: request.amount,
      rollType: request.rollType,
    }),
    reasonCode: request.reasonCode,
  })
  context.io.say(heading('Target'))
  context.io.say(identityBlock(candidate))
  return { user: { id: candidate.id }, ...(await executePlan(plan, request, context)) }
}

async function commandDieGrant(request, context) {
  const candidate = await resolveSingleUser(request, context)
  const item = await fetchCatalogItem(context.client, request.catalogItemId)
  if (!item) {
    throw new OperationError(
      `Unknown catalog item "${request.catalogItemId}". Ids look like ` +
        '<catalog-key>@<contract-version>; check public.catalog_items.',
    )
  }
  if (item.item_kind !== 'die') {
    throw new OperationError(
      `Catalog item "${item.id}" has item_kind=${item.item_kind}; ` +
        'record_dice_copy_grant only accepts dice (0020_dice_copy_inventory.sql:146-154).',
    )
  }
  // HARD STOP, not a warning. `fetchCatalogSnapshot` drops catalog items with no
  // asset version (src/lib/collectibleCatalog.ts:259-260), and
  // `mapServerCopiesToInventoryDice` then returns null for the WHOLE set the
  // moment any live copy has no resolvable item/asset
  // (src/store/useInventoryStore.ts:300-308). So this does not merely fail to
  // render one die — it collapses the player's entire server-copy inventory
  // overlay. Dice copies are undeletable (0020_dice_copy_inventory.sql:76-118),
  // so the damage is permanent and only an asset-version migration can undo it.
  if (item.assetVersionCount === 0 && !request.allowMissingAsset) {
    throw new OperationError(
      `${item.id} has no catalog_asset_versions row. Granting it would permanently break this ` +
        "player's ENTIRE inventory overlay, not just this die: the client drops asset-less " +
        'catalog items and then discards the whole server-copy set, and dice_copies rows can ' +
        'never be deleted. Publish an asset version first. Pass --allow-missing-asset only if ' +
        'you have independently confirmed this is safe.',
    )
  }
  if (item.assetVersionCount === 0) {
    context.io.warn(
      `WARNING: --allow-missing-asset overrides the asset check for ${item.id}. This can ` +
        "permanently collapse the player's entire server-copy inventory overlay.",
    )
  }

  const pulls = await fetchPullSessions(context.client, candidate.id)
  if (pulls.activeSession) {
    context.io.warn(
      `WARNING: a pull hold is live until ${formatTimestamp(pulls.activeSession.expires_at)} ` +
        `(${secondsUntil(pulls.activeSession.expires_at)}s). Grants raise SQLSTATE 55000 while ` +
        'it is held — wait for it to expire and re-run this exact command (the derived key replays).',
    )
  }

  context.io.say(heading('Target'))
  context.io.say(identityBlock(candidate))
  context.io.say(heading('Catalog item'))
  context.io.say(
    formatKeyValues([
      ['id', item.id],
      ['set', item.set_id],
      ['dice type', item.dice_type],
      ['rarity', item.rarity],
      ['asset versions', item.assetVersionCount],
    ]),
  )

  const plan = buildDieGrantPlan({
    command: request.command,
    userId: candidate.id,
    catalogItemId: item.id,
    operator: request.operator,
    note: request.note,
    idempotencyKey: resolveKey(request, candidate.id, { subject: item.id }),
  })
  return {
    user: { id: candidate.id },
    catalogItem: item,
    activePullSession: pulls.activeSession,
    ...(await executePlan(plan, request, context)),
  }
}

/**
 * Inspect and (manually) cancel a live pull hold.
 *
 * There is no service-role execution path: `public.cancel_pull_session(uuid)` is
 * granted to `authenticated` only and reads `auth.uid()`
 * (0017_pull_commit_reveal.sql:1063-1090), and `service_role` has SELECT-only on
 * `pull_session_transitions` (0017_pull_commit_reveal.sql:53-58). So this
 * command reports the hold and, with `--confirm`, prints the exact owner-level
 * SQL. The preferred fix is almost always to wait: holds are 30-600s
 * (0011_earned_pull_preparation.sql:188) and self-clear at `expires_at`.
 */
async function commandCancelSession(request, context) {
  const candidate = await resolveSingleUser(request, context)
  const { io } = context
  const pulls = await fetchPullSessions(context.client, candidate.id)

  io.say(heading('Target'))
  io.say(identityBlock(candidate))
  io.say(heading('Recent pull sessions'))
  io.say(
    formatTable(
      pulls.sessions.map(session => ({
        id: session.id,
        banner: session.banner_version_id,
        pulls: session.pull_count,
        held: formatInteger(session.held_amount),
        prepared: formatTimestamp(session.prepared_at),
        expires: formatTimestamp(session.expires_at),
        outcome: session.transition ? session.transition.kind : 'none',
      })),
      [
        { key: 'id', label: 'session_id' },
        { key: 'banner', label: 'banner' },
        { key: 'pulls', label: 'pulls', align: 'right' },
        { key: 'held', label: 'held', align: 'right' },
        { key: 'prepared', label: 'prepared' },
        { key: 'expires', label: 'expires' },
        { key: 'outcome', label: 'transition' },
      ],
    ),
  )

  io.say(heading('Live hold'))
  renderActiveSession(pulls.activeSession, io)

  if (!pulls.activeSession) {
    io.say('\nNothing to cancel — no prepared, unexpired, untransitioned session.')
    return { user: { id: candidate.id }, sessions: pulls.sessions, activeSession: null, executed: false, sql: null }
  }

  if (!request.dryRun) {
    io.warn(
      '--no-dry-run has no effect on cancel-session: no service-role execution path exists. ' +
        'The statement below must be run from a Postgres owner connection.',
    )
  }

  const remaining = secondsUntil(pulls.activeSession.expires_at)
  io.say(
    `\nPREFERRED FIX: wait ${remaining}s. The hold self-clears at expires_at and grants unblock ` +
      'with no write at all.',
  )

  if (!request.confirm) {
    io.say('Pass --confirm to print the manual cancellation SQL.')
    return {
      user: { id: candidate.id },
      sessions: pulls.sessions,
      activeSession: pulls.activeSession,
      executed: false,
      sql: null,
    }
  }

  const sql = buildCancelSessionSql(pulls.activeSession, {
    operator: request.operator ?? 'support',
    note: request.note ?? null,
  })
  io.say(heading('Manual cancellation SQL (owner connection required)'))
  io.say(sql)
  io.warn(
    'NOT EXECUTED. The service-role key cannot write pull_session_transitions ' +
      '(0017_pull_commit_reveal.sql:53-58) and cannot call public.cancel_pull_session for ' +
      'another user (0017_pull_commit_reveal.sql:1073-1090). Run the statement above from the ' +
      'Supabase dashboard SQL editor, or have the player retry in-app. The insert is ' +
      'append-only and can never be corrected.',
  )
  return {
    user: { id: candidate.id },
    sessions: pulls.sessions,
    activeSession: pulls.activeSession,
    executed: false,
    sql,
  }
}

const HANDLERS = Object.freeze({
  user: commandUser,
  ledger: commandLedger,
  orders: commandOrders,
  'grant-stars': (request, context) => commandWalletGrant('stars', request, context),
  'grant-dust': (request, context) => commandWalletGrant('dust', request, context),
  'grant-tickets': commandTicketGrant,
  'grant-die': commandDieGrant,
  'cancel-session': commandCancelSession,
})

export async function runCommand(request, context) {
  const handler = HANDLERS[request.command]
  if (!handler) throw new UsageError(`Unknown command "${request.command}"`)
  return handler(request, context)
}
