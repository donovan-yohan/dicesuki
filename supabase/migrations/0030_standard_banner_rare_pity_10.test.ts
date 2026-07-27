import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { beforeAll, describe, expect, it } from 'vitest'

const migrationPath = resolve(
  process.cwd(),
  'supabase/migrations/0030_standard_banner_rare_pity_10.sql',
)
const behavioralPath = resolve(
  process.cwd(),
  'supabase/tests/0030_standard_banner_rare_pity_10.test.sql',
)
const pullRpcPath = resolve(process.cwd(), 'src/lib/pullRpc.ts')
const pityPath = resolve(
  process.cwd(),
  'supabase/migrations/0025_pity_read.sql',
)

let sql = ''
let behavioralSql = ''
let pullRpc = ''
let pitySql = ''

beforeAll(async () => {
  [sql, behavioralSql, pullRpc, pitySql] = await Promise.all([
    readFile(migrationPath, 'utf8'),
    readFile(behavioralPath, 'utf8'),
    readFile(pullRpcPath, 'utf8'),
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

describe('0030 standard banner rare pity 10', () => {
  it('appends version 3 from immutable version 2 without mutating banner history', () => {
    const statements = executable(sql)

    expect(statements).toMatch(
      /insert into public\.pull_banner_versions\s*\([\s\S]*?from public\.pull_banner_versions as source[\s\S]*?source\.id = 'earned-collection-001@2'/i,
    )
    expect(statements).toMatch(
      /'earned-collection-001@3',\s*source\.banner_id,\s*3,\s*source\.banner_family_id/i,
    )
    expect(statements).not.toMatch(/\bcreate\s+(?:or\s+replace\s+)?function\b/i)
    expect(statements).not.toMatch(
      /\b(?:alter|update|delete|merge|truncate)\s+(?:table\s+)?public\.pull_banner/i,
    )
    expect(statements).not.toMatch(
      /\b(?:update|delete|truncate)\s+(?:table\s+)?public\.pull_guarantee_states/i,
    )
  })

  it('changes only rare hard pity to 10 and retains epic 25 and selected 20', () => {
    expect(sql).toMatch(
      /source_banner\.rare_hard_guarantee_pull is distinct from 8[\s\S]*?source_banner\.epic_hard_guarantee_pull is distinct from 25[\s\S]*?source_banner\.selected_hard_guarantee_pull is distinct from 20/i,
    )
    expect(sql).toMatch(
      /source\.rare_minimum_rank,\s*10,\s*source\.epic_minimum_rank,\s*source\.epic_hard_guarantee_pull/i,
    )
    expect(sql).toMatch(
      /target_banner\.rare_hard_guarantee_pull is distinct from 10[\s\S]*?target_banner\.epic_hard_guarantee_pull is distinct from 25[\s\S]*?target_banner\.selected_hard_guarantee_pull is distinct from 20/i,
    )
    expectIfRaise(
      executable(sql),
      'earned-collection-001@3 policy drifted beyond rare pity 10',
    )
  })

  it('byte-copies version 2 offers, tiers, and items in both directions', () => {
    expect(sql).toMatch(
      /insert into public\.pull_banner_offers[\s\S]*?'earned-collection-001@3',\s*source\.pull_count,\s*source\.cost[\s\S]*?source\.banner_version_id = 'earned-collection-001@2'/i,
    )
    expect(sql).toMatch(
      /insert into public\.pull_banner_tiers[\s\S]*?source\.weight_units,[\s\S]*?source\.duplicate_dust[\s\S]*?source\.banner_version_id = 'earned-collection-001@2'/i,
    )
    expect(sql).toMatch(
      /insert into public\.pull_banner_items[\s\S]*?source\.canonical_order,[\s\S]*?source\.catalog_item_id,[\s\S]*?source\.selected_featured[\s\S]*?source\.banner_version_id = 'earned-collection-001@2'/i,
    )
    expect(sql).toMatch(
      /offer_difference_count is distinct from 0::bigint[\s\S]*?tier_difference_count is distinct from 0::bigint[\s\S]*?item_difference_count is distinct from 0::bigint/i,
    )
  })

  it('uses the existing highest-version activation mechanism', () => {
    const discovery =
      pullRpc.match(
        /export async function fetchActiveStandardPullBanner\([\s\S]*?\n}\n/,
      )?.[0] ?? ''

    expect(discovery).toMatch(
      /\.eq\('banner_class', 'standard'\)\s*\.eq\('roll_type', 'standard_roll'\)\s*\.order\('banner_version', \{ ascending: false \}\)/i,
    )
    expect(discovery).toMatch(
      /candidates\.sort\(\(a, b\) => \(\s*b\.bannerVersion - a\.bannerVersion/i,
    )
    expect(pitySql).toMatch(
      /select max\(versions\.banner_version\)[\s\S]*?versions\.banner_family_id = p_banner_family_id/i,
    )
    expectIfRaise(
      executable(behavioralSql),
      'Standard discovery did not activate earned-collection-001@3',
    )
  })

  it('backs the 10/25 boundaries and untouched version 2 with live SQL assertions', () => {
    const behavior = executable(behavioralSql)
    const evidence = [
      'Version 2 changed while appending rare pity version 3',
      'Rare guarantee fired at pull 8 under version 3',
      'Rare guarantee did not fire at pull 10 under version 3',
      'Epic guarantee did not fire at pull 25 under version 3',
      'Pity read did not expose active version 3 thresholds and carried counters',
    ]

    for (const message of evidence) {
      expectIfRaise(behavior, message)
    }
    expect(behavior).toMatch(
      /select resolution_reason[\s\S]*?where user_id = 'd0300000-0000-4030-8030-000000000008'[\s\S]*?is distinct from 'base'/i,
    )
    expect(behavior).toMatch(
      /select resolution_reason[\s\S]*?where user_id = 'd0300000-0000-4030-8030-000000000010'[\s\S]*?is distinct from 'rare-guarantee'/i,
    )
    expect(behavior).toMatch(
      /select resolution_reason[\s\S]*?where user_id = 'd0300000-0000-4030-8030-000000000025'[\s\S]*?is distinct from 'epic-guarantee'/i,
    )
  })
})
