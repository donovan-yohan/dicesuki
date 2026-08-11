import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// Partial mock: the network-touching readers are stubbed so the command layer
// can be exercised without a server; every pure export stays real.
vi.mock('./lib/queries.mjs', async importOriginal => {
  const actual = await importOriginal()
  return {
    ...actual,
    resolveUserCandidates: vi.fn(),
    fetchCatalogItem: vi.fn(),
    fetchPullSessions: vi.fn(),
    findExistingGrant: vi.fn(),
    fetchEconomyAccess: vi.fn(),
    fetchWalletBalances: vi.fn(),
    fetchTicketBalances: vi.fn(),
    fetchCopySummary: vi.fn(),
    fetchWalletLedger: vi.fn(),
    fetchTicketLedger: vi.fn(),
  }
})

import {
  COMMAND_SPECS,
  DEFAULT_LIMIT,
  MAX_LIMIT,
  UsageError,
  parseAccessDecision,
  parseArgs,
  usageText,
} from './lib/args.mjs'
import { createIo } from './dicesuki-admin.mjs'
import { isRetryable, runCommand, sqlstateHint } from './lib/commands.mjs'
import {
  fetchCatalogItem,
  fetchCopySummary,
  fetchEconomyAccess,
  fetchPullSessions,
  fetchTicketBalances,
  fetchTicketLedger,
  fetchWalletBalances,
  fetchWalletLedger,
  findExistingGrant,
  resolveUserCandidates,
} from './lib/queries.mjs'
import {
  DICE_COPY_KEY_PATTERN,
  ECONOMY_EDITION_ID,
  GRANT_WRITE_TARGETS,
  REASON_CODE_PATTERN,
  assertSupportReasonCode,
  buildCancelSessionSql,
  buildDieGrantPlan,
  buildEconomyAccessPlan,
  buildProvenance,
  buildSourceReference,
  buildTicketGrantPlan,
  buildWalletGrantPlan,
  defaultTicketReasonCode,
  defaultWalletReasonCode,
  deriveIdempotencyKey,
  formatSqlCall,
  formatSqlPreview,
  sqlLiteral,
} from './lib/plans.mjs'
import { resolveEnvironment, likePattern, redactSecret } from './lib/supabase.mjs'
import { selectActiveSession } from './lib/queries.mjs'
import { formatTable, secondsUntil } from './lib/report.mjs'

const USER = '11111111-2222-4333-8444-555555555555'
const KEY = 'admin-grant:2026-07-27:0a1b2c3d'
const GRANT = { operator: 'po', note: 'ticket 1234 goodwill' }

describe('parseArgs', () => {
  it('prints help for a bare invocation', () => {
    expect(parseArgs([])).toEqual({ command: 'help', helpTopic: null })
    expect(parseArgs(['--help'])).toEqual({ command: 'help', helpTopic: null })
    expect(parseArgs(['help', 'grant-die'])).toEqual({ command: 'help', helpTopic: 'grant-die' })
  })

  it('parses a read command with defaults', () => {
    const request = parseArgs(['user', ' player@example.com '])
    expect(request).toMatchObject({
      command: 'user',
      query: 'player@example.com',
      limit: DEFAULT_LIMIT,
      json: false,
      mutating: false,
    })
  })

  it('validates --limit bounds', () => {
    expect(parseArgs(['ledger', 'x', '--limit', '50']).limit).toBe(50)
    expect(parseArgs(['ledger', 'x', '--limit=25']).limit).toBe(25)
    expect(() => parseArgs(['ledger', 'x', '--limit', '0'])).toThrow(UsageError)
    expect(() => parseArgs(['ledger', 'x', '--limit', String(MAX_LIMIT + 1)])).toThrow(UsageError)
    expect(() => parseArgs(['ledger', 'x', '--limit', 'ten'])).toThrow(UsageError)
  })

  it('rejects unknown commands and options', () => {
    expect(() => parseArgs(['nuke-account', 'x'])).toThrow(/Unknown command/)
    expect(() => parseArgs(['user', 'x', '--force'])).toThrow(/Unknown option --force/)
    expect(() => parseArgs(['user', 'x', '-f'])).toThrow(/Unknown option/)
    // --dry-run is only offered on mutating commands.
    expect(() => parseArgs(['user', 'x', '--dry-run'])).toThrow(/Unknown option --dry-run/)
  })

  it('requires an operator and a note on every grant', () => {
    expect(() => parseArgs(['grant-stars', USER, '100'])).toThrow(/requires --operator/)
    expect(() => parseArgs(['grant-stars', USER, '100', '--operator', 'po'])).toThrow(
      /requires --note/,
    )
  })

  it('parses wallet grants including negative corrections', () => {
    const request = parseArgs([
      'grant-stars',
      USER,
      '20000',
      '--operator',
      'po',
      '--note',
      'launch goodwill',
    ])
    expect(request).toMatchObject({
      command: 'grant-stars',
      query: USER,
      amount: 20000,
      operator: 'po',
      note: 'launch goodwill',
      dryRun: false,
      idempotencyKey: null,
      reasonCode: null,
    })
    expect(
      parseArgs(['grant-dust', USER, '-500', '--operator', 'po', '--note', 'correction']).amount,
    ).toBe(-500)
  })

  it('rejects zero and non-integer amounts', () => {
    expect(() => parseArgs(['grant-stars', USER, '0', '--operator', 'p', '--note', 'n'])).toThrow(
      /nonzero/,
    )
    expect(() => parseArgs(['grant-stars', USER, '1.5', '--operator', 'p', '--note', 'n'])).toThrow(
      /whole number/,
    )
  })

  it('defaults grant-tickets to standard_roll', () => {
    expect(
      parseArgs(['grant-tickets', USER, '3', '--operator', 'p', '--note', 'n']).rollType,
    ).toBe('standard_roll')
    expect(
      parseArgs([
        'grant-tickets',
        USER,
        '3',
        '--operator',
        'p',
        '--note',
        'n',
        '--roll-type',
        'premium_roll',
      ]).rollType,
    ).toBe('premium_roll')
  })

  it('defaults grant-die and cancel-session to dry-run', () => {
    const die = parseArgs(['grant-die', USER, 'starter/d20/common@1', '--operator', 'p', '--note', 'n'])
    expect(die.dryRun).toBe(true)
    expect(
      parseArgs([
        'grant-die',
        USER,
        'starter/d20/common@1',
        '--operator',
        'p',
        '--note',
        'n',
        '--no-dry-run',
      ]).dryRun,
    ).toBe(false)

    expect(parseArgs(['cancel-session', USER]).dryRun).toBe(true)
    expect(parseArgs(['cancel-session', USER]).confirm).toBe(false)
    expect(parseArgs(['cancel-session', USER, '--confirm']).confirm).toBe(true)
  })

  it('rejects contradictory and unconfirmable flag combinations', () => {
    expect(() =>
      parseArgs(['grant-stars', USER, '5', '--operator', 'p', '--note', 'n', '--dry-run', '--no-dry-run']),
    ).toThrow(/mutually exclusive/)
    expect(() =>
      parseArgs(['grant-stars', USER, '5', '--operator', 'p', '--note', 'n', '--json']),
    ).toThrow(/pass --yes/)
    expect(
      parseArgs(['grant-stars', USER, '5', '--operator', 'p', '--note', 'n', '--json', '--yes'])
        .yes,
    ).toBe(true)
    // A dry run needs no confirmation, so --json alone is fine there.
    expect(
      parseArgs(['grant-die', USER, 'a/d6/common@1', '--operator', 'p', '--note', 'n', '--json'])
        .json,
    ).toBe(true)
  })

  it('rejects repeated value flags and missing values', () => {
    expect(() =>
      parseArgs(['grant-stars', USER, '5', '--operator', 'a', '--operator', 'b', '--note', 'n']),
    ).toThrow(/more than once/)
    expect(() => parseArgs(['grant-stars', USER, '5', '--operator'])).toThrow(/requires a value/)
  })

  it('documents every command in the usage text', () => {
    const text = usageText()
    for (const command of [
      'user',
      'ledger',
      'orders',
      'economy-access',
      'set-economy-access',
      'grant-stars',
      'grant-dust',
      'grant-tickets',
      'grant-die',
      'cancel-session',
    ]) {
      expect(text).toContain(command)
    }
  })

  it('keeps the summary column aligned for the 18-character set-economy-access', () => {
    const lines = usageText().split('\n')
    const columns = Object.entries(COMMAND_SPECS).map(([name, spec]) => {
      const row = lines.find(line => line.startsWith(`  ${name}`) && line.includes(spec.summary))
      expect(row, `no usage row for ${name}`).toBeDefined()
      return (row ?? '').indexOf(spec.summary)
    })
    expect(new Set(columns).size).toBe(1)
    // Two-space indent + the longest name + a two-space gutter.
    expect(columns[0]).toBeGreaterThanOrEqual(2 + 'set-economy-access'.length + 2)
  })
})

describe('parseArgs — economy access', () => {
  const setArgs = (decision: string, ...extra: string[]) =>
    parseArgs(['set-economy-access', USER, decision, '--operator', 'po', '--note', 'n', ...extra])

  it('parses the lookup as a non-mutating one-positional read', () => {
    expect(parseArgs(['economy-access', ' player@example.com '])).toMatchObject({
      command: 'economy-access',
      query: 'player@example.com',
      mutating: false,
      json: false,
    })
    expect(parseArgs(['economy-access', USER, '--json']).json).toBe(true)
    expect(() => parseArgs(['economy-access'])).toThrow(/expects 1 argument/)
    expect(() => parseArgs(['economy-access', USER, 'on'])).toThrow(/expects 1 argument/)
    // Nothing to dry-run: the flag is only offered on mutating commands.
    expect(() => parseArgs(['economy-access', USER, '--dry-run'])).toThrow(
      /Unknown option --dry-run/,
    )
  })

  it('takes exactly two positionals for the flip', () => {
    expect(() => parseArgs(['set-economy-access', USER, '--operator', 'po', '--note', 'n'])).toThrow(
      /expects 2 argument/,
    )
    expect(() =>
      parseArgs(['set-economy-access', USER, 'on', 'off', '--operator', 'po', '--note', 'n']),
    ).toThrow(/expects 2 argument/)
  })

  it('accepts only the literals on and off, naming both when it refuses', () => {
    expect(setArgs('on').decision).toBe(true)
    expect(setArgs('off').decision).toBe(false)
    expect(parseAccessDecision('on')).toBe(true)
    expect(parseAccessDecision('off')).toBe(false)
    // Every one of these is a plausible mistyping of "enable"; none of them is
    // allowed to flip a flag whose first enable is permanent.
    for (const bad of ['ON', 'Off', 'true', 'yes', '1', 'enable', 'disabled', '']) {
      expect(() => setArgs(bad)).toThrow(/"on"/)
      expect(() => setArgs(bad)).toThrow(/"off"/)
      expect(() => parseAccessDecision(bad)).toThrow(UsageError)
    }
  })

  it('requires the audit trail, exactly like the grant commands', () => {
    expect(() => parseArgs(['set-economy-access', USER, 'on'])).toThrow(/requires --operator/)
    expect(() => parseArgs(['set-economy-access', USER, 'on', '--operator', 'po'])).toThrow(
      /requires --note/,
    )
  })

  it('defaults to dry-run, because the first enable is permanent', () => {
    expect(setArgs('on').dryRun).toBe(true)
    expect(setArgs('on', '--no-dry-run').dryRun).toBe(false)
    expect(setArgs('on', '--dry-run').dryRun).toBe(true)
    expect(setArgs('on').mutating).toBe(true)
  })

  it('rejects contradictory and unconfirmable flag combinations', () => {
    expect(() => setArgs('on', '--dry-run', '--no-dry-run')).toThrow(/mutually exclusive/)
    expect(() => setArgs('on', '--no-dry-run', '--json')).toThrow(/pass --yes/)
    expect(setArgs('on', '--no-dry-run', '--json', '--yes').yes).toBe(true)
    // A dry run needs no confirmation, so --json alone is fine there.
    expect(setArgs('on', '--json').json).toBe(true)
  })
})

describe('idempotency keys', () => {
  const INTENT = {
    command: 'grant-stars',
    userId: USER,
    subject: 20000,
    operator: 'po',
    note: 'ticket 1284',
    now: new Date('2026-07-27T09:15:00Z'),
  }

  it('derives admin-grant:<date>:<digest> with the date in the clear', () => {
    expect(deriveIdempotencyKey(INTENT)).toMatch(/^admin-grant:2026-07-27:[0-9a-f]{12}$/)
  })

  it('is deterministic, so re-running after an ambiguous failure replays', () => {
    expect(deriveIdempotencyKey(INTENT)).toBe(deriveIdempotencyKey(INTENT))
    // A fresh Date object for the same day must not change the key.
    expect(deriveIdempotencyKey({ ...INTENT, now: new Date('2026-07-27T23:59:59Z') })).toBe(
      deriveIdempotencyKey(INTENT),
    )
  })

  it('changes when any part of the operator intent changes', () => {
    const base = deriveIdempotencyKey(INTENT)
    const variants = [
      { ...INTENT, command: 'grant-dust' },
      { ...INTENT, userId: '99999999-2222-4333-8444-555555555555' },
      { ...INTENT, subject: 20001 },
      { ...INTENT, rollType: 'premium_roll' },
      { ...INTENT, operator: 'someone-else' },
      { ...INTENT, note: 'ticket 1285' },
      { ...INTENT, now: new Date('2026-07-28T09:15:00Z') },
    ]
    for (const variant of variants) {
      expect(deriveIdempotencyKey(variant)).not.toBe(base)
    }
    // ...which is exactly how an INTENTIONAL same-day repeat grant is expressed.
    expect(deriveIdempotencyKey({ ...INTENT, note: 'ticket 1284 (second goodwill grant)' })).not.toBe(
      base,
    )
  })

  it('satisfies both the ledger length rule and the dice_copies key regex', () => {
    const key = deriveIdempotencyKey(INTENT)
    expect(key.length).toBeGreaterThanOrEqual(8)
    expect(key.length).toBeLessThanOrEqual(200)
    expect(DICE_COPY_KEY_PATTERN.test(key)).toBe(true)
  })

  it('rejects an operator-supplied key that the database would refuse', () => {
    expect(() =>
      buildWalletGrantPlan({ kind: 'stars', userId: USER, amount: 1, ...GRANT, idempotencyKey: 'short' }),
    ).toThrow(/8-200 characters/)
    expect(() =>
      buildDieGrantPlan({
        userId: USER,
        catalogItemId: 'a/d6/common@1',
        ...GRANT,
        idempotencyKey: '!!badstart!!',
      }),
    ).toThrow(/must match/)
  })
})

describe('provenance', () => {
  it('records the admin-grant source, operator and note', () => {
    expect(buildProvenance({ command: 'grant-stars', ...GRANT })).toEqual({
      source: 'admin-grant',
      tool: 'scripts/admin/dicesuki-admin.mjs',
      command: 'grant-stars',
      operator: 'po',
      note: 'ticket 1234 goodwill',
    })
  })

  it('carries no wall-clock value, so a --key replay stays byte-identical', () => {
    const first = buildProvenance({ command: 'grant-stars', ...GRANT })
    const second = buildProvenance({ command: 'grant-stars', ...GRANT })
    expect(JSON.stringify(first)).toBe(JSON.stringify(second))
    expect(JSON.stringify(first)).not.toMatch(/20\d\d-\d\d-\d\dT/)
  })

  it('trims and bounds the audit fields', () => {
    expect(buildProvenance({ command: 'c', operator: '  po  ', note: ' n ' }).operator).toBe('po')
    expect(() => buildProvenance({ command: 'c', operator: '', note: 'n' })).toThrow(/--operator/)
    expect(() => buildProvenance({ command: 'c', operator: 'p', note: '   ' })).toThrow(/--note/)
    expect(() => buildProvenance({ command: 'c', operator: 'x'.repeat(65), note: 'n' })).toThrow(
      /at most 64/,
    )
    expect(() => buildProvenance({ command: 'c', operator: 'p', note: 'n'.repeat(513) })).toThrow(
      /at most 512/,
    )
  })
})

describe('reason codes', () => {
  it('namespaces support writes and matches the ledger regex', () => {
    const codes = [
      defaultWalletReasonCode('stars', 100),
      defaultWalletReasonCode('stars', -100),
      defaultWalletReasonCode('dust', 100),
      defaultTicketReasonCode('standard_roll', 5),
      defaultTicketReasonCode('premium_roll', -5),
    ]
    expect(codes).toEqual([
      'support.manual.stars.credit',
      'support.manual.stars.debit',
      'support.manual.dust.credit',
      'support.manual.standard_roll.credit',
      'support.manual.premium_roll.debit',
    ])
    for (const code of codes) {
      expect(REASON_CODE_PATTERN.test(code)).toBe(true)
      expect(code.length).toBeGreaterThanOrEqual(3)
      expect(code.length).toBeLessThanOrEqual(128)
    }
  })

  it('rejects an override the database would reject', () => {
    expect(() =>
      buildWalletGrantPlan({
        kind: 'stars',
        userId: USER,
        amount: 1,
        ...GRANT,
        idempotencyKey: KEY,
        reasonCode: 'Support Manual',
      }),
    ).toThrow(/must be 3-128 chars/)
  })

  it('confines operator overrides to the support namespace', () => {
    expect(assertSupportReasonCode('support.compensation.credit')).toBe(
      'support.compensation.credit',
    )
    // The database would accept these — only the CLI stops them.
    for (const hijacked of ['purchase.star_bundle', 'dice.scrap.dust.credit', 'lunar.daily']) {
      expect(() => assertSupportReasonCode(hijacked)).toThrow(/must start with "support."/)
    }
    expect(() =>
      buildTicketGrantPlan({
        userId: USER,
        amount: 1,
        rollType: 'standard_roll',
        ...GRANT,
        idempotencyKey: KEY,
        reasonCode: 'pull.commit.standard_roll.debit',
      }),
    ).toThrow(/must start with "support."/)
  })
})

describe('wallet grant plans', () => {
  const plan = buildWalletGrantPlan({
    kind: 'stars',
    userId: USER,
    amount: 20000,
    ...GRANT,
    idempotencyKey: KEY,
  })

  it('sends append_wallet_ledger_entry arguments in declared order', () => {
    expect(plan.rpc).toBe('append_wallet_ledger_entry')
    expect(plan.args.map(argument => argument.name)).toEqual([
      'p_user_id',
      'p_currency_id',
      'p_balance_bucket',
      'p_delta_amount',
      'p_reason_code',
      'p_idempotency_key',
      'p_economy_edition_id',
      'p_provenance',
    ])
  })

  it('pins Stars to the promotional bucket and the only economy edition', () => {
    expect(plan.payload.p_currency_id).toBe('stars')
    expect(plan.payload.p_balance_bucket).toBe('promotional')
    expect(plan.payload.p_economy_edition_id).toBe(ECONOMY_EDITION_ID)
  })

  it('pins Dust to the earned bucket', () => {
    const dust = buildWalletGrantPlan({
      kind: 'dust',
      userId: USER,
      amount: 12,
      ...GRANT,
      idempotencyKey: KEY,
    })
    expect(dust.payload.p_currency_id).toBe('dust')
    expect(dust.payload.p_balance_bucket).toBe('earned')
  })

  it('exposes a payload matching the ordered args', () => {
    expect(Object.keys(plan.payload)).toEqual(plan.args.map(argument => argument.name))
  })

  it('keeps negative corrections as-is and labels them a debit', () => {
    const debit = buildWalletGrantPlan({
      kind: 'stars',
      userId: USER,
      amount: -750,
      ...GRANT,
      idempotencyKey: KEY,
    })
    expect(debit.payload.p_delta_amount).toBe(-750)
    expect(debit.effect).toBe('debit')
    expect(debit.summary).toMatch(/^Debit 750 Stars/)
  })

  it('rejects a zero delta and a non-uuid target', () => {
    expect(() =>
      buildWalletGrantPlan({ kind: 'stars', userId: USER, amount: 0, ...GRANT, idempotencyKey: KEY }),
    ).toThrow(/nonzero/)
    expect(() =>
      buildWalletGrantPlan({
        kind: 'stars',
        userId: 'player@example.com',
        amount: 1,
        ...GRANT,
        idempotencyKey: KEY,
      }),
    ).toThrow(/Not a user uuid/)
  })

  it('has no path to the paid Stars bucket', () => {
    expect(() =>
      buildWalletGrantPlan({ kind: 'paid', userId: USER, amount: 1, ...GRANT, idempotencyKey: KEY }),
    ).toThrow(/Unknown wallet grant kind/)
  })
})

describe('ticket and die grant plans', () => {
  it('sends record_roll_ticket_ledger_entry arguments in declared order', () => {
    const plan = buildTicketGrantPlan({
      userId: USER,
      amount: 3,
      rollType: 'standard_roll',
      ...GRANT,
      idempotencyKey: KEY,
    })
    expect(plan.rpc).toBe('record_roll_ticket_ledger_entry')
    expect(plan.args.map(argument => argument.name)).toEqual([
      'p_user_id',
      'p_roll_type',
      'p_delta_quantity',
      'p_reason_code',
      'p_idempotency_key',
      'p_provenance',
    ])
  })

  it('rejects an unknown roll type', () => {
    expect(() =>
      buildTicketGrantPlan({
        userId: USER,
        amount: 1,
        rollType: 'mythic_roll',
        ...GRANT,
        idempotencyKey: KEY,
      }),
    ).toThrow(/--roll-type must be one of/)
  })

  it('sends record_dice_copy_grant arguments in declared order with source_kind=reward', () => {
    const plan = buildDieGrantPlan({
      userId: USER,
      catalogItemId: 'adventurer-starter/d20/common@1',
      ...GRANT,
      idempotencyKey: KEY,
    })
    expect(plan.rpc).toBe('record_dice_copy_grant')
    expect(plan.args.map(argument => argument.name)).toEqual([
      'p_user_id',
      'p_catalog_item_id',
      'p_source_kind',
      'p_source_reference',
      'p_idempotency_key',
    ])
    expect(plan.payload.p_source_kind).toBe('reward')
    expect(plan.payload.p_source_reference).toBe('admin-grant:po:ticket 1234 goodwill')
  })

  it('bounds source_reference to the 512-character column limit', () => {
    const reference = buildSourceReference({ operator: 'o'.repeat(64), note: 'n'.repeat(512) })
    expect(reference.length).toBe(512)
  })

  it('rejects catalog ids that cannot exist', () => {
    for (const bad of ['not-a-catalog-id', 'Uppercase/d6/common@1', 'starter/d6/common', 'starter@0']) {
      expect(() =>
        buildDieGrantPlan({ userId: USER, catalogItemId: bad, ...GRANT, idempotencyKey: KEY }),
      ).toThrow(/not a catalog item id/)
    }
  })
})

describe('economy access plans', () => {
  const enable = buildEconomyAccessPlan({ userId: USER, enabled: true, ...GRANT })

  it('sends set_user_economy_access arguments in declared order with their casts', () => {
    expect(enable.rpc).toBe('set_user_economy_access')
    expect(enable.args.map(argument => argument.name)).toEqual([
      'p_user_id',
      'p_enabled',
      'p_operator',
      'p_note',
    ])
    expect(enable.args.map(argument => argument.cast)).toEqual([
      'uuid',
      'boolean',
      'text',
      'text',
    ])
    expect(enable.payload).toEqual({
      p_user_id: USER,
      p_enabled: true,
      p_operator: 'po',
      p_note: 'ticket 1234 goodwill',
    })
    expect(Object.keys(enable.payload)).toEqual(enable.args.map(argument => argument.name))
  })

  it('carries no idempotency key, because the row is a state and not an append', () => {
    expect(enable.payload).not.toHaveProperty('p_idempotency_key')
    expect(enable.payload).not.toHaveProperty('p_provenance')
    // ...so there is no write target to pre-flight, and `findExistingGrant`
    // returns null: the "REPLAYED" report can never fire on an access flip.
    expect(GRANT_WRITE_TARGETS).not.toHaveProperty('set_user_economy_access')
  })

  it('labels both directions and names the permanent side effect', () => {
    expect(enable.effect).toBe('enable')
    expect(enable.summary).toMatch(/^Enable economy access for /)
    expect(enable.summary).toMatch(/economy_access_granted_at \(the passport anchor\)/)

    const disable = buildEconomyAccessPlan({ userId: USER, enabled: false, ...GRANT })
    expect(disable.effect).toBe('disable')
    expect(disable.summary).toMatch(/^Disable economy access for /)
    expect(disable.summary).toMatch(/passport anchor.*left untouched/)
    expect(disable.payload.p_enabled).toBe(false)
  })

  it('rejects arguments the RPC would refuse with 23503 or 22023', () => {
    expect(() =>
      buildEconomyAccessPlan({ userId: 'player@example.com', enabled: true, ...GRANT }),
    ).toThrow(/Not a user uuid/)
    expect(() =>
      buildEconomyAccessPlan({ userId: USER, enabled: true, operator: '   ', note: 'n' }),
    ).toThrow(/--operator must not be empty/)
    expect(() =>
      buildEconomyAccessPlan({ userId: USER, enabled: true, operator: 'x'.repeat(65), note: 'n' }),
    ).toThrow(/at most 64/)
    expect(() =>
      buildEconomyAccessPlan({ userId: USER, enabled: true, operator: 'po', note: ' ' }),
    ).toThrow(/--note must not be empty/)
    expect(() =>
      buildEconomyAccessPlan({ userId: USER, enabled: true, operator: 'po', note: 'n'.repeat(513) }),
    ).toThrow(/at most 512/)
  })

  it('refuses a decision that is not exactly a boolean', () => {
    for (const notABoolean of ['on', 'true', 1, null, undefined]) {
      expect(() =>
        buildEconomyAccessPlan({ userId: USER, enabled: notABoolean, ...GRANT }),
      ).toThrow(/must be exactly "on" or "off"/)
    }
  })

  it('renders a pasteable named-argument call', () => {
    expect(formatSqlPreview(enable)).toBe(
      'select * from public.set_user_economy_access(\n' +
        `  p_user_id => '${USER}'::uuid,\n` +
        '  p_enabled => true::boolean,\n' +
        "  p_operator => 'po'::text,\n" +
        "  p_note => 'ticket 1234 goodwill'::text\n" +
        ');',
    )
    expect(
      formatSqlPreview(buildEconomyAccessPlan({ userId: USER, enabled: false, ...GRANT })),
    ).toContain('p_enabled => false::boolean')
  })
})

describe('SQL rendering', () => {
  it('escapes single quotes instead of interpolating them', () => {
    expect(sqlLiteral("O'Brien")).toBe("'O''Brien'")
    expect(sqlLiteral(42, 'bigint')).toBe('42::bigint')
    expect(sqlLiteral(null)).toBe('null')
    expect(sqlLiteral(true)).toBe('true')
    expect(sqlLiteral({ a: 1 }, 'jsonb')).toBe('\'{"a":1}\'::jsonb')
  })

  it('renders a named-argument call that psql can run verbatim', () => {
    const plan = buildDieGrantPlan({
      userId: USER,
      catalogItemId: 'adventurer-starter/d20/common@1',
      ...GRANT,
      idempotencyKey: KEY,
    })
    const preview = formatSqlPreview(plan)
    expect(preview.startsWith('select * from public.record_dice_copy_grant(')).toBe(true)
    expect(preview.endsWith(');')).toBe(true)
    expect(preview).toContain(`p_user_id => '${USER}'::uuid`)
    expect(formatSqlCall(plan)).not.toContain(';')
  })

  it('neutralises a quote-injection attempt in the operator note', () => {
    const plan = buildWalletGrantPlan({
      kind: 'stars',
      userId: USER,
      amount: 1,
      operator: 'po',
      note: "'); drop table public.wallet_ledger_entries; --",
      idempotencyKey: KEY,
    })
    const preview = formatSqlPreview(plan)
    // The note survives as data inside one jsonb literal, with its quote doubled.
    expect(preview).toContain("''); drop table public.wallet_ledger_entries; --")
    expect((preview.match(/'/g) ?? []).length % 2).toBe(0)
  })

  it('renders the manual pull-session cancellation insert', () => {
    const sql = buildCancelSessionSql(
      {
        id: '99999999-9999-4999-8999-999999999999',
        account_id: '88888888-8888-4888-8888-888888888888',
        user_id: USER,
        banner_version_id: 'standard-banner@3',
      },
      { operator: 'po', note: 'stuck session' },
    )
    expect(sql).toContain('insert into public.pull_session_transitions')
    expect(sql).toContain("'cancelled'")
    expect(sql).toContain("'standard-banner@3'::text")
    expect(sql).toContain(`'${USER}'::uuid`)
    expect(sql.trimEnd().endsWith(');')).toBe(true)
  })
})

describe('environment resolution', () => {
  const KEY_VALUE = 'sb_secret_0123456789abcdef0123456789'

  it('prefers the canonical variable names', () => {
    const environment = resolveEnvironment({
      SUPABASE_URL: 'https://project.supabase.co/',
      VITE_SUPABASE_URL: 'https://other.supabase.co',
      SUPABASE_SERVICE_ROLE_KEY: KEY_VALUE,
      SUPABASE_SECRET_KEY: 'ignored-because-secondary',
    })
    expect(environment).toMatchObject({
      url: 'https://project.supabase.co',
      urlSource: 'SUPABASE_URL',
      keySource: 'SUPABASE_SERVICE_ROLE_KEY',
    })
  })

  it('falls back to VITE_SUPABASE_URL and SUPABASE_SECRET_KEY', () => {
    expect(
      resolveEnvironment({
        VITE_SUPABASE_URL: 'https://project.supabase.co',
        SUPABASE_SECRET_KEY: KEY_VALUE,
      }),
    ).toMatchObject({ urlSource: 'VITE_SUPABASE_URL', keySource: 'SUPABASE_SECRET_KEY' })
  })

  it('refuses to run without credentials', () => {
    expect(() => resolveEnvironment({ SUPABASE_SERVICE_ROLE_KEY: KEY_VALUE })).toThrow(
      /Missing Supabase project URL/,
    )
    expect(() => resolveEnvironment({ SUPABASE_URL: 'https://p.supabase.co' })).toThrow(
      /Missing Supabase service-role key/,
    )
    expect(() =>
      resolveEnvironment({ SUPABASE_URL: 'https://p.supabase.co', SUPABASE_SECRET_KEY: 'short' }),
    ).toThrow(/looks truncated/)
    expect(() =>
      resolveEnvironment({ SUPABASE_URL: 'http://prod.example', SUPABASE_SECRET_KEY: KEY_VALUE }),
    ).toThrow(/must be https/)
  })

  it('allows a local Supabase stack over http', () => {
    expect(
      resolveEnvironment({ SUPABASE_URL: 'http://127.0.0.1:54321', SUPABASE_SECRET_KEY: KEY_VALUE }),
    ).toMatchObject({ url: 'http://127.0.0.1:54321' })
  })

  it('redacts the service-role key from anything it prints', () => {
    expect(redactSecret(`GET /x?apikey=${KEY_VALUE} and ${KEY_VALUE}`, KEY_VALUE)).toBe(
      'GET /x?apikey=[REDACTED service-role key] and [REDACTED service-role key]',
    )
    expect(redactSecret('nothing to hide', 'tiny')).toBe('nothing to hide')
  })

  it('builds an unquoted substring ilike pattern', () => {
    // PostgREST does not dequote a single filter value, so quoting the pattern
    // would search for literal quote characters and match nothing.
    expect(likePattern('Ada')).toBe('%Ada%')
    expect(likePattern('')).toBe('%%')
    // Commas and dots are only special inside in.() lists and logical trees.
    expect(likePattern('Lovelace, Ada')).toBe('%Lovelace, Ada%')
    expect(likePattern('say "hi"')).toBe('%say "hi"%')
  })

  it('escapes LIKE wildcards so they match literally', () => {
    expect(likePattern('100%')).toBe('%100\\%%')
    expect(likePattern('snake_case')).toBe('%snake\\_case%')
    expect(likePattern('back\\slash')).toBe('%back\\\\slash%')
  })

  it('leaves * alone, since PostgREST maps it to % for deliberate wildcards', () => {
    expect(likePattern('Ada*Lovelace')).toBe('%Ada*Lovelace%')
  })
})

describe('pull-hold detection', () => {
  const now = new Date('2026-07-27T12:00:00Z')
  const base = {
    prepared_at: '2026-07-27T11:59:00Z',
    expires_at: '2026-07-27T12:02:00Z',
  }

  it('matches prepared, unexpired, untransitioned sessions', () => {
    const live = { id: 'live', ...base }
    expect(selectActiveSession([live], new Map(), now)).toBe(live)
  })

  it('ignores sessions with a terminal transition', () => {
    const committed = { id: 'committed', ...base }
    const transitions = new Map([['committed', { kind: 'committed' }]])
    expect(selectActiveSession([committed], transitions, now)).toBeNull()
  })

  it('ignores expired and not-yet-prepared sessions', () => {
    const expired = { id: 'expired', prepared_at: '2026-07-27T11:00:00Z', expires_at: '2026-07-27T11:05:00Z' }
    const future = { id: 'future', prepared_at: '2026-07-27T12:30:00Z', expires_at: '2026-07-27T12:35:00Z' }
    expect(selectActiveSession([expired, future], new Map(), now)).toBeNull()
  })
})

describe('report formatting', () => {
  it('renders an empty table without headers', () => {
    expect(formatTable([], [{ key: 'a', label: 'a' }])).toBe('  (none)')
  })

  it('right-aligns numeric columns', () => {
    const table = formatTable(
      [{ name: 'stars', value: '20,000' }, { name: 'dust', value: '7' }],
      [
        { key: 'name', label: 'currency' },
        { key: 'value', label: 'balance', align: 'right' },
      ],
    )
    const lines = table.split('\n')
    expect(lines[0]).toBe('  currency  balance')
    expect(lines[2].trimStart()).toMatch(/^stars\s+20,000$/)
    expect(lines[3].trimStart()).toMatch(/^dust\s+7$/)
    // Right alignment means every row ends in the same column.
    expect(lines[2]).toHaveLength(lines[3].length)
    expect(lines[0]).toHaveLength(lines[2].length)
  })

  it('floors a countdown at zero', () => {
    const now = new Date('2026-07-27T12:00:00Z')
    expect(secondsUntil('2026-07-27T12:01:00Z', now)).toBe(60)
    expect(secondsUntil('2026-07-27T11:00:00Z', now)).toBe(0)
  })
})

/* ------------------------------------------------------------------------- */
/* Command layer (network readers stubbed)                                    */
/* ------------------------------------------------------------------------- */

function fakeIo() {
  const said: string[] = []
  const warned: string[] = []
  return {
    said,
    warned,
    say: (text: unknown) => said.push(String(text)),
    warn: (text: unknown) => warned.push(String(text)),
    confirm: vi.fn(async () => true),
    text: () => said.join('\n'),
  }
}

function fakeClient(response: unknown = { data: { id: 42 }, error: null }) {
  return { rpc: vi.fn(async () => response) }
}

const CANDIDATE = { id: USER, auth: { email: 'ada@example.com' }, profile: { display_name: 'Ada' } }

function grantStarsArgs(...extra: string[]) {
  return parseArgs(['grant-stars', USER, '20000', '--operator', 'po', '--note', 'ticket 1', ...extra])
}

beforeEach(() => {
  // Default: nothing has been written yet, so grants take the fresh-write path.
  vi.mocked(findExistingGrant).mockResolvedValue(null)
})

afterEach(() => {
  vi.restoreAllMocks()
  vi.mocked(resolveUserCandidates).mockReset()
  vi.mocked(fetchCatalogItem).mockReset()
  vi.mocked(fetchPullSessions).mockReset()
  vi.mocked(findExistingGrant).mockReset()
  vi.mocked(fetchEconomyAccess).mockReset()
  vi.mocked(fetchWalletBalances).mockReset()
  vi.mocked(fetchTicketBalances).mockReset()
  vi.mocked(fetchCopySummary).mockReset()
  vi.mocked(fetchWalletLedger).mockReset()
  vi.mocked(fetchTicketLedger).mockReset()
})

describe('user resolution refusals', () => {
  it('refuses to guess when a query matches several players', async () => {
    vi.mocked(resolveUserCandidates).mockResolvedValue([
      CANDIDATE,
      { id: '22222222-2222-4333-8444-555555555555', auth: { email: 'ada2@example.com' } },
    ])
    await expect(
      runCommand(parseArgs(['user', 'Ada']), { client: fakeClient(), environment: {}, io: fakeIo() }),
    ).rejects.toThrow(/matched 2 players/)
  })

  it('reports a miss rather than proceeding', async () => {
    vi.mocked(resolveUserCandidates).mockResolvedValue([])
    await expect(
      runCommand(parseArgs(['ledger', 'nobody@example.com']), {
        client: fakeClient(),
        environment: {},
        io: fakeIo(),
      }),
    ).rejects.toThrow(/No player matched/)
  })
})

describe('executePlan gating', () => {
  it('executes nothing on a dry run', async () => {
    vi.mocked(resolveUserCandidates).mockResolvedValue([CANDIDATE])
    const client = fakeClient()
    const io = fakeIo()
    const result = await runCommand(grantStarsArgs('--dry-run'), { client, environment: {}, io })
    expect(client.rpc).not.toHaveBeenCalled()
    expect(io.confirm).not.toHaveBeenCalled()
    expect(result).toMatchObject({ dryRun: true, executed: false, result: null })
    expect(io.text()).toContain('DRY RUN — nothing was executed.')
  })

  it('sends the exact plan payload once --yes is given', async () => {
    vi.mocked(resolveUserCandidates).mockResolvedValue([CANDIDATE])
    const client = fakeClient()
    const io = fakeIo()
    const result = await runCommand(grantStarsArgs('--yes'), { client, environment: {}, io })
    expect(io.confirm).not.toHaveBeenCalled()
    expect(client.rpc).toHaveBeenCalledTimes(1)
    expect(client.rpc).toHaveBeenCalledWith('append_wallet_ledger_entry', result.plan.payload)
    expect(result).toMatchObject({ dryRun: false, executed: true })
  })

  it('reports a replay instead of claiming a write that did not happen', async () => {
    vi.mocked(resolveUserCandidates).mockResolvedValue([CANDIDATE])
    vi.mocked(findExistingGrant).mockResolvedValue({
      id: 7,
      createdAt: '2026-07-27T09:00:00Z',
      table: 'wallet_ledger_entries',
      row: { id: 7, delta_amount: 20000 },
    })
    const client = fakeClient()
    const io = fakeIo()
    const result = await runCommand(grantStarsArgs('--yes'), { client, environment: {}, io })

    expect(client.rpc).not.toHaveBeenCalled()
    expect(result).toMatchObject({ executed: false, replayed: true, dryRun: false })
    expect(result.result).toEqual({ id: 7, delta_amount: 20000 })
    expect(io.text()).toContain(
      'REPLAYED — this exact grant already exists (id 7, created 2026-07-27T09:00:00Z)',
    )
    expect(io.text()).toContain('Change --note or pass --key to grant again.')
    expect(io.text()).not.toContain('DONE —')
  })

  it('does not prompt for a replay, since there is nothing to approve', async () => {
    vi.mocked(resolveUserCandidates).mockResolvedValue([CANDIDATE])
    vi.mocked(findExistingGrant).mockResolvedValue({
      id: 7,
      createdAt: '2026-07-27T09:00:00Z',
      table: 'wallet_ledger_entries',
      row: { id: 7 },
    })
    const io = fakeIo()
    await runCommand(grantStarsArgs(), { client: fakeClient(), environment: {}, io })
    expect(io.confirm).not.toHaveBeenCalled()
  })

  it('checks for a replay before prompting, and marks fresh writes replayed:false', async () => {
    vi.mocked(resolveUserCandidates).mockResolvedValue([CANDIDATE])
    const client = fakeClient()
    const result = await runCommand(grantStarsArgs('--yes'), {
      client,
      environment: {},
      io: fakeIo(),
    })
    expect(findExistingGrant).toHaveBeenCalledTimes(1)
    expect(result).toMatchObject({ executed: true, replayed: false })
    expect(client.rpc).toHaveBeenCalledTimes(1)
  })

  it('does not pre-flight on a dry run', async () => {
    vi.mocked(resolveUserCandidates).mockResolvedValue([CANDIDATE])
    const result = await runCommand(grantStarsArgs('--dry-run'), {
      client: fakeClient(),
      environment: {},
      io: fakeIo(),
    })
    expect(findExistingGrant).not.toHaveBeenCalled()
    expect(result.replayed).toBe(false)
  })

  it('aborts without calling the RPC when the operator declines', async () => {
    vi.mocked(resolveUserCandidates).mockResolvedValue([CANDIDATE])
    const client = fakeClient()
    const io = fakeIo()
    io.confirm.mockResolvedValue(false)
    await expect(runCommand(grantStarsArgs(), { client, environment: {}, io })).rejects.toThrow(
      /Aborted by operator/,
    )
    expect(client.rpc).not.toHaveBeenCalled()
  })

  it('echoes the idempotency key when a retry could behave differently', async () => {
    vi.mocked(resolveUserCandidates).mockResolvedValue([CANDIDATE])
    const client = fakeClient({ data: null, error: { code: '40001', message: 'serialization' } })
    await expect(
      runCommand(grantStarsArgs('--yes'), { client, environment: {}, io: fakeIo() }),
    ).rejects.toThrow(/Retry with --key 'admin-grant:\d{4}-\d{2}-\d{2}:[0-9a-f]{12}'/)
  })

  it('does NOT suggest a retry on a deterministic rejection', async () => {
    vi.mocked(resolveUserCandidates).mockResolvedValue([CANDIDATE])
    for (const code of ['22023', '22003', '23503', '42501']) {
      const client = fakeClient({ data: null, error: { code, message: 'nope' } })
      // The same key is guaranteed to fail identically, and a retry suggestion
      // would contradict the code-specific guidance printed beside it.
      await expect(
        runCommand(grantStarsArgs('--yes'), { client, environment: {}, io: fakeIo() }),
      ).rejects.toThrow(new RegExp(`\\[${code}\\](?![\\s\\S]*Retry with --key)`))
    }
  })

  it('classifies which SQLSTATEs are worth retrying', () => {
    for (const retryable of ['55000', '40001', '40P01', '57014', '08006', null, undefined]) {
      expect(isRetryable(retryable)).toBe(true)
    }
    for (const deterministic of ['22023', '22003', '23503', '42501']) {
      expect(isRetryable(deterministic)).toBe(false)
    }
  })

  it('reports a thrown transport error as possibly-landed, with the retry key', async () => {
    vi.mocked(resolveUserCandidates).mockResolvedValue([CANDIDATE])
    const client = { rpc: vi.fn(async () => { throw new Error('socket hang up') }) }
    await expect(
      runCommand(grantStarsArgs('--yes'), { client, environment: {}, io: fakeIo() }),
    ).rejects.toThrow(/may or may not have landed.*Retry with --key/s)
  })
})

describe('grant-die catalog validation', () => {
  const dieArgs = (...extra: string[]) =>
    parseArgs([
      'grant-die',
      USER,
      'adventurer-starter/d20/common@1',
      '--operator',
      'po',
      '--note',
      'ticket 2',
      ...extra,
    ])

  const ITEM = {
    id: 'adventurer-starter/d20/common@1',
    item_kind: 'die',
    set_id: 'adventurer-starter',
    dice_type: 'd20',
    rarity: 'common',
    assetVersionCount: 1,
  }

  it('refuses an unknown catalog item', async () => {
    vi.mocked(resolveUserCandidates).mockResolvedValue([CANDIDATE])
    vi.mocked(fetchCatalogItem).mockResolvedValue(null)
    await expect(
      runCommand(dieArgs(), { client: fakeClient(), environment: {}, io: fakeIo() }),
    ).rejects.toThrow(/Unknown catalog item/)
  })

  it('refuses a catalog item that is not a die', async () => {
    vi.mocked(resolveUserCandidates).mockResolvedValue([CANDIDATE])
    vi.mocked(fetchCatalogItem).mockResolvedValue({ ...ITEM, item_kind: 'cosmetic' })
    await expect(
      runCommand(dieArgs(), { client: fakeClient(), environment: {}, io: fakeIo() }),
    ).rejects.toThrow(/item_kind=cosmetic/)
  })

  it('hard-fails an asset-less item, naming the real blast radius', async () => {
    vi.mocked(resolveUserCandidates).mockResolvedValue([CANDIDATE])
    vi.mocked(fetchCatalogItem).mockResolvedValue({ ...ITEM, assetVersionCount: 0 })
    const client = fakeClient()
    await expect(
      runCommand(dieArgs('--no-dry-run', '--yes'), { client, environment: {}, io: fakeIo() }),
    ).rejects.toThrow(/ENTIRE inventory overlay/)
    expect(client.rpc).not.toHaveBeenCalled()
  })

  it('allows the asset-less grant only behind the explicit escape flag', async () => {
    vi.mocked(resolveUserCandidates).mockResolvedValue([CANDIDATE])
    vi.mocked(fetchCatalogItem).mockResolvedValue({ ...ITEM, assetVersionCount: 0 })
    vi.mocked(fetchPullSessions).mockResolvedValue({ sessions: [], activeSession: null })
    const io = fakeIo()
    const result = await runCommand(dieArgs('--allow-missing-asset'), {
      client: fakeClient(),
      environment: {},
      io,
    })
    expect(result.dryRun).toBe(true)
    expect(io.warned.join('\n')).toMatch(/--allow-missing-asset overrides the asset check/)
  })

  it('warns about a live pull hold before attempting the grant', async () => {
    vi.mocked(resolveUserCandidates).mockResolvedValue([CANDIDATE])
    vi.mocked(fetchCatalogItem).mockResolvedValue(ITEM)
    vi.mocked(fetchPullSessions).mockResolvedValue({
      sessions: [],
      activeSession: { id: 's', expires_at: new Date(Date.now() + 60000).toISOString() },
    })
    const io = fakeIo()
    await runCommand(dieArgs(), { client: fakeClient(), environment: {}, io })
    expect(io.warned.join('\n')).toMatch(/pull hold is live.*55000/s)
  })
})

describe('economy access commands', () => {
  const ACCESS_ON = {
    user_id: USER,
    economy_access: true,
    economy_access_granted_at: '2026-08-01T10:00:00Z',
    updated_at: '2026-08-02T11:30:00Z',
    last_changed_by: 'donovan',
    last_change_note: 'ticket 1500: closed beta wave 2',
  }

  const setAccessArgs = (decision: string, ...extra: string[]) =>
    parseArgs([
      'set-economy-access',
      USER,
      decision,
      '--operator',
      'po',
      '--note',
      'ticket 1500: closed beta wave 2',
      ...extra,
    ])

  beforeEach(() => {
    vi.mocked(resolveUserCandidates).mockResolvedValue([CANDIDATE])
  })

  it('prints the flag and labels the timestamp as the passport anchor', async () => {
    vi.mocked(fetchEconomyAccess).mockResolvedValue(ACCESS_ON)
    const io = fakeIo()
    const result = await runCommand(parseArgs(['economy-access', USER]), {
      client: fakeClient(),
      environment: {},
      io,
    })
    expect(io.text()).toContain('Economy access')
    expect(io.text()).toContain('access:          on')
    expect(io.text()).toContain(
      'granted at:      2026-08-01T10:00:00Z (passport anchor — set once, never moved)',
    )
    expect(io.text()).toContain('last changed by: donovan')
    expect(result).toEqual({ user: { id: USER }, economyAccess: ACCESS_ON })
  })

  it('says "off" in words when the player has no row at all', async () => {
    // Absence of a row IS off. Rendering a dash here would read as "unknown"
    // and send support chasing a state that simply does not exist yet.
    vi.mocked(fetchEconomyAccess).mockResolvedValue(null)
    const io = fakeIo()
    const result = await runCommand(parseArgs(['economy-access', USER]), {
      client: fakeClient(),
      environment: {},
      io,
    })
    expect(io.text()).toContain('off (no user_economy_access row — never granted)')
    expect(io.text()).toContain('- (passport anchor never stamped)')
    expect(io.text()).not.toMatch(/access:\s+-\s*$/m)
    expect(result.economyAccess).toBeNull()
  })

  it('shows the current state before the plan, and executes nothing on a dry run', async () => {
    vi.mocked(fetchEconomyAccess).mockResolvedValue(null)
    const client = fakeClient()
    const io = fakeIo()
    const result = await runCommand(setAccessArgs('on'), { client, environment: {}, io })

    const text = io.text()
    expect(text.indexOf('Economy access (current)')).toBeLessThan(text.indexOf('Planned call'))
    expect(text).toContain('off (no user_economy_access row — never granted)')
    expect(text).toContain('effect:  enable')
    expect(text).toContain('DRY RUN — nothing was executed.')
    expect(client.rpc).not.toHaveBeenCalled()
    expect(io.confirm).not.toHaveBeenCalled()
    expect(findExistingGrant).not.toHaveBeenCalled()
    expect(result).toMatchObject({ dryRun: true, executed: false, replayed: false })
    expect(result.economyAccessBefore).toBeNull()
    // The permanence of a first enable is a stderr warning, not buried in the plan.
    expect(io.warned.join('\n')).toMatch(/FIRST enable.*12-week anchor/s)
  })

  it('calls set_user_economy_access with the exact payload under --no-dry-run --yes', async () => {
    vi.mocked(fetchEconomyAccess).mockResolvedValue(null)
    const client = fakeClient({
      data: { ...ACCESS_ON, economy_access_granted_at: '2026-08-10T08:00:00Z' },
      error: null,
    })
    const io = fakeIo()
    const result = await runCommand(setAccessArgs('on', '--no-dry-run', '--yes'), {
      client,
      environment: {},
      io,
    })
    expect(client.rpc).toHaveBeenCalledTimes(1)
    expect(client.rpc).toHaveBeenCalledWith('set_user_economy_access', {
      p_user_id: USER,
      p_enabled: true,
      p_operator: 'po',
      p_note: 'ticket 1500: closed beta wave 2',
    })
    expect(result).toMatchObject({ dryRun: false, executed: true, replayed: false })
    expect(io.text()).toContain('DONE — Enable economy access')
  })

  it('cannot report a REPLAY, because there is no key to replay on', async () => {
    // findExistingGrant is stubbed here, but the real one short-circuits on a
    // missing GRANT_WRITE_TARGETS entry (asserted in "economy access plans").
    vi.mocked(fetchEconomyAccess).mockResolvedValue(null)
    vi.mocked(findExistingGrant).mockResolvedValue(null)
    const io = fakeIo()
    const result = await runCommand(setAccessArgs('off', '--no-dry-run', '--yes'), {
      client: fakeClient(),
      environment: {},
      io,
    })
    expect(result.replayed).toBe(false)
    expect(io.text()).not.toContain('REPLAYED')
  })

  it('reports a no-op flip plainly and still lets it refresh the audit fields', async () => {
    vi.mocked(fetchEconomyAccess).mockResolvedValue(ACCESS_ON)
    const client = fakeClient({ data: ACCESS_ON, error: null })
    const io = fakeIo()
    const result = await runCommand(setAccessArgs('on', '--no-dry-run', '--yes'), {
      client,
      environment: {},
      io,
    })
    expect(io.text()).toContain(
      'NO CHANGE — economy access is already on (granted at 2026-08-01T10:00:00Z)',
    )
    expect(result.noChange).toBe(true)
    expect(client.rpc).toHaveBeenCalledTimes(1)
    // Re-enabling an already-anchored player is not a first enable.
    expect(io.warned.join('\n')).not.toMatch(/FIRST enable/)
  })

  it('does not print "undefined" in the retry hint for a keyless plan', async () => {
    vi.mocked(fetchEconomyAccess).mockResolvedValue(null)
    const client = fakeClient({ data: null, error: { code: '40001', message: 'serialization' } })
    const error = await runCommand(setAccessArgs('on', '--no-dry-run', '--yes'), {
      client,
      environment: {},
      io: fakeIo(),
    }).catch((thrown: Error) => thrown)
    expect(error.message).toContain('state write with no idempotency key')
    expect(error.message).not.toContain('undefined')
    expect(error.message).not.toContain('--key')
  })

  it('leaves the key-based hint untouched for the keyed grant RPCs', async () => {
    const client = fakeClient({ data: null, error: { code: '40001', message: 'serialization' } })
    const error = await runCommand(grantStarsArgs('--yes'), {
      client,
      environment: {},
      io: fakeIo(),
    }).catch((thrown: Error) => thrown)
    expect(error.message).toMatch(
      /Retry with --key 'admin-grant:\d{4}-\d{2}-\d{2}:[0-9a-f]{12}' \(or re-run the identical command\): the key is stable, so a retry cannot double-grant\./,
    )
    expect(error.message).not.toContain('no idempotency key')
  })

  it('puts the economy-access block in the user report, including the no-row case', async () => {
    vi.mocked(fetchWalletBalances).mockResolvedValue([])
    vi.mocked(fetchTicketBalances).mockResolvedValue([])
    vi.mocked(fetchCopySummary).mockResolvedValue({
      totalCopies: 0,
      liveCopies: 0,
      scrappedCopies: 0,
      recentCopies: [],
    })
    vi.mocked(fetchWalletLedger).mockResolvedValue([])
    vi.mocked(fetchTicketLedger).mockResolvedValue([])
    vi.mocked(fetchPullSessions).mockResolvedValue({ sessions: [], activeSession: null })
    vi.mocked(fetchEconomyAccess).mockResolvedValue(ACCESS_ON)

    const io = fakeIo()
    const result = await runCommand(parseArgs(['user', USER]), {
      client: fakeClient(),
      environment: {},
      io,
    })
    const text = io.text()
    expect(text).toContain('Economy access')
    expect(text).toContain('2026-08-01T10:00:00Z (passport anchor — set once, never moved)')
    // Support's first stop reads access before balances.
    expect(text.indexOf('Economy access')).toBeLessThan(text.indexOf('Wallet balances'))
    expect(result.economyAccess).toEqual(ACCESS_ON)

    vi.mocked(fetchEconomyAccess).mockResolvedValue(null)
    const emptyIo = fakeIo()
    const empty = await runCommand(parseArgs(['user', USER]), {
      client: fakeClient(),
      environment: {},
      io: emptyIo,
    })
    expect(emptyIo.text()).toContain('off (no user_economy_access row — never granted)')
    expect(empty.economyAccess).toBeNull()
  })
})

describe('SQLSTATE hints are scoped to the RPC that raised them', () => {
  it('only explains the pull-hold pause for die grants', () => {
    expect(sqlstateHint('55000', 'record_dice_copy_grant')).toMatch(/prepared pull hold is live/)
    expect(sqlstateHint('55000', 'append_wallet_ledger_entry')).toBeNull()
    expect(sqlstateHint('55000', 'record_roll_ticket_ledger_entry')).toBeNull()
  })

  it('does not mention pull holds in the ticket balance floor', () => {
    expect(sqlstateHint('22003', 'record_roll_ticket_ledger_entry')).not.toMatch(/pull hold/)
    expect(sqlstateHint('22003', 'append_wallet_ledger_entry')).toMatch(/pull hold/)
  })

  it('returns null for codes it has nothing useful to say about', () => {
    expect(sqlstateHint('40001', 'append_wallet_ledger_entry')).toBeNull()
  })

  it('does not offer idempotency-key advice for the keyless access RPC', () => {
    const access = sqlstateHint('22023', 'set_user_economy_access')
    expect(access).toMatch(/--operator must be 1-64 characters and --note 1-512/)
    expect(access).toMatch(/no idempotency key/)
    expect(access).not.toMatch(/pass --key/)
    // The ledger-flavoured wording is unchanged for the RPCs that do have keys.
    expect(sqlstateHint('22023', 'append_wallet_ledger_entry')).toMatch(
      /idempotency key was already used with different arguments/,
    )
  })

  it('reads 23503 as an unknown auth user for the access RPC', () => {
    expect(sqlstateHint('23503', 'set_user_economy_access')).toMatch(
      /No such auth user — check the uuid/,
    )
    expect(sqlstateHint('23503', 'record_dice_copy_grant')).toMatch(/unknown catalog item/)
  })
})

describe('--json output purity', () => {
  it('emits only the JSON envelope on stdout and redacts the key', () => {
    const stdout = vi.spyOn(process.stdout, 'write').mockImplementation(() => true)
    const stderr = vi.spyOn(process.stderr, 'write').mockImplementation(() => true)
    const secret = 'sb_secret_0123456789abcdef'
    const io = createIo({ json: true, secret })

    io.say('human-readable noise that must not pollute stdout')
    io.warn(`a warning containing ${secret}`)
    io.result({ ok: true, key: secret })

    expect(stdout).toHaveBeenCalledTimes(1)
    expect(stdout.mock.calls[0][0]).toContain('"ok": true')
    expect(stdout.mock.calls[0][0]).toContain('[REDACTED service-role key]')
    expect(stdout.mock.calls[0][0]).not.toContain(secret)
    expect(stderr.mock.calls[0][0]).not.toContain(secret)
  })

  it('writes human output and no JSON envelope when --json is absent', () => {
    const stdout = vi.spyOn(process.stdout, 'write').mockImplementation(() => true)
    const io = createIo({ json: false, secret: 'sb_secret_0123456789abcdef' })
    io.say('a table')
    io.result({ ok: true })
    expect(stdout).toHaveBeenCalledTimes(1)
    expect(stdout.mock.calls[0][0]).toContain('a table')
  })
})
