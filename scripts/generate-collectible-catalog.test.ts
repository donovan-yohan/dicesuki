import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  buildSql,
  catalogPaths,
  createPreparedCatalogEdition,
  generateCatalogArtifacts,
  publishPreparedCatalogEdition,
  resolvePublicModelFilePath,
  verifyPublishedEditions,
} from './generate-collectible-catalog.js'
import { hashCatalogRow } from './catalog-edition-planner.js'

const temporaryDirectories: string[] = []

function item(contractVersion = 1) {
  return {
    id: `test-set/d6@${contractVersion}`,
    catalogKey: 'test-set/d6',
    contractVersion,
    itemKind: 'die',
    setId: 'test-set',
    diceType: 'd6',
    rarity: 'rare',
  }
}

function asset(assetVersion = 1, metadata = { name: 'Test d6', source: 'configured' }) {
  return {
    id: `test-set/d6@1/asset@${assetVersion}`,
    catalogItemId: 'test-set/d6@1',
    assetVersion,
    assetKind: 'builtin',
    modelPath: 'builtin:d6',
    modelSha256: null,
    metadata,
    metadataSha256: hashCatalogRow(metadata),
  }
}

function baselineEdition() {
  return {
    edition: 1,
    slug: 'initial',
    label: 'V1',
    migration: '0004_collectible_catalog.sql',
    items: [item()],
    assetVersions: [asset()],
  }
}

function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dicesuki-catalog-generator-'))
  temporaryDirectories.push(root)
  const paths = catalogPaths(root)
  fs.mkdirSync(paths.editionsDir, { recursive: true })
  fs.mkdirSync(paths.migrationsDir, { recursive: true })
  fs.mkdirSync(path.dirname(paths.jsonOutputPath), { recursive: true })

  const edition = baselineEdition()
  const sql = buildSql(edition, edition.label)
  fs.writeFileSync(paths.sqlOutputPath, sql)
  fs.writeFileSync(
    paths.baselineMigrationPath,
    `-- schema before generated data\n\n${sql}\n-- policies after generated data\n`,
  )
  fs.writeFileSync(
    path.join(paths.editionsDir, '0001-initial.json'),
    `${JSON.stringify(edition, null, 2)}\n`,
  )
  return { paths, edition }
}

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    fs.rmSync(directory, { recursive: true, force: true })
  }
})

describe('collectible catalog edition integration', () => {
  it('resolves model paths inside public and rejects traversal before reading bytes', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dicesuki-model-path-'))
    temporaryDirectories.push(root)
    const modelPath = path.join(root, 'public', 'dice', 'test-set', 'd6', 'model.glb')
    fs.mkdirSync(path.dirname(modelPath), { recursive: true })
    fs.writeFileSync(modelPath, 'safe model bytes')
    expect(resolvePublicModelFilePath(root, '/dice/test-set/d6/model.glb')).toBe(
      modelPath,
    )
    expect(() => resolvePublicModelFilePath(root, '/dice/../../.env')).toThrow(/safe public path/)
    expect(() => resolvePublicModelFilePath(root, 'dice/test-set/model.glb')).toThrow(
      /must start with \/dice\//,
    )

    const outsidePath = path.join(root, 'outside.glb')
    const symlinkPath = path.join(path.dirname(modelPath), 'escape.glb')
    fs.writeFileSync(outsidePath, 'outside bytes')
    fs.symlinkSync(outsidePath, symlinkPath)
    expect(() => resolvePublicModelFilePath(root, '/dice/test-set/d6/escape.glb')).toThrow(
      /must not use symbolic links/,
    )
  })

  it('anchors a published manifest to its frozen SQL and migration', () => {
    const { paths, edition } = fixture()
    expect(() => verifyPublishedEditions([edition], paths)).not.toThrow()

    const rewrittenItem = { ...item(), rarity: 'epic' }
    const rewrittenEdition = { ...edition, items: [rewrittenItem] }
    const rewrittenDesired = {
      contractVersion: 1,
      items: [{ ...rewrittenItem, assetVersionId: asset().id }],
      assetVersions: [asset()],
    }
    expect(() => generateCatalogArtifacts({
      paths,
      desired: rewrittenDesired,
      editions: [rewrittenEdition],
    })).toThrow(/stale|frozen catalog edition/)
  })

  it('prepares and publishes one delta without replaying historical rows', () => {
    const { paths, edition } = fixture()
    const metadata = { name: 'Test d6 remaster', source: 'configured' }
    const asset2 = asset(2, metadata)
    const desired = {
      contractVersion: 1,
      items: [{ ...item(), assetVersionId: asset2.id }],
      assetVersions: [asset2],
    }

    const prepared = createPreparedCatalogEdition([edition], desired, '0005', 'remaster')
    expect(prepared.edition.items).toEqual([])
    expect(prepared.edition.assetVersions).toEqual([asset2])
    expect(prepared.migrationSql).toContain("'test-set/d6@1/asset@2'")
    expect(prepared.migrationSql).not.toContain("'test-set/d6@1/asset@1'")
    expect(prepared.catalog.assetVersions.map(candidate => candidate.id)).toEqual([
      'test-set/d6@1/asset@1',
      'test-set/d6@1/asset@2',
    ])
    expect(prepared.catalog.items[0].assetVersionId).toBe(asset2.id)

    publishPreparedCatalogEdition(prepared, paths)
    expect(fs.readFileSync(
      path.join(paths.editionsDir, '0002-remaster.json'),
      'utf8',
    )).toBe(prepared.editionJson)
    expect(fs.readFileSync(
      path.join(paths.migrationsDir, '0005_catalog_remaster.sql'),
      'utf8',
    )).toBe(prepared.migrationSql)
    expect(fs.readFileSync(paths.jsonOutputPath, 'utf8')).toBe(prepared.catalogJson)
  })
})
