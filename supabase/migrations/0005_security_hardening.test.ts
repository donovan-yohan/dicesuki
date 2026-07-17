import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { beforeAll, describe, expect, it } from 'vitest'

const migrationPath = resolve(
  process.cwd(),
  'supabase/migrations/0005_security_hardening.sql',
)

let sql = ''

beforeAll(async () => {
  sql = await readFile(migrationPath, 'utf8')
})

function stripSqlComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*--.*$/gm, '')
}

function splitSqlStatements(source: string): string[] {
  const statements: string[] = []
  let current = ''
  let inSingleQuote = false
  let dollarTag: string | undefined

  for (let index = 0; index < source.length; index += 1) {
    if (dollarTag !== undefined) {
      if (source.startsWith(dollarTag, index)) {
        current += dollarTag
        index += dollarTag.length - 1
        dollarTag = undefined
      } else {
        current += source[index]
      }
      continue
    }

    const character = source[index]

    if (inSingleQuote) {
      current += character
      if (character === "'") {
        if (source[index + 1] === "'") {
          current += source[index + 1]
          index += 1
        } else {
          inSingleQuote = false
        }
      }
      continue
    }

    if (character === "'") {
      inSingleQuote = true
      current += character
      continue
    }

    if (character === '$') {
      const tag = source.slice(index).match(/^\$(?:[A-Za-z_][A-Za-z0-9_]*)?\$/)?.[0]
      if (tag !== undefined) {
        dollarTag = tag
        current += tag
        index += tag.length - 1
        continue
      }
    }

    if (character === ';') {
      statements.push(current)
      current = ''
      continue
    }

    current += character
  }

  statements.push(current)
  return statements
}

function executableStatements(source: string): string[] {
  return splitSqlStatements(stripSqlComments(source))
    .map(statement => statement.replace(/\s+/g, ' ').trim().toLowerCase())
    .filter(Boolean)
}

describe('SQL statement parsing', () => {
  it('preserves semicolons inside quoted and dollar-quoted bodies', () => {
    expect(executableStatements(`
      comment on table public.profiles is 'display-safe; it isn''t secret';
      do $body$ begin perform 'one;two'; end $body$;
    `)).toEqual([
      "comment on table public.profiles is 'display-safe; it isn''t secret'",
      "do $body$ begin perform 'one;two'; end $body$",
    ])
  })
})

describe('0005 explicit least-privilege grants', () => {
  it('has an exact executable table privilege allowlist', () => {
    const statements = executableStatements(sql)
    const tableRevokes = statements.filter(statement => (
      statement.startsWith('revoke ') && statement.includes(' on table ')
    ))
    const grants = statements.filter(statement => statement.startsWith('grant '))

    expect(tableRevokes).toEqual([
      'revoke all on table public.profiles from public, anon, authenticated, service_role',
      'revoke all on table public.inventory from public, anon, authenticated, service_role',
      'revoke all on table public.saved_rolls from public, anon, authenticated, service_role',
      'revoke all on table public.settings from public, anon, authenticated, service_role',
      'revoke all on table public.rooms from public, anon, authenticated, service_role',
    ])
    expect(grants).toEqual([
      'grant select on table public.profiles to anon',
      'grant select on table public.profiles to authenticated',
      'grant select on table public.rooms to anon',
      'grant select on table public.rooms to authenticated',
      'grant insert, update, delete on table public.profiles to authenticated',
      'grant select, insert, update, delete on table public.inventory to authenticated',
      'grant select, insert, update, delete on table public.saved_rolls to authenticated',
      'grant select, insert, update, delete on table public.settings to authenticated',
      'grant select, insert, update, delete on table public.profiles to service_role',
      'grant select, insert, update, delete on table public.inventory to service_role',
      'grant select, insert, update, delete on table public.saved_rolls to service_role',
      'grant select, insert, update, delete on table public.settings to service_role',
      'grant select, insert, update, delete on table public.rooms to service_role',
    ])
  })
})

describe('0005 RLS and helper hardening', () => {
  it('pins trigger-helper search paths and removes client-callable execution', () => {
    const executableSql = stripSqlComments(sql)

    for (const fn of ['set_updated_at', 'set_last_heartbeat']) {
      expect(executableSql).toMatch(new RegExp(
        `alter function public\\.${fn}\\(\\) set search_path = ''`,
        'i',
      ))
      expect(executableSql).toMatch(new RegExp(
        `revoke execute on function public\\.${fn}\\(\\) from public, anon, authenticated`,
        'i',
      ))
      expect(executableSql).not.toMatch(new RegExp(
        `grant execute on function public\\.${fn}\\(\\)`,
        'i',
      ))
    }
  })

  it('optimizes every auth.uid policy expression and scopes it to authenticated', () => {
    const executableSql = stripSqlComments(sql)
    const expectedPolicies = [
      ['users insert their own profile', 'profiles'],
      ['users update their own profile', 'profiles'],
      ['users delete their own profile', 'profiles'],
      ['users read their own inventory', 'inventory'],
      ['users insert their own inventory', 'inventory'],
      ['users update their own inventory', 'inventory'],
      ['users delete their own inventory', 'inventory'],
      ['users read their own saved_rolls', 'saved_rolls'],
      ['users insert their own saved_rolls', 'saved_rolls'],
      ['users update their own saved_rolls', 'saved_rolls'],
      ['users delete their own saved_rolls', 'saved_rolls'],
      ['users read their own settings', 'settings'],
      ['users insert their own settings', 'settings'],
      ['users update their own settings', 'settings'],
      ['users delete their own settings', 'settings'],
      ['users read their own entitlements', 'user_entitlements'],
    ] as const

    for (const [policy, table] of expectedPolicies) {
      expect(executableSql).toMatch(new RegExp(
        `alter policy "${policy}"\\s+on public\\.${table}\\s+to authenticated`,
        'i',
      ))
    }

    const uidCalls = executableSql.match(/auth\.uid\(\)/gi) ?? []
    const initPlanCalls = executableSql.match(/\(select auth\.uid\(\)\)/gi) ?? []

    expect(executableSql.match(/alter policy/gi)).toHaveLength(16)
    expect(uidCalls).toHaveLength(20)
    expect(initPlanCalls).toHaveLength(uidCalls.length)
    expect(executableSql.replaceAll('(select auth.uid())', '')).not.toMatch(
      /auth\.uid\(\)/i,
    )
  })
})

describe('0005 index and accepted-advisor contracts', () => {
  it('adds the missing catalog-item foreign-key index', () => {
    const executableSql = stripSqlComments(sql)

    expect(executableSql).toMatch(
      /create index if not exists user_entitlements_catalog_item_id_idx\s+on public\.user_entitlements \(catalog_item_id\)/i,
    )
    expect(executableSql).toMatch(
      /comment on index public\.user_entitlements_catalog_item_id_idx/i,
    )
  })

  it('retains and documents the two cold-but-purposeful indexes', () => {
    const executableSql = stripSqlComments(sql)

    expect(executableSql).toMatch(/comment on index public\.rooms_last_heartbeat_idx/i)
    expect(executableSql).toMatch(
      /comment on index public\.user_entitlements_active_user_idx/i,
    )
    expect(executableSql).not.toMatch(/drop index/i)
  })

  it('references the fixed starter RPC only to document the accepted exception', () => {
    const rpcStatements = executableStatements(sql).filter(statement => (
      statement.includes('public.ensure_starter_entitlements')
    ))

    expect(rpcStatements).toHaveLength(1)
    expect(rpcStatements[0]).toMatch(
      /^comment on function public\.ensure_starter_entitlements\(\) is /,
    )
  })

  it('has no executable statement targeting immutable catalog tables', () => {
    const immutableCatalogStatements = executableStatements(sql).filter(statement => (
      /\b(?:public\.)?(catalog_items|catalog_asset_versions)\b/i.test(statement)
    ))

    expect(immutableCatalogStatements).toEqual([])
  })
})
