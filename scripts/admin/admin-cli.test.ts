import { afterEach, describe, expect, it, vi } from 'vitest'

// Partial mock: the network-touching readers are stubbed so the command layer
// can be exercised without a server; every pure export stays real.
vi.mock('./lib/queries.mjs', async importOriginal => {
  const actual = await importOriginal()
  return {
    ...actual,
    resolveUserCandidates: vi.fn(),
    fetchCatalogItem: vi.fn(),
    fetchPullSessions: vi.fn(),
  }
})

import { DEFAULT_LIMIT, MAX_LIMIT, UsageError, parseArgs, usageText } from './lib/args.mjs'
import { createIo } from './dicesuki-admin.mjs'
import { runCommand, sqlstateHint } from './lib/commands.mjs'
import { fetchCatalogItem, fetchPullSessions, resolveUserCandidates } from './lib/queries.mjs'
import {
  DICE_COPY_KEY_PATTERN,
  ECONOMY_EDITION_ID,
  REASON_CODE_PATTERN,
  assertSupportReasonCode,
  buildCancelSessionSql,
  buildDieGrantPlan,
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
      'grant-stars',
      'grant-dust',
      'grant-tickets',
      'grant-die',
      'cancel-session',
    ]) {
      expect(text).toContain(command)
    }
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

afterEach(() => {
  vi.restoreAllMocks()
  vi.mocked(resolveUserCandidates).mockReset()
  vi.mocked(fetchCatalogItem).mockReset()
  vi.mocked(fetchPullSessions).mockReset()
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

  it('echoes the idempotency key on an ambiguous failure so the retry is precise', async () => {
    vi.mocked(resolveUserCandidates).mockResolvedValue([CANDIDATE])
    const client = fakeClient({ data: null, error: { code: '22023', message: 'boom' } })
    await expect(
      runCommand(grantStarsArgs('--yes'), { client, environment: {}, io: fakeIo() }),
    ).rejects.toThrow(/Retry with --key 'admin-grant:\d{4}-\d{2}-\d{2}:[0-9a-f]{12}'/)
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
