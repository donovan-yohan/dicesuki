// Pure call-plan builders for every mutating support action.
//
// A "plan" is a fully validated description of ONE trusted RPC call: the
// function name, its arguments in declared order (with SQL casts), the
// PostgREST payload, and a human summary. Nothing here executes anything, so
// `--dry-run` prints exactly what a real run would send, and the Supabase
// Postgres harness (`supabase/tests/0030_admin_support_cli.test.mjs`) can
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

import { randomUUID } from 'node:crypto'

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

/** Random 8-hex slug for auto-derived idempotency keys. */
export function randomSlug() {
  return randomUUID().replaceAll('-', '').slice(0, 8)
}

/**
 * `admin-grant:<YYYY-MM-DD>:<slug>` — carries the operation date so a support
 * ticket can be traced back from a ledger row, and a random slug so two grants
 * on the same day never collide. Satisfies both the ledger length check and the
 * stricter dice_copies key regex.
 */
export function deriveIdempotencyKey({ now = new Date(), slug = randomSlug() } = {}) {
  const date = now.toISOString().slice(0, 10)
  return assertIdempotencyKey(`${PROVENANCE_SOURCE}:${date}:${slug}`, { requireShape: true })
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
      value: assertReasonCode(reasonCode ?? defaultWalletReasonCode(kind, amount)),
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
      value: assertReasonCode(reasonCode ?? defaultTicketReasonCode(resolvedRollType, amount)),
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
