import { describe, expect, it } from 'vitest'

import { DEFAULT_LIMIT, MAX_LIMIT, UsageError, parseArgs, usageText } from './lib/args.mjs'
import {
  DICE_COPY_KEY_PATTERN,
  ECONOMY_EDITION_ID,
  REASON_CODE_PATTERN,
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
  it('derives admin-grant:<date>:<slug>', () => {
    const key = deriveIdempotencyKey({ now: new Date('2026-07-27T09:15:00Z'), slug: '0a1b2c3d' })
    expect(key).toBe('admin-grant:2026-07-27:0a1b2c3d')
  })

  it('satisfies both the ledger length rule and the dice_copies key regex', () => {
    const key = deriveIdempotencyKey()
    expect(key.length).toBeGreaterThanOrEqual(8)
    expect(key.length).toBeLessThanOrEqual(200)
    expect(DICE_COPY_KEY_PATTERN.test(key)).toBe(true)
  })

  it('produces a distinct key per invocation', () => {
    expect(deriveIdempotencyKey()).not.toBe(deriveIdempotencyKey())
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

  it('quotes display-name search patterns so PostgREST cannot mis-parse them', () => {
    expect(likePattern('Ada')).toBe('"%Ada%"')
    expect(likePattern('Lovelace, Ada')).toBe('"%Lovelace, Ada%"')
    expect(likePattern('say "hi"')).toBe('"%say \\"hi\\"%"')
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
