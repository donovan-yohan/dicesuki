import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { beforeAll, describe, expect, it } from 'vitest'

const migrationPath = resolve(
  process.cwd(),
  'supabase/migrations/0029_standard_banner_activation.sql',
)
const behavioralPath = resolve(
  process.cwd(),
  'supabase/tests/0029_standard_banner_activation.test.sql',
)
const pullRpcPath = resolve(process.cwd(), 'src/lib/pullRpc.ts')
const enginePath = resolve(
  process.cwd(),
  'supabase/migrations/0021_pull_copy_grant_rework.sql',
)
const pityPath = resolve(
  process.cwd(),
  'supabase/migrations/0025_pity_read.sql',
)

let sql = ''
let behavioralSql = ''
let pullRpc = ''
let engineSql = ''
let pitySql = ''

beforeAll(async () => {
  [sql, behavioralSql, pullRpc, engineSql, pitySql] = await Promise.all([
    readFile(migrationPath, 'utf8'),
    readFile(behavioralPath, 'utf8'),
    readFile(pullRpcPath, 'utf8'),
    readFile(enginePath, 'utf8'),
    readFile(pityPath, 'utf8'),
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

function expectIfRaise(source: string, message: string) {
  expect(source).toMatch(
    new RegExp(
      `\\bif\\b[\\s\\S]*?\\bthen\\s+raise exception '${regexEscape(message)}'`,
      'i',
    ),
  )
}

function functionSql(
  source: string,
  schema: 'public' | 'private',
  name: string,
) {
  return (
    source.match(
      new RegExp(
        `create or replace function ${schema}\\.${name}\\([\\s\\S]*?\\n\\$\\$;`,
        'i',
      ),
    )?.[0] ?? ''
  )
}

describe('0029 standard banner activation', () => {
  it('adds only append-only banner data and never replaces an engine body', () => {
    const statements = executable(sql)

    expect(statements).toMatch(
      /insert into public\.pull_banner_versions\s*\([\s\S]*?from public\.pull_banner_versions as source[\s\S]*?source\.id = 'earned-collection-001@1'/i,
    )
    expect(statements).toMatch(
      /'earned-collection-001@2',\s*source\.banner_id,\s*2,\s*source\.banner_family_id/i,
    )
    expect(statements).not.toMatch(/\bcreate\s+(?:or\s+replace\s+)?function\b/i)
    expect(statements).not.toMatch(
      /\b(?:alter|update|delete|merge|truncate)\s+(?:table\s+)?public\.pull_banner/i,
    )
  })

  it('copies the version-1 policy and pool while changing only identity and standard-roll binding', () => {
    expect(sql).toMatch(
      /source_banner\.rare_hard_guarantee_pull is distinct from 8[\s\S]*?source_banner\.epic_hard_guarantee_pull is distinct from 25[\s\S]*?source_banner\.selected_hard_guarantee_pull is distinct from 20/i,
    )
    expect(sql).toMatch(
      /source_banner\.banner_class is distinct from 'standard'[\s\S]*?source_banner\.roll_type is not null/i,
    )
    expect(sql).toMatch(
      /source_banner\.soft_pity_model is not null[\s\S]*?source_banner\.soft_pity_start_pull is not null[\s\S]*?source_banner\.soft_pity_per_pull_increment is not null/i,
    )
    expect(sql).toMatch(
      /source\.resolution_order,\s*'standard',\s*'standard_roll',\s*null,\s*null,\s*null/i,
    )
    expect(sql).toMatch(
      /insert into public\.pull_banner_tiers[\s\S]*?source\.tier_id,[\s\S]*?source\.tier_rank,[\s\S]*?source\.weight_units,[\s\S]*?source\.duplicate_dust[\s\S]*?source\.banner_version_id = 'earned-collection-001@1'/i,
    )
    expect(sql).toMatch(
      /insert into public\.pull_banner_items[\s\S]*?source\.canonical_order,[\s\S]*?source\.catalog_item_id,[\s\S]*?source\.selected_featured[\s\S]*?source\.banner_version_id = 'earned-collection-001@1'/i,
    )
    expect(sql).toMatch(
      /tier_difference_count is distinct from 0::bigint[\s\S]*?item_difference_count is distinct from 0::bigint/i,
    )
    expect(sql).toMatch(
      /pull_banner_tiers[\s\S]*?is distinct from 4::bigint[\s\S]*?sum\(weight_units\)[\s\S]*?is distinct from 100::bigint[\s\S]*?pull_banner_items[\s\S]*?is distinct from 45::bigint[\s\S]*?selected_featured\) is distinct from 6::bigint/i,
    )
  })

  it('replaces Stars prices with exact one- and ten-ticket offers', () => {
    expect(sql).toMatch(
      /insert into public\.pull_banner_offers[\s\S]*?'earned-collection-001@2',\s*source\.pull_count,\s*source\.pull_count::bigint/i,
    )
    expect(sql).toMatch(
      /banner_version_id = target_banner\.id[\s\S]*?pull_count = 1[\s\S]*?cost = 1/i,
    )
    expect(sql).toMatch(
      /banner_version_id = target_banner\.id[\s\S]*?pull_count = 10[\s\S]*?cost = 10/i,
    )
    expect(sql).toMatch(/cost is distinct from pull_count::bigint/i)
  })

  it('matches fetchActiveStandardPullBanner discovery shape and proves the latest result', () => {
    const discovery =
      pullRpc.match(
        /export async function fetchActiveStandardPullBanner\([\s\S]*?\n}\n/,
      )?.[0] ?? ''
    const behavior = executable(behavioralSql)

    expect(discovery).not.toBe('')
    expect(discovery).toMatch(
      /\.from\('pull_banner_versions'\)\s*\.select\('id, banner_id, banner_version, banner_family_id, banner_class, roll_type'\)\s*\.eq\('banner_class', 'standard'\)\s*\.eq\('roll_type', 'standard_roll'\)\s*\.order\('banner_version', \{ ascending: false \}\)/i,
    )
    expect(behavior).toMatch(
      /select\s+id,\s*banner_id,\s*banner_version,\s*banner_family_id,\s*banner_class,\s*roll_type\s+from public\.pull_banner_versions\s+where banner_class = 'standard'\s+and roll_type = 'standard_roll'\s+order by banner_version desc/i,
    )
    expectIfRaise(
      behavior,
      'Standard discovery query did not return active earned-collection-001@3',
    )
  })

  it('keeps family-scoped pity continuity and legacy/premium engine behavior intact', () => {
    const prepare = functionSql(engineSql, 'private', 'prepare_pull_for_user')
    const commit = functionSql(engineSql, 'private', 'commit_pull_session_for_user')
    const pity = functionSql(pitySql, 'private', 'get_pull_pity_for_user')

    expect(prepare).toMatch(
      /if banner\.roll_type is null then[\s\S]*?from public\.wallet_balances/i,
    )
    expect(prepare).toMatch(
      /else[\s\S]*?target_cost <> p_pull_count::bigint[\s\S]*?from public\.roll_ticket_balances/i,
    )
    expect(prepare).toMatch(
      /from public\.pull_guarantee_states[\s\S]*?banner_family_id = banner\.banner_family_id/i,
    )
    expect(prepare).toContain(
      'Premium banner preparation is disabled pending issue #154',
    )
    expect(commit).toMatch(
      /record_roll_ticket_ledger_entry\([\s\S]*?'standard_roll',\s*-target_session\.held_amount/i,
    )
    expect(commit).toMatch(
      /insert into public\.pull_guarantee_states[\s\S]*?target_session\.banner_family_id[\s\S]*?on conflict \(account_id, banner_family_id\) do update/i,
    )
    expect(commit).toMatch(
      /public\.record_dice_copy_grant\([\s\S]*?'pull'/i,
    )
    expect(commit).toContain(
      'Premium banner commit is disabled pending issue #154',
    )
    expect(pity).toMatch(
      /select max\(versions\.banner_version\)[\s\S]*?versions\.banner_family_id = p_banner_family_id/i,
    )
  })

  it('backs every activation claim with behavioral and NULL-hole assertions', () => {
    const behavior = executable(behavioralSql)
    const evidence = [
      'Standard discovery query did not return active earned-collection-001@3',
      'Legacy Stars-funded version @1 did not prepare and commit under NULL roll binding',
      'Version @2 did not reserve ten standard-roll tickets without touching Stars',
      'Version @2 did not continue every family counter from version @1',
      'Version @2 commit did not grant ten copies and debit exactly ten tickets',
      'Pity read did not expose active version @3 counters, shallow thresholds, and NULL soft pity',
      'Premium preparation no longer failed closed',
      'Standard activation NULL-hole audit failed',
    ]

    for (const message of evidence) {
      expectIfRaise(behavior, message)
    }
    expect(behavior).toMatch(
      /soft_pity_model is not null[\s\S]*?soft_pity_start_pull is not null[\s\S]*?soft_pity_per_pull_increment is not null/i,
    )
    expect(behavior).toMatch(
      /row\(\s*new_session\.total_pulls_before,[\s\S]*?new_session\.selected_misses_before\s*\)\s+is distinct from row\(/i,
    )
    expect(behavior).toMatch(
      /exception when sqlstate '55000' then/i,
    )
    expect(behavior).toMatch(
      /set local role authenticated;\s*create temporary table slice20_lifecycle_ctx[\s\S]*?insert into pg_temp\.slice20_lifecycle_ctx[\s\S]*?update pg_temp\.slice20_lifecycle_ctx[\s\S]*?reset role;/i,
    )
  })
})
