import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { beforeAll, describe, expect, it } from 'vitest'

const migrationPath = resolve(
  process.cwd(),
  'supabase/migrations/0004_collectible_catalog.sql',
)
const generatedSeedPath = resolve(
  process.cwd(),
  'supabase/catalog/collectible_catalog_v1.sql',
)

let sql = ''
let generatedSeed = ''

beforeAll(async () => {
  const sources = await Promise.all([
    readFile(migrationPath, 'utf8'),
    readFile(generatedSeedPath, 'utf8'),
  ])
  sql = sources[0]
  generatedSeed = sources[1]
})

function functionBody(name: string): string {
  return sql.match(
    new RegExp(
      `create or replace function public\\.${name}\\(\\)[\\s\\S]*?\\$\\$;`,
      'i',
    ),
  )?.[0] ?? ''
}

function starterItemIds(source: string): string[] {
  const values = source.match(
    /(?:from|cross join)\s*\(values([\s\S]*?)\)\s*as starter\s*\(catalog_item_id\)/i,
  )?.[1] ?? ''

  return [...values.matchAll(/\(\s*'([^']+@\d+)'\s*\)/g)].map(match => match[1])
}

function stripLineComments(source: string): string {
  return source.replace(/^\s*--.*$/gm, '')
}

function generatedSeedBlock(source: string): string {
  return source.match(
    /-- BEGIN GENERATED COLLECTIBLE CATALOG V1[\s\S]*?-- END GENERATED COLLECTIBLE CATALOG V1/,
  )?.[0] ?? ''
}

describe('0004 collectible catalog schema', () => {
  it('defines versioned catalog, immutable asset, and separate entitlement tables', () => {
    expect(sql).toMatch(/create table if not exists public\.catalog_items/)
    expect(sql).toMatch(/id\s+text\s+primary key/)
    expect(sql).toMatch(/unique \(catalog_key, contract_version\)/)
    expect(sql).toMatch(/id = catalog_key \|\| '@' \|\| contract_version::text/)

    expect(sql).toMatch(/create table if not exists public\.catalog_asset_versions/)
    expect(sql).toMatch(
      /catalog_item_id\s+text\s+not null references public\.catalog_items \(id\)/,
    )
    expect(sql).toMatch(/unique \(catalog_item_id, asset_version\)/)
    expect(sql).toMatch(
      /id = catalog_item_id \|\| '\/asset@' \|\| asset_version::text/,
    )
    expect(sql).toMatch(/asset_kind in \('builtin', 'gltf'\)/)
    expect(sql).toMatch(/model_sha256 ~ '\^\[0-9a-f\]\{64\}\$'/)
    expect(sql).toMatch(/metadata_sha256\s+text\s+not null/)
    expect(sql).toMatch(/metadata_sha256 ~ '\^\[0-9a-f\]\{64\}\$'/)
    expect(sql).toMatch(/asset_kind <> 'gltf' or model_sha256 is not null/)

    expect(sql).toMatch(/create table if not exists public\.user_entitlements/)
    expect(sql).toMatch(
      /user_id\s+uuid\s+not null references auth\.users \(id\) on delete cascade/,
    )
    expect(sql).toMatch(
      /catalog_item_id\s+text\s+not null references public\.catalog_items \(id\)/,
    )
    expect(sql).toMatch(/provenance\s+jsonb\s+not null/)
    expect(sql).toMatch(/revoked_at\s+timestamptz/)
    expect(sql).toMatch(/unique \(user_id, catalog_item_id\)/)
    const entitlementTable = sql.match(
      /create table if not exists public\.user_entitlements \([\s\S]*?\n\);/,
    )?.[0] ?? ''
    expect(entitlementTable).not.toMatch(/\bquantity\b/)
    expect(entitlementTable).not.toMatch(/unique \(user_id, grant_ref\)/)
  })

  it('forces RLS and exposes only public catalog reads plus own entitlement reads', () => {
    for (const table of [
      'catalog_items',
      'catalog_asset_versions',
      'user_entitlements',
    ]) {
      expect(sql).toMatch(
        new RegExp(`alter table public\\.${table} enable row level security`, 'i'),
      )
      expect(sql).toMatch(
        new RegExp(`alter table public\\.${table} force row level security`, 'i'),
      )
      expect(sql).toMatch(
        new RegExp(
          `revoke all on table public\\.${table} from anon, authenticated, service_role`,
          'i',
        ),
      )
    }

    const policies = [...sql.matchAll(
      /create policy "([^"]+)"\s+on public\.(\w+)\s+for (\w+)\s+using \(([^)]+\([^)]*\)[^)]*|[^)]+)\)/gi,
    )].map((match) => ({ table: match[2], command: match[3].toLowerCase() }))

    expect(policies).toEqual([
      { table: 'catalog_items', command: 'select' },
      { table: 'catalog_asset_versions', command: 'select' },
      { table: 'user_entitlements', command: 'select' },
    ])
    expect(sql).toMatch(
      /on public\.user_entitlements for select using \(auth\.uid\(\) = user_id and revoked_at is null\)/,
    )
    expect(sql).toMatch(
      /grant select on table public\.catalog_items to anon, authenticated/,
    )
    expect(sql).toMatch(
      /grant select on table public\.catalog_asset_versions to anon, authenticated/,
    )
    expect(sql).toMatch(
      /grant select on table public\.user_entitlements to authenticated/,
    )
    expect(sql).toMatch(
      /grant select on table public\.catalog_items to service_role/,
    )
    expect(sql).toMatch(
      /grant select on table public\.catalog_asset_versions to service_role/,
    )
    expect(sql).toMatch(
      /grant select, insert on table public\.user_entitlements to service_role/,
    )
    expect(sql).toMatch(
      /grant update \(revoked_at\) on table public\.user_entitlements to service_role/,
    )
    expect(stripLineComments(sql)).not.toMatch(
      /grant\s+[^;]*(insert|update|delete|all)[^;]*on table public\.(catalog_items|catalog_asset_versions) to (anon|authenticated|service_role)/i,
    )
    expect(stripLineComments(sql)).not.toMatch(
      /grant\s+[^;]*(insert|update|delete|all)[^;]*on table public\.user_entitlements to (anon|authenticated)/i,
    )
    expect(stripLineComments(sql)).not.toMatch(
      /grant\s+[^;]*(delete|all)[^;]*on table public\.user_entitlements to service_role/i,
    )
    expect(stripLineComments(sql)).not.toMatch(
      /grant\s+[^;]*\bupdate\b(?!\s*\(revoked_at\))[^;]*on table public\.user_entitlements to service_role/i,
    )
  })

  it('rejects updates and deletes to both immutable catalog tables', () => {
    const rejectFunction = functionBody('reject_collectible_catalog_mutation')
    expect(rejectFunction).toContain("set search_path = ''")
    expect(rejectFunction).toContain("errcode = '55000'")
    expect(sql).toMatch(
      /before update or delete on public\.catalog_items[\s\S]*?reject_collectible_catalog_mutation/,
    )
    expect(sql).toMatch(
      /before update or delete on public\.catalog_asset_versions[\s\S]*?reject_collectible_catalog_mutation/,
    )
    expect(sql).not.toMatch(
      /before update or delete on public\.user_entitlements/,
    )
    expect(sql).toMatch(
      /revoke all on function public\.reject_collectible_catalog_mutation\(\) from public, anon, authenticated/,
    )
  })
})

describe('0004 fixed starter entitlement boundary', () => {
  it('extracts every versioned starter VALUES id without unrelated strings', () => {
    expect(starterItemIds(`
      select 'unrelated/catalog@99';
      from (values
        ('starter/d4@1'),
        ('starter/d6@2')
      ) as starter(catalog_item_id)
    `)).toEqual(['starter/d4@1', 'starter/d6@2'])
  })

  it('offers one no-argument, authenticated, idempotent starter RPC', () => {
    const starterFunction = functionBody('ensure_starter_entitlements')

    expect(starterFunction).not.toBe('')
    expect(starterFunction).toMatch(/returns void/)
    expect(starterFunction).toMatch(/security definer/)
    expect(starterFunction).toContain("set search_path = ''")
    expect(starterFunction).toMatch(/target_user_id uuid := auth\.uid\(\)/)
    expect(starterFunction).toMatch(/if target_user_id is null/)
    expect(starterFunction).toMatch(/on conflict \(user_id, catalog_item_id\) do nothing/)
    expect(sql.match(
      /create or replace function public\.ensure_starter_entitlements\s*\(/gi,
    )).toHaveLength(1)
    expect(sql).toMatch(
      /revoke all on function public\.ensure_starter_entitlements\(\) from public, anon, authenticated/,
    )
    expect(sql).toMatch(
      /grant execute on function public\.ensure_starter_entitlements\(\) to authenticated/,
    )
    expect(stripLineComments(sql).match(/security definer/gi)).toHaveLength(1)
  })

  it('grants the same fixed 8-item ownership set to the RPC and existing-user backfill', () => {
    const rpcItemIds = starterItemIds(functionBody('ensure_starter_entitlements'))
    const backfill = sql.match(
      /-- Existing accounts receive[\s\S]*?(?=-- ---------------------------------------------------------------------------\n-- Row-Level Security)/,
    )?.[0] ?? ''
    const backfillItemIds = starterItemIds(backfill)

    expect(rpcItemIds).toEqual([
      'adventurer-starter/d4/common@1',
      'adventurer-starter/d8/common@1',
      'adventurer-starter/d10/common@1',
      'adventurer-starter/d12/common@1',
      'adventurer-starter/d20/common@1',
      'materials-lab/steel-d20@1',
      'materials-lab/rubber-d20@1',
      'devil-set/devil-d6@1',
    ])
    expect(backfillItemIds).toEqual(rpcItemIds)
    expect(backfill).toMatch(/from auth\.users as users/)
    expect(backfill).toMatch(/on conflict \(user_id, catalog_item_id\) do nothing/)
    expect(functionBody('ensure_starter_entitlements')).not.toMatch(/\bquantity\b/)
    expect(backfill).not.toMatch(/\bquantity\b/)
  })

  it('never derives authoritative grants from client inventory JSON', () => {
    const executableSql = stripLineComments(sql)
    expect(executableSql).not.toMatch(/public\.inventory/i)
    expect(executableSql).not.toMatch(/inventory\s*\.\s*data/i)
    expect(executableSql).not.toMatch(/data\s*(->|#>)/i)
  })

  it('embeds the 51-item generated catalog seed verbatim', () => {
    const migrationSeed = generatedSeedBlock(sql)

    expect(migrationSeed).not.toBe('')
    expect(migrationSeed).toBe(generatedSeed.trim())
    expect(migrationSeed.match(/, 'die', /g)).toHaveLength(51)
    expect(migrationSeed.match(/\/asset@1'/g)).toHaveLength(51)
  })
})
