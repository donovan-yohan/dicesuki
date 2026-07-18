import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { beforeAll, describe, expect, it } from 'vitest'

const migrationPath = resolve(
  process.cwd(),
  'supabase/migrations/0012_earned_pull_preparation_fk_indexes.sql',
)

const expectedIndexes = [
  {
    name: 'pull_banner_items_tier_fkey_idx',
    table: 'pull_banner_items',
    columns: 'banner_version_id, tier_id, tier_rank',
  },
  {
    name: 'pull_guarantee_states_banner_family_id_fkey_idx',
    table: 'pull_guarantee_states',
    columns: 'banner_family_id',
  },
  {
    name: 'pull_sessions_account_fkey_idx',
    table: 'pull_sessions',
    columns: 'account_id, user_id',
  },
  {
    name: 'pull_sessions_banner_fkey_idx',
    table: 'pull_sessions',
    columns: 'banner_version_id, banner_family_id',
  },
  {
    name: 'sealed_pull_results_session_fkey_idx',
    table: 'sealed_pull_results',
    columns: 'session_id, account_id, user_id, banner_version_id',
  },
] as const

let statements: string[] = []

beforeAll(async () => {
  const sql = await readFile(migrationPath, 'utf8')
  statements = sql
    .replace(/--.*$/gm, '')
    .split(';')
    .map(statement => statement.trim().replace(/\s+/g, ' '))
    .filter(Boolean)
})

describe('0012 pull preparation foreign-key indexes', () => {
  it('adds exactly the five intended ordinary non-partial btree indexes', () => {
    expect(statements).toHaveLength(expectedIndexes.length)

    expectedIndexes.forEach(({ name, table, columns }, position) => {
      expect(statements[position]).toBe(
        `create index ${name} on public.${table} using btree (${columns})`,
      )
    })
  })

  it('contains no schema or data mutation beyond index creation', () => {
    for (const statement of statements) {
      expect(statement).toMatch(/^create index [a-z0-9_]+ on public\.[a-z0-9_]+ using btree \([a-z0-9_, ]+\)$/)
      expect(statement).not.toMatch(/\b(?:unique|concurrently|where|include)\b/i)
    }
  })
})
