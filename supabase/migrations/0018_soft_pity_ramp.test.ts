import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { beforeAll, describe, expect, it } from 'vitest'

const migrationPath = resolve(
  process.cwd(),
  'supabase/migrations/0018_soft_pity_ramp.sql',
)
const canonicalPath = resolve(
  process.cwd(),
  'supabase/migrations/0017_pull_commit_reveal.sql',
)
const helperPath = resolve(
  process.cwd(),
  'supabase/migrations/0011_earned_pull_preparation.sql',
)

let sql = ''
let canonicalSql = ''
let helperSql = ''

beforeAll(async () => {
  [sql, canonicalSql, helperSql] = await Promise.all([
    readFile(migrationPath, 'utf8'),
    readFile(canonicalPath, 'utf8'),
    readFile(helperPath, 'utf8'),
  ])
})

function functionSqlFrom(
  source: string,
  schema: 'public' | 'private',
  name: string,
) {
  return source.match(
    new RegExp(`create or replace function ${schema}\\.${name}\\([\\s\\S]*?\\n\\$\\$;`, 'i'),
  )?.[0] ?? ''
}

function drawRegion(source: string) {
  return source.match(
    / {4}if selected_due then[\s\S]*?(?=\n\n {4}result_is_duplicate)/,
  )?.[0] ?? ''
}

function normalTierItemDraw(source: string) {
  return source.match(
    / {6}if epic_due then\n {8}minimum_rank := banner\.epic_minimum_rank;[\s\S]*? {6}order by items\.canonical_order\n {6}offset item_draw\n {6}limit 1;/,
  )?.[0] ?? ''
}

describe('0018 dormant soft-pity ramp', () => {
  it('adds nullable dormant columns with all-or-none and bounded values', () => {
    expect(sql).toMatch(
      /alter table public\.pull_banner_versions[\s\S]*?add column soft_pity_model text null,[\s\S]*?add column soft_pity_start_pull integer null,[\s\S]*?add column soft_pity_per_pull_increment numeric null/i,
    )
    expect(sql).not.toMatch(/soft_pity_(?:model|start_pull|per_pull_increment)[^,;\n]*default/i)
    expect(sql).not.toMatch(/update\s+public\.pull_banner_versions/i)
    expect(sql).toMatch(
      /pull_banner_versions_soft_pity_model[\s\S]*?soft_pity_model is null or\s+soft_pity_model = 'linear-rate-ramp'/i,
    )
    expect(sql).toMatch(
      /pull_banner_versions_soft_pity_all_or_none[\s\S]*?soft_pity_model is null and\s+soft_pity_start_pull is null and\s+soft_pity_per_pull_increment is null[\s\S]*?soft_pity_model = 'linear-rate-ramp' and\s+soft_pity_start_pull is not null and\s+soft_pity_start_pull > 1 and\s+soft_pity_per_pull_increment is not null and\s+soft_pity_per_pull_increment > 0/i,
    )
    expect(sql).toMatch(
      /soft_pity_per_pull_increment not in \(\s*'NaN'::numeric,\s*'Infinity'::numeric,\s*'-Infinity'::numeric\s*\)/i,
    )
  })

  it('requires a configured ramp to start before selected hard pity', () => {
    expect(sql).toMatch(
      /pull_banner_versions_soft_pity_before_hard_guarantee[\s\S]*?soft_pity_model is null or \([\s\S]*?selected_hard_guarantee_pull is not null and\s+soft_pity_start_pull < selected_hard_guarantee_pull/i,
    )
  })

  it('replaces the inherited sealed-result reason check and admits soft pity', () => {
    const replacement = sql.match(
      /alter table public\.sealed_pull_results[\s\S]*?;/i,
    )?.[0] ?? ''

    expect(helperSql).toMatch(
      /create table public\.sealed_pull_results[\s\S]*?resolution_reason\s+text\s+not null check \(/i,
    )
    expect(replacement).toMatch(
      /drop constraint sealed_pull_results_resolution_reason_check/i,
    )
    expect(replacement).toMatch(
      /add constraint sealed_pull_results_resolution_reason_check/i,
    )
    for (const reason of [
      'base',
      'rare-guarantee',
      'epic-guarantee',
      'selected-guarantee',
      'soft-pity',
    ]) {
      expect(replacement).toContain(`'${reason}'`)
    }
  })

  it('extends the inherited seeded helper with one domain-separated draw label', () => {
    const inherited = functionSqlFrom(
      helperSql,
      'private',
      'pull_seeded_uint32_below',
    )
    const extended = functionSqlFrom(
      sql,
      'private',
      'pull_seeded_uint32_below',
    )

    expect(extended).toContain("('tier', 'item', 'soft-pity-upgrade')")
    expect(
      extended.replace(
        "('tier', 'item', 'soft-pity-upgrade')",
        "('tier', 'item')",
      ),
    ).toBe(inherited)
  })

  it('gates the upgrade on an unowned selected item, ramp start, and hard-pity miss', () => {
    const prepare = functionSqlFrom(sql, 'private', 'prepare_pull_for_user')
    const upgrade = prepare.match(
      /if not selected_due and[\s\S]*?end if;\n {6}end if;\n\n {6}-- Keep this canonical 0017 block/i,
    )?.[0] ?? ''

    expect(upgrade).toMatch(/banner\.soft_pity_model = 'linear-rate-ramp'/i)
    expect(upgrade).toMatch(/selected_item\.catalog_item_id is not null/i)
    expect(upgrade).toMatch(
      /not exists \([\s\S]*?from public\.user_entitlements as entitlements[\s\S]*?entitlements\.user_id = p_user_id[\s\S]*?entitlements\.catalog_item_id = selected_item\.catalog_item_id/i,
    )
    expect(upgrade).toMatch(
      /selected_cursor \+ 1 >= banner\.soft_pity_start_pull/i,
    )
  })

  it('uses the fixed full-banner base and floor-rounded billion-point excess draw', () => {
    const prepare = functionSqlFrom(sql, 'private', 'prepare_pull_for_user')
    const baseRate = prepare.match(
      /select tiers\.weight_units::numeric[\s\S]*?into strict soft_pity_base_rate[\s\S]*?tiers\.tier_id = selected_item\.tier_id;/i,
    )?.[0] ?? ''

    expect(baseRate).not.toBe('')
    expect(baseRate).toMatch(
      /tiers\.weight_units::numeric \/ \(\s*select sum\(all_tiers\.weight_units\)::numeric\s+from public\.pull_banner_tiers as all_tiers\s+where all_tiers\.banner_version_id = banner\.id\s*\)/i,
    )
    expect(baseRate).not.toMatch(/banner\.weight_scale/i)
    expect(prepare).toMatch(
      /soft_pity_base_rate \+\s+banner\.soft_pity_per_pull_increment \*\s+\(selected_cursor \+ 1 - banner\.soft_pity_start_pull \+ 1\)::numeric/i,
    )
    expect(prepare).toMatch(
      /soft_pity_excess_rate :=\s+\(soft_pity_target_rate - soft_pity_base_rate\) \/\s+\(1::numeric - soft_pity_base_rate\)/i,
    )
    expect(prepare).toMatch(/soft_pity_draw_scale integer := 1000000000/i)
    expect(prepare).toMatch(
      /soft_pity_upgrade_threshold := floor\(\s*soft_pity_excess_rate \* soft_pity_draw_scale::numeric\s*\)::integer/i,
    )
    expect(prepare).toMatch(
      /private\.pull_seeded_uint32_below\(\s*pull_seed,\s*target_session_id,\s*position::smallint,\s*'soft-pity-upgrade',\s*soft_pity_draw_scale\s*\)/i,
    )
    expect(prepare).toMatch(
      /if soft_pity_upgrade_draw < soft_pity_upgrade_threshold then/i,
    )
  })

  it('seals upgrades with hard-guarantee intersection precedence', () => {
    const prepare = functionSqlFrom(sql, 'private', 'prepare_pull_for_user')
    const upgradeAward = prepare.match(
      /if soft_pity_upgrade_draw < soft_pity_upgrade_threshold then[\s\S]*?soft_pity_upgraded := true;\s+end if;/i,
    )?.[0] ?? ''

    expect(upgradeAward).toMatch(/target_item := selected_item/i)
    expect(upgradeAward).toMatch(
      /if epic_due then\s+resolution_reason := 'epic-guarantee';\s+elsif rare_due then\s+resolution_reason := 'rare-guarantee';\s+else\s+resolution_reason := 'soft-pity';/i,
    )
    expect(upgradeAward.indexOf("resolution_reason := 'epic-guarantee'"))
      .toBeLessThan(upgradeAward.indexOf("resolution_reason := 'rare-guarantee'"))
    expect(upgradeAward.indexOf("resolution_reason := 'rare-guarantee'"))
      .toBeLessThan(upgradeAward.indexOf("resolution_reason := 'soft-pity'"))
    expect(upgradeAward).toMatch(/soft_pity_upgraded := true/i)
    expect(prepare).toMatch(
      /result_selected_after := private\.pull_selected_misses_after\(\s*selected_cursor,\s*target_item\.selected_featured,\s*result_is_duplicate\s*\)/i,
    )
    expect(prepare).toMatch(/'reason', resolution_reason/i)
    expect(prepare).toMatch(/result\.reason,[\s\S]*?result\.selected_after/i)
  })

  it('keeps the NULL-ramp tier/item draw sequence byte-identical to 0017', () => {
    const prepare = functionSqlFrom(sql, 'private', 'prepare_pull_for_user')
    const canonical = functionSqlFrom(
      canonicalSql,
      'private',
      'prepare_pull_for_user',
    )
    const currentNormal = normalTierItemDraw(prepare)
    const canonicalNormal = normalTierItemDraw(canonical)

    expect(currentNormal).not.toBe('')
    expect(currentNormal).toBe(canonicalNormal)
    expect(prepare).toMatch(
      /soft_pity_upgraded := false;[\s\S]*?if not soft_pity_upgraded then[\s\S]*?'tier'[\s\S]*?'item'/i,
    )
  })

  it('preserves hard-pity due logic and changes only declarations plus draw section', () => {
    const prepare = functionSqlFrom(sql, 'private', 'prepare_pull_for_user')
    const canonical = functionSqlFrom(
      canonicalSql,
      'private',
      'prepare_pull_for_user',
    )
    const dueAssignments = (source: string) => source.match(
      / {4}selected_due :=[\s\S]*? {4}rare_due := rare_cursor \+ 1 >= banner\.rare_hard_guarantee_pull;/,
    )?.[0] ?? ''

    expect(dueAssignments(prepare)).toBe(dueAssignments(canonical))
    expect(prepare).toMatch(
      /if selected_due then\s+target_item := selected_item;\s+resolution_reason := 'selected-guarantee';\s+else/i,
    )

    const currentDraw = drawRegion(prepare)
    const canonicalDraw = drawRegion(canonical)
    const withoutSoftDeclarations = prepare
      .replace(/ {2}soft_pity_upgraded boolean;\n/, '')
      .replace(/ {2}soft_pity_base_rate numeric;\n/, '')
      .replace(/ {2}soft_pity_target_rate numeric;\n/, '')
      .replace(/ {2}soft_pity_excess_rate numeric;\n/, '')
      .replace(/ {2}soft_pity_upgrade_draw integer;\n/, '')
      .replace(/ {2}soft_pity_upgrade_threshold integer;\n/, '')
      .replace(/ {2}soft_pity_draw_scale integer := 1000000000;\n/, '')
      .replace(currentDraw, canonicalDraw)

    expect(currentDraw).not.toBe('')
    expect(canonicalDraw).not.toBe('')
    expect(withoutSoftDeclarations).toBe(canonical)
  })
})
