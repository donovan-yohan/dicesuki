import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { beforeAll, describe, expect, it } from 'vitest'

const migrationPath = resolve(
  process.cwd(),
  'supabase/migrations/0032_earned_economy_dice_content_wave_1.sql',
)
const catalogMigrationPath = resolve(
  process.cwd(),
  'supabase/migrations/0031_catalog_dice_content_wave_1.sql',
)
const behavioralPath = resolve(
  process.cwd(),
  'supabase/tests/0032_earned_economy_dice_content_wave_1.test.sql',
)
const engineMigrationPath = resolve(
  process.cwd(),
  'supabase/migrations/0030_earned_economy_rare_pity_10.sql',
)

let sql = ''
let catalogSql = ''
let behavioralSql = ''
let engineSql = ''

beforeAll(async () => {
  [sql, catalogSql, behavioralSql, engineSql] = await Promise.all([
    readFile(migrationPath, 'utf8'),
    readFile(catalogMigrationPath, 'utf8'),
    readFile(behavioralPath, 'utf8'),
    readFile(engineMigrationPath, 'utf8'),
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

describe('0032 earned economy dice content wave 1', () => {
  it('appends version 4 from immutable version 3 without mutating banner history', () => {
    const statements = executable(sql)

    expect(statements).toMatch(
      /insert into public\.pull_banner_versions\s*\([\s\S]*?from public\.pull_banner_versions as source[\s\S]*?source\.id = 'earned-collection-001@3'/i,
    )
    expect(statements).toMatch(
      /'earned-collection-001@4',\s*source\.banner_id,\s*4,\s*source\.banner_family_id/i,
    )
    expect(statements).not.toMatch(
      /\b(?:alter|update|delete|merge|truncate)\s+(?:table\s+)?public\.pull_banner/i,
    )
    expect(statements).not.toMatch(
      /\b(?:update|delete|truncate)\s+(?:table\s+)?public\.pull_guarantee_states/i,
    )
    expect(statements).not.toMatch(
      /\b(?:update|delete|truncate)\s+(?:table\s+)?public\.economy_editions/i,
    )
  })

  it('changes nothing that requires a function, reusing the 0030 active-version guard', () => {
    const statements = executable(sql)

    // The retirement of version 3 is a consequence of appending version 4, not
    // of new code: 0030 already restricted preparation to a family's head, and
    // it resolves that head dynamically.
    expect(statements).not.toMatch(/\bcreate\s+(?:or\s+replace\s+)?function\b/i)
    expect(statements).not.toMatch(/\bcreate\s+(?:or\s+replace\s+)?(?:view|trigger|policy)\b/i)
    expect(engineSql).toMatch(
      /if banner\.banner_version is distinct from active_banner_version then\s*raise exception 'Pull banner version % is superseded by version % of family %'/i,
    )
    expectIfRaise(
      executable(behavioralSql),
      'Superseded version 3 is still player-callable',
    )
    expectIfRaise(
      executable(behavioralSql),
      'The superseded version 3 rejection still reserved tickets',
    )
  })

  it('carries every guarantee boundary and tier weight across the expansion', () => {
    // The rare/epic/selected boundaries and the 72/23/4/1 weights are copied,
    // never restated as literals on the insert, so only membership can move.
    expect(sql).toMatch(
      /source_banner\.rare_hard_guarantee_pull is distinct from 10[\s\S]*?source_banner\.epic_hard_guarantee_pull is distinct from 25[\s\S]*?source_banner\.selected_hard_guarantee_pull is distinct from 20/i,
    )
    expect(sql).toMatch(
      /source\.rare_minimum_rank,\s*source\.rare_hard_guarantee_pull,\s*source\.epic_minimum_rank,\s*source\.epic_hard_guarantee_pull/i,
    )
    expect(sql).toMatch(
      /target_banner\.rare_hard_guarantee_pull is distinct from 10[\s\S]*?target_banner\.epic_hard_guarantee_pull is distinct from 25[\s\S]*?target_banner\.selected_hard_guarantee_pull is distinct from 20/i,
    )
    expect(sql).toMatch(/tier_difference_count is distinct from 0::bigint/i)
    expectIfRaise(
      executable(sql),
      'earned-collection-001@4 policy drifted beyond the wave-1 pool expansion',
    )
    expectIfRaise(
      executable(behavioralSql),
      'Wave-1 expansion changed a standard banner tier weight',
    )
  })

  it('derives the pool from the edition of record and proves it is purely additive', () => {
    const statements = executable(sql)

    // Items come from the pinned edition JSON, the same way 0011 seeded
    // version 1, rather than from a copy-and-patch of version 3's rows.
    expect(statements).toMatch(
      /insert into public\.pull_banner_items[\s\S]*?jsonb_array_elements_text\(tier_record\.tier -> 'catalogItemIds'\)\s*with ordinality/i,
    )
    expect(statements).toMatch(
      /selectedFeaturedUnowned', 'catalogItemIds'\s*\]\) \? item\.catalog_item_id/i,
    )
    // Nothing retired, exactly 36 rows added (rare +18, epic +12, signature +6).
    expect(statements).toMatch(
      /retired_item_count is distinct from 0::bigint[\s\S]*?added_item_count is distinct from 36::bigint/i,
    )
    expect(statements).toMatch(
      /tier_id = 'standard'\) is distinct from 24::bigint[\s\S]*?tier_id = 'rare'\) is distinct from 27::bigint[\s\S]*?tier_id = 'epic'\) is distinct from 18::bigint[\s\S]*?tier_id = 'signature'\) is distinct from 12::bigint/i,
    )
    expect(statements).toMatch(/selected_featured\) is distinct from 12::bigint/i)
    expectIfRaise(
      executable(behavioralSql),
      'Version 4 pools are not the reviewed 24/27/18/12 expansion',
    )
    expectIfRaise(
      executable(behavioralSql),
      'Version 3 changed while appending the wave-1 pool',
    )
  })

  it('binds every pooled die to its tier rarity on both sides of the boundary', () => {
    const statements = executable(sql)

    expect(statements).toMatch(
      /when 'standard' then array\['common', 'uncommon'\][\s\S]*?when 'rare' then array\['rare'\][\s\S]*?when 'epic' then array\['epic'\][\s\S]*?when 'signature' then array\['legendary'\]/i,
    )
    // coalesce keeps an unrecognized tier id counted rather than NULL-erased.
    expect(statements).toMatch(
      /not \(catalog\.rarity = any \(coalesce\(/i,
    )
    expect(statements).toMatch(/mistiered_item_count is distinct from 0::bigint/i)
    expectIfRaise(
      executable(behavioralSql),
      'A version 4 pool item does not match its tier rarity',
    )
  })

  it('keeps the reserved premium featured set out of every standard pool', () => {
    expectIfRaise(
      executable(sql),
      'earned-collection@3 leaked the reserved premium featured set into a standard tier',
    )
    expect(executable(sql)).toMatch(
      /catalog_item_id like 'ten-thousand-folds\/%'/i,
    )
    expectIfRaise(
      executable(behavioralSql),
      'The reserved premium featured set leaked into a pull banner',
    )

    // The set still ships in the catalog; only its banner membership is held
    // back, so the premium slice has something to feature.
    expect(catalogSql).toMatch(
      /\('ten-thousand-folds\/d20\/legendary@1', 'ten-thousand-folds\/d20\/legendary', 1, 'die', 'ten-thousand-folds', 'd20', 'legendary'\)/i,
    )
  })

  it('appends the production edition of record instead of re-attesting version 3', () => {
    const editionSource = readFileSync(
      resolve(process.cwd(), 'economy/production/editions/0003-earned-collection.json'),
      'utf8',
    )
    const edition = JSON.parse(editionSource)
    const sha256 = createHash('sha256')
      .update(JSON.stringify(edition))
      .digest('hex')

    expect(edition).toMatchObject({
      edition: 3,
      editionId: 'earned-collection@3',
      slug: 'earned-collection',
      purpose: 'production',
      migration: '0032_earned_economy_dice_content_wave_1.sql',
    })

    // The migration embeds the byte-identical edition and pins its exact hash.
    const embedded = sql.match(
      /-- BEGIN EARNED ECONOMY EDITION 0003\s*\$edition\$([\s\S]*?)\$edition\$::jsonb\s*-- END EARNED ECONOMY EDITION 0003/,
    )
    expect(embedded).not.toBeNull()
    expect(JSON.stringify(JSON.parse(embedded![1]))).toBe(JSON.stringify(edition))
    expect(sql).toMatch(
      new RegExp(`expected_sha256 constant text :=\\s*'${sha256}'`),
    )
    expect(sql).toMatch(
      /insert into public\.economy_editions[\s\S]*?\('earned-collection@3', 3, expected_sha256, expected_config\)/i,
    )

    // Version 4 attests the appended edition, never version 3's source hash.
    expect(sql).toMatch(
      new RegExp(
        `source\\.banner_family_id,\\s*'earned-collection@3',\\s*'${sha256}',`,
        'i',
      ),
    )
    expect(sql).not.toMatch(/source\.source_config_sha256,/i)
    expectIfRaise(
      executable(sql),
      'earned-collection-001@4 is not anchored to the wave-1 economy edition',
    )
    expectIfRaise(
      executable(behavioralSql),
      'Version 4 is not anchored to the appended wave-1 economy edition',
    )
  })

  it('backs the shipped catalog payload and the new signature draw with live SQL', () => {
    const behavior = executable(behavioralSql)

    for (const message of [
      'Wave-1 set % did not publish six single-rarity dice',
      'Wave-1 set % did not publish its authored d20 appearance',
      'Wave-1 set % did not join its reviewed tier',
      'Standard discovery did not activate earned-collection-001@4',
      'Active version 4 did not prepare after the superseded rejection',
      'The selected-featured guarantee did not award the new signature die',
    ]) {
      expectIfRaise(behavior, message)
    }

    // Adding Stormglass to the signature tier moves the lowest-canonical-id
    // unowned featured die below every void-crystal id, so the 20-pull selected
    // guarantee is the decisive proof that the new set is drawable.
    expect(behavior).toMatch(
      /selected_misses[\s\S]*?19[\s\S]*?prepare_pull\(\s*'earned-collection-001@4',\s*1::smallint/i,
    )
    expect(behavior).toMatch(
      /sealed\.resolution_reason is distinct from 'selected-guarantee'[\s\S]*?sealed\.catalog_item_id is distinct from 'stormglass\/d10\/legendary@1'/i,
    )
  })
})
