import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { beforeAll, describe, expect, it } from 'vitest'

const migrationPath = resolve(
  process.cwd(),
  'supabase/migrations/0019_soft_pity_constraint_fix.sql',
)

let sql = ''
let executableSql = ''

beforeAll(async () => {
  sql = await readFile(migrationPath, 'utf8')
  executableSql = sql
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/--[^\r\n]*/g, '')
})

describe('0019 soft-pity constraint fix', () => {
  it('drops and recreates the merged constraints with nullable comparisons', () => {
    expect(executableSql).toMatch(
      /alter table public\.pull_banner_versions\s+drop constraint pull_banner_versions_soft_pity_all_or_none,\s+add constraint pull_banner_versions_soft_pity_all_or_none\s+check \(/i,
    )
    expect(executableSql).toMatch(
      /alter table public\.pull_banner_versions\s+drop constraint pull_banner_versions_soft_pity_before_hard_guarantee,\s+add constraint pull_banner_versions_soft_pity_before_hard_guarantee\s+check \(/i,
    )
  })

  it('guards the configured arm before comparing the nullable model', () => {
    const constraint = executableSql.match(
      /add constraint pull_banner_versions_soft_pity_all_or_none[\s\S]*?\n\s*\);/i,
    )?.[0] ?? ''

    expect(constraint).not.toBe('')
    expect(constraint).toMatch(
      /\) or \(\s+soft_pity_model is not null and\s+soft_pity_model = 'linear-rate-ramp'/i,
    )
  })

  it('guards the nullable soft-pity start before the hard-guarantee comparison', () => {
    const constraint = executableSql.match(
      /add constraint pull_banner_versions_soft_pity_before_hard_guarantee[\s\S]*?\n\s*\);/i,
    )?.[0] ?? ''

    expect(constraint).not.toBe('')
    expect(constraint).toMatch(
      /selected_hard_guarantee_pull is not null and\s+soft_pity_start_pull is not null and\s+soft_pity_start_pull < selected_hard_guarantee_pull/i,
    )
  })
})
