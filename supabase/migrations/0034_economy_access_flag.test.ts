import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { beforeAll, describe, expect, it } from 'vitest'

const migrationPath = resolve(
  process.cwd(),
  'supabase/migrations/0034_economy_access_flag.sql',
)
const behavioralPath = resolve(
  process.cwd(),
  'supabase/tests/0034_economy_access_flag.test.sql',
)
const claimsPath = resolve(
  process.cwd(),
  'supabase/migrations/0010_earned_reward_claims.sql',
)
const hardeningPath = resolve(
  process.cwd(),
  'supabase/migrations/0005_security_hardening.sql',
)
const profilesPath = resolve(
  process.cwd(),
  'supabase/migrations/0001_profiles.sql',
)

let sql = ''
let behavioralSql = ''
let claimsSql = ''
let hardeningSql = ''
let profilesSql = ''

beforeAll(async () => {
  [sql, behavioralSql, claimsSql, hardeningSql, profilesSql] = await Promise.all([
    readFile(migrationPath, 'utf8'),
    readFile(behavioralPath, 'utf8'),
    readFile(claimsPath, 'utf8'),
    readFile(hardeningPath, 'utf8'),
    readFile(profilesPath, 'utf8'),
  ])
})

function executable(source: string) {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/--[^\r\n]*/g, '')
}

function regexEscape(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/**
 * Bind a raise to *its own* guard: `[^;]` cannot cross a plpgsql statement
 * boundary, so the match starts at the `if` that actually raises rather than at
 * any earlier one in the file.
 *
 * This proves the message is still the consequent of a guard. It does NOT prove
 * the guard still constrains anything -- `if false then` contains no semicolon
 * either, so a hollowed predicate still matches. Pair each call with a literal
 * from the condition when that matters; the 0032 suite makes that literal a
 * required parameter for exactly this reason.
 */
function expectIfRaise(source: string, message: string) {
  expect(source).toMatch(
    new RegExp(
      `\\bif\\b[^;]*?\\bthen\\s+raise exception '${regexEscape(message)}'`,
      'i',
    ),
  )
}

function collapse(value: string) {
  return value.replace(/\s+/g, ' ').trim()
}

describe('0034 economy access flag', () => {
  it('keeps the gate off public.profiles because profiles is player-writable', () => {
    // The justification is load-bearing, so pin the hazard it cites rather than
    // trusting the comment: profiles hands `authenticated` a table-wide update
    // and never forces RLS, so a column there would be self-grantable.
    expect(hardeningSql).toMatch(
      /grant insert, update, delete on table public\.profiles to authenticated;/i,
    )
    expect(hardeningSql).not.toMatch(
      /alter table public\.profiles force row level security/i,
    )
    expect(profilesSql).toMatch(
      /alter table public\.profiles enable row level security;/i,
    )
    expect(profilesSql).not.toMatch(/force row level security/i)

    const statements = executable(sql)
    expect(statements).not.toMatch(/public\.profiles/i)
    expect(statements).toMatch(
      /create table public\.user_economy_access \(/i,
    )
  })

  it('forces RLS and grants only own-row select to the API roles', () => {
    const statements = executable(sql)

    expect(statements).toMatch(
      /alter table public\.user_economy_access enable row level security;/i,
    )
    expect(statements).toMatch(
      /alter table public\.user_economy_access force row level security;/i,
    )
    expect(statements).toMatch(
      /create policy "users read their own economy access"\s+on public\.user_economy_access\s+for select\s+to authenticated\s+using \(\(select auth\.uid\(\)\) = user_id\);/i,
    )
    expect(statements).toMatch(
      /revoke all on table public\.user_economy_access\s+from public, anon, authenticated, service_role;/i,
    )

    // Exhaustive: the only table grants that exist are the two SELECT grants.
    // No API role -- not even service_role -- may write the gate directly.
    const tableGrants = (
      statements.match(
        /grant\s+[^;]*?on table public\.user_economy_access[^;]*;/gi,
      ) ?? []
    ).map(collapse)
    expect(tableGrants).toEqual([
      'grant select on table public.user_economy_access to authenticated;',
      'grant select on table public.user_economy_access to service_role;',
    ])
    expect(statements).not.toMatch(
      /grant[^;]*\b(?:insert|update|delete|all)\b[^;]*public\.user_economy_access/i,
    )
    // Only one policy exists on the gate table, and it is a SELECT policy.
    const policies = (
      statements.match(/create policy[^;]*on public\.user_economy_access[^;]*;/gi) ?? []
    ).map(collapse)
    expect(policies).toHaveLength(1)
    expect(policies[0]).toContain('for select')
  })

  it('declares the gate columns with guarded nullable CHECK arms', () => {
    const statements = executable(sql)

    expect(statements).toMatch(
      /user_id\s+uuid\s+primary key\s+references auth\.users \(id\) on delete cascade/i,
    )
    expect(statements).toMatch(
      /economy_access\s+boolean\s+not null default false/i,
    )
    expect(statements).toMatch(/economy_access_granted_at\s+timestamptz,/i)
    expect(statements).toMatch(/updated_at\s+timestamptz not null default now\(\)/i)
    expect(statements).toMatch(/last_changed_by\s+text,/i)
    expect(statements).toMatch(/last_change_note\s+text/i)

    expect(statements).toMatch(
      /constraint user_economy_access_granted_at_required\s+check \(economy_access = false or economy_access_granted_at is not null\)/i,
    )
    // Three-valued logic makes an unguarded arm pass silently on NULL, so both
    // length checks carry an explicit `is null or` guard.
    expect(statements).toMatch(
      /constraint user_economy_access_last_changed_by\s+check \(\s*last_changed_by is null or\s*char_length\(last_changed_by\) between 1 and 64\s*\)/i,
    )
    expect(statements).toMatch(
      /constraint user_economy_access_last_change_note\s+check \(\s*last_change_note is null or\s*char_length\(last_change_note\) between 1 and 512\s*\)/i,
    )

    for (const column of [
      'user_id',
      'economy_access',
      'economy_access_granted_at',
      'updated_at',
      'last_changed_by',
      'last_change_note',
    ]) {
      expect(sql).toMatch(
        new RegExp(`comment on column public\\.user_economy_access\\.${column} is`, 'i'),
      )
    }
    expect(sql).toMatch(/comment on table public\.user_economy_access is/i)
  })

  it('ships the exact operator RPC signature, service-role-only', () => {
    const statements = executable(sql)

    expect(statements).toMatch(
      /create or replace function public\.set_user_economy_access\(\s*p_user_id uuid,\s*p_enabled boolean,\s*p_operator text,\s*p_note text\s*\)\s*returns public\.user_economy_access\s*language plpgsql\s*security definer\s*set search_path = ''/i,
    )
    expect(statements).toMatch(
      /revoke all on function public\.set_user_economy_access\(uuid, boolean, text, text\)\s+from public, anon, authenticated, service_role;/i,
    )
    expect(statements).toMatch(
      /grant execute on function public\.set_user_economy_access\(uuid, boolean, text, text\)\s+to service_role;/i,
    )
    expect(sql).toMatch(
      /comment on function public\.set_user_economy_access\(uuid, boolean, text, text\) is/i,
    )

    // Exhaustive: service_role is the only grantee of any execute privilege in
    // this migration. A player can never call the gate write.
    const executeGrants = (
      statements.match(/grant execute on function[^;]*;/gi) ?? []
    ).map(collapse)
    expect(executeGrants).toEqual([
      'grant execute on function public.set_user_economy_access(uuid, boolean, text, text) to service_role;',
    ])

    expectIfRaise(statements, 'A target user id is required')
    expectIfRaise(statements, 'An explicit economy access decision is required')
    expectIfRaise(statements, 'Operator name must be 1-64 characters')
    expectIfRaise(statements, 'Operator note must be 1-512 characters')
    expectIfRaise(statements, 'Unknown user for economy access')
    expect(statements).toMatch(
      /raise exception 'Unknown user for economy access' using errcode = '23503';/i,
    )
    expect(statements).toMatch(
      /if not exists \(select 1 from auth\.users as users where users\.id = p_user_id\) then/i,
    )
  })

  it('stamps economy_access_granted_at once and never moves it', () => {
    const statements = executable(sql)

    expect(statements).toMatch(
      /normalized_operator text := btrim\(coalesce\(p_operator, ''\)\);/i,
    )
    expect(statements).toMatch(
      /normalized_note text := btrim\(coalesce\(p_note, ''\)\);/i,
    )
    expect(statements).toMatch(
      /insert into public\.user_economy_access as access \(/i,
    )
    // The coalesce IS the set-once rule; the disable arm keeps the stored value.
    expect(statements).toMatch(
      /economy_access_granted_at = case\s*when excluded\.economy_access\s*then coalesce\(access\.economy_access_granted_at, statement_timestamp\(\)\)\s*else access\.economy_access_granted_at\s*end,/i,
    )
    expect(statements).toMatch(/updated_at = statement_timestamp\(\),/i)
    expect(statements).toMatch(/last_changed_by = excluded\.last_changed_by,/i)
    expect(statements).toMatch(/last_change_note = excluded\.last_change_note/i)
    // Nothing in the migration clears the anchor.
    expect(statements).not.toMatch(/economy_access_granted_at\s*=\s*null/i)
  })

  it('adds the clamped anchor helper with no API-role execute', () => {
    const statements = executable(sql)

    expect(statements).toMatch(
      /create or replace function private\.passport_enrollment_anchor_period\(\s*p_user_id uuid,\s*p_fallback_period date\s*\)\s*returns date\s*language sql\s*stable\s*parallel safe\s*set search_path = ''/i,
    )
    expect(statements).toMatch(
      /select least\(\s*p_fallback_period,\s*coalesce\(\s*\(\s*select private\.utc_monday_period_start\(access\.economy_access_granted_at\)\s*from public\.user_economy_access as access\s*where access\.user_id = p_user_id\s*\),\s*p_fallback_period\s*\)\s*\);/i,
    )
    expect(statements).toMatch(
      /revoke all on function private\.passport_enrollment_anchor_period\(uuid, date\)\s+from public, anon, authenticated, service_role;/i,
    )
    // The clamp exists to keep a skewed grant from tripping 0010's guard.
    expect(sql).toMatch(/Claim time precedes passport enrollment/)
  })

  it('replaces exactly three functions and rewrites no history', () => {
    const statements = executable(sql)

    expect(
      statements.match(/create\s+or\s+replace\s+function\s+([a-z_.]+)\(/gi),
    ).toEqual([
      'create or replace function public.set_user_economy_access(',
      'create or replace function private.passport_enrollment_anchor_period(',
      'create or replace function private.issue_earned_reward_claim(',
    ])
    expect(statements).not.toMatch(/\bcreate\s+function\b/i)

    // No backfill: passport enrollments are append-only behind 0010's
    // reject-update/delete triggers, and rewriting an anchor would confiscate
    // or gift claims.
    expect(statements).not.toMatch(
      /\b(?:update|delete|merge|truncate|alter)\s+(?:table\s+)?public\.earned_reward_passport_enrollments/i,
    )
    expect(statements).not.toMatch(
      /\bupdate\s+public\.earned_reward_claim_outcomes/i,
    )
    // The derived status projection is untouched; it follows the anchor already.
    expect(statements).not.toMatch(/get_earned_reward_status/i)
    // No existing economy RPC gains a gate check in this slice.
    expect(statements).not.toMatch(/claim_new_collector_passport/i)
    expect(statements).not.toMatch(/claim_community_die/i)
    expect(statements).not.toMatch(/prepare_pull|commit_pull_session|craft_dice_copy/i)
    // Only one table is created.
    expect(statements.match(/create table [a-z_.]+/gi)).toEqual([
      'create table public.user_economy_access',
    ])
  })

  it('re-creates the 0010 claim engine verbatim apart from the anchor', () => {
    // 0010 lines 594-819 are the only definition of the claim engine; it has
    // never been redefined by a later migration.
    const others = claimsSql
    expect(others).toContain(
      'create or replace function private.issue_earned_reward_claim(',
    )

    const original = claimsSql.split('\n').slice(593, 819).join('\n')
    expect(original.startsWith(
      'create or replace function private.issue_earned_reward_claim(',
    )).toBe(true)
    expect(original.endsWith('$$;')).toBe(true)

    const originalInsert = [
      '    insert into public.earned_reward_passport_enrollments (',
      '      account_id,',
      '      user_id,',
      '      program_id,',
      '      enrolled_period_start,',
      '      enrolled_at',
      '    ) values (',
      '      target_account.id,',
      '      p_user_id,',
      '      program.id,',
      '      target_period_start,',
      '      p_effective_at',
      '    )',
      '',
    ].join('\n')
    const anchoredInsert = [
      '    anchor_period := private.passport_enrollment_anchor_period(',
      '      p_user_id,',
      '      target_period_start',
      '    );',
      '    insert into public.earned_reward_passport_enrollments (',
      '      account_id,',
      '      user_id,',
      '      program_id,',
      '      enrolled_period_start,',
      '      enrolled_at',
      '    ) values (',
      '      target_account.id,',
      '      p_user_id,',
      '      program.id,',
      '      anchor_period,',
      '      p_effective_at',
      '    )',
      '',
    ].join('\n')

    expect(original.split(originalInsert)).toHaveLength(2)
    expect(original.split('  target_dust bigint := 0;\n')).toHaveLength(2)

    const expected = original
      .replace('  target_dust bigint := 0;\n', '  target_dust bigint := 0;\n  anchor_period date;\n')
      .replace(originalInsert, anchoredInsert)

    // Byte-exact: the shipped body differs from 0010 only by the declaration
    // and the anchored enrollment insert.
    expect(sql).toContain(expected)

    // 0010's revoke is re-issued so the replacement cannot widen the grant.
    expect(executable(sql)).toMatch(
      /revoke all on function private\.issue_earned_reward_claim\(uuid, text, text, timestamptz\)\s+from public, anon, authenticated, service_role;/i,
    )
  })

  it('backs every gate and anchor claim with live SQL assertions', () => {
    const behavior = executable(behavioralSql)
    const evidence = [
      'Economy access table does not force RLS with select-only API grants',
      'Granted access five weeks ago did not anchor the passport to the grant week',
      'Community Die did not inherit the economy access anchor',
      'A user with no economy access row did not anchor the passport to the claim week',
      'A future economy access grant was not clamped to the claim week',
      'Authenticated economy access update unexpectedly succeeded',
      'Authenticated economy access insert unexpectedly succeeded',
      'Authenticated set_user_economy_access unexpectedly succeeded',
      'Own-row economy access select did not return exactly the caller row',
      'A different authenticated user could read the economy access row',
      'First enable did not stamp economy_access_granted_at',
      'Disable moved or cleared economy_access_granted_at',
      'Re-enable moved economy_access_granted_at',
      'set_user_economy_access validation did not fail closed',
      'set_user_economy_access accepted an unknown user',
      'A rejected economy access decision still mutated the row',
    ]

    for (const message of evidence) {
      expectIfRaise(behavior, message)
    }

    // The nullable-CHECK arms are proved by direct owner DML, so their raises
    // are the unexpected-success guards rather than `if` consequents.
    for (const message of [
      'Economy access enabled without a grant anchor was accepted',
      'Economy access accepted an empty operator name',
      'Economy access accepted an oversized operator note',
    ]) {
      expect(behavior).toContain(`raise exception '${message}'`)
      expect(behavior).toMatch(
        new RegExp(
          `raise exception '${regexEscape(message)}';\\s*exception when check_violation then`,
          'i',
        ),
      )
    }

    // The negative control must fail on an unexpected success, and it compares
    // the sqlstate and the message rather than swallowing any error.
    expect(behavior).toMatch(
      /update public\.user_economy_access\s*set economy_access = true\s*where user_id = 'd0340000-0000-4034-8034-000000000004';\s*raise exception 'Authenticated economy access update unexpectedly succeeded';\s*exception when sqlstate '42501' then/i,
    )
    expect(behavior).toMatch(
      /perform public\.set_user_economy_access\([\s\S]*?\);\s*raise exception 'Authenticated set_user_economy_access unexpectedly succeeded';\s*exception when sqlstate '42501' then/i,
    )
    expect(behavior).toMatch(
      /sqlerrm not like '%set_user_economy_access%'/i,
    )

    // Catch-up is asserted through the untouched derived status projection.
    expect(behavior).toMatch(
      /\(status #>> '\{passport,availableClaimCount\}'\)::integer is distinct from 6/i,
    )
    expect(behavior).toMatch(
      /\(status #>> '\{passport,catchUpClaimCount\}'\)::integer is distinct from 5/i,
    )
    expect(behavior).toMatch(
      /enrollment\.enrolled_period_start is distinct from \(claim_period - 35\)/i,
    )
  })
})
