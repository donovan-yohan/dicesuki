#!/usr/bin/env node

import crypto from 'crypto'
import fs from 'fs'
import path from 'path'
import process from 'process'
import { fileURLToPath } from 'url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const ROOT_DIR = path.join(__dirname, '..')
const SOURCE_PATH = path.join(ROOT_DIR, 'src', 'config', 'collectibleCatalogSource.json')
const DICE_DIR = path.join(ROOT_DIR, 'public', 'dice')
const JSON_OUTPUT_PATH = path.join(ROOT_DIR, 'src', 'generated', 'collectibleCatalog.json')
const SQL_OUTPUT_PATH = path.join(ROOT_DIR, 'supabase', 'catalog', 'collectible_catalog_v1.sql')
const CHECK_ONLY = process.argv.includes('--check')

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

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex')
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'))
}

function catalogItem(source, catalogKey, setId, diceType, rarity) {
  const id = `${catalogKey}@${source.contractVersion}`
  return {
    id,
    catalogKey,
    contractVersion: source.contractVersion,
    itemKind: 'die',
    setId,
    diceType,
    rarity,
    assetVersionId: `${id}/asset@${source.assetVersion}`,
  }
}

function assetVersion(source, item, assetKind, modelPath, modelSha256, metadata) {
  return {
    id: item.assetVersionId,
    catalogItemId: item.id,
    assetVersion: source.assetVersion,
    assetKind,
    modelPath,
    modelSha256,
    metadata,
    metadataSha256: sha256(canonicalJson(metadata)),
  }
}

function configuredEntries(source) {
  const entries = []
  const sets = [...source.configuredSets].sort((left, right) => compareStrings(left.id, right.id))

  for (const set of sets) {
    if (set.id === 'custom-artist') {
      throw new Error('custom-artist must remain local-only and cannot enter the collectible catalog')
    }

    for (const diceType of source.diceShapes) {
      for (const rarity of Object.keys(set.rarityVariants).sort(compareStrings)) {
        const catalogKey = `${set.id}/${diceType}/${rarity}`
        const item = catalogItem(source, catalogKey, set.id, diceType, rarity)
        const variant = set.rarityVariants[rarity]
        const metadata = {
          source: 'configured',
          name: `${set.name} ${diceType.toUpperCase()}`,
          description: set.description,
          appearance: variant.appearance,
          vfx: variant.vfx,
        }
        entries.push({
          item,
          asset: assetVersion(source, item, 'builtin', `builtin:${diceType}`, null, metadata),
        })
      }
    }
  }

  return entries
}

function standaloneEntries(source) {
  return [...source.standaloneItems]
    .sort((left, right) => compareStrings(left.catalogKey, right.catalogKey))
    .map(definition => {
      const item = catalogItem(
        source,
        definition.catalogKey,
        definition.setId,
        definition.diceType,
        definition.rarity,
      )
      const metadata = {
        source: 'standalone',
        name: definition.name,
        description: definition.description,
        appearance: definition.appearance,
        vfx: definition.vfx,
      }
      return {
        item,
        asset: assetVersion(source, item, 'builtin', `builtin:${definition.diceType}`, null, metadata),
      }
    })
}

function productionEntries(source) {
  const entries = []
  const setDirectories = fs.readdirSync(DICE_DIR, { withFileTypes: true })
    .filter(entry => entry.isDirectory() && !entry.name.startsWith('.'))
    .sort((left, right) => compareStrings(left.name, right.name))

  for (const setDirectory of setDirectories) {
    const setId = setDirectory.name
    const setPath = path.join(DICE_DIR, setId)
    const setMetadataPath = path.join(setPath, 'set.json')
    if (!fs.existsSync(setMetadataPath)) continue

    const setMetadata = readJson(setMetadataPath)
    if (setMetadata.id !== setId) {
      throw new Error(`${setMetadataPath} id must match its directory`)
    }

    const diceDirectories = fs.readdirSync(setPath, { withFileTypes: true })
      .filter(entry => entry.isDirectory() && !entry.name.startsWith('.'))
      .sort((left, right) => compareStrings(left.name, right.name))

    for (const diceDirectory of diceDirectories) {
      const diceId = diceDirectory.name
      const dicePath = path.join(setPath, diceId)
      const modelFilePath = path.join(dicePath, 'model.glb')
      const metadataFilePath = path.join(dicePath, 'metadata.json')
      if (!fs.existsSync(modelFilePath) || !fs.existsSync(metadataFilePath)) continue

      const diceMetadata = readJson(metadataFilePath)
      if (diceMetadata.setId && diceMetadata.setId !== setId) {
        throw new Error(`${metadataFilePath} setId must match its parent set`)
      }
      if (typeof diceMetadata.rarity !== 'string') {
        throw new Error(`${metadataFilePath} must declare rarity for catalog generation`)
      }

      const catalogKey = `${setId}/${diceId}`
      const item = catalogItem(source, catalogKey, setId, diceMetadata.diceType, diceMetadata.rarity)
      const metadata = {
        source: 'production',
        name: diceMetadata.name,
        description: diceMetadata.description ?? setMetadata.description,
        appearance: {
          baseColor: '#8b5cf6',
          accentColor: '#ffffff',
          material: 'plastic',
          roughness: 0.7,
          metalness: 0,
        },
        vfx: {},
        diceMetadata,
      }
      entries.push({
        item,
        asset: assetVersion(
          source,
          item,
          'gltf',
          `/dice/${setId}/${diceId}/model.glb`,
          sha256(fs.readFileSync(modelFilePath)),
          metadata,
        ),
      })
    }
  }

  return entries
}

export function buildCatalog() {
  const source = readJson(SOURCE_PATH)
  if (source.contractVersion !== 1 || source.assetVersion !== 1) {
    throw new Error('This generator only supports collectible catalog contract/asset version 1')
  }

  const entries = [
    ...configuredEntries(source),
    ...standaloneEntries(source),
    ...productionEntries(source),
  ].sort((left, right) => compareStrings(left.item.id, right.item.id))

  const duplicateIds = entries
    .map(entry => entry.item.id)
    .filter((id, index, ids) => ids.indexOf(id) !== index)
  if (duplicateIds.length > 0) {
    throw new Error(`Duplicate catalog item ids: ${duplicateIds.join(', ')}`)
  }

  return {
    contractVersion: source.contractVersion,
    items: entries.map(entry => entry.item),
    assetVersions: entries.map(entry => entry.asset),
  }
}

function sqlString(value) {
  return `'${String(value).replaceAll("'", "''")}'`
}

export function buildSql(catalog) {
  const itemRows = catalog.items.map(item => `  (${[
    item.id,
    item.catalogKey,
    item.contractVersion,
    item.itemKind,
    item.setId,
    item.diceType,
    item.rarity,
  ].map((value, index) => index === 2 ? value : sqlString(value)).join(', ')})`)

  const assetRows = catalog.assetVersions.map(asset => `  (${[
    sqlString(asset.id),
    sqlString(asset.catalogItemId),
    asset.assetVersion,
    sqlString(asset.assetKind),
    sqlString(asset.modelPath),
    asset.modelSha256 ? sqlString(asset.modelSha256) : 'null',
    `${sqlString(canonicalJson(asset.metadata))}::jsonb`,
    sqlString(asset.metadataSha256),
  ].join(', ')})`)

  return [
    '-- BEGIN GENERATED COLLECTIBLE CATALOG V1',
    '-- Generated by scripts/generate-collectible-catalog.js. Do not edit by hand.',
    'insert into public.catalog_items',
    '  (id, catalog_key, contract_version, item_kind, set_id, dice_type, rarity)',
    'values',
    `${itemRows.join(',\n')}\n`,
    'on conflict do nothing;',
    '',
    'insert into public.catalog_asset_versions',
    '  (id, catalog_item_id, asset_version, asset_kind, model_path, model_sha256, metadata, metadata_sha256)',
    'values',
    `${assetRows.join(',\n')}\n`,
    'on conflict do nothing;',
    '-- END GENERATED COLLECTIBLE CATALOG V1',
    '',
  ].join('\n')
}

function verifyOrWrite(filePath, content) {
  if (CHECK_ONLY) {
    const current = fs.existsSync(filePath) ? fs.readFileSync(filePath, 'utf8') : null
    if (current !== content) {
      throw new Error(`${path.relative(ROOT_DIR, filePath)} is stale; run npm run generate:collectible-catalog`)
    }
    return
  }

  fs.mkdirSync(path.dirname(filePath), { recursive: true })
  fs.writeFileSync(filePath, content)
}

export function generateCatalogArtifacts() {
  const catalog = buildCatalog()
  return {
    catalog,
    json: `${JSON.stringify(catalog, null, 2)}\n`,
    sql: buildSql(catalog),
  }
}

function main() {
  const artifacts = generateCatalogArtifacts()
  verifyOrWrite(JSON_OUTPUT_PATH, artifacts.json)
  verifyOrWrite(SQL_OUTPUT_PATH, artifacts.sql)
  console.log(`${CHECK_ONLY ? 'Verified' : 'Generated'} ${artifacts.catalog.items.length} collectible catalog items`)
}

if (process.argv[1] && path.resolve(process.argv[1]) === __filename) {
  main()
}
