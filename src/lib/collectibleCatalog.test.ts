import { describe, expect, it, vi } from 'vitest'
import type { InventoryDie } from '../types/inventory'
import {
  COLLECTIBLE_CATALOG,
  createInventoryDieFromCatalogItem,
  ensureStarterEntitlements,
  fetchCatalogSnapshot,
  fetchMyEntitlements,
  getCatalogAssetVersion,
  getCatalogItemByKey,
  isCatalogItemRefValid,
  mapInventoryDieToCatalogRef,
} from './collectibleCatalog'

function inventoryDie(overrides: Partial<InventoryDie> = {}): InventoryDie {
  return {
    id: 'local-die-1',
    type: 'd6',
    setId: 'adventurer-starter',
    rarity: 'common',
    appearance: {
      baseColor: '#3b82f6',
      accentColor: '#ffffff',
      material: 'plastic',
    },
    vfx: {},
    name: 'Local die',
    isFavorite: false,
    isLocked: true,
    acquiredAt: 1,
    source: 'starter',
    stats: {
      timesRolled: 0,
      totalValue: 0,
      critsRolled: 0,
      failsRolled: 0,
    },
    assignedToRolls: [],
    ...overrides,
  }
}

describe('collectible catalog', () => {
  it('uses stable version-in-id contracts and excludes local artist dice', () => {
    expect(COLLECTIBLE_CATALOG.contractVersion).toBe(1)
    expect(COLLECTIBLE_CATALOG.items).toHaveLength(51)
    expect(COLLECTIBLE_CATALOG.items.every(item => item.id === `${item.catalogKey}@1`)).toBe(true)
    expect(COLLECTIBLE_CATALOG.assetVersions.every(asset => (
      asset.id === `${asset.catalogItemId}/asset@${asset.assetVersion}`
    ))).toBe(true)
    expect(COLLECTIBLE_CATALOG.items.some(item => item.setId === 'custom-artist')).toBe(false)
  })

  it('keeps Steel and Rubber as distinct catalog definitions', () => {
    const steel = getCatalogItemByKey('materials-lab/steel-d20')
    const rubber = getCatalogItemByKey('materials-lab/rubber-d20')

    expect(steel?.id).toBe('materials-lab/steel-d20@1')
    expect(rubber?.id).toBe('materials-lab/rubber-d20@1')
    expect(steel?.id).not.toBe(rubber?.id)
  })

  it('keeps an existing older asset ref valid after a newer default is appended', () => {
    const item = getCatalogItemByKey('adventurer-starter/d6/common')!
    const oldAsset = getCatalogAssetVersion(item.assetVersionId)!
    const latestAsset = {
      ...oldAsset,
      id: `${item.id}/asset@2`,
      assetVersion: 2,
    }
    const versionedCatalog = {
      items: [{ ...item, assetVersionId: latestAsset.id }],
      assetVersions: [oldAsset, latestAsset],
    }

    expect(isCatalogItemRefValid({
      itemId: item.id,
      assetVersionId: oldAsset.id,
    }, versionedCatalog)).toBe(true)
  })

  it('maps legacy configured, materials-lab and production instances without treating custom dice as catalog items', () => {
    expect(mapInventoryDieToCatalogRef(inventoryDie())?.itemId)
      .toBe('adventurer-starter/d6/common@1')
    expect(mapInventoryDieToCatalogRef(inventoryDie({
      type: 'd20',
      setId: 'materials-lab',
      rarity: 'rare',
      appearance: { baseColor: '#fff', accentColor: '#000', material: 'rubber' },
    }))?.itemId).toBe('materials-lab/rubber-d20@1')
    expect(mapInventoryDieToCatalogRef(inventoryDie({
      setId: 'devil-set',
      rarity: 'rare',
      customAsset: {
        modelUrl: '/dice/devil-set/devil-d6/model.glb',
        assetId: 'devil-set/devil-d6',
        metadata: createInventoryDieFromCatalogItem('devil-set/devil-d6@1', {
          source: 'starter',
        }).customAsset!.metadata,
      },
    }))?.itemId).toBe('devil-set/devil-d6@1')
    expect(mapInventoryDieToCatalogRef(inventoryDie({
      setId: 'custom-artist',
      rarity: 'rare',
      isDev: true,
    }))).toBeNull()
    expect(mapInventoryDieToCatalogRef(inventoryDie({
      setId: 'unrelated-bundled-asset',
      rarity: 'rare',
      customAsset: {
        modelUrl: '/dice/other/model.glb',
        storage: 'bundled',
        metadata: createInventoryDieFromCatalogItem('devil-set/devil-d6@1', {
          source: 'starter',
        }).customAsset!.metadata,
      },
    }))).toBeNull()
  })

  it('creates a bundled production instance with a descriptive catalog ref but no entitlement id', () => {
    const die = createInventoryDieFromCatalogItem('devil-set/devil-d6@1', {
      name: 'Devil d6 #1',
      source: 'starter',
    })

    expect(die.catalogRef).toEqual({
      itemId: 'devil-set/devil-d6@1',
      assetVersionId: 'devil-set/devil-d6@1/asset@1',
    })
    expect(die.customAsset).toMatchObject({
      modelUrl: '/dice/devil-set/devil-d6/model.glb',
      assetId: 'devil-set/devil-d6',
      storage: 'bundled',
    })
    expect(die).not.toHaveProperty('entitlementId')
  })

  it('reads RLS-scoped entitlements without accepting a user id or exposing a write API', async () => {
    const is = vi.fn().mockResolvedValue({
      data: [{
        id: 'grant-1',
        user_id: 'user-1',
        catalog_item_id: 'adventurer-starter/d20/common@1',
        grant_reason: 'starter',
        grant_ref: 'starter-v1:adventurer-starter/d20/common@1',
        provenance: { rpc: 'ensure_starter_entitlements' },
        granted_at: '2026-07-17T00:00:00Z',
        revoked_at: null,
      }],
      error: null,
    })
    const select = vi.fn(() => ({ is }))
    const client = { from: vi.fn(() => ({ select })) } as never

    await expect(fetchMyEntitlements(client)).resolves.toEqual([{
      id: 'grant-1',
      userId: 'user-1',
      catalogItemId: 'adventurer-starter/d20/common@1',
      grantReason: 'starter',
      grantRef: 'starter-v1:adventurer-starter/d20/common@1',
      provenance: { rpc: 'ensure_starter_entitlements' },
      grantedAt: '2026-07-17T00:00:00Z',
      revokedAt: null,
    }])
    expect(select).toHaveBeenCalledWith(
      'id, user_id, catalog_item_id, grant_reason, grant_ref, provenance, granted_at, revoked_at',
    )
    expect(is).toHaveBeenCalledWith('revoked_at', null)
  })

  it('returns an empty collection for a successful empty entitlement read', async () => {
    const client = {
      from: vi.fn(() => ({
        select: vi.fn(() => ({
          is: vi.fn().mockResolvedValue({ data: [], error: null }),
        })),
      })),
    } as never

    await expect(fetchMyEntitlements(client)).resolves.toEqual([])
  })

  it('returns null when the entitlement query reports an error', async () => {
    const client = {
      from: vi.fn(() => ({
        select: vi.fn(() => ({
          is: vi.fn().mockResolvedValue({ data: null, error: new Error('RLS unavailable') }),
        })),
      })),
    } as never

    await expect(fetchMyEntitlements(client)).resolves.toBeNull()
  })

  it('returns null when the entitlement read throws', async () => {
    const client = {
      from: vi.fn(() => ({
        select: vi.fn(() => ({
          is: vi.fn().mockRejectedValue(new Error('offline')),
        })),
      })),
    } as never

    await expect(fetchMyEntitlements(client)).resolves.toBeNull()
  })

  it('selects latest contract and asset versions numerically regardless of row order', async () => {
    const metadata = {
      source: 'configured',
      name: 'Starter D20',
      appearance: { baseColor: '#fff', accentColor: '#000', material: 'plastic' },
      vfx: {},
    }
    const from = vi.fn((table: string) => ({
      select: vi.fn().mockResolvedValue(table === 'catalog_items'
        ? {
            data: [10, 2].map(contractVersion => ({
              id: `adventurer-starter/d20/common@${contractVersion}`,
              catalog_key: 'adventurer-starter/d20/common',
              contract_version: contractVersion,
              item_kind: 'die',
              set_id: 'adventurer-starter',
              dice_type: 'd20',
              rarity: 'common',
            })),
            error: null,
          }
        : {
            data: [
              ...[10, 2].map(assetVersion => ({
                id: `adventurer-starter/d20/common@10/asset@${assetVersion}`,
                catalog_item_id: 'adventurer-starter/d20/common@10',
                asset_version: assetVersion,
                asset_kind: 'builtin',
                model_path: 'builtin:d20',
                model_sha256: null,
                metadata,
                metadata_sha256: `hash-${assetVersion}`,
              })),
              {
                id: 'adventurer-starter/d20/common@2/asset@1',
                catalog_item_id: 'adventurer-starter/d20/common@2',
                asset_version: 1,
                asset_kind: 'builtin',
                model_path: 'builtin:d20',
                model_sha256: null,
                metadata,
                metadata_sha256: 'hash-1',
              },
            ],
            error: null,
          }),
    }))

    const snapshot = await fetchCatalogSnapshot({ from } as never)

    expect(snapshot?.contractVersion).toBe(COLLECTIBLE_CATALOG.contractVersion)
    expect(getCatalogItemByKey('adventurer-starter/d20/common', snapshot!)).toMatchObject({
      id: 'adventurer-starter/d20/common@10',
      contractVersion: 10,
      assetVersionId: 'adventurer-starter/d20/common@10/asset@10',
    })
    expect(snapshot?.items).toHaveLength(2)
    expect(snapshot?.assetVersions).toHaveLength(3)
    expect(from).toHaveBeenCalledTimes(2)
  })

  it('returns null when the server catalog is unavailable', async () => {
    const client = {
      from: vi.fn(() => ({
        select: vi.fn().mockResolvedValue({ data: null, error: new Error('offline') }),
      })),
    } as never

    await expect(fetchCatalogSnapshot(client)).resolves.toBeNull()
  })

  it('returns null when the server catalog read throws', async () => {
    const client = {
      from: vi.fn(() => ({
        select: vi.fn().mockRejectedValue(new Error('offline')),
      })),
    } as never

    await expect(fetchCatalogSnapshot(client)).resolves.toBeNull()
  })

  it('calls only the no-argument starter grant RPC and degrades on failure', async () => {
    const rpc = vi.fn().mockResolvedValue({ error: null })
    await expect(ensureStarterEntitlements({ rpc } as never)).resolves.toBe(true)
    expect(rpc).toHaveBeenCalledWith('ensure_starter_entitlements')

    rpc.mockRejectedValueOnce(new Error('offline'))
    await expect(ensureStarterEntitlements({ rpc } as never)).resolves.toBe(false)
  })
})
