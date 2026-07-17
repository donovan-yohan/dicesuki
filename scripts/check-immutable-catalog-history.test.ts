import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  changedImmutableCatalogPaths,
  immutableCatalogPathsAtRef,
  validateCurrentCatalogAnchors,
} from './check-immutable-catalog-history.js'

const temporaryDirectories: string[] = []

function git(cwd: string, ...args: string[]) {
  return execFileSync('git', args, { cwd, encoding: 'utf8' }).trim()
}

function write(root: string, filePath: string, value: string) {
  const target = path.join(root, filePath)
  fs.mkdirSync(path.dirname(target), { recursive: true })
  fs.writeFileSync(target, value)
}

function repository() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dicesuki-catalog-history-'))
  temporaryDirectories.push(root)
  git(root, 'init', '-q')
  git(root, 'config', 'user.name', 'Catalog Test')
  git(root, 'config', 'user.email', 'catalog-test@example.invalid')
  write(root, 'supabase/catalog/editions/0001-initial.json', JSON.stringify({
    edition: 1,
    slug: 'initial',
    migration: '0004_collectible_catalog.sql',
  }))
  write(root, 'supabase/catalog/collectible_catalog_v1.sql', '-- v1\n')
  write(root, 'supabase/migrations/0004_collectible_catalog.sql', '-- migration 4\n')
  git(root, 'add', '.')
  git(root, 'commit', '-qm', 'catalog baseline')
  const baseline = git(root, 'rev-parse', 'HEAD')
  return { root, baseline }
}

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    fs.rmSync(directory, { recursive: true, force: true })
  }
})

describe('immutable catalog history guard', () => {
  it('anchors every published manifest, its migration, and the v1 SQL', () => {
    const { root, baseline } = repository()
    expect(immutableCatalogPathsAtRef(baseline, root)).toEqual([
      'supabase/catalog/collectible_catalog_v1.sql',
      'supabase/catalog/editions/0001-initial.json',
      'supabase/migrations/0004_collectible_catalog.sql',
    ])
  })

  it('allows a new edition while rejecting joint history and migration rewrites', () => {
    const { root, baseline } = repository()
    write(root, 'supabase/catalog/editions/0002-next.json', JSON.stringify({
      edition: 2,
      slug: 'next',
      migration: '0005_catalog_next.sql',
    }))
    write(root, 'supabase/migrations/0005_catalog_next.sql', '-- migration 5\n')
    expect(changedImmutableCatalogPaths(baseline, root)).toEqual([])

    write(root, 'supabase/catalog/editions/0001-initial.json', '{"rewritten":true}\n')
    write(root, 'supabase/migrations/0004_collectible_catalog.sql', '-- rewritten\n')
    expect(changedImmutableCatalogPaths(baseline, root)).toEqual([
      'supabase/catalog/editions/0001-initial.json',
      'supabase/migrations/0004_collectible_catalog.sql',
    ])
  })

  it('rejects missing, orphaned, and noncontiguous current migration anchors', () => {
    const { root } = repository()
    expect(() => validateCurrentCatalogAnchors(root)).not.toThrow()

    fs.unlinkSync(path.join(root, 'supabase/migrations/0004_collectible_catalog.sql'))
    expect(() => validateCurrentCatalogAnchors(root)).toThrow(/missing migration/)
    write(root, 'supabase/migrations/0004_collectible_catalog.sql', '-- migration 4\n')

    write(root, 'supabase/migrations/0005_catalog_orphan.sql', '-- orphan\n')
    expect(() => validateCurrentCatalogAnchors(root)).toThrow(/lack edition manifests/)
    fs.unlinkSync(path.join(root, 'supabase/migrations/0005_catalog_orphan.sql'))

    write(
      root,
      'supabase/migrations/0005_add_dice.sql',
      'insert into public.catalog_items (id) values (\'bypass@1\');\n',
    )
    expect(() => validateCurrentCatalogAnchors(root)).toThrow(/DML must be anchored/)
    fs.unlinkSync(path.join(root, 'supabase/migrations/0005_add_dice.sql'))

    write(
      root,
      'supabase/migrations/0005_grant_entitlement.sql',
      'insert into public.user_entitlements (catalog_item_id) select id from public.catalog_items;\n',
    )
    expect(() => validateCurrentCatalogAnchors(root)).not.toThrow()
    fs.unlinkSync(path.join(root, 'supabase/migrations/0005_grant_entitlement.sql'))

    write(root, 'supabase/catalog/editions/0003-skipped.json', JSON.stringify({
      edition: 3,
      slug: 'skipped',
      migration: '0006_catalog_skipped.sql',
    }))
    write(root, 'supabase/migrations/0006_catalog_skipped.sql', '-- skipped\n')
    expect(() => validateCurrentCatalogAnchors(root)).toThrow(/contiguous/)
  })
})
