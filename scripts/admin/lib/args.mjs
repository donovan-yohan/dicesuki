// Pure argument parsing for the operator/support CLI.
//
// Nothing in this module touches the network, the filesystem, or `process`, so
// every branch is unit-testable from Vitest (`scripts/admin/admin-cli.test.ts`).
// The entrypoint (`scripts/admin/dicesuki-admin.mjs`) owns all IO.

/** Thrown for anything the operator typed wrong. Exits the CLI with code 2. */
export class UsageError extends Error {
  constructor(message) {
    super(message)
    this.name = 'UsageError'
  }
}

/** Read-tail default, and the ceiling we will not page past in one command. */
export const DEFAULT_LIMIT = 10
export const MAX_LIMIT = 200

/**
 * Command table. `defaultDryRun` encodes the safety posture required by the
 * support runbook: the two commands that can create inventory or terminate a
 * live pull hold refuse to fire until the operator opts in with `--no-dry-run`.
 */
export const COMMAND_SPECS = Object.freeze({
  user: {
    summary: 'Inspect a player: profile, balances, tickets, copies, ledger tail, live pull hold.',
    usage: 'user <email|display-name|uuid> [--limit N] [--json]',
    positionals: ['query'],
    values: ['limit'],
    mutating: false,
  },
  ledger: {
    summary: 'Print the wallet and roll-ticket ledger tails for a player.',
    usage: 'ledger <email|display-name|uuid> [--limit N] [--json]',
    positionals: ['query'],
    values: ['limit'],
    mutating: false,
  },
  orders: {
    summary: 'Print payment orders and their Xsolla events for a player.',
    usage: 'orders <email|display-name|uuid> [--limit N] [--json]',
    positionals: ['query'],
    values: ['limit'],
    mutating: false,
  },
  'grant-stars': {
    summary: 'Credit (or correct) promotional Stars via append_wallet_ledger_entry.',
    usage:
      'grant-stars <user> <amount> --operator <name> --note <why> ' +
      '[--key K] [--reason-code C] [--dry-run|--no-dry-run] [--yes] [--json]',
    positionals: ['query', 'amount'],
    values: ['operator', 'note', 'key', 'reason-code'],
    required: ['operator', 'note'],
    mutating: true,
    defaultDryRun: false,
  },
  'grant-dust': {
    summary: 'Credit (or correct) earned Dust via append_wallet_ledger_entry.',
    usage:
      'grant-dust <user> <amount> --operator <name> --note <why> ' +
      '[--key K] [--reason-code C] [--dry-run|--no-dry-run] [--yes] [--json]',
    positionals: ['query', 'amount'],
    values: ['operator', 'note', 'key', 'reason-code'],
    required: ['operator', 'note'],
    mutating: true,
    defaultDryRun: false,
  },
  'grant-tickets': {
    summary: 'Credit (or correct) roll tickets via record_roll_ticket_ledger_entry.',
    usage:
      'grant-tickets <user> <amount> --operator <name> --note <why> ' +
      '[--roll-type standard_roll|premium_roll] [--key K] [--reason-code C] ' +
      '[--dry-run|--no-dry-run] [--yes] [--json]',
    positionals: ['query', 'amount'],
    values: ['operator', 'note', 'key', 'reason-code', 'roll-type'],
    required: ['operator', 'note'],
    mutating: true,
    defaultDryRun: false,
  },
  'grant-die': {
    summary: 'Mint a live dice_copies row via record_dice_copy_grant (source_kind=reward).',
    usage:
      'grant-die <user> <catalog_item_id> --operator <name> --note <why> ' +
      '[--key K] [--allow-missing-asset] [--no-dry-run] [--yes] [--json]',
    positionals: ['query', 'catalogItemId'],
    values: ['operator', 'note', 'key'],
    booleans: ['allow-missing-asset'],
    required: ['operator', 'note'],
    mutating: true,
    // Inventory is append-only: a dice_copies row can never be deleted, only
    // scrapped by the player (0020_dice_copy_inventory.sql:76-118). Dry-run by
    // default so a typo'd catalog id cannot become permanent.
    defaultDryRun: true,
  },
  'cancel-session': {
    summary: 'Inspect a live pull hold and print the operator cancellation path.',
    usage: 'cancel-session <user> [--confirm] [--operator <name>] [--note <why>] [--json]',
    positionals: ['query'],
    // Optional here: inspecting costs nothing, but if --confirm renders the
    // manual SQL the operator/note are stamped into its provenance.
    values: ['operator', 'note'],
    booleans: ['confirm'],
    mutating: true,
    // A cancellation writes an append-only terminal transition that can never be
    // corrected (0017_pull_commit_reveal.sql:36-42). Dry-run by default.
    defaultDryRun: true,
  },
})

const GLOBAL_BOOLEANS = ['json', 'yes', 'help']
const DRY_RUN_BOOLEANS = ['dry-run', 'no-dry-run']

/** Amount tokens may be negative (`-500`); other `-x` tokens are option typos. */
function looksLikeNegativeNumber(token) {
  return /^-\d/.test(token)
}

/**
 * Parse a whole-number ledger delta. Zero is rejected here rather than at the
 * database, because both ledger RPCs raise `22023` on a zero delta
 * (0028_sku_fulfillment.sql:430-432, 0014_roll_ticket_ledger.sql).
 */
export function parseAmount(raw) {
  if (!/^-?\d+$/.test(raw)) {
    throw new UsageError(`Amount must be a whole number, got "${raw}"`)
  }
  const value = Number(raw)
  if (!Number.isSafeInteger(value)) {
    throw new UsageError(`Amount ${raw} is outside the safe integer range`)
  }
  if (value === 0) {
    throw new UsageError('Amount must be nonzero — the ledger rejects zero deltas')
  }
  return value
}

function parseLimit(raw) {
  if (raw === undefined) return DEFAULT_LIMIT
  if (!/^\d+$/.test(raw)) {
    throw new UsageError(`--limit must be a positive whole number, got "${raw}"`)
  }
  const value = Number(raw)
  if (value < 1 || value > MAX_LIMIT) {
    throw new UsageError(`--limit must be between 1 and ${MAX_LIMIT}`)
  }
  return value
}

/**
 * Parse `process.argv.slice(2)` into a fully resolved command request.
 *
 * @returns {{ command: string } & Record<string, unknown>}
 */
export function parseArgs(argv) {
  const tokens = [...argv]
  if (tokens.length === 0) return { command: 'help', helpTopic: null }

  const first = tokens[0]
  if (first === 'help' || first === '--help' || first === '-h') {
    tokens.shift()
    return { command: 'help', helpTopic: tokens[0] ?? null }
  }

  const command = tokens.shift()
  const spec = COMMAND_SPECS[command]
  if (!spec) {
    throw new UsageError(
      `Unknown command "${command}". Known commands: ${Object.keys(COMMAND_SPECS).join(', ')}`,
    )
  }

  const booleanNames = new Set([
    ...GLOBAL_BOOLEANS,
    ...(spec.booleans ?? []),
    ...(spec.mutating ? DRY_RUN_BOOLEANS : []),
  ])
  const valueNames = new Set(spec.values ?? [])
  const flags = new Map()
  const positionals = []

  while (tokens.length > 0) {
    const token = tokens.shift()
    if (token === '--') {
      positionals.push(...tokens)
      break
    }
    if (token.startsWith('--')) {
      const equals = token.indexOf('=')
      const name = equals === -1 ? token.slice(2) : token.slice(2, equals)
      const inline = equals === -1 ? null : token.slice(equals + 1)
      if (booleanNames.has(name)) {
        if (inline !== null) throw new UsageError(`--${name} does not take a value`)
        flags.set(name, true)
        continue
      }
      if (valueNames.has(name)) {
        if (flags.has(name)) throw new UsageError(`--${name} was given more than once`)
        const value = inline ?? tokens.shift()
        if (value === undefined) throw new UsageError(`--${name} requires a value`)
        flags.set(name, value)
        continue
      }
      throw new UsageError(`Unknown option --${name} for "${command}"`)
    }
    if (token.startsWith('-') && token.length > 1 && !looksLikeNegativeNumber(token)) {
      throw new UsageError(`Unknown option "${token}" — long options only (--name value)`)
    }
    positionals.push(token)
  }

  if (flags.get('help')) return { command: 'help', helpTopic: command }

  if (positionals.length !== spec.positionals.length) {
    throw new UsageError(
      `"${command}" expects ${spec.positionals.length} argument(s): ${spec.usage}`,
    )
  }
  for (const name of spec.required ?? []) {
    if (!flags.has(name)) {
      throw new UsageError(`"${command}" requires --${name} (audit trail is mandatory)`)
    }
  }
  if (flags.has('dry-run') && flags.has('no-dry-run')) {
    throw new UsageError('--dry-run and --no-dry-run are mutually exclusive')
  }

  const request = {
    command,
    json: flags.get('json') === true,
    yes: flags.get('yes') === true,
    confirm: flags.get('confirm') === true,
    allowMissingAsset: flags.get('allow-missing-asset') === true,
    mutating: Boolean(spec.mutating),
    dryRun: flags.has('dry-run')
      ? true
      : flags.has('no-dry-run')
        ? false
        : Boolean(spec.defaultDryRun),
    limit: parseLimit(flags.get('limit')),
  }

  spec.positionals.forEach((name, index) => {
    const raw = positionals[index]
    request[name] = name === 'query' ? raw.trim() : raw
  })

  if (spec.positionals.includes('amount')) {
    request.amount = parseAmount(positionals[spec.positionals.indexOf('amount')])
  }
  if (valueNames.has('operator')) request.operator = flags.get('operator')
  if (valueNames.has('note')) request.note = flags.get('note')
  if (valueNames.has('key')) request.idempotencyKey = flags.get('key') ?? null
  if (valueNames.has('reason-code')) request.reasonCode = flags.get('reason-code') ?? null
  if (valueNames.has('roll-type')) request.rollType = flags.get('roll-type') ?? 'standard_roll'

  if (request.query === '') {
    throw new UsageError(`"${command}" requires a non-empty user query`)
  }
  if (request.json && request.mutating && !request.dryRun && !request.yes) {
    throw new UsageError(
      '--json cannot prompt for confirmation; pass --yes to execute non-interactively',
    )
  }

  return request
}

/** Full help text (also printed on a bare invocation). */
export function usageText(topic = null) {
  if (topic && COMMAND_SPECS[topic]) {
    const spec = COMMAND_SPECS[topic]
    return [
      spec.summary,
      '',
      `  dicesuki-admin ${spec.usage}`,
      '',
      'Global options: --json  --yes  --help',
    ].join('\n')
  }
  const rows = Object.entries(COMMAND_SPECS).map(([name, spec]) => {
    return `  ${name.padEnd(16)}${spec.summary}`
  })
  return [
    'dicesuki-admin — operator/support CLI for the Dicesuki Supabase project.',
    '',
    'Usage: node scripts/admin/dicesuki-admin.mjs <command> [options]',
    '',
    'Commands:',
    ...rows,
    '',
    'Global options:',
    '  --json               machine-readable output on stdout',
    '  --yes                skip the interactive confirmation (required with --json)',
    '  --dry-run            print the exact call without executing (mutating commands)',
    '  --no-dry-run         execute (grant-die and cancel-session are dry-run by default)',
    '  --help               show help, optionally for one command',
    '',
    'Environment (never committed, never logged):',
    '  SUPABASE_URL                 project URL (VITE_SUPABASE_URL is accepted)',
    '  SUPABASE_SERVICE_ROLE_KEY    service-role key (SUPABASE_SECRET_KEY is accepted)',
    '',
    'See scripts/admin/README.md for the support runbook.',
  ].join('\n')
}
