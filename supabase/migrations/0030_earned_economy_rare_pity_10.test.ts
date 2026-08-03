import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { beforeAll, describe, expect, it } from 'vitest'

const migrationPath = resolve(
  process.cwd(),
  'supabase/migrations/0030_earned_economy_rare_pity_10.sql',
)
const behavioralPath = resolve(
  process.cwd(),
  'supabase/tests/0030_earned_economy_rare_pity_10.test.sql',
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

/**
 * Bind a raise to *its own* guard. `[^;]` cannot cross a statement boundary --
 * no plpgsql IF condition contains a semicolon -- so the match starts at the
 * `if` that actually raises rather than at any earlier one in the file. The
 * unbounded `[\s\S]*?` this replaced made the helper a mere presence check: it
 * still matched after a guard had been hollowed out to `if false then`.
 */
function expectIfRaise(source: string, message: string) {
  expect(source).toMatch(
    new RegExp(
      `\\bif\\b[^;]*?\\bthen\\s+raise exception '${regexEscape(message)}'`,
      'i',
    ),
  )
}

describe('0030 earned economy rare pity 10', () => {
  it('appends version 3 from immutable version 2 without mutating banner history', () => {
    const statements = executable(sql)

    expect(statements).toMatch(
      /insert into public\.pull_banner_versions\s*\([\s\S]*?from public\.pull_banner_versions as source[\s\S]*?source\.id = 'earned-collection-001@2'/i,
    )
    expect(statements).toMatch(
      /'earned-collection-001@3',\s*source\.banner_id,\s*3,\s*source\.banner_family_id/i,
    )
    expect(
      statements.match(/\bcreate\s+or\s+replace\s+function\s+([a-z_.]+)\(/gi),
    ).toEqual(['create or replace function private.prepare_pull_for_user('])
    expect(statements).not.toMatch(/\bcreate\s+function\b/i)
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
      'Standard discovery did not activate earned-collection-001@4',
    )
  })

  it('backs the 10/25 boundaries and untouched version 2 with live SQL assertions', () => {
    const behavior = executable(behavioralSql)
    // 0032_earned_economy_dice_content_wave_1.sql carried these boundaries
    // unchanged into version 4 and retired version 3 from the player path, so
    // the behavioral suite proves them on the version a player can prepare.
    const evidence = [
      'Version 2 changed while appending rare pity version 3',
      'Rare guarantee fired at pull 8 under version 4',
      'Rare guarantee fired at pull 9 under version 4',
      'Rare guarantee did not fire at pull 10 under version 4',
      'Epic guarantee did not fire at pull 25 under version 4',
      'Pity read did not expose active version 4 thresholds and carried counters',
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
  it('appends the production edition of record instead of re-attesting version 2', () => {
    const editionSource = readFileSync(
      resolve(process.cwd(), 'economy/production/editions/0002-earned-collection.json'),
      'utf8',
    )
    const edition = JSON.parse(editionSource)
    const sha256 = createHash('sha256')
      .update(JSON.stringify(edition))
      .digest('hex')

    expect(edition).toMatchObject({
      edition: 2,
      editionId: 'earned-collection@2',
      slug: 'earned-collection',
      purpose: 'production',
      migration: '0030_earned_economy_rare_pity_10.sql',
    })
    expect(
      edition.acquisition.banner.guarantees.rareOrBetter.hardGuaranteePull,
    ).toBe(10)

    // The migration embeds the byte-identical edition and pins its exact hash.
    const embedded = sql.match(
      /-- BEGIN EARNED ECONOMY EDITION 0002\s*\$edition\$([\s\S]*?)\$edition\$::jsonb\s*-- END EARNED ECONOMY EDITION 0002/,
    )
    expect(embedded).not.toBeNull()
    expect(JSON.stringify(JSON.parse(embedded![1]))).toBe(JSON.stringify(edition))
    expect(sql).toMatch(
      new RegExp(`expected_sha256 constant text :=\\s*'${sha256}'`),
    )
    expect(sql).toMatch(
      /insert into public\.economy_editions[\s\S]*?\('earned-collection@2', 2, expected_sha256, expected_config\)/i,
    )

    // Version 3 attests the appended edition, never version 2's source hash.
    expect(sql).toMatch(
      new RegExp(
        `source\\.banner_family_id,\\s*'earned-collection@2',\\s*'${sha256}',`,
        'i',
      ),
    )
    expect(sql).not.toMatch(/source\.source_config_sha256,/i)
    expectIfRaise(
      executable(sql),
      'earned-collection-001@3 is not anchored to the 10-pull economy edition',
    )
    expectIfRaise(
      executable(behavioralSql),
      'Version 3 is not anchored to the appended 10-pull economy edition',
    )
    expectIfRaise(
      executable(behavioralSql),
      'Economy edition earned-collection@2 is not the 10-pull edition of record',
    )
  })

  it('retires every superseded version of a family from the player path', () => {
    const statements = executable(sql)
    const engine = statements.slice(
      statements.indexOf('create or replace function private.prepare_pull_for_user('),
    )

    // The guard resolves the family head exactly the way the pity read does,
    // and lives in the trusted engine rather than the public wrapper.
    expect(engine).toMatch(
      /select max\(versions\.banner_version\)\s*into active_banner_version\s*from public\.pull_banner_versions as versions\s*where versions\.banner_family_id = banner\.banner_family_id;/i,
    )
    expectIfRaise(engine, 'Ambiguous active pull banner version for family %')
    expect(engine).toMatch(
      /if banner\.banner_version is distinct from active_banner_version then\s*raise exception 'Pull banner version % is superseded by version % of family %',\s*banner\.id, active_banner_version, banner\.banner_family_id\s*using errcode = '55000';/i,
    )

    // Fail closed before the account lock, so a rejection can never reserve.
    expect(engine.indexOf('is superseded by version'))
      .toBeLessThan(engine.indexOf('private.lock_wallet_account'))

    // Commit/reveal semantics are untouched: sessions store their banner at
    // preparation, so blocking at prepare is sufficient.
    expect(statements).not.toMatch(/commit_pull_session_for_user/i)
    expect(statements).not.toMatch(/get_committed_pull_reveal_for_user/i)

    for (const message of [
      'Superseded version 1 is still player-callable',
      'Superseded version 2 is still player-callable',
      'A rejected superseded preparation still reserved funds',
      'Active version 4 did not prepare after the superseded rejections',
    ]) {
      expectIfRaise(executable(behavioralSql), message)
    }
  })
})
