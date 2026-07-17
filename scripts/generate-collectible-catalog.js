#!/usr/bin/env node

import crypto from 'crypto'
import fs from 'fs'
import path from 'path'
import process from 'process'
import { fileURLToPath } from 'url'
import {
  buildCatalogDeltaSql,
  compileCatalogHistory,
  flattenEditions,
  planCatalogEdition,
} from './catalog-edition-planner.js'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const ROOT_DIR = path.join(__dirname, '..')
const CHECK_ONLY = process.argv.includes('--check')
const PREPARE_EDITION_INDEX = process.argv.indexOf('--prepare-edition')
const POSTGRES_INTEGER_MAX = 2_147_483_647

export function catalogPaths(rootDir = ROOT_DIR) {
  const migrationsDir = path.join(rootDir, 'supabase', 'migrations')
  return {
    rootDir,
    sourcePath: path.join(rootDir, 'src', 'config', 'collectibleCatalogSource.json'),
    diceDir: path.join(rootDir, 'public', 'dice'),
    jsonOutputPath: path.join(rootDir, 'src', 'generated', 'collectibleCatalog.json'),
    sqlOutputPath: path.join(rootDir, 'supabase', 'catalog', 'collectible_catalog_v1.sql'),
    editionsDir: path.join(rootDir, 'supabase', 'catalog', 'editions'),
    migrationsDir,
    baselineMigrationPath: path.join(migrationsDir, '0004_collectible_catalog.sql'),
  }
}

const DEFAULT_PATHS = catalogPaths()

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

export function resolvePublicModelFilePath(rootDir, publicModelPath) {
  if (typeof publicModelPath !== 'string' || !publicModelPath.startsWith('/dice/')) {
    throw new Error('Catalog model path must start with /dice/')
  }
  const segments = publicModelPath.slice(1).split('/')
  if (segments.some(
    segment => !segment || segment === '.' || segment === '..' || segment.includes('\\'),
  )) {
    throw new Error(`Catalog model path ${publicModelPath} is not a safe public path`)
  }
  const publicRoot = path.resolve(rootDir, 'public')
  const candidate = path.resolve(publicRoot, ...segments)
  if (!candidate.startsWith(`${publicRoot}${path.sep}`)) {
    throw new Error(`Catalog model path ${publicModelPath} escapes the public directory`)
  }
  if (!fs.existsSync(candidate)) {
    throw new Error(`Catalog model path ${publicModelPath} does not exist`)
  }

  const publicRootStat = fs.lstatSync(publicRoot)
  if (publicRootStat.isSymbolicLink() || !publicRootStat.isDirectory()) {
    throw new Error('Catalog public directory must be a real directory')
  }
  let current = publicRoot
  segments.forEach((segment, index) => {
    current = path.join(current, segment)
    const stat = fs.lstatSync(current)
    if (stat.isSymbolicLink()) {
      throw new Error(`Catalog model path ${publicModelPath} must not use symbolic links`)
    }
    const finalSegment = index === segments.length - 1
    if ((finalSegment && !stat.isFile()) || (!finalSegment && !stat.isDirectory())) {
      throw new Error(`Catalog model path ${publicModelPath} must resolve to a regular file`)
    }
  })

  const realPublicRoot = fs.realpathSync(publicRoot)
  const realCandidate = fs.realpathSync(candidate)
  if (!realCandidate.startsWith(`${realPublicRoot}${path.sep}`)) {
    throw new Error(`Catalog model path ${publicModelPath} escapes the real public directory`)
  }
  return candidate
}

function positiveVersion(value, label) {
  if (!Number.isSafeInteger(value) || value < 1 || value > POSTGRES_INTEGER_MAX) {
    throw new Error(`${label} must be a positive PostgreSQL integer`)
  }
  return value
}

function assertRecord(value, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${label} must be an object`)
  }
}

function validateVersionOverrides(source, catalogKeys, setIds) {
  assertRecord(source.setVersionOverrides, 'setVersionOverrides')
  assertRecord(source.versionOverrides, 'versionOverrides')

  for (const [setId, override] of Object.entries(source.setVersionOverrides)) {
    if (!setIds.has(setId)) throw new Error(`Version override references unknown set ${setId}`)
    assertRecord(override, `Version override for set ${setId}`)
    for (const key of Object.keys(override)) {
      if (!['contractVersion', 'assetVersion'].includes(key)) {
        throw new Error(`Unsupported set version override ${setId}.${key}`)
      }
    }
  }

  for (const [catalogKey, override] of Object.entries(source.versionOverrides)) {
    if (!catalogKeys.has(catalogKey)) {
      throw new Error(`Version override references unknown catalog key ${catalogKey}`)
    }
    assertRecord(override, `Version override for ${catalogKey}`)
    for (const key of Object.keys(override)) {
      if (!['contractVersion', 'assetVersion', 'modelPath'].includes(key)) {
        throw new Error(`Unsupported version override ${catalogKey}.${key}`)
      }
    }
  }
}

function versionsFor(source, catalogKey, setId) {
  const setOverride = source.setVersionOverrides?.[setId] ?? {}
  const itemOverride = source.versionOverrides?.[catalogKey] ?? {}
  return {
    contractVersion: positiveVersion(
      itemOverride.contractVersion ?? setOverride.contractVersion ?? source.contractVersion,
      `Contract version for ${catalogKey}`,
    ),
    assetVersion: positiveVersion(
      itemOverride.assetVersion ?? setOverride.assetVersion ?? source.assetVersion,
      `Asset version for ${catalogKey}`,
    ),
    modelPath: itemOverride.modelPath,
  }
}

function catalogItem(source, catalogKey, setId, diceType, rarity) {
  const versions = versionsFor(source, catalogKey, setId)
  const id = `${catalogKey}@${versions.contractVersion}`
  return {
    id,
    catalogKey,
    contractVersion: versions.contractVersion,
    itemKind: 'die',
    setId,
    diceType,
    rarity,
    assetVersionId: `${id}/asset@${versions.assetVersion}`,
  }
}

function assetVersion(item, assetKind, modelPath, modelSha256, metadata) {
  const version = Number(item.assetVersionId.split('/asset@').at(-1))
  return {
    id: item.assetVersionId,
    catalogItemId: item.id,
    assetVersion: version,
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
          asset: assetVersion(item, 'builtin', `builtin:${diceType}`, null, metadata),
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
        asset: assetVersion(item, 'builtin', `builtin:${definition.diceType}`, null, metadata),
      }
    })
}

function productionEntries(source, paths) {
  const entries = []
  const setDirectories = fs.readdirSync(paths.diceDir, { withFileTypes: true })
    .filter(entry => entry.isDirectory() && !entry.name.startsWith('.'))
    .sort((left, right) => compareStrings(left.name, right.name))

  for (const setDirectory of setDirectories) {
    const setId = setDirectory.name
    const setPath = path.join(paths.diceDir, setId)
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
      const versions = versionsFor(source, catalogKey, setId)
      const publishedModelPath = versions.modelPath ?? `/dice/${setId}/${diceId}/model.glb`
      const publishedModelFilePath = resolvePublicModelFilePath(
        paths.rootDir,
        publishedModelPath,
      )
      if (!fs.existsSync(publishedModelFilePath)) {
        throw new Error(`Catalog model path ${publishedModelPath} does not exist`)
      }
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
          item,
          'gltf',
          publishedModelPath,
          sha256(fs.readFileSync(publishedModelFilePath)),
          metadata,
        ),
      })
    }
  }

  return entries
}

export function buildCatalog(paths = DEFAULT_PATHS) {
  const source = readJson(paths.sourcePath)
  if (source.contractVersion !== 1 || source.assetVersion !== 1) {
    throw new Error('Catalog defaults are frozen at version 1; use scoped version overrides')
  }
  assertRecord(source.setVersionOverrides, 'setVersionOverrides')
  assertRecord(source.versionOverrides, 'versionOverrides')

  const entries = [
    ...configuredEntries(source),
    ...standaloneEntries(source),
    ...productionEntries(source, paths),
  ].sort((left, right) => compareStrings(left.item.id, right.item.id))

  validateVersionOverrides(
    source,
    new Set(entries.map(entry => entry.item.catalogKey)),
    new Set(entries.map(entry => entry.item.setId)),
  )

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

export function buildSql(
  catalog,
  label = 'V1',
  publishedHistory = { items: [], assetVersions: [] },
) {
  return buildCatalogDeltaSql(catalog, label, publishedHistory)
}

function expectedEditionLabel(edition, slug) {
  return edition === 1
    ? 'V1'
    : `EDITION_${edition}_${slug.replaceAll('-', '_').toUpperCase()}`
}

function expectedEditionFileName(edition) {
  return `${String(edition.edition).padStart(4, '0')}-${edition.slug}.json`
}

function exactKeys(value, expected, label) {
  assertRecord(value, label)
  const actual = Object.keys(value).sort(compareStrings)
  const wanted = [...expected].sort(compareStrings)
  if (JSON.stringify(actual) !== JSON.stringify(wanted)) {
    throw new Error(`${label} must contain exactly: ${wanted.join(', ')}`)
  }
}

function compareItems(left, right) {
  return compareStrings(left.catalogKey, right.catalogKey) ||
    left.contractVersion - right.contractVersion ||
    compareStrings(left.id, right.id)
}

function compareAssets(left, right) {
  return compareStrings(left.catalogItemId, right.catalogItemId) ||
    left.assetVersion - right.assetVersion ||
    compareStrings(left.id, right.id)
}

function assertSortedRows(rows, compare, label) {
  const sortedIds = [...rows].sort(compare).map(row => row.id)
  const actualIds = rows.map(row => row.id)
  if (JSON.stringify(actualIds) !== JSON.stringify(sortedIds)) {
    throw new Error(`${label} must use deterministic row ordering`)
  }
}

function validateCatalogEditions(editions, fileNames = undefined) {
  flattenEditions(editions)
  const migrations = new Set()
  let previousMigrationNumber = 0

  editions.forEach((edition, index) => {
    exactKeys(
      edition,
      ['edition', 'slug', 'label', 'migration', 'items', 'assetVersions'],
      `Catalog edition ${index + 1}`,
    )
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(edition.slug)) {
      throw new Error(`Catalog edition ${edition.edition} slug must be lowercase kebab-case`)
    }
    if (edition.label !== expectedEditionLabel(edition.edition, edition.slug)) {
      throw new Error(`Catalog edition ${edition.edition} has a noncanonical label`)
    }
    if (fileNames && fileNames[index] !== expectedEditionFileName(edition)) {
      throw new Error(`Catalog edition ${edition.edition} filename does not match its manifest`)
    }

    const expectedMigration = edition.edition === 1
      ? '0004_collectible_catalog.sql'
      : /^\d{4}_catalog_[a-z0-9]+(?:_[a-z0-9]+)*\.sql$/.test(edition.migration)
    if (expectedMigration !== true && edition.migration !== expectedMigration) {
      throw new Error(`Catalog edition ${edition.edition} has a noncanonical migration filename`)
    }
    if (migrations.has(edition.migration)) {
      throw new Error(`Catalog migration ${edition.migration} is referenced more than once`)
    }
    migrations.add(edition.migration)
    const migrationNumber = Number(edition.migration.slice(0, 4))
    if (migrationNumber <= previousMigrationNumber) {
      throw new Error('Catalog edition migrations must increase monotonically')
    }
    previousMigrationNumber = migrationNumber

    for (const item of edition.items) {
      exactKeys(
        item,
        ['id', 'catalogKey', 'contractVersion', 'itemKind', 'setId', 'diceType', 'rarity'],
        `Catalog item ${item.id}`,
      )
    }
    for (const asset of edition.assetVersions) {
      exactKeys(
        asset,
        [
          'id',
          'catalogItemId',
          'assetVersion',
          'assetKind',
          'modelPath',
          'modelSha256',
          'metadata',
          'metadataSha256',
        ],
        `Catalog asset ${asset.id}`,
      )
    }
    assertSortedRows(edition.items, compareItems, `Catalog edition ${edition.edition} items`)
    assertSortedRows(
      edition.assetVersions,
      compareAssets,
      `Catalog edition ${edition.edition} assets`,
    )
  })
}

function editionJson(edition) {
  return `${JSON.stringify(edition, null, 2)}\n`
}

export function loadCatalogEditions(paths = DEFAULT_PATHS) {
  if (!fs.existsSync(paths.editionsDir)) return []
  const jsonFileNames = fs.readdirSync(paths.editionsDir)
    .filter(fileName => fileName.endsWith('.json'))
    .sort(compareStrings)
  const invalidFileName = jsonFileNames.find(
    fileName => !/^\d{4}-[a-z0-9]+(?:-[a-z0-9]+)*\.json$/.test(fileName),
  )
  if (invalidFileName) {
    throw new Error(`Catalog edition filename ${invalidFileName} is invalid`)
  }

  const sources = jsonFileNames.map(fileName => (
    fs.readFileSync(path.join(paths.editionsDir, fileName), 'utf8')
  ))
  const editions = sources.map(source => JSON.parse(source))
  validateCatalogEditions(editions, jsonFileNames)
  editions.forEach((edition, index) => {
    if (sources[index] !== editionJson(edition)) {
      throw new Error(`Catalog edition ${jsonFileNames[index]} is not canonical JSON`)
    }
  })
  return editions
}

function verifyFile(filePath, expected, command, paths = DEFAULT_PATHS) {
  const current = fs.existsSync(filePath) ? fs.readFileSync(filePath, 'utf8') : null
  if (current !== expected) {
    throw new Error(`${path.relative(paths.rootDir, filePath)} is stale; ${command}`)
  }
}

function exactGeneratedBlock(source, expected, migrationName) {
  const expectedBlock = expected.trimEnd()
  const [beginMarker] = expectedBlock.split('\n')
  const endMarker = expectedBlock.split('\n').at(-1)
  const beginAt = source.indexOf(beginMarker)
  const endAt = source.indexOf(endMarker, beginAt + beginMarker.length)
  if (
    beginAt < 0 ||
    endAt < 0 ||
    source.indexOf(beginMarker, beginAt + beginMarker.length) >= 0 ||
    source.indexOf(endMarker, endAt + endMarker.length) >= 0
  ) {
    throw new Error(`${migrationName} must contain exactly one generated catalog block`)
  }
  const actualBlock = source.slice(beginAt, endAt + endMarker.length)
  if (actualBlock !== expectedBlock) {
    throw new Error(`${migrationName} no longer contains its frozen catalog edition byte-for-byte`)
  }
}

function renderEditionMigration(edition, sql) {
  return `-- Additive collectible catalog edition ${edition.edition}: ${edition.slug}\n\n${sql}`
}

export function verifyPublishedEditions(editions, paths = DEFAULT_PATHS) {
  validateCatalogEditions(editions)
  for (const [index, edition] of editions.entries()) {
    const publishedHistory = flattenEditions(editions.slice(0, index))
    const sql = buildCatalogDeltaSql(edition, edition.label, publishedHistory)
    if (edition.edition === 1) {
      verifyFile(
        paths.sqlOutputPath,
        sql,
        'published v1 history cannot be rewritten',
        paths,
      )
      const migration = fs.existsSync(paths.baselineMigrationPath)
        ? fs.readFileSync(paths.baselineMigrationPath, 'utf8')
        : ''
      exactGeneratedBlock(migration, sql, edition.migration)
      continue
    }

    verifyFile(
      path.join(paths.migrationsDir, edition.migration),
      renderEditionMigration(edition, sql),
      'published catalog edition migrations cannot be rewritten',
      paths,
    )
  }
}

export function generateCatalogArtifacts({
  paths = DEFAULT_PATHS,
  desired = buildCatalog(paths),
  editions = loadCatalogEditions(paths),
} = {}) {
  if (editions.length === 0) throw new Error('Frozen catalog edition 0001-initial.json is missing')
  verifyPublishedEditions(editions, paths)
  const delta = planCatalogEdition(editions, desired)
  if (delta.items.length > 0 || delta.assetVersions.length > 0) {
    throw new Error('Catalog has unprepared version changes; run npm run prepare:collectible-edition -- <migration-number> <slug>')
  }
  const catalog = compileCatalogHistory(editions)
  return {
    catalog,
    json: `${JSON.stringify(catalog, null, 2)}\n`,
    sql: buildCatalogDeltaSql(editions[0], editions[0].label),
  }
}

export function createPreparedCatalogEdition(editions, desired, migrationNumber, slug) {
  if (!/^\d{4}$/.test(migrationNumber ?? '')) {
    throw new Error('Migration number must use four digits, for example 0005')
  }
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug ?? '')) {
    throw new Error('Edition slug must be lowercase kebab-case')
  }

  if (editions.length === 0) throw new Error('Frozen catalog edition 0001-initial.json is missing')
  validateCatalogEditions(editions)
  const delta = planCatalogEdition(editions, desired)
  if (delta.items.length === 0 && delta.assetVersions.length === 0) {
    throw new Error('Catalog source has no unprepared version changes')
  }
  const nextEdition = editions.length + 1
  const editionPrefix = String(nextEdition).padStart(4, '0')
  const migrationFileName = `${migrationNumber}_catalog_${slug.replaceAll('-', '_')}.sql`
  const label = expectedEditionLabel(nextEdition, slug)
  const edition = {
    edition: nextEdition,
    slug,
    label,
    migration: migrationFileName,
    items: delta.items,
    assetVersions: delta.assetVersions,
  }
  validateCatalogEditions([...editions, edition])
  const publishedHistory = flattenEditions(editions)
  const sql = buildCatalogDeltaSql(edition, label, publishedHistory)
  const compiled = compileCatalogHistory(editions, delta)
  return {
    edition,
    editionFileName: `${editionPrefix}-${slug}.json`,
    editionJson: editionJson(edition),
    migrationFileName,
    migrationSql: renderEditionMigration(edition, sql),
    catalog: compiled,
    catalogJson: `${JSON.stringify(compiled, null, 2)}\n`,
  }
}

function temporaryPath(targetPath) {
  return `${targetPath}.tmp-${process.pid}-${crypto.randomBytes(8).toString('hex')}`
}

function removeIfPresent(filePath) {
  try {
    fs.unlinkSync(filePath)
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error
  }
}

export function publishPreparedCatalogEdition(prepared, paths = DEFAULT_PATHS) {
  const editionPath = path.join(paths.editionsDir, prepared.editionFileName)
  const migrationPath = path.join(paths.migrationsDir, prepared.migrationFileName)
  const staged = [
    [temporaryPath(editionPath), prepared.editionJson],
    [temporaryPath(migrationPath), prepared.migrationSql],
    [temporaryPath(paths.jsonOutputPath), prepared.catalogJson],
  ]
  const published = []

  try {
    for (const [stagedPath, content] of staged) {
      fs.writeFileSync(stagedPath, content, { flag: 'wx' })
    }
    fs.linkSync(staged[0][0], editionPath)
    published.push(editionPath)
    fs.linkSync(staged[1][0], migrationPath)
    published.push(migrationPath)
    fs.renameSync(staged[2][0], paths.jsonOutputPath)
  } catch (error) {
    for (const publishedPath of published.reverse()) removeIfPresent(publishedPath)
    throw error
  } finally {
    for (const [stagedPath] of staged) removeIfPresent(stagedPath)
  }
}

export function prepareCatalogEdition(migrationNumber, slug, paths = DEFAULT_PATHS) {
  const desired = buildCatalog(paths)
  const editions = loadCatalogEditions(paths)
  if (editions.length === 0) throw new Error('Frozen catalog edition 0001-initial.json is missing')
  verifyPublishedEditions(editions, paths)

  const migrationNumbers = fs.readdirSync(paths.migrationsDir)
    .map(fileName => fileName.match(/^(\d{4})_[a-z0-9_]+\.sql$/)?.[1])
    .filter(Boolean)
  if (migrationNumbers.includes(migrationNumber)) {
    throw new Error(`Migration number ${migrationNumber} is already in use`)
  }
  const latestMigrationNumber = Math.max(...migrationNumbers.map(Number), 0)
  if (Number(migrationNumber) <= latestMigrationNumber) {
    throw new Error(`Migration number must be greater than ${String(latestMigrationNumber).padStart(4, '0')}`)
  }

  const prepared = createPreparedCatalogEdition(editions, desired, migrationNumber, slug)
  const editionPath = path.join(paths.editionsDir, prepared.editionFileName)
  const migrationPath = path.join(paths.migrationsDir, prepared.migrationFileName)
  if (fs.existsSync(editionPath) || fs.existsSync(migrationPath)) {
    throw new Error('Edition or migration target already exists')
  }
  publishPreparedCatalogEdition(prepared, paths)
  console.log(
    `Prepared catalog edition ${prepared.edition.edition} with ` +
    `${prepared.edition.items.length} items and ${prepared.edition.assetVersions.length} assets`,
  )
  return prepared
}

function main() {
  const args = process.argv.slice(2)
  if (PREPARE_EDITION_INDEX >= 0) {
    if (args.length !== 3 || args[0] !== '--prepare-edition') {
      throw new Error('Usage: --prepare-edition <migration-number> <slug>')
    }
    prepareCatalogEdition(
      process.argv[PREPARE_EDITION_INDEX + 1],
      process.argv[PREPARE_EDITION_INDEX + 2],
    )
    return
  }
  if (args.length > 1 || (args.length === 1 && args[0] !== '--check')) {
    throw new Error('Usage: [--check] | --prepare-edition <migration-number> <slug>')
  }

  const artifacts = generateCatalogArtifacts()
  verifyFile(
    DEFAULT_PATHS.jsonOutputPath,
    artifacts.json,
    'run the explicit prepare:collectible-edition workflow for version changes',
    DEFAULT_PATHS,
  )
  console.log(`${CHECK_ONLY ? 'Verified' : 'Checked'} ${artifacts.catalog.items.length} collectible catalog items`)
}

if (process.argv[1] && path.resolve(process.argv[1]) === __filename) {
  main()
}
