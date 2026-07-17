import crypto from 'node:crypto'

const POSTGRES_INTEGER_MAX = 2_147_483_647
const SHA256_PATTERN = /^[0-9a-f]{64}$/
const PATH_SEGMENT_PATTERN = /^[a-z0-9][a-z0-9_-]*$/
const GLB_FILE_PATTERN = /^[a-z0-9][a-z0-9_-]*\.glb$/
const ITEM_KINDS = new Set(['die'])
const DICE_TYPES = new Set(['d4', 'd6', 'd8', 'd10', 'd12', 'd20'])
const RARITIES = new Set(['common', 'uncommon', 'rare', 'epic', 'legendary', 'mythic'])
const ASSET_KINDS = new Set(['builtin', 'gltf'])
const BUILTIN_METADATA_SOURCES = new Set(['configured', 'standalone'])
const DIE_MATERIALS = new Set([
  'plastic',
  'resin',
  'metal',
  'rubber',
  'stone',
  'glass',
  'crystal',
  'wood',
  'bone',
  'obsidian',
  'celestial',
])

function compareStrings(left, right) {
  return left < right ? -1 : left > right ? 1 : 0
}

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize)
  if (!value || typeof value !== 'object') return value

  return Object.fromEntries(
    Object.keys(value)
      .sort(compareStrings)
      .map(key => [key, canonicalize(value[key])]),
  )
}

function canonicalJson(value) {
  return JSON.stringify(canonicalize(value))
}

function assertPositiveInteger(value, label) {
  if (!Number.isSafeInteger(value) || value < 1 || value > POSTGRES_INTEGER_MAX) {
    throw new Error(`${label} must be a positive PostgreSQL integer`)
  }
}

function assertRecord(value, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${label} must be an object`)
  }
}

function assertNonEmptyString(value, label) {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error(`${label} must be a non-empty string`)
  }
}

function assertEnum(value, allowed, label) {
  if (!allowed.has(value)) {
    throw new Error(`${label} is unsupported`)
  }
}

function assertSha256(value, label, { nullable = false } = {}) {
  if (nullable && value === null) return
  if (typeof value !== 'string' || !SHA256_PATTERN.test(value)) {
    throw new Error(`${label} must be a canonical lowercase SHA-256`)
  }
}

function assertCanonicalGltfPath(asset) {
  if (asset.assetKind !== 'gltf') return
  if (typeof asset.modelPath !== 'string') {
    throw new Error(`GLB asset ${asset.id} must have a canonical model path`)
  }

  const segments = asset.modelPath.split('/')
  const directories = segments.slice(2, -1)
  const filename = segments.at(-1)
  if (
    segments[0] !== '' ||
    segments[1] !== 'dice' ||
    directories.length === 0 ||
    directories.some(segment => !PATH_SEGMENT_PATTERN.test(segment)) ||
    !GLB_FILE_PATTERN.test(filename ?? '')
  ) {
    throw new Error(`GLB asset ${asset.id} must have a canonical /dice/.../*.glb path`)
  }

  const versionMarkers = directories
    .map((segment, index) => segment === 'versions' ? index : -1)
    .filter(index => index >= 0)
  if (asset.assetVersion > 1) {
    const markerIndex = directories.length - 2
    if (
      versionMarkers.length !== 1 ||
      versionMarkers[0] !== markerIndex ||
      directories[markerIndex + 1] !== `v${asset.assetVersion}`
    ) {
      throw new Error(
        `GLB asset ${asset.id} must use an immutable /versions/v${asset.assetVersion}/ path`,
      )
    }
  } else if (
    versionMarkers.length > 0 &&
    (
      versionMarkers.length !== 1 ||
      versionMarkers[0] !== directories.length - 2 ||
      directories.at(-1) !== 'v1'
    )
  ) {
    throw new Error(`GLB asset ${asset.id} has a mismatched version path`)
  }
}

function stripRuntimeItem(item) {
  return {
    id: item.id,
    catalogKey: item.catalogKey,
    contractVersion: item.contractVersion,
    itemKind: item.itemKind,
    setId: item.setId,
    diceType: item.diceType,
    rarity: item.rarity,
  }
}

function sortItems(items) {
  return [...items].sort((left, right) => (
    compareStrings(left.catalogKey, right.catalogKey) ||
    left.contractVersion - right.contractVersion ||
    compareStrings(left.id, right.id)
  ))
}

function sortAssets(assets) {
  return [...assets].sort((left, right) => (
    compareStrings(left.catalogItemId, right.catalogItemId) ||
    left.assetVersion - right.assetVersion ||
    compareStrings(left.id, right.id)
  ))
}

function assertItemShape(item) {
  assertRecord(item, 'Catalog item')
  assertPositiveInteger(item.contractVersion, `Contract version for ${item.id}`)
  assertEnum(item.itemKind, ITEM_KINDS, `Item kind for ${item.id}`)
  assertEnum(item.diceType, DICE_TYPES, `Dice type for ${item.id}`)
  assertEnum(item.rarity, RARITIES, `Rarity for ${item.id}`)
  if (item.id !== `${item.catalogKey}@${item.contractVersion}`) {
    throw new Error(`Catalog item ${item.id} does not match its key and version`)
  }
}

function assertAssetMetadata(asset, item) {
  assertRecord(asset.metadata, `Catalog asset ${asset.id} metadata`)
  assertNonEmptyString(asset.metadata.name, `Catalog asset ${asset.id} metadata name`)
  assertRecord(asset.metadata.appearance, `Catalog asset ${asset.id} metadata appearance`)
  assertNonEmptyString(
    asset.metadata.appearance.baseColor,
    `Catalog asset ${asset.id} appearance base color`,
  )
  assertNonEmptyString(
    asset.metadata.appearance.accentColor,
    `Catalog asset ${asset.id} appearance accent color`,
  )
  assertEnum(
    asset.metadata.appearance.material,
    DIE_MATERIALS,
    `Catalog asset ${asset.id} appearance material`,
  )
  assertRecord(asset.metadata.vfx, `Catalog asset ${asset.id} metadata vfx`)
  if (
    asset.metadata.description !== undefined &&
    typeof asset.metadata.description !== 'string'
  ) {
    throw new Error(`Catalog asset ${asset.id} metadata description must be a string`)
  }

  if (asset.assetKind === 'builtin') {
    assertEnum(
      asset.metadata.source,
      BUILTIN_METADATA_SOURCES,
      `Builtin catalog asset ${asset.id} metadata source`,
    )
    if (asset.modelPath !== `builtin:${item.diceType}`) {
      throw new Error(
        `Builtin catalog asset ${asset.id} must use model path builtin:${item.diceType}`,
      )
    }
    if (asset.modelSha256 !== null) {
      throw new Error(`Builtin catalog asset ${asset.id} must not declare a model hash`)
    }
    if ('diceMetadata' in asset.metadata) {
      throw new Error(`Builtin catalog asset ${asset.id} must not declare GLTF dice metadata`)
    }
    return
  }

  if (asset.metadata.source !== 'production') {
    throw new Error(`GLB catalog asset ${asset.id} metadata source must be production`)
  }
  assertRecord(asset.metadata.diceMetadata, `GLB catalog asset ${asset.id} dice metadata`)
  if (asset.metadata.diceMetadata.diceType !== item.diceType) {
    throw new Error(`GLB catalog asset ${asset.id} dice metadata type must match its item`)
  }
  if (
    asset.metadata.diceMetadata.setId !== undefined &&
    asset.metadata.diceMetadata.setId !== item.setId
  ) {
    throw new Error(`GLB catalog asset ${asset.id} dice metadata set must match its item`)
  }
  if (
    asset.metadata.diceMetadata.rarity !== undefined &&
    asset.metadata.diceMetadata.rarity !== item.rarity
  ) {
    throw new Error(`GLB catalog asset ${asset.id} dice metadata rarity must match its item`)
  }
  if (asset.metadata.delivery !== undefined) {
    const delivery = asset.metadata.delivery
    assertRecord(delivery, `GLB catalog asset ${asset.id} delivery metadata`)
    assertNonEmptyString(delivery.thumbnailPath, `GLB catalog asset ${asset.id} thumbnail path`)
    assertSha256(delivery.thumbnailSha256, `GLB catalog asset ${asset.id} thumbnail hash`)
    for (const key of ['thumbnailBytes', 'modelBytes', 'embeddedTextureBytes', 'maxTextureDimension', 'canonicalReferenceVersion']) {
      assertPositiveInteger(delivery[key], `GLB catalog asset ${asset.id} delivery ${key}`)
    }
    if (delivery.textureFormat !== 'image/webp') {
      throw new Error(`GLB catalog asset ${asset.id} textures must use image/webp`)
    }
    const expectedThumbnailPath = asset.modelPath.replace(/model\.glb$/, 'thumbnail.png')
    if (delivery.thumbnailPath !== expectedThumbnailPath) {
      throw new Error(`GLB catalog asset ${asset.id} thumbnail path must match its model directory`)
    }
  }
}

function assertAssetShape(asset, itemsById) {
  assertRecord(asset, 'Catalog asset')
  assertPositiveInteger(asset.assetVersion, `Asset version for ${asset.id}`)
  assertEnum(asset.assetKind, ASSET_KINDS, `Asset kind for ${asset.id}`)
  if (asset.id !== `${asset.catalogItemId}/asset@${asset.assetVersion}`) {
    throw new Error(`Catalog asset ${asset.id} does not match its item and version`)
  }
  const item = itemsById.get(asset.catalogItemId)
  if (!item) {
    throw new Error(`Catalog asset ${asset.id} references unknown item ${asset.catalogItemId}`)
  }
  assertAssetMetadata(asset, item)
  assertSha256(asset.metadataSha256, `Metadata hash for ${asset.id}`)
  const expectedMetadataSha256 = hashCatalogRow(asset.metadata)
  if (asset.metadataSha256 !== expectedMetadataSha256) {
    throw new Error(`Catalog asset ${asset.id} metadata hash does not match canonical metadata`)
  }
  if (asset.assetKind === 'gltf') {
    assertSha256(asset.modelSha256, `Model hash for ${asset.id}`)
  }
  assertCanonicalGltfPath(asset)
}

function validateVersionSequences(items, assets) {
  const versionsByKey = new Map()
  for (const item of items) {
    const versions = versionsByKey.get(item.catalogKey) ?? []
    versions.push(item.contractVersion)
    versionsByKey.set(item.catalogKey, versions)
  }
  for (const [catalogKey, versions] of versionsByKey) {
    versions.sort((left, right) => left - right)
    versions.forEach((version, index) => {
      if (version !== index + 1) {
        throw new Error(`Catalog key ${catalogKey} has noncontiguous contract versions`)
      }
    })
  }

  const versionsByItem = new Map()
  for (const asset of assets) {
    const versions = versionsByItem.get(asset.catalogItemId) ?? []
    versions.push(asset.assetVersion)
    versionsByItem.set(asset.catalogItemId, versions)
  }
  for (const [catalogItemId, versions] of versionsByItem) {
    versions.sort((left, right) => left - right)
    versions.forEach((version, index) => {
      if (version !== index + 1) {
        throw new Error(`Catalog item ${catalogItemId} has noncontiguous asset versions`)
      }
    })
  }
}

function validateRows(items, assets) {
  const itemsById = new Map()
  for (const item of items) {
    assertItemShape(item)
    if (itemsById.has(item.id)) throw new Error(`Duplicate catalog item id ${item.id}`)
    itemsById.set(item.id, item)
  }

  const assetIds = new Set()
  for (const asset of assets) {
    assertAssetShape(asset, itemsById)
    if (assetIds.has(asset.id)) throw new Error(`Duplicate catalog asset id ${asset.id}`)
    assetIds.add(asset.id)
  }

  const assetOneItemIds = new Set(
    assets.filter(asset => asset.assetVersion === 1).map(asset => asset.catalogItemId),
  )
  for (const item of items) {
    if (!assetOneItemIds.has(item.id)) {
      throw new Error(`Catalog item ${item.id} must have asset version 1`)
    }
  }

  const modelHashByPath = new Map()
  for (const asset of assets.filter(candidate => candidate.assetKind === 'gltf')) {
    const previousHash = modelHashByPath.get(asset.modelPath)
    if (previousHash && previousHash !== asset.modelSha256) {
      throw new Error(`GLB path ${asset.modelPath} changes bytes across catalog history`)
    }
    modelHashByPath.set(asset.modelPath, asset.modelSha256)
  }

  validateVersionSequences(items, assets)
}

/** Flatten immutable edition manifests into deterministic database rows. */
export function flattenEditions(editions) {
  const ordered = [...editions].sort((left, right) => left.edition - right.edition)
  ordered.forEach((edition, index) => {
    assertPositiveInteger(edition.edition, 'Edition number')
    if (edition.edition !== index + 1) {
      throw new Error('Catalog editions must be contiguous and start at 1')
    }
  })

  const items = ordered.flatMap(edition => edition.items.map(stripRuntimeItem))
  const assetVersions = ordered.flatMap(edition => edition.assetVersions)
  validateRows(items, assetVersions)

  return {
    items: sortItems(items),
    assetVersions: sortAssets(assetVersions),
  }
}

function latestItemByKey(items) {
  const latest = new Map()
  for (const item of items) {
    const previous = latest.get(item.catalogKey)
    if (!previous || item.contractVersion > previous.contractVersion) {
      latest.set(item.catalogKey, item)
    }
  }
  return latest
}

function latestAssetByItem(assets) {
  const latest = new Map()
  for (const asset of assets) {
    const previous = latest.get(asset.catalogItemId)
    if (!previous || asset.assetVersion > previous.assetVersion) {
      latest.set(asset.catalogItemId, asset)
    }
  }
  return latest
}

function assertSamePayload(kind, id, current, published) {
  if (canonicalJson(current) !== canonicalJson(published)) {
    throw new Error(`${kind} ${id} changed without a version bump`)
  }
}

function assertImmutableGltfPath(asset, historicalAssets) {
  if (asset.assetKind !== 'gltf') return

  const reused = historicalAssets.find(previous => previous.modelPath === asset.modelPath)
  if (reused && reused.modelSha256 !== asset.modelSha256) {
    throw new Error(`GLB asset ${asset.id} changes bytes at published path ${asset.modelPath}`)
  }
  if (asset.assetVersion === 1) return
  if (reused) throw new Error(`GLB asset ${asset.id} reuses a published model path`)
}

/**
 * Compute the minimal append-only edition needed to make history match the
 * desired current source. Existing ids are compared byte-for-byte by canonical
 * JSON; only the next contract or asset version may be appended.
 */
export function planCatalogEdition(editions, desiredCurrent) {
  const history = flattenEditions(editions)
  const historicalItemsById = new Map(history.items.map(item => [item.id, item]))
  const historicalAssetsById = new Map(history.assetVersions.map(asset => [asset.id, asset]))
  const historicalLatestItems = latestItemByKey(history.items)
  const historicalLatestAssets = latestAssetByItem(history.assetVersions)

  const desiredItems = desiredCurrent.items.map(stripRuntimeItem)
  const desiredKeys = new Set()
  for (const item of desiredItems) {
    assertItemShape(item)
    if (desiredKeys.has(item.catalogKey)) {
      throw new Error(`Desired catalog repeats key ${item.catalogKey}`)
    }
    desiredKeys.add(item.catalogKey)
  }
  for (const catalogKey of historicalLatestItems.keys()) {
    if (!desiredKeys.has(catalogKey)) {
      throw new Error(`Published catalog key ${catalogKey} cannot be removed`)
    }
  }

  const desiredAssetsByItem = new Map()
  for (const asset of desiredCurrent.assetVersions) {
    if (desiredAssetsByItem.has(asset.catalogItemId)) {
      throw new Error(`Desired catalog repeats assets for ${asset.catalogItemId}`)
    }
    desiredAssetsByItem.set(asset.catalogItemId, asset)
  }

  const newItems = []
  const newAssets = []
  const knownItemsById = new Map(historicalItemsById)
  for (const item of desiredItems) {
    const historicalItem = historicalItemsById.get(item.id)
    const previousItem = historicalLatestItems.get(item.catalogKey)
    if (historicalItem) {
      assertSamePayload('Catalog item', item.id, item, historicalItem)
      if (previousItem?.id !== item.id) {
        throw new Error(`Catalog key ${item.catalogKey} must target its latest contract`)
      }
    } else if (previousItem) {
      if (item.contractVersion !== previousItem.contractVersion + 1) {
        throw new Error(`Catalog key ${item.catalogKey} must append contract version ${previousItem.contractVersion + 1}`)
      }
      newItems.push(item)
    } else {
      if (item.contractVersion !== 1) {
        throw new Error(`New catalog key ${item.catalogKey} must start at contract version 1`)
      }
      newItems.push(item)
    }
    knownItemsById.set(item.id, item)

    const asset = desiredAssetsByItem.get(item.id)
    if (!asset) throw new Error(`Desired catalog item ${item.id} has no current asset`)
    assertAssetShape(asset, knownItemsById)

    const historicalAsset = historicalAssetsById.get(asset.id)
    const previousAsset = historicalLatestAssets.get(item.id)
    if (historicalAsset) {
      assertSamePayload('Catalog asset', asset.id, asset, historicalAsset)
      if (previousAsset?.id !== asset.id) {
        throw new Error(`Catalog item ${item.id} must target its latest asset`)
      }
    } else if (previousAsset) {
      if (asset.assetVersion !== previousAsset.assetVersion + 1) {
        throw new Error(`Catalog item ${item.id} must append asset version ${previousAsset.assetVersion + 1}`)
      }
      assertImmutableGltfPath(asset, history.assetVersions)
      newAssets.push(asset)
    } else {
      if (asset.assetVersion !== 1) {
        throw new Error(`New catalog item ${item.id} must start at asset version 1`)
      }
      assertImmutableGltfPath(asset, history.assetVersions)
      newAssets.push(asset)
    }
  }

  const desiredItemIds = new Set(desiredItems.map(item => item.id))
  for (const catalogItemId of desiredAssetsByItem.keys()) {
    if (!desiredItemIds.has(catalogItemId)) {
      throw new Error(`Desired asset references non-current item ${catalogItemId}`)
    }
  }

  return {
    items: sortItems(newItems),
    assetVersions: sortAssets(newAssets),
  }
}

/** Aggregate all immutable rows and attach each contract's latest asset. */
export function compileCatalogHistory(editions, delta = { items: [], assetVersions: [] }) {
  const history = flattenEditions(editions)
  const items = [...history.items, ...delta.items.map(stripRuntimeItem)]
  const assetVersions = [...history.assetVersions, ...delta.assetVersions]
  validateRows(items, assetVersions)

  const latestAssets = latestAssetByItem(assetVersions)
  const runtimeItems = sortItems(items).map(item => {
    const asset = latestAssets.get(item.id)
    if (!asset) throw new Error(`Catalog item ${item.id} has no asset version`)
    return { ...item, assetVersionId: asset.id }
  })

  return {
    contractVersion: 1,
    items: runtimeItems,
    assetVersions: sortAssets(assetVersions),
  }
}

/** Explicit numeric latest selection; never depend on row or lexical order. */
export function selectLatestCatalogItem(items, catalogKey) {
  return items
    .filter(item => item.catalogKey === catalogKey)
    .reduce((latest, item) => (
      !latest || item.contractVersion > latest.contractVersion ? item : latest
    ), undefined)
}

function sqlString(value) {
  return `'${String(value).replaceAll("'", "''")}'`
}

/**
 * Render only rows that are absent from the supplied published history.
 * Conflicting replays are routed through the catalog's immutable-update trigger.
 */
export function buildCatalogDeltaSql(
  delta,
  label,
  publishedHistory = { items: [], assetVersions: [] },
) {
  if (delta.items.length === 0 && delta.assetVersions.length === 0) {
    throw new Error('Cannot build an empty catalog edition')
  }
  if (!/^[A-Za-z0-9][A-Za-z0-9_-]*$/.test(label)) {
    throw new Error('Catalog edition label contains unsupported characters')
  }

  const publishedItems = publishedHistory.items.map(stripRuntimeItem)
  const publishedAssets = [...publishedHistory.assetVersions]
  validateRows(publishedItems, publishedAssets)

  const items = sortItems(delta.items.map(stripRuntimeItem))
  const assets = sortAssets(delta.assetVersions)
  const publishedItemIds = new Set(publishedItems.map(item => item.id))
  const publishedAssetIds = new Set(publishedAssets.map(asset => asset.id))
  for (const item of items) {
    if (publishedItemIds.has(item.id)) {
      throw new Error(`Delta catalog item ${item.id} is already published`)
    }
  }
  for (const asset of assets) {
    if (publishedAssetIds.has(asset.id)) {
      throw new Error(`Delta catalog asset ${asset.id} is already published`)
    }
  }
  validateRows([...publishedItems, ...items], [...publishedAssets, ...assets])

  const sections = [
    `-- BEGIN GENERATED COLLECTIBLE CATALOG ${label}`,
    '-- Generated by scripts/generate-collectible-catalog.js. Do not edit by hand.',
  ]
  if (items.length > 0) {
    const rows = items.map(item => `  (${[
      item.id,
      item.catalogKey,
      item.contractVersion,
      item.itemKind,
      item.setId,
      item.diceType,
      item.rarity,
    ].map((value, index) => index === 2 ? value : sqlString(value)).join(', ')})`)
    sections.push(
      'insert into public.catalog_items',
      '  (id, catalog_key, contract_version, item_kind, set_id, dice_type, rarity)',
      'values',
      `${rows.join(',\n')}\n`,
      'on conflict (id) do update',
      'set id = excluded.id',
      'where (catalog_items.catalog_key, catalog_items.contract_version, catalog_items.item_kind,',
      '       catalog_items.set_id, catalog_items.dice_type, catalog_items.rarity)',
      '  is distinct from (excluded.catalog_key, excluded.contract_version, excluded.item_kind,',
      '                    excluded.set_id, excluded.dice_type, excluded.rarity);',
    )
  }

  if (assets.length > 0) {
    const rows = assets.map(asset => `  (${[
      sqlString(asset.id),
      sqlString(asset.catalogItemId),
      asset.assetVersion,
      sqlString(asset.assetKind),
      sqlString(asset.modelPath),
      asset.modelSha256 ? sqlString(asset.modelSha256) : 'null',
      `${sqlString(canonicalJson(asset.metadata))}::jsonb`,
      sqlString(asset.metadataSha256),
    ].join(', ')})`)
    sections.push(
      '',
      'insert into public.catalog_asset_versions',
      '  (id, catalog_item_id, asset_version, asset_kind, model_path, model_sha256, metadata, metadata_sha256)',
      'values',
      `${rows.join(',\n')}\n`,
      'on conflict (id) do update',
      'set id = excluded.id',
      'where (catalog_asset_versions.catalog_item_id, catalog_asset_versions.asset_version,',
      '       catalog_asset_versions.asset_kind, catalog_asset_versions.model_path,',
      '       catalog_asset_versions.model_sha256, catalog_asset_versions.metadata,',
      '       catalog_asset_versions.metadata_sha256)',
      '  is distinct from (excluded.catalog_item_id, excluded.asset_version, excluded.asset_kind,',
      '                    excluded.model_path, excluded.model_sha256, excluded.metadata,',
      '                    excluded.metadata_sha256);',
    )
  }

  sections.push(`-- END GENERATED COLLECTIBLE CATALOG ${label}`, '')
  return sections.join('\n')
}

export function hashCatalogRow(row) {
  return crypto.createHash('sha256').update(canonicalJson(row)).digest('hex')
}
