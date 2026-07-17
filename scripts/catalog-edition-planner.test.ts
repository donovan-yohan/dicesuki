import { describe, expect, it } from 'vitest'
import {
  buildCatalogDeltaSql,
  compileCatalogHistory,
  flattenEditions,
  hashCatalogRow,
  planCatalogEdition,
  selectLatestCatalogItem,
} from './catalog-edition-planner.js'

function item(contractVersion = 1, catalogKey = 'test-set/d6') {
  return {
    id: `${catalogKey}@${contractVersion}`,
    catalogKey,
    contractVersion,
    itemKind: 'die',
    setId: 'test-set',
    diceType: 'd6',
    rarity: 'rare',
    assetVersionId: `${catalogKey}@${contractVersion}/asset@1`,
  }
}

function asset(
  catalogItem = item(),
  assetVersion = 1,
  modelPath = '/dice/test-set/d6/model.glb',
) {
  const metadata = { source: 'production', name: `Test d6 asset ${assetVersion}` }
  return {
    id: `${catalogItem.id}/asset@${assetVersion}`,
    catalogItemId: catalogItem.id,
    assetVersion,
    assetKind: 'gltf',
    modelPath,
    modelSha256: hashCatalogRow({ assetVersion, modelPath }),
    metadata,
    metadataSha256: hashCatalogRow(metadata),
  }
}

function edition1() {
  const initialItem = item()
  return {
    edition: 1,
    slug: 'initial',
    migration: '0004_collectible_catalog.sql',
    items: [initialItem],
    assetVersions: [asset(initialItem)],
  }
}

function desired(currentItem = item(), currentAsset = asset(currentItem)) {
  return { items: [currentItem], assetVersions: [currentAsset] }
}

describe('catalog edition planner', () => {
  it('rejects duplicate and malformed immutable history', () => {
    const first = edition1()
    expect(() => flattenEditions([{ ...first, items: [...first.items, first.items[0]] }]))
      .toThrow(/Duplicate catalog item id/)
    expect(() => flattenEditions([{
      ...first,
      assetVersions: [{
        ...first.assetVersions[0],
        id: 'missing@1/asset@1',
        catalogItemId: 'missing@1',
      }],
    }])).toThrow(/references unknown item/)
  })

  it('requires safe PostgreSQL integer versions and an asset v1 for every item', () => {
    const first = edition1()
    const oversizedItem = {
      ...first.items[0],
      id: 'test-set/d6@2147483648',
      contractVersion: 2_147_483_648,
    }
    expect(() => flattenEditions([{ ...first, items: [oversizedItem] }]))
      .toThrow(/positive PostgreSQL integer/)

    const oversizedAsset = {
      ...first.assetVersions[0],
      id: 'test-set/d6@1/asset@2147483648',
      assetVersion: 2_147_483_648,
    }
    expect(() => flattenEditions([{ ...first, assetVersions: [oversizedAsset] }]))
      .toThrow(/positive PostgreSQL integer/)
    expect(() => flattenEditions([{ ...first, assetVersions: [] }]))
      .toThrow(/must have asset version 1/)

    const onlyAsset2 = asset(item(), 2, '/dice/test-set/d6/versions/v2/model.glb')
    expect(() => flattenEditions([{ ...first, assetVersions: [onlyAsset2] }]))
      .toThrow(/must have asset version 1/)
  })

  it('validates canonical hashes and recomputes the metadata hash', () => {
    const first = edition1()
    expect(() => flattenEditions([{
      ...first,
      assetVersions: [{ ...first.assetVersions[0], metadataSha256: 'A'.repeat(64) }],
    }])).toThrow(/canonical lowercase SHA-256/)
    expect(() => flattenEditions([{
      ...first,
      assetVersions: [{ ...first.assetVersions[0], metadataSha256: '0'.repeat(64) }],
    }])).toThrow(/does not match canonical metadata/)
    expect(() => flattenEditions([{
      ...first,
      assetVersions: [{ ...first.assetVersions[0], modelSha256: 'not-a-hash' }],
    }])).toThrow(/canonical lowercase SHA-256/)

    expect(hashCatalogRow({ b: 2, a: { d: 4, c: 3 } }))
      .toBe(hashCatalogRow({ a: { c: 3, d: 4 }, b: 2 }))
  })

  it('rejects same-id item and asset drift', () => {
    const changedItem = { ...item(), rarity: 'epic' }
    expect(() => planCatalogEdition([edition1()], desired(changedItem, asset(changedItem))))
      .toThrow(/changed without a version bump/)

    const changedMetadata = { source: 'production', name: 'Mutated' }
    const changedAsset = {
      ...asset(),
      metadata: changedMetadata,
      metadataSha256: hashCatalogRow(changedMetadata),
    }
    expect(() => planCatalogEdition([edition1()], desired(item(), changedAsset)))
      .toThrow(/changed without a version bump/)
  })

  it('rejects published-key removal and skipped version bumps', () => {
    expect(() => planCatalogEdition([edition1()], { items: [], assetVersions: [] }))
      .toThrow(/cannot be removed/)

    const contract3 = item(3)
    expect(() => planCatalogEdition([edition1()], desired(contract3, asset(contract3))))
      .toThrow(/must append contract version 2/)

    const asset3 = asset(item(), 3, '/dice/test-set/d6/versions/v3/model.glb')
    expect(() => planCatalogEdition([edition1()], desired(item(), asset3)))
      .toThrow(/must append asset version 2/)
  })

  it('creates an asset-only v2 delta and preserves the old ref', () => {
    const asset2 = asset(item(), 2, '/dice/test-set/d6/versions/v2/model.glb')
    const delta = planCatalogEdition([edition1()], desired(item(), asset2))

    expect(delta.items).toEqual([])
    expect(delta.assetVersions).toEqual([asset2])

    const compiled = compileCatalogHistory([edition1()], delta)
    expect(compiled.assetVersions.map(candidate => candidate.id)).toEqual([
      'test-set/d6@1/asset@1',
      'test-set/d6@1/asset@2',
    ])
    expect(compiled.items[0].assetVersionId).toBe('test-set/d6@1/asset@2')
    expect(compiled.assetVersions.some(candidate => candidate.id === 'test-set/d6@1/asset@1'))
      .toBe(true)
  })

  it('requires a distinct immutable GLB path for later assets', () => {
    expect(() => planCatalogEdition(
      [edition1()],
      desired(item(), asset(item(), 2, '/dice/test-set/d6/model.glb')),
    )).toThrow(/immutable \/versions\/v2\//)

    const contract2 = item(2)
    const replacedBytes = {
      ...asset(contract2, 1, '/dice/test-set/d6/model.glb'),
      modelSha256: '9'.repeat(64),
    }
    expect(() => planCatalogEdition([edition1()], desired(contract2, replacedBytes)))
      .toThrow(/changes bytes at published path/)
  })

  it('rejects noncanonical, encoded, traversing, and mismatched GLB paths', () => {
    const invalidPaths = [
      '/dice/test-set/d6/versions/v2/model.glb?cache=1',
      '/dice/test-set/d6/versions/v2/%6dodel.glb',
      '/dice/test-set/d6/../versions/v2/model.glb',
      '/dice/Test-set/d6/versions/v2/model.glb',
      '/dice/test-set/d6/versions/v3/model.glb',
      '/dice/test-set/d6/versions/v2/nested/model.glb',
    ]
    for (const modelPath of invalidPaths) {
      expect(() => planCatalogEdition(
        [edition1()],
        desired(item(), asset(item(), 2, modelPath)),
      )).toThrow(/canonical|immutable \/versions\/v2\//)
    }

    const first = edition1()
    expect(() => flattenEditions([{
      ...first,
      assetVersions: [{ ...first.assetVersions[0], modelPath: '/dice/test-set/d6/model.glb#old' }],
    }])).toThrow(/canonical/)
  })

  it('rejects a historical GLB path whose bytes change in a later contract', () => {
    const contract2 = item(2)
    const changedBytes = {
      ...asset(contract2),
      modelSha256: '9'.repeat(64),
    }
    expect(() => flattenEditions([
      edition1(),
      {
        edition: 2,
        slug: 'contract-v2',
        migration: '0005_contract_v2.sql',
        items: [contract2],
        assetVersions: [changedBytes],
      },
    ])).toThrow(/changes bytes across catalog history/)
  })

  it('creates one item and one asset for contract v2', () => {
    const contract2 = item(2)
    const contract2Asset = asset(contract2)
    const delta = planCatalogEdition([edition1()], desired(contract2, contract2Asset))

    expect(delta.items.map(candidate => candidate.id)).toEqual(['test-set/d6@2'])
    expect(delta.assetVersions.map(candidate => candidate.id)).toEqual([
      'test-set/d6@2/asset@1',
    ])
  })

  it('emits only supplied delta rows', () => {
    const published = flattenEditions([edition1()])
    const asset2 = asset(item(), 2, '/dice/test-set/d6/versions/v2/model.glb')
    const assetDelta = planCatalogEdition([edition1()], desired(item(), asset2))
    const assetSql = buildCatalogDeltaSql(assetDelta, 'V2_TEST', published)

    expect(assetSql).not.toContain('insert into public.catalog_items')
    expect(assetSql).toContain("'test-set/d6@1/asset@2'")
    expect(assetSql).not.toContain("'test-set/d6@1/asset@1'")
    expect(assetSql).toContain('on conflict (id) do update')
    expect(assetSql).toContain('is distinct from')
    expect(assetSql).not.toContain('on conflict do nothing')

    const contract2 = item(2)
    const contractDelta = planCatalogEdition([edition1()], desired(contract2, asset(contract2)))
    const contractSql = buildCatalogDeltaSql(contractDelta, 'V2_CONTRACT', published)
    expect(contractSql).toContain("'test-set/d6@2'")
    expect(contractSql).not.toContain("'test-set/d6@1', 'test-set/d6'")
    expect(() => buildCatalogDeltaSql({ items: [], assetVersions: [] }, 'EMPTY'))
      .toThrow(/empty catalog edition/)
  })

  it('rejects historical IDs and full-history input masquerading as a delta', () => {
    const published = flattenEditions([edition1()])
    expect(() => buildCatalogDeltaSql(published, 'REPLAY', published))
      .toThrow(/already published/)

    const changedMetadata = { source: 'production', name: 'Collision' }
    const payloadCollision = {
      items: [],
      assetVersions: [{
        ...published.assetVersions[0],
        metadata: changedMetadata,
        metadataSha256: hashCatalogRow(changedMetadata),
      }],
    }
    expect(() => buildCatalogDeltaSql(payloadCollision, 'COLLISION', published))
      .toThrow(/already published/)
  })

  it('selects latest contracts numerically rather than lexically', () => {
    const latest = selectLatestCatalogItem([item(2), item(10)], 'test-set/d6')
    expect(latest?.contractVersion).toBe(10)
  })
})
