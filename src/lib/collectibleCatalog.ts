import type { SupabaseClient } from '@supabase/supabase-js'
import generatedCatalog from '../generated/collectibleCatalog.json'
import type {
  BuiltinCatalogAssetVersion,
  CatalogAssetVersion,
  CatalogItem,
  CatalogItemRef,
  CollectibleCatalog,
  CollectibleEntitlement,
  GltfCatalogAssetVersion,
} from '../types/catalog'
import type { AcquisitionSource, InventoryDie, NewInventoryDie } from '../types/inventory'

export const COLLECTIBLE_CATALOG = generatedCatalog as unknown as CollectibleCatalog

const itemsById = new Map(COLLECTIBLE_CATALOG.items.map(item => [item.id, item]))
const itemsByKey = indexLatestItemsByKey(COLLECTIBLE_CATALOG.items)
const assetsById = new Map(COLLECTIBLE_CATALOG.assetVersions.map(asset => [asset.id, asset]))

function indexLatestItemsByKey(items: readonly CatalogItem[]): Map<string, CatalogItem> {
  const latestByKey = new Map<string, CatalogItem>()
  for (const item of items) {
    const previous = latestByKey.get(item.catalogKey)
    if (!previous || item.contractVersion > previous.contractVersion) {
      latestByKey.set(item.catalogKey, item)
    }
  }
  return latestByKey
}

function indexLatestAssetsByItemId(
  assets: readonly CatalogAssetVersion[],
): Map<string, CatalogAssetVersion> {
  const latestByItemId = new Map<string, CatalogAssetVersion>()
  for (const asset of assets) {
    const previous = latestByItemId.get(asset.catalogItemId)
    if (!previous || asset.assetVersion > previous.assetVersion) {
      latestByItemId.set(asset.catalogItemId, asset)
    }
  }
  return latestByItemId
}

export function getCatalogItem(itemId: string): CatalogItem | undefined {
  return itemsById.get(itemId)
}

export function getCatalogItemByKey(
  catalogKey: string,
  catalog: Pick<CollectibleCatalog, 'items'> = COLLECTIBLE_CATALOG,
): CatalogItem | undefined {
  if (catalog === COLLECTIBLE_CATALOG) return itemsByKey.get(catalogKey)
  return indexLatestItemsByKey(catalog.items).get(catalogKey)
}

export function getCatalogAssetVersion(assetVersionId: string): CatalogAssetVersion | undefined {
  return assetsById.get(assetVersionId)
}

export function getCatalogItemRef(item: CatalogItem): CatalogItemRef {
  return {
    itemId: item.id,
    assetVersionId: item.assetVersionId,
  }
}

/** A ref is valid when its immutable asset revision belongs to its item. */
export function isCatalogItemRefValid(
  ref: CatalogItemRef | undefined,
  catalog: Pick<CollectibleCatalog, 'items' | 'assetVersions'> = COLLECTIBLE_CATALOG,
): ref is CatalogItemRef {
  if (!ref) return false
  const item = catalog.items.find(candidate => candidate.id === ref.itemId)
  const asset = catalog.assetVersions.find(candidate => candidate.id === ref.assetVersionId)
  return Boolean(item && asset?.catalogItemId === item.id)
}

function validExplicitRef(ref: CatalogItemRef | undefined): CatalogItemRef | null {
  return isCatalogItemRefValid(ref) ? ref : null
}

/**
 * Best-effort compatibility mapping for local inventory instances created
 * before catalog refs existed. A match describes the item; it does not grant
 * or verify ownership.
 */
export function mapInventoryDieToCatalogRef(die: InventoryDie): CatalogItemRef | null {
  const explicit = validExplicitRef(die.catalogRef)
  if (explicit) return explicit
  if (die.isDev || die.setId === 'custom-artist') return null

  const productionKey = die.customAsset?.assetId === 'devil-set/devil-d6' ||
    die.customAsset?.modelUrl === '/dice/devil-set/devil-d6/model.glb'
    ? 'devil-set/devil-d6'
    : null
  if (productionKey) {
    const item = getCatalogItemByKey(productionKey)
    return item ? getCatalogItemRef(item) : null
  }

  if (die.setId === 'materials-lab') {
    const materialKey = die.appearance.material === 'metal'
      ? 'materials-lab/steel-d20'
      : die.appearance.material === 'rubber'
        ? 'materials-lab/rubber-d20'
        : null
    const item = materialKey ? getCatalogItemByKey(materialKey) : undefined
    return item ? getCatalogItemRef(item) : null
  }

  const item = getCatalogItemByKey(`${die.setId}/${die.type}/${die.rarity}`)
  return item ? getCatalogItemRef(item) : null
}

export interface CatalogInventoryDieOptions {
  readonly name?: string
  readonly source: AcquisitionSource
  readonly isLocked?: boolean
}

/** Create a local playable instance from a bundled catalog definition. */
export function createInventoryDieFromCatalogItem(
  itemId: string,
  options: CatalogInventoryDieOptions,
): Omit<NewInventoryDie, 'id' | 'acquiredAt'> {
  const item = getCatalogItem(itemId)
  if (!item) throw new Error(`Catalog item ${itemId} not found`)
  const asset = getCatalogAssetVersion(item.assetVersionId)
  if (!asset) throw new Error(`Catalog asset ${item.assetVersionId} not found`)

  const die: Omit<NewInventoryDie, 'id' | 'acquiredAt'> = {
    type: item.diceType,
    setId: item.setId,
    rarity: item.rarity,
    appearance: asset.metadata.appearance,
    vfx: asset.metadata.vfx,
    name: options.name ?? asset.metadata.name,
    description: asset.metadata.description,
    isFavorite: false,
    isLocked: options.isLocked ?? true,
    source: options.source,
    catalogRef: getCatalogItemRef(item),
  }

  if (asset.assetKind === 'gltf') {
    die.customAsset = {
      modelUrl: asset.modelPath,
      assetId: item.catalogKey,
      storage: 'bundled',
      metadata: asset.metadata.diceMetadata,
    }
  }

  return die
}

interface CatalogItemRow {
  id: string
  catalog_key: string
  contract_version: number
  item_kind: 'die'
  set_id: string
  dice_type: CatalogItem['diceType']
  rarity: CatalogItem['rarity']
}

interface CatalogAssetRowBase {
  id: string
  catalog_item_id: string
  asset_version: number
  metadata_sha256: string
}

type CatalogAssetRow = CatalogAssetRowBase & (
  | {
      asset_kind: 'builtin'
      model_path: BuiltinCatalogAssetVersion['modelPath']
      model_sha256: null
      metadata: BuiltinCatalogAssetVersion['metadata']
    }
  | {
      asset_kind: 'gltf'
      model_path: string
      model_sha256: string
      metadata: GltfCatalogAssetVersion['metadata']
    }
)

/** Read the public server catalog. Returns null on an unavailable/offline backend. */
export async function fetchCatalogSnapshot(client: SupabaseClient): Promise<CollectibleCatalog | null> {
  try {
    const [itemResult, assetResult] = await Promise.all([
      client.from('catalog_items').select(
        'id, catalog_key, contract_version, item_kind, set_id, dice_type, rarity',
      ),
      client.from('catalog_asset_versions').select(
        'id, catalog_item_id, asset_version, asset_kind, model_path, model_sha256, metadata, metadata_sha256',
      ),
    ])
    if (itemResult.error || assetResult.error) return null

    const assetVersions = ((assetResult.data ?? []) as unknown as CatalogAssetRow[])
      .map(row => {
        const common = {
          id: row.id,
          catalogItemId: row.catalog_item_id,
          assetVersion: row.asset_version,
          metadataSha256: row.metadata_sha256,
        }
        if (row.asset_kind === 'gltf') {
          return {
            ...common,
            assetKind: row.asset_kind,
            modelPath: row.model_path,
            modelSha256: row.model_sha256,
            metadata: row.metadata,
          } satisfies GltfCatalogAssetVersion
        }
        return {
          ...common,
          assetKind: row.asset_kind,
          modelPath: row.model_path,
          modelSha256: row.model_sha256,
          metadata: row.metadata,
        } satisfies BuiltinCatalogAssetVersion
      })
    const latestAssetByItemId = indexLatestAssetsByItemId(assetVersions)

    const items = ((itemResult.data ?? []) as unknown as CatalogItemRow[])
      .map(row => {
        const asset = latestAssetByItemId.get(row.id)
        if (!asset) return null
        return {
          id: row.id,
          catalogKey: row.catalog_key,
          contractVersion: row.contract_version,
          itemKind: row.item_kind,
          setId: row.set_id,
          diceType: row.dice_type,
          rarity: row.rarity,
          assetVersionId: asset.id,
        } satisfies CatalogItem
      })
      .filter((item): item is CatalogItem => item !== null)

    return { contractVersion: COLLECTIBLE_CATALOG.contractVersion, items, assetVersions }
  } catch {
    return null
  }
}

interface EntitlementRow {
  id: string
  user_id: string
  catalog_item_id: string
  grant_reason: string
  grant_ref: string
  provenance: Record<string, unknown> | null
  granted_at: string
  revoked_at: string | null
}

/** RLS-scoped entitlement read. Returns null when ownership cannot be verified. */
export async function fetchMyEntitlements(
  client: SupabaseClient,
): Promise<readonly CollectibleEntitlement[] | null> {
  try {
    const { data, error } = await client
      .from('user_entitlements')
      .select('id, user_id, catalog_item_id, grant_reason, grant_ref, provenance, granted_at, revoked_at')
      .is('revoked_at', null)
    if (error) return null

    return ((data ?? []) as unknown as EntitlementRow[]).map(row => ({
      id: row.id,
      userId: row.user_id,
      catalogItemId: row.catalog_item_id,
      grantReason: row.grant_reason,
      grantRef: row.grant_ref,
      provenance: row.provenance ?? {},
      grantedAt: row.granted_at,
      revokedAt: row.revoked_at,
    }))
  } catch {
    return null
  }
}

/**
 * The only client-callable grant path: a no-argument, server-fixed starter RPC.
 * It is best-effort so auth/offline startup remains playable.
 */
export async function ensureStarterEntitlements(client: SupabaseClient): Promise<boolean> {
  try {
    const { error } = await client.rpc('ensure_starter_entitlements')
    return !error
  } catch {
    return false
  }
}
