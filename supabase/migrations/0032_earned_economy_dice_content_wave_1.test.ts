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

/**
 * Assert a guard, in two halves a caller cannot accidentally split.
 *
 * The message half proves the raise is the consequent of an `if` in the *same*
 * statement: `[^;]` cannot cross a plpgsql statement boundary and no IF
 * condition contains a semicolon, so it cannot bind to some earlier `if` in the
 * file. That is all it proves. On its own it still matches a guard hollowed out
 * to `if false then`, because `if false then` contains no semicolon either.
 *
 * `condition` is therefore required, not optional: a literal that appears only
 * in this guard's real predicate. Hollowing the predicate deletes that literal
 * and fails the test. Making it a parameter rather than a convention is the
 * point -- a call site physically cannot omit the half that does the work.
 */
function expectIfRaise(source: string, message: string, condition: RegExp) {
  expect(source).toMatch(
    new RegExp(
      `\\bif\\b[^;]*?\\bthen\\s+raise exception '${regexEscape(message)}'`,
      'i',
    ),
  )
  expect(source).toMatch(condition)
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
      /sqlerrm is distinct from\s*'Pull banner version earned-collection-001@3 is superseded by version 4 '/i,
    )
    expectIfRaise(
      executable(behavioralSql),
      'The superseded version 3 rejection still reserved tickets',
      /roll_type = 'standard_roll'\) is distinct from 2::bigint/i,
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
      /target_banner\.banner_version is distinct from 4/i,
    )
    expectIfRaise(
      executable(behavioralSql),
      'Wave-1 expansion changed a standard banner tier weight',
      /jsonb_build_object\(\s*'standard', 72, 'rare', 23, 'epic', 4, 'signature', 1\s*\)/i,
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

    const behavior = executable(behavioralSql)
    expectIfRaise(
      behavior,
      'Version 4 pools are not the reviewed 24/27/18/12 expansion',
      /jsonb_build_object\(\s*'standard', 24, 'rare', 27, 'epic', 18, 'signature', 12\s*\)/i,
    )
    expectIfRaise(
      behavior,
      'Version 3 changed while appending the wave-1 pool',
      /banner_version_id = 'earned-collection-001@3'\) is distinct from 45::bigint/i,
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
      /not \(catalog\.rarity = any \(coalesce\([\s\S]{0,400}?when 'signature' then array\['legendary'\]/i,
    )
  })

  it('keeps the reserved premium featured set out of every standard pool', () => {
    expectIfRaise(
      executable(sql),
      'earned-collection@3 leaked the reserved premium featured set into a standard tier',
      /item\.catalog_item_id like 'ten-thousand-folds\/%'/i,
    )
    expectIfRaise(
      executable(behavioralSql),
      'The reserved premium featured set leaked into a pull banner',
      /catalog\.set_id = 'ten-thousand-folds'/i,
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
      /target_banner\.economy_edition_id is distinct from 'earned-collection@3'/i,
    )
    expectIfRaise(
      executable(behavioralSql),
      'Version 4 is not anchored to the appended wave-1 economy edition',
      /version_4\.source_config_sha256 is distinct from edition_3\.config_sha256/i,
    )
  })

  it('backs the shipped catalog payload and the new signature draw with live SQL', () => {
    const behavior = executable(behavioralSql)

    const guards: [string, RegExp][] = [
      [
        'Wave-1 set % did not publish six single-rarity dice',
        /count\(distinct dice_type\)[\s\S]{0,200}?is distinct from 6::bigint/i,
      ],
      [
        'Wave-1 set % did not publish its authored d20 appearance',
        /metadata -> 'appearance' ->> 'baseColor'\s*[\s\S]{0,300}?is distinct from wave_set\.base_color/i,
      ],
      [
        'Wave-1 set % did not join its reviewed tier',
        /catalog\.set_id = wave_set\.set_id\s*and items\.tier_id = wave_set\.tier_id\) is distinct from 6::bigint/i,
      ],
      [
        'Standard discovery did not activate earned-collection-001@4',
        /active_banner\.economy_edition_id is distinct from 'earned-collection@3'/i,
      ],
      [
        'Active version 4 did not prepare after the superseded rejection',
        /prepared\.banner_version_id is distinct from 'earned-collection-001@4'/i,
      ],
      [
        // Unique to the pull-20 block: the banked block below asserts the same
        // resolution and item, but never the selected *target*. Literal pins
        // degrade as blocks are cloned, so each one anchors on something only
        // its own block contains.
        'The selected-featured guarantee did not award the new signature die',
        /sealed\.selected_target_catalog_item_id is distinct from\s*'stormglass\/d10\/legendary@1'/i,
      ],
    ]

    for (const [message, condition] of guards) {
      expectIfRaise(behavior, message, condition)
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

  it('pins the banked selected-pity discharge this migration hands existing owners', () => {
    const behavior = executable(behavioralSql)

    // A player who already owned all six version-3 featured dice had no
    // eligible guarantee target, so their selected_misses grew without bound.
    // Version 4 gives them one and the banked guarantee pays out immediately.
    // The migration deliberately does not rewrite pull_guarantee_states, so
    // this is emergent runtime behavior that only a live assertion can hold.
    //
    // The precondition mirrors the engine's own target selection against @3,
    // so it proves *why* the counter banked rather than merely counting copies.
    expectIfRaise(
      behavior,
      'The banked-pity fixture still had a reachable version-3 guarantee target',
      /items\.banner_version_id = 'earned-collection-001@3'\s*and items\.selected_featured\s*and not exists/i,
    )
    expectIfRaise(
      behavior,
      'Banked selected pity did not discharge onto the expanded featured pool',
      /sealed\.selected_misses_before is distinct from 40::bigint[\s\S]{0,200}?sealed\.selected_misses_after is distinct from 0::bigint/i,
    )

    // The counters themselves are never rewritten -- confiscating earned pity
    // would be the wrong fix for a player-favorable discharge.
    expect(executable(sql)).not.toMatch(
      /\b(?:update|delete|insert into|truncate)\s+(?:table\s+)?public\.pull_guarantee_states/i,
    )
    // Doc-presence pins only: the header block is the artifact a future author
    // reads before touching guarantee state. Both effects must stay recorded --
    // the target reassignment hits a far larger cohort than the discharge, and
    // it was the effect most easily left out.
    expect(sql).toMatch(/RUNTIME EFFECTS ON EXISTING PLAYERS/)
    expect(sql).toMatch(/guarantee target silently moves/)
    expect(sql).toMatch(/Banked pity discharges/)
  })
})
