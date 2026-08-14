// Command implementations. All IO goes through the injected `io` object so the
// entrypoint owns stdout/stderr/prompting and can redact the service-role key.

import { UsageError } from './args.mjs'
import {
  buildCancelSessionSql,
  buildDieGrantPlan,
  buildEconomyAccessPlan,
  buildTicketGrantPlan,
  buildWalletGrantPlan,
  deriveIdempotencyKey,
  formatSqlPreview,
} from './plans.mjs'
import {
  fetchCatalogItem,
  fetchCopySummary,
  fetchEconomyAccess,
  fetchOrders,
  findExistingGrant,
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
      // Scoped, because the two meanings do not overlap: on the three grant
      // RPCs 22023 is usually idempotency-key drift, but set_user_economy_access
      // has no key at all, so pointing its caller at --key/--note replay advice
      // would send them after a mechanism that does not exist.
      return rpc === 'set_user_economy_access'
        ? 'An argument was rejected: --operator must be 1-64 characters and --note 1-512, ' +
            'both non-blank after trimming, and the on/off decision must not be null ' +
            '(0034_economy_access_flag.sql:111-123). This RPC has no idempotency key, so this ' +
            'is a plain validation failure and never a replay conflict.'
        : 'An argument was rejected, or this idempotency key was already used with different ' +
            'arguments (0028_sku_fulfillment.sql:508-521). Re-run the identical command to ' +
            'replay, or change --note (or pass --key) to make it a genuinely new grant.'
    case '22003':
      return rpc === 'record_roll_ticket_ledger_entry'
        ? 'Ticket floor hit: a negative delta cannot take the balance below zero ' +
            '(0014_roll_ticket_ledger.sql:196-203).'
        : 'Balance floor hit. A negative delta cannot take the balance below zero, and ' +
            'promotional Stars cannot dip below the amount reserved by a live pull hold ' +
            '(0028_sku_fulfillment.sql:536-566).'
    case '23503':
      return rpc === 'set_user_economy_access'
        ? 'No such auth user — check the uuid. user_economy_access.user_id references ' +
            'auth.users (0034_economy_access_flag.sql:124-126), and this CLI resolves identity ' +
            'via the GoTrue admin API, so a stale uuid pasted from a ticket is the usual cause.'
        : 'A referenced row does not exist (unknown economy edition or unknown catalog item).'
    case '42501':
      return (
        'Permission denied. These RPCs are granted to service_role only — the key in use is ' +
        'not a service-role key.'
      )
    default:
      return null
  }
}

/**
 * SQLSTATEs where re-running the identical command could plausibly behave
 * differently: transient contention, cancellation, and the pull-hold pause that
 * clears on its own. Everything else the grant RPCs raise is a deterministic
 * rejection of these exact arguments — offering a retry there is worse than
 * silence, because it contradicts the code-specific fix printed alongside it.
 *
 * A missing code means the failure never reached Postgres (transport), which is
 * ambiguous, so the operator does get the key.
 */
const RETRYABLE_SQLSTATES = new Set(['55000', '40001', '40P01', '55P03', '57014'])

export function isRetryable(code) {
  if (code === null || code === undefined || code === '') return true
  const value = String(code)
  return RETRYABLE_SQLSTATES.has(value) || value.startsWith('08')
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

/**
 * Render the economy access flag.
 *
 * The no-row case is spelled out rather than dashed: absence of a
 * `user_economy_access` row IS "off" (the column defaults to false and no row
 * exists until an operator decides — 0034_economy_access_flag.sql:39-49). A support
 * agent reading `access: -` would reasonably conclude "unknown", and would then
 * either escalate a non-problem or grant access a second time.
 *
 * `granted at` is labelled as what it actually is: the New Collector Passport's
 * 12-week anchor, stamped by the first enable and never moved afterwards — so a
 * disable does not reset it and a re-enable does not restart the clock.
 */
function economyAccessBlock(access) {
  if (!access) {
    return formatKeyValues([
      ['access', 'off (no user_economy_access row — never granted)'],
      ['granted at', '- (passport anchor never stamped)'],
      ['updated', '-'],
      ['last changed by', '-'],
      ['note', '-'],
    ])
  }
  return formatKeyValues([
    ['access', access.economy_access ? 'on' : 'off'],
    [
      'granted at',
      access.economy_access_granted_at
        ? `${formatTimestamp(access.economy_access_granted_at)} ` +
          '(passport anchor — set once, never moved)'
        : '- (passport anchor never stamped)',
    ],
    ['updated', formatTimestamp(access.updated_at)],
    ['last changed by', access.last_changed_by ?? '-'],
    ['note', access.last_change_note ?? '-'],
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
  const [balances, tickets, copies, walletTail, ticketTail, pulls, economyAccess] =
    await Promise.all([
      fetchWalletBalances(client, candidate.id),
      fetchTicketBalances(client, candidate.id),
      fetchCopySummary(client, candidate.id),
      fetchWalletLedger(client, candidate.id, request.limit),
      fetchTicketLedger(client, candidate.id, request.limit),
      fetchPullSessions(client, candidate.id),
      fetchEconomyAccess(client, candidate.id),
    ])

  io.say(heading('Identity'))
  io.say(identityBlock(candidate))

  // Directly after identity: whether the player can see the economy at all
  // decides how to read everything below it. A player with access off still
  // accrues earned faucets server-side, so a balance here is not proof of access.
  io.say(heading('Economy access'))
  io.say(economyAccessBlock(economyAccess))

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
    economyAccess,
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

/** Read-only view of one player's economy access flag and passport anchor. */
async function commandEconomyAccess(request, context) {
  const candidate = await resolveSingleUser(request, context)
  const access = await fetchEconomyAccess(context.client, candidate.id)

  context.io.say(heading(`Economy access — ${candidate.id}`))
  context.io.say(economyAccessBlock(access))

  return { user: { id: candidate.id }, economyAccess: access }
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
    return { plan, dryRun: true, executed: false, replayed: false, result: null }
  }

  // Replay pre-flight, BEFORE the prompt. Keys are derived from the operator's
  // intent, so re-running a command is normally a replay. The RPC would return
  // the original row and we would report a write that never happened — and
  // prompting for a no-op is noise. Racy only in the benign direction: if a
  // concurrent write lands between this check and the call, the RPC is still
  // idempotent, we just report it as fresh.
  const existing = await findExistingGrant(context.client, plan)
  if (existing) {
    io.say(
      `\nREPLAYED — this exact grant already exists (id ${existing.id}, created ` +
        `${formatTimestamp(existing.createdAt)}); nothing changed.`,
    )
    io.say('Change --note or pass --key to grant again.')
    return { plan, dryRun: false, executed: false, replayed: true, result: existing.row }
  }

  if (!request.yes) {
    const approved = await io.confirm(`Execute ${plan.schema}.${plan.rpc}?`)
    if (!approved) {
      throw new OperationError('Aborted by operator — nothing was executed.')
    }
  }

  // Only offered when a retry could actually behave differently. On a
  // deterministic rejection (22023/22003/23503/42501) the same call is
  // guaranteed to fail the same way, and telling the operator to retry would
  // contradict the code-specific guidance printed right next to it.
  //
  // Not every plan has an idempotency key: `set_user_economy_access` writes a
  // state row keyed on user_id and takes none, so the key-based wording has to
  // be conditional — interpolating an absent key would print `undefined` at the
  // operator during exactly the failure where they are least able to sanity-check
  // what they are reading.
  const retryHint =
    plan.payload.p_idempotency_key === undefined
      ? 'This call is a state write with no idempotency key; re-running the identical command ' +
        'is safe.'
      : `Retry with --key '${plan.payload.p_idempotency_key}' (or re-run the identical command): ` +
        'the key is stable, so a retry cannot double-grant.'

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
  if (error) throw rpcFailure(error, plan.rpc, isRetryable(error.code) ? retryHint : null)
  io.say(`\nDONE — ${plan.summary}`)
  io.say(formatKeyValues(Object.entries(data ?? {}).map(([key, value]) => [key, JSON.stringify(value)])))
  return { plan, dryRun: false, executed: true, replayed: false, result: data ?? null }
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
 * Flip the economy access flag.
 *
 * Prints the CURRENT state before the plan, for two reasons. A dry run is only
 * informative if it shows what is being changed *from* — and the one
 * irreversible part of this command is invisible in the plan itself: whether
 * `economy_access_granted_at` is already stamped decides whether this enable
 * starts the player's 12-week passport clock or merely re-opens a door.
 *
 * A no-op flip is reported and then still allowed through. The RPC is not a
 * no-op even when the boolean does not move: it refreshes `updated_at`,
 * `last_changed_by` and `last_change_note`, so a support agent re-affirming a
 * decision with a fresh ticket note is doing something useful. Refusing it
 * would silently discard that audit trail.
 */
async function commandSetEconomyAccess(request, context) {
  const candidate = await resolveSingleUser(request, context)
  const { io } = context
  const current = await fetchEconomyAccess(context.client, candidate.id)

  io.say(heading('Target'))
  io.say(identityBlock(candidate))
  io.say(heading('Economy access (current)'))
  io.say(economyAccessBlock(current))

  // No row means off, so this is the whole truth about the present state.
  const currentlyEnabled = current?.economy_access === true
  const noChange = currentlyEnabled === request.decision
  if (noChange) {
    io.say(
      `\nNO CHANGE — economy access is already ${request.decision ? 'on' : 'off'}` +
        (current?.economy_access_granted_at
          ? ` (granted at ${formatTimestamp(current.economy_access_granted_at)})`
          : '') +
        '. Executing refreshes updated_at / last_changed_by / last_change_note only.',
    )
  }

  const plan = buildEconomyAccessPlan({
    command: request.command,
    userId: candidate.id,
    enabled: request.decision,
    operator: request.operator,
    note: request.note,
  })
  if (request.decision && !current?.economy_access_granted_at) {
    io.warn(
      `WARNING: this is the FIRST enable for ${candidate.id}, so it permanently stamps ` +
        'economy_access_granted_at — the New Collector Passport 12-week anchor. It is set once ' +
        'and never moved: disabling access later does not clear it and re-enabling does not ' +
        'restart it. Confirm the user id before executing.',
    )
  }

  return {
    user: { id: candidate.id },
    economyAccessBefore: current,
    noChange,
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
  'economy-access': commandEconomyAccess,
  'set-economy-access': commandSetEconomyAccess,
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
