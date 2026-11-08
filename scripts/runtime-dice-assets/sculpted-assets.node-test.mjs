import './sculpted-public-model.node-test.mjs'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import * as contract from './runtime-asset-contract.mjs'

import { SCULPTED_ASSET_PROFILES } from './sculpted-asset-profiles.mjs'
import { inspectSculptedGlb, readRegularFile, readSculptedSourceRecord, validateSculptedMetadata } from './sculpted-asset-contract.mjs'
import { packageSculptedAssets } from './package-sculpted.mjs'

import { buildCatalog, loadCatalogEditions } from '../generate-collectible-catalog.js'
import { planCatalogEdition } from '../catalog-edition-planner.js'

import { checkAuthoringBoundary } from '../imagegen-uv/check-authoring-boundary.mjs'
import { changedCanonicalReferencePaths } from '../imagegen-uv/check-canonical-history.mjs'
import { execFileSync } from 'node:child_process'

const root = path.resolve(import.meta.dirname, '../..')
const sets = ['woodland-sculpted-set', 'cyberpunk-cutline-set', 'monster-dungeon-set']

test('managed validator routes the new sculpted contract and fails malformed input closed', async () => {
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'sculpted-contract-'))
  try {
    const file = path.join(temporary, 'runtime-assets.json')
    for (const assets of [null, {}, [null], ['invalid']]) {
      fs.writeFileSync(file, JSON.stringify({ contractVersion: 2, assetKind: 'sculpted', setId: 'monster-dungeon-set', assets }))
      const result = await contract.validateRuntimeAssetManifest(file, temporary)
      assert.equal(result.valid, false)
      assert.match(result.errors.join('\n'), /sculpted.*six dice/i)
    }
  } finally {
    fs.rmSync(temporary, { recursive: true, force: true })
  }
})

test('new manifest discovery is exactly the three explicit sculpted profiles', () => {
  assert.deepEqual(contract.runtimeAssetManifestPaths(root).filter(file => JSON.parse(fs.readFileSync(file)).contractVersion === 2).map(file => path.basename(path.dirname(file))).sort(), Object.keys(SCULPTED_ASSET_PROFILES).sort())
})

function rewriteGlb(bytes, mutate) {
  const length = bytes.readUInt32LE(12)
  const json = JSON.parse(bytes.subarray(20, 20 + length).toString().trim())
  mutate(json)
  const text = Buffer.from(JSON.stringify(json))
  const padded = Buffer.concat([text, Buffer.alloc((4 - text.length % 4) % 4, 32)])
  const tail = bytes.subarray(20 + length)
  const header = Buffer.alloc(20)
  bytes.copy(header, 0, 0, 12)
  header.writeUInt32LE(20 + padded.length + tail.length, 8)
  header.writeUInt32LE(padded.length, 12)
  header.writeUInt32LE(0x4e4f534a, 16)
  return Buffer.concat([header, padded, tail])
}

test('sculpted inspector rejects external payloads, compression, invalid geometry and dimensions', async () => {
  const bytes = fs.readFileSync(path.join(root, 'public/dice/monster-dungeon-set/d6/model.glb'))
  const budgets = SCULPTED_ASSET_PROFILES['monster-dungeon-set'].budgets
  for (const mutate of [
    json => { json.buffers[0].uri = 'https://example.invalid/leak' },
    json => { json.images[0].uri = '../secret.png' },
    json => { json.extensionsUsed.push('EXT_meshopt_compression') },
    json => { json.bufferViews[0].buffer = 1 },
    json => { json.accessors[0].count = 999999999 },
    json => { json.meshes[0].primitives[0].attributes.POSITION = 999999 },
    json => { json.textures[0].extensions.EXT_texture_webp.source = 99999 },
  ]) {
    await assert.rejects(() => inspectSculptedGlb(rewriteGlb(bytes, mutate), budgets, 'd6'))
  }
  await assert.rejects(() => inspectSculptedGlb(bytes, { ...budgets, textureMaxDimension: 16 }, 'd6'))
  await assert.rejects(() => inspectSculptedGlb(bytes, { ...budgets, maxAnimations: 21 }, 'd6'))
  // Historical mapped contract still refuses the animated/multitexture D6.
  await assert.rejects(() => contract.inspectGlb(path.join(root, 'public/dice/monster-dungeon-set/d6/model.glb')), /exactly two textures/)
})

test('metadata rejects malformed runtime fields instead of accepting unchecked catalog values', () => {
  const metadata = JSON.parse(fs.readFileSync(path.join(root, 'public/dice/woodland-sculpted-set/d4/metadata.json')))
  for (const change of [
    value => { value.name = '' },
    value => { value.rarity = 'invented' },
    value => { value.physics.restitution = -1 },
    value => { value.physics.friction = -1 },
    value => { value.colliderType = 'invented' },
    value => { value.faceNormals[0].normal[0] = 0 },
    value => { value.scale = 1.45 },
    value => { value.vertexOutcomeCopies = 4 },
  ]) {
    const changed = structuredClone(metadata)
    change(changed)
    assert.throws(() => validateSculptedMetadata(changed, 'd4', 'woodland-sculpted-set'))
  }
})

test('existing catalog pipeline admits only explicitly marked bounded sculpted delivery', () => {
  const catalog = buildCatalog()
  const editions = loadCatalogEditions().slice(0, 6)
  const delta = planCatalogEdition(editions, catalog)
  assert.equal(delta.items.length, 18)
  assert.equal(delta.assetVersions.length, 18)
  for (const asset of delta.assetVersions) {
    assert.equal(asset.metadata.delivery.assetContractVersion, 2)
    assert.equal(asset.metadata.delivery.assetKind, 'sculpted')
  }
  const malformed = structuredClone(catalog)
  const sculpture = malformed.assetVersions.find(asset => asset.metadata.delivery?.assetContractVersion === 2)
  delete sculpture.metadata.delivery.assetContractVersion
  assert.throws(() => planCatalogEdition(editions, malformed), /positive PostgreSQL integer|textures must use/)
})

test('local source reads reject traversal and symlink ancestors', () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'sculpted-path-'))
  try {
    fs.mkdirSync(path.join(temp, 'inside'))
    fs.writeFileSync(path.join(temp, 'inside', 'file'), 'test')
    fs.symlinkSync(path.join(temp, 'inside'), path.join(temp, 'alias'))
    assert.throws(() => readRegularFile(temp, '../secret'))
    assert.throws(() => readRegularFile(temp, 'alias/file'), /Symbolic links/)
    assert.equal(readRegularFile(temp, 'inside/file').toString(), 'test')
  } finally { fs.rmSync(temp, { recursive: true, force: true }) }
})

test('packaging is reproducible from checked inputs and refuses any source drift before writing', { skip: !process.env.SCULPTED_SOURCE_ROOT }, async () => {
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'sculpted-package-'))
  try {
    const source = path.join(temporary, 'source')
    const output = path.join(temporary, 'output')
    for (const file of readSculptedSourceRecord().record.files) {
      const target = path.join(source, file.path)
      fs.mkdirSync(path.dirname(target), { recursive: true })
      fs.copyFileSync(path.join(process.env.SCULPTED_SOURCE_ROOT, file.path), target)
    }
    const first = await packageSculptedAssets(source, output)
    const inventory = () => sets.flatMap(set => {
      const directory = path.join(output, 'public/dice', set)
      return fs.readdirSync(directory, { recursive: true }).filter(file => fs.statSync(path.join(directory, file)).isFile()).map(file => [set, file, contract.sha256(fs.readFileSync(path.join(directory, file)))])
    })
    const before = inventory()
    assert.deepEqual(await packageSculptedAssets(source, output), first)
    assert.deepEqual(inventory(), before)
    const file = readSculptedSourceRecord().record.sets[0].dice[0].model
    fs.appendFileSync(path.join(source, file), Buffer.from([0]))
    const refused = path.join(temporary, 'refused')
    await assert.rejects(() => packageSculptedAssets(source, refused), /source hash mismatch/)
    assert.equal(fs.existsSync(refused), false)
  } finally { fs.rmSync(temporary, { recursive: true, force: true }) }
})

test('local-frozen source records become append-only history after acceptance', () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'sculpted-history-'))
  try {
    const git = args => execFileSync('git', args, { cwd: temp, stdio: 'pipe', encoding: 'utf8' })
    git(['init', '-q'])
    const file = 'scripts/runtime-dice-assets/sources/sculpted-v1.source.json'
    fs.mkdirSync(path.dirname(path.join(temp, file)), { recursive: true })
    fs.writeFileSync(path.join(temp, file), '{}\n')
    git(['add', '.'])
    git(['-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', 'commit', '-qm', 'baseline'])
    fs.writeFileSync(path.join(temp, file), '{"changed":true}\n')
    assert.deepEqual(changedCanonicalReferencePaths('HEAD', temp), [file])
  } finally { fs.rmSync(temp, { recursive: true, force: true }) }
})

test('manifest validation refuses hash, budget, metadata, identity and path drift', async () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'sculpted-manifest-'))
  try {
    const set = 'cyberpunk-cutline-set'
    const directory = path.join(temp, 'public/dice', set)
    fs.mkdirSync(path.dirname(directory), { recursive: true })
    fs.cpSync(path.join(root, 'public/dice', set), directory, { recursive: true })
    const file = path.join(directory, 'runtime-assets.json')
    const original = JSON.parse(fs.readFileSync(file))
    for (const mutate of [
      value => { value.budgets.completeSetMaxBytes += 1 },
      value => { value.source.kind = 'published-release' },
      value => { value.assets[0].model.sha256 = '0'.repeat(64) },
      value => { value.assets[0].model.path = '/dice/other-set/d4/model.glb' },
      value => { value.assets[0].metadata.bytes += 1 },
      value => { value.assets[0].thumbnail.sha256 = '0'.repeat(64) },
      value => { value.assets[0].diceType = 'd100' },
      value => { value.assets[0] = null },
    ]) {
      const changed = structuredClone(original)
      mutate(changed)
      fs.writeFileSync(file, JSON.stringify(changed))
      assert.equal((await contract.validateRuntimeAssetManifest(file, temp)).valid, false)
    }
    fs.writeFileSync(file, JSON.stringify(original))
    const valid = await contract.validateRuntimeAssetManifest(file, temp)
    assert.equal(valid.valid, true, valid.errors.join('\n'))
  } finally { fs.rmSync(temp, { recursive: true, force: true }) }
})

test('authoring boundary admits the exact sculptures without admitting sibling authoring payloads', () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'sculpted-boundary-'))
  try {
    execFileSync('git', ['init', '-q'], { cwd: temp })
    for (const set of sets) {
      const directory = path.join(temp, 'public/dice', set)
      fs.mkdirSync(path.dirname(directory), { recursive: true })
      fs.cpSync(path.join(root, 'public/dice', set), directory, { recursive: true })
    }
    assert.equal(checkAuthoringBoundary(temp).valid, true)
    const stray = path.join(temp, 'public/dice/woodland-sculpted-set/unreviewed.glb')
    fs.copyFileSync(path.join(root, 'public/dice/cyberpunk-cutline-set/d6/model.glb'), stray)
    assert.equal(checkAuthoringBoundary(temp).valid, false)
    fs.unlinkSync(stray)
    fs.appendFileSync(path.join(temp, 'public/dice/monster-dungeon-set/d6/model.glb'), Buffer.from([0]))
    assert.equal(checkAuthoringBoundary(temp).valid, false)
  } finally { fs.rmSync(temp, { recursive: true, force: true }) }
})

test('all 18 managed sculptures and thumbnails validate with explicit bounded profiles', async () => {
  for (const set of sets) {
    const result = await contract.validateRuntimeAssetManifest(path.join(root, 'public/dice', set, 'runtime-assets.json'), root)
    assert.equal(result.valid, true, result.errors.join('\n'))
    assert.equal(result.manifest.assets.length, 6)
    assert.equal(result.manifest.source.kind, 'local-frozen')
    assert.equal(Object.hasOwn(result.manifest.source, 'release'), false)
  }
})
