// Pure call-plan builders for every mutating support action.
//
// A "plan" is a fully validated description of ONE trusted RPC call: the
// function name, its arguments in declared order (with SQL casts), the
// PostgREST payload, and a human summary. Nothing here executes anything, so
// `--dry-run` prints exactly what a real run would send, and the Supabase
// Postgres harness (`supabase/tests/0031_admin_support_cli.test.mjs`) can
// execute the generated SQL against the real migration suite to prove the
// argument names, order, and value domains still match the deployed functions.
//
// Ground truth (verified against supabase/migrations/):
//   public.append_wallet_ledger_entry(
//     p_user_id uuid, p_currency_id text, p_balance_bucket text,
//     p_delta_amount bigint, p_reason_code text, p_idempotency_key text,
//     p_economy_edition_id text, p_provenance jsonb default '{}'::jsonb)
//     -> public.wallet_ledger_entries     0028_sku_fulfillment.sql:401-417
//     granted to service_role only        0028_sku_fulfillment.sql:612-617
//   public.record_roll_ticket_ledger_entry(
//     p_user_id uuid, p_roll_type text, p_delta_quantity bigint,
//     p_reason_code text, p_idempotency_key text,
//     p_provenance jsonb default '{}'::jsonb)
//     -> public.roll_ticket_ledger_entries 0014_roll_ticket_ledger.sql:110-121
//     granted to service_role only         0014_roll_ticket_ledger.sql:270-276
//   public.record_dice_copy_grant(
//     p_user_id uuid, p_catalog_item_id text, p_source_kind text,
//     p_source_reference text, p_idempotency_key text)
//     -> public.dice_copies                0020_dice_copy_inventory.sql:125-136
//     granted to service_role only         0020_dice_copy_inventory.sql:385-390
//   public.set_user_economy_access(
//     p_user_id uuid, p_enabled boolean, p_operator text, p_note text)
//     -> public.user_economy_access        0034_economy_access_flag.sql:95-101
//     granted to service_role only         0034_economy_access_flag.sql:164-167
//     Unlike the three above it takes NO idempotency key: the row is a STATE
//     keyed on user_id, not an append, so an identical re-run is inherently
//     safe (0034_economy_access_flag.sql:145-155). It raises 22023 for a null
//     decision or a blank/over-long operator or note (:111-123) and 23503 for
//     an unknown auth user (:124-126); 42501 comes from the grant at :164-167.

import { createHash } from 'node:crypto'

import { UsageError } from './args.mjs'

/** Identifies every row this tool writes, for later audit queries. */
export const PROVENANCE_SOURCE = 'admin-grant'
export const TOOL_ID = 'scripts/admin/dicesuki-admin.mjs'

/**
 * The only economy edition row that exists, seeded by
 * 0009_earned_economy_ledger.sql:425-429. `append_wallet_ledger_entry` raises
 * `23503 Unknown economy edition` for anything else
 * (0028_sku_fulfillment.sql:494-499).
 */
export const ECONOMY_EDITION_ID = 'earned-collection@1'

/**
 * Only three (currency, bucket) pairs exist, enforced in three places that must
 * agree: the RPC guard (0028_sku_fulfillment.sql:433-441), and the
 * `*_currency_bucket_pair` checks on both wallet tables
 * (0027_paid_stars_bucket.sql:13-25 and :35-46).
 *
 * `stars/paid` is deliberately NOT reachable from this CLI: paid Stars are
 * purchase-backed, and a paid negative is hard-gated to the exact Star-bundle
 * refund path (0028_sku_fulfillment.sql:443-478). Refunds go through
 * `refund_payment_order`, never a manual ledger append.
 */
export const WALLET_GRANT_KINDS = Object.freeze({
  stars: Object.freeze({ currencyId: 'stars', balanceBucket: 'promotional', label: 'Stars' }),
  dust: Object.freeze({ currencyId: 'dust', balanceBucket: 'earned', label: 'Dust' }),
})

/** 0014_roll_ticket_ledger.sql:19 and the RPC guard at :136-140. */
export const ROLL_TYPES = Object.freeze(['standard_roll', 'premium_roll'])

/**
 * `source_kind` domain on dice_copies (0020_dice_copy_inventory.sql:11-13).
 * Support grants are `reward` — they are not pulls, crafts, or purchases, and
 * mislabelling them would corrupt acquisition analytics.
 */
export const DIE_GRANT_SOURCE_KIND = 'reward'

/** reason_code check: 3..128 chars, `^[a-z][a-z0-9_.:-]+$` (0009:116-120, 0014:52-56). */
export const REASON_CODE_PATTERN = /^[a-z][a-z0-9_.:-]+$/
/** idempotency_key check on the ledgers: 8..200 chars (0009:121, 0014:57). */
export const LEDGER_KEY_LENGTH = Object.freeze({ min: 8, max: 200 })
/** dice_copies additionally constrains the key shape (0020:25-29). */
export const DICE_COPY_KEY_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]+$/
/** catalog_items id shape: `<catalog_key>@<contract_version>` (0004:30-32). */
export const CATALOG_ITEM_ID_PATTERN = /^[a-z0-9][a-z0-9/_-]*@[1-9]\d*$/

export const OPERATOR_MAX_LENGTH = 64
export const NOTE_MAX_LENGTH = 512
/** provenance must be a JSON object <= 8192 bytes (0028:489-493, 0009:123-125). */
export const PROVENANCE_MAX_BYTES = 8192
/** dice_copies.source_reference is 1..512 chars (0020:23-24). */
export const SOURCE_REFERENCE_MAX_LENGTH = 512

/**
 * Where each grant RPC's write actually lands, so a replay can be detected
 * BEFORE the call rather than inferred after it. Note the dice-copy key column
 * is named differently from the two ledgers.
 *
 *   wallet_ledger_entries       unique (account_id, idempotency_key)      0009:107
 *   roll_ticket_ledger_entries  unique (user_id, idempotency_key)         0014:48
 *   dice_copies                 unique (user_id, grant_idempotency_key)   0020:21-22
 *
 * `set_user_economy_access` is deliberately ABSENT: it has no idempotency key
 * and writes a state row rather than appending, so there is nothing to pre-flight
 * and `findExistingGrant` correctly returns null for it — the "REPLAYED" report
 * can never fire on an access flip.
 *
 * Lives here rather than in queries.mjs so the Supabase Postgres harness can
 * assert these column names against the real schema without importing the
 * Supabase client.
 */
export const GRANT_WRITE_TARGETS = Object.freeze({
  append_wallet_ledger_entry: Object.freeze({
    table: 'wallet_ledger_entries',
    keyColumn: 'idempotency_key',
    createdColumn: 'created_at',
    select: 'id, created_at, currency_id, balance_bucket, delta_amount, balance_after, reason_code',
  }),
  record_roll_ticket_ledger_entry: Object.freeze({
    table: 'roll_ticket_ledger_entries',
    keyColumn: 'idempotency_key',
    createdColumn: 'created_at',
    select: 'id, created_at, roll_type, delta_quantity, quantity_after, reason_code',
  }),
  record_dice_copy_grant: Object.freeze({
    table: 'dice_copies',
    keyColumn: 'grant_idempotency_key',
    createdColumn: 'acquired_at',
    select: 'id, acquired_at, catalog_item_id, source_kind, is_first_copy, scrapped_at',
  }),
})

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export function isUuid(value) {
  return typeof value === 'string' && UUID_PATTERN.test(value)
}

export function assertUserId(userId) {
  if (!isUuid(userId)) throw new UsageError(`Not a user uuid: "${userId}"`)
  return userId.toLowerCase()
}

export function assertOperator(operator) {
  const value = String(operator ?? '').trim()
  if (value.length === 0) throw new UsageError('--operator must not be empty')
  if (value.length > OPERATOR_MAX_LENGTH) {
    throw new UsageError(`--operator must be at most ${OPERATOR_MAX_LENGTH} characters`)
  }
  return value
}

export function assertNote(note) {
  const value = String(note ?? '').trim()
  if (value.length === 0) throw new UsageError('--note must not be empty')
  if (value.length > NOTE_MAX_LENGTH) {
    throw new UsageError(`--note must be at most ${NOTE_MAX_LENGTH} characters`)
  }
  return value
}

export function assertReasonCode(reasonCode) {
  const value = String(reasonCode ?? '')
  if (value.length < 3 || value.length > 128 || !REASON_CODE_PATTERN.test(value)) {
    throw new UsageError(
      `Reason code "${value}" must be 3-128 chars matching ${REASON_CODE_PATTERN.source}`,
    )
  }
  return value
}

export function assertIdempotencyKey(key, { requireShape = false } = {}) {
  const value = String(key ?? '')
  if (value.length < LEDGER_KEY_LENGTH.min || value.length > LEDGER_KEY_LENGTH.max) {
    throw new UsageError(
      `Idempotency key must be ${LEDGER_KEY_LENGTH.min}-${LEDGER_KEY_LENGTH.max} characters`,
    )
  }
  if (requireShape && !DICE_COPY_KEY_PATTERN.test(value)) {
    throw new UsageError(
      `Idempotency key "${value}" must match ${DICE_COPY_KEY_PATTERN.source} for dice grants`,
    )
  }
  return value
}

export function assertRollType(rollType) {
  if (!ROLL_TYPES.includes(rollType)) {
    throw new UsageError(`--roll-type must be one of: ${ROLL_TYPES.join(', ')}`)
  }
  return rollType
}

export function assertCatalogItemId(catalogItemId) {
  const value = String(catalogItemId ?? '')
  if (!CATALOG_ITEM_ID_PATTERN.test(value)) {
    throw new UsageError(
      `"${value}" is not a catalog item id — expected <catalog-key>@<version>, e.g. ` +
        'adventurer-starter/d20/common@1',
    )
  }
  return value
}

/**
 * `admin-grant:<YYYY-MM-DD>:<digest>` — DETERMINISTIC in the full intent of the
 * grant, so a re-run after an ambiguous failure (network drop, timeout, Ctrl-C
 * mid-call) replays rather than double-granting.
 *
 * The digest covers the UTC date, command, target user, subject (amount, or the
 * catalog item for a die), roll type, operator, and note. Anything the operator
 * could have meant differently produces a different key; anything identical
 * produces the same key and the RPC returns the original row
 * (0028_sku_fulfillment.sql:508-521, 0020_dice_copy_inventory.sql:182-197).
 *
 * Consequence, documented in the README: an INTENTIONAL second identical grant
 * on the same UTC day needs a distinct `--note` (preferred — it is the audit
 * trail anyway) or an explicit `--key`.
 *
 * The date is kept in the clear so a ledger row can be traced back to the day
 * of the support ticket without recomputing anything.
 */
export function deriveIdempotencyKey({
  command,
  userId,
  subject = null,
  rollType = null,
  operator,
  note,
  now = new Date(),
}) {
  const date = now.toISOString().slice(0, 10)
  const fingerprint = JSON.stringify([
    date,
    String(command),
    assertUserId(userId),
    subject === null ? null : String(subject),
    rollType === null ? null : String(rollType),
    assertOperator(operator),
    assertNote(note),
  ])
  const digest = createHash('sha256').update(fingerprint).digest('hex').slice(0, 12)
  return assertIdempotencyKey(`${PROVENANCE_SOURCE}:${date}:${digest}`, { requireShape: true })
}

/**
 * An operator-supplied `--reason-code` must stay inside the `support.` namespace.
 * Every code outside it belongs to an automated path whose invariants are
 * reconciled elsewhere, and the database's only check is a format regex — it
 * would happily accept `purchase.star_bundle` on a manual grant.
 */
export function assertSupportReasonCode(reasonCode) {
  const value = assertReasonCode(reasonCode)
  if (!value.startsWith('support.')) {
    throw new UsageError(
      `--reason-code "${value}" must start with "support." — codes outside that namespace ` +
        'belong to automated paths that reconcile against their own tables.',
    )
  }
  return value
}

/**
 * Default reason codes live in a dedicated `support.manual.*` namespace.
 *
 * Every existing reason code belongs to an automated path whose invariants are
 * cross-checked elsewhere (e.g. `purchase.refund` is gated on a matching
 * `payment_refund_intents` row at 0028_sku_fulfillment.sql:454-478, and
 * `dice.scrap.dust.credit` is re-derived at 0022_scrap_craft_economy.sql:335).
 * Reusing one from a manual grant would corrupt those reconciliations, so
 * support writes are namespaced and trivially filterable.
 */
export function defaultWalletReasonCode(kind, delta) {
  const currency = WALLET_GRANT_KINDS[kind].currencyId
  return `support.manual.${currency}.${delta > 0 ? 'credit' : 'debit'}`
}

export function defaultTicketReasonCode(rollType, delta) {
  return `support.manual.${rollType}.${delta > 0 ? 'credit' : 'debit'}`
}

/**
 * Provenance is DELIBERATELY free of wall-clock timestamps.
 *
 * Both ledger RPCs treat an idempotency replay as a drift error unless every
 * argument — including `provenance` — is byte-identical
 * (0028_sku_fulfillment.sql:508-521, 0014_roll_ticket_ledger.sql:173-183). A
 * timestamp inside provenance would make `--key <same-key>` retries fail with
 * `22023` instead of returning the original row. The date already lives in the
 * idempotency key, and `created_at` is written by the database.
 */
export function buildProvenance({ command, operator, note }) {
  const provenance = {
    source: PROVENANCE_SOURCE,
    tool: TOOL_ID,
    command,
    operator: assertOperator(operator),
    note: assertNote(note),
  }
  const bytes = new TextEncoder().encode(JSON.stringify(provenance)).length
  if (bytes > PROVENANCE_MAX_BYTES) {
    throw new UsageError(`Provenance is ${bytes} bytes; the ledger caps it at ${PROVENANCE_MAX_BYTES}`)
  }
  return provenance
}

/**
 * `dice_copies.source_reference` is free text (1..512). Encode who granted what
 * and why so a copy can be explained without joining anything.
 */
export function buildSourceReference({ operator, note }) {
  const reference = `${PROVENANCE_SOURCE}:${assertOperator(operator)}:${assertNote(note)}`
  return reference.slice(0, SOURCE_REFERENCE_MAX_LENGTH)
}

function quote(text) {
  return `'${String(text).replaceAll("'", "''")}'`
}

/** Render a JS value as a Postgres literal. Used for the dry-run SQL preview. */
export function sqlLiteral(value, cast = null) {
  let rendered
  if (value === null || value === undefined) {
    rendered = 'null'
  } else if (typeof value === 'number') {
    if (!Number.isSafeInteger(value)) {
      throw new UsageError(`Cannot render ${value} as a SQL integer literal`)
    }
    rendered = String(value)
  } else if (typeof value === 'boolean') {
    rendered = value ? 'true' : 'false'
  } else if (typeof value === 'object') {
    rendered = quote(JSON.stringify(value))
  } else {
    rendered = quote(value)
  }
  return cast ? `${rendered}::${cast}` : rendered
}

/** `public.fn(p_a => 'x'::uuid, ...)` — no `select`, no trailing semicolon. */
export function formatSqlCall(plan) {
  const args = plan.args
    .map(argument => `  ${argument.name} => ${sqlLiteral(argument.value, argument.cast)}`)
    .join(',\n')
  return `${plan.schema}.${plan.rpc}(\n${args}\n)`
}

/** The exact statement an operator could paste into psql. */
export function formatSqlPreview(plan) {
  return `select * from ${formatSqlCall(plan)};`
}

function finalizePlan(plan) {
  return Object.freeze({
    ...plan,
    schema: 'public',
    payload: Object.fromEntries(plan.args.map(argument => [argument.name, argument.value])),
  })
}

/**
 * Stars/Dust grant or correction.
 *
 * Negative amounts are allowed: the RPC enforces both the non-negative balance
 * floor and the stricter "available after active pull holds" floor, raising
 * `22003` (0028_sku_fulfillment.sql:536-566). We do not pre-check balances —
 * the database is the only correct arbiter under concurrency.
 */
export function buildWalletGrantPlan({
  kind,
  userId,
  amount,
  operator,
  note,
  idempotencyKey,
  reasonCode = null,
  command = `grant-${kind}`,
}) {
  const grantKind = WALLET_GRANT_KINDS[kind]
  if (!grantKind) {
    throw new UsageError(`Unknown wallet grant kind "${kind}"`)
  }
  if (!Number.isSafeInteger(amount) || amount === 0) {
    throw new UsageError('Wallet delta must be a nonzero whole number')
  }
  const provenance = buildProvenance({ command, operator, note })
  const args = [
    { name: 'p_user_id', value: assertUserId(userId), cast: 'uuid' },
    { name: 'p_currency_id', value: grantKind.currencyId, cast: 'text' },
    { name: 'p_balance_bucket', value: grantKind.balanceBucket, cast: 'text' },
    { name: 'p_delta_amount', value: amount, cast: 'bigint' },
    {
      name: 'p_reason_code',
      value:
        reasonCode === null || reasonCode === undefined
          ? defaultWalletReasonCode(kind, amount)
          : assertSupportReasonCode(reasonCode),
      cast: 'text',
    },
    { name: 'p_idempotency_key', value: assertIdempotencyKey(idempotencyKey), cast: 'text' },
    { name: 'p_economy_edition_id', value: ECONOMY_EDITION_ID, cast: 'text' },
    { name: 'p_provenance', value: provenance, cast: 'jsonb' },
  ]
  return finalizePlan({
    command,
    rpc: 'append_wallet_ledger_entry',
    args,
    effect: amount > 0 ? 'credit' : 'debit',
    summary:
      `${amount > 0 ? 'Credit' : 'Debit'} ${Math.abs(amount)} ${grantKind.label} ` +
      `(${grantKind.currencyId}/${grantKind.balanceBucket}) ` +
      `${amount > 0 ? 'to' : 'from'} ${args[0].value}`,
  })
}

/** Roll-ticket grant or correction (`record_roll_ticket_ledger_entry`). */
export function buildTicketGrantPlan({
  userId,
  amount,
  rollType,
  operator,
  note,
  idempotencyKey,
  reasonCode = null,
  command = 'grant-tickets',
}) {
  if (!Number.isSafeInteger(amount) || amount === 0) {
    throw new UsageError('Ticket delta must be a nonzero whole number')
  }
  const resolvedRollType = assertRollType(rollType)
  const provenance = buildProvenance({ command, operator, note })
  const args = [
    { name: 'p_user_id', value: assertUserId(userId), cast: 'uuid' },
    { name: 'p_roll_type', value: resolvedRollType, cast: 'text' },
    { name: 'p_delta_quantity', value: amount, cast: 'bigint' },
    {
      name: 'p_reason_code',
      value:
        reasonCode === null || reasonCode === undefined
          ? defaultTicketReasonCode(resolvedRollType, amount)
          : assertSupportReasonCode(reasonCode),
      cast: 'text',
    },
    { name: 'p_idempotency_key', value: assertIdempotencyKey(idempotencyKey), cast: 'text' },
    { name: 'p_provenance', value: provenance, cast: 'jsonb' },
  ]
  return finalizePlan({
    command,
    rpc: 'record_roll_ticket_ledger_entry',
    args,
    effect: amount > 0 ? 'credit' : 'debit',
    summary:
      `${amount > 0 ? 'Credit' : 'Debit'} ${Math.abs(amount)} ${resolvedRollType} ticket(s) ` +
      `${amount > 0 ? 'to' : 'from'} ${args[0].value}`,
  })
}

/**
 * Die grant. `record_dice_copy_grant` is the ONLY service_role-callable path
 * that mints a `dice_copies` row, and `dice_copies` is the authoritative
 * inventory surface the client reads (src/lib/diceCopies.ts:66-69). See
 * scripts/admin/README.md for why `user_entitlements` is not written.
 */
export function buildDieGrantPlan({
  userId,
  catalogItemId,
  operator,
  note,
  idempotencyKey,
  command = 'grant-die',
}) {
  const args = [
    { name: 'p_user_id', value: assertUserId(userId), cast: 'uuid' },
    { name: 'p_catalog_item_id', value: assertCatalogItemId(catalogItemId), cast: 'text' },
    { name: 'p_source_kind', value: DIE_GRANT_SOURCE_KIND, cast: 'text' },
    {
      name: 'p_source_reference',
      value: buildSourceReference({ operator, note }),
      cast: 'text',
    },
    {
      name: 'p_idempotency_key',
      value: assertIdempotencyKey(idempotencyKey, { requireShape: true }),
      cast: 'text',
    },
  ]
  return finalizePlan({
    command,
    rpc: 'record_dice_copy_grant',
    args,
    effect: 'grant',
    summary: `Grant 1 copy of ${args[1].value} (source_kind=reward) to ${args[0].value}`,
  })
}

/**
 * Economy access flip (`set_user_economy_access`).
 *
 * This is the one plan with no idempotency key, and the shape of the risk is
 * inverted from the grants. The boolean is a STATE keyed on `user_id`, so
 * flipping it is reversible and re-running the identical command is inherently
 * safe (it only refreshes `updated_at`, `last_changed_by`, `last_change_note`).
 *
 * What is NOT reversible is the side effect of the FIRST enable: it stamps
 * `economy_access_granted_at` once and never moves it again — the upsert's
 * `coalesce(access.economy_access_granted_at, statement_timestamp())` keeps the
 * original on every later enable and a disable does not touch it at all
 * (0034_economy_access_flag.sql:145-155). That timestamp is the New Collector
 * Passport's 12-week anchor: `private.passport_enrollment_anchor_period` reads
 * it to decide which week the player's window starts (:178-205). Enabling the
 * wrong user id therefore starts a stranger's passport clock permanently —
 * there is no correcting write, only the flag itself can be turned back off.
 * Hence `defaultDryRun: true` in COMMAND_SPECS and the current-state print in
 * commandSetEconomyAccess.
 */
export function buildEconomyAccessPlan({
  userId,
  enabled,
  operator,
  note,
  command = 'set-economy-access',
}) {
  if (typeof enabled !== 'boolean') {
    throw new UsageError('Economy access decision must be exactly "on" or "off"')
  }
  const args = [
    { name: 'p_user_id', value: assertUserId(userId), cast: 'uuid' },
    { name: 'p_enabled', value: enabled, cast: 'boolean' },
    { name: 'p_operator', value: assertOperator(operator), cast: 'text' },
    { name: 'p_note', value: assertNote(note), cast: 'text' },
  ]
  return finalizePlan({
    command,
    rpc: 'set_user_economy_access',
    args,
    effect: enabled ? 'enable' : 'disable',
    summary: enabled
      ? `Enable economy access for ${args[0].value} — the first enable permanently stamps ` +
        'economy_access_granted_at (the passport anchor)'
      : `Disable economy access for ${args[0].value} — the passport anchor, once stamped, ` +
        'is left untouched',
  })
}

/**
 * Manual pull-session cancellation SQL.
 *
 * `public.cancel_pull_session(uuid)` is granted to `authenticated` only and
 * derives the caller from `auth.uid()` (0017_pull_commit_reveal.sql:1063-1090),
 * and `service_role` holds SELECT-only on `pull_session_transitions`
 * (0017_pull_commit_reveal.sql:53-58). There is therefore NO service-role path
 * to cancel another player's hold. This renders the exact statement an operator
 * must run over a Postgres owner connection (Supabase dashboard SQL editor).
 */
export function buildCancelSessionSql(session, { operator, note = null }) {
  const provenance = {
    source: PROVENANCE_SOURCE,
    tool: TOOL_ID,
    command: 'cancel-session',
    operator: assertOperator(operator),
    ...(note === null ? {} : { note: assertNote(note) }),
  }
  return [
    'insert into public.pull_session_transitions (',
    '  session_id, account_id, user_id, banner_version_id, kind, provenance',
    ') values (',
    `  ${sqlLiteral(session.id, 'uuid')},`,
    `  ${sqlLiteral(session.account_id, 'uuid')},`,
    `  ${sqlLiteral(session.user_id, 'uuid')},`,
    `  ${sqlLiteral(session.banner_version_id, 'text')},`,
    "  'cancelled',",
    `  ${sqlLiteral(provenance, 'jsonb')}`,
    ');',
  ].join('\n')
}
