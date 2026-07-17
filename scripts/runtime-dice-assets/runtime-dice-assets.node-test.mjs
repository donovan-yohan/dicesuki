import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'

import {
  RUNTIME_ASSET_BUDGETS,
  inspectGlb,
  validateRuntimeAssetManifest,
} from './runtime-asset-contract.mjs'
import {
  buildDiceManifest,
  checkDiceManifest,
  renderDiceManifest,
  writeDiceManifest,
} from '../generate-dice-manifest.js'

const REPO_ROOT = path.resolve(import.meta.dirname, '..', '..')
const SET_ROOT = path.join(REPO_ROOT, 'public', 'dice', 'cozy-forest-imagegen-set')
const MANIFEST_PATH = path.join(SET_ROOT, 'runtime-assets.json')

test('Cozy Forest runtime set is complete, hashed, WebP-backed, and within budgets', async () => {
  const result = await validateRuntimeAssetManifest(MANIFEST_PATH, REPO_ROOT)
  assert.equal(result.valid, true, result.errors.join('\n'))
  assert.deepEqual(
    result.manifest.assets.map(asset => asset.diceType).sort(),
    ['d10', 'd12', 'd20', 'd4', 'd6', 'd8'],
  )
  assert.ok(result.completeSetBytes <= RUNTIME_ASSET_BUDGETS.completeSetMaxBytes)
  for (const asset of result.manifest.assets) {
    assert.equal(asset.model.textureFormat, 'image/webp')
    assert.ok(asset.model.bytes <= RUNTIME_ASSET_BUDGETS.modelHardMaxBytes)
    assert.ok(asset.thumbnail.bytes <= RUNTIME_ASSET_BUDGETS.thumbnailMaxBytes)
  }
})

test('runtime validation fails closed when a published model changes in place', async () => {
  const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'dicesuki-runtime-drift-'))
  try {
    const copiedSet = path.join(temporaryRoot, 'public', 'dice', 'cozy-forest-imagegen-set')
    fs.mkdirSync(path.dirname(copiedSet), { recursive: true })
    fs.cpSync(SET_ROOT, copiedSet, { recursive: true })
    const manifestPath = path.join(copiedSet, 'runtime-assets.json')
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'))
    const modelPath = path.join(temporaryRoot, 'public', manifest.assets[0].model.path.slice(1))
    fs.appendFileSync(modelPath, Buffer.from([0]))

    const result = await validateRuntimeAssetManifest(manifestPath, temporaryRoot)
    assert.equal(result.valid, false)
    assert.match(result.errors.join('\n'), /length header does not match|does not match its file/)
  } finally {
    fs.rmSync(temporaryRoot, { recursive: true, force: true })
  }
})

test('GLB validation rejects external buffers and nonzero texture buffers', async () => {
  const sourceModel = path.join(SET_ROOT, 'hearthwood-d6', 'model.glb')
  const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'dicesuki-external-glb-'))
  try {
    const externalBuffer = path.join(temporaryRoot, 'external-buffer.glb')
    rewriteGlbJson(sourceModel, externalBuffer, json => {
      json.buffers[0].uri = 'textures.bin'
    })
    await assert.rejects(() => inspectGlb(externalBuffer), /URI-free embedded buffer/)

    const nonzeroTextureBuffer = path.join(temporaryRoot, 'nonzero-texture-buffer.glb')
    rewriteGlbJson(sourceModel, nonzeroTextureBuffer, json => {
      json.bufferViews[json.images[0].bufferView].buffer = 1
    })
    await assert.rejects(() => inspectGlb(nonzeroTextureBuffer), /valid buffer view/)
  } finally {
    fs.rmSync(temporaryRoot, { recursive: true, force: true })
  }
})

test('runtime metadata uses density and canonical v2 scale references', () => {
  const expectedScales = new Map([
    ['d4', 1.3888888888888888],
    ['d6', 1.1],
    ['d8', 1.3888888888888888],
    ['d10', 1.3888888888888888],
    ['d12', 1.25],
    ['d20', 1.3888888888888888],
  ])
  for (const diceId of fs.readdirSync(SET_ROOT)) {
    const metadataPath = path.join(SET_ROOT, diceId, 'metadata.json')
    if (!fs.existsSync(metadataPath)) continue
    const metadata = JSON.parse(fs.readFileSync(metadataPath, 'utf8'))
    assert.equal(metadata.canonicalReferenceVersion, 2)
    assert.equal(metadata.scale, expectedScales.get(metadata.diceType))
    assert.equal(typeof metadata.physics.density, 'number')
    assert.equal(Object.hasOwn(metadata.physics, 'mass'), false)
    assert.equal(Object.hasOwn(metadata, 'uvManifestUrl'), false)
  }
})

test('dice manifest is deterministic and has no wall-clock field', () => {
  const first = renderDiceManifest(buildDiceManifest(path.join(REPO_ROOT, 'public', 'dice')))
  const second = renderDiceManifest(buildDiceManifest(path.join(REPO_ROOT, 'public', 'dice')))
  assert.equal(first, second)
  assert.equal(Object.hasOwn(JSON.parse(first), 'generatedAt'), false)
})

test('dice manifest check detects stale snapshots', () => {
  const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'dicesuki-dice-manifest-'))
  try {
    const diceDir = path.join(temporaryRoot, 'dice')
    const dieDir = path.join(diceDir, 'z-set', 'z-d6')
    fs.mkdirSync(dieDir, { recursive: true })
    fs.writeFileSync(path.join(diceDir, 'z-set', 'set.json'), '{}')
    fs.writeFileSync(path.join(dieDir, 'model.glb'), 'model')
    fs.writeFileSync(path.join(dieDir, 'metadata.json'), '{}')
    const manifestPath = path.join(diceDir, 'manifest.json')

    writeDiceManifest({ diceDir, manifestPath })
    assert.doesNotThrow(() => checkDiceManifest({ diceDir, manifestPath }))
    fs.writeFileSync(manifestPath, '{}\n')
    assert.throws(
      () => checkDiceManifest({ diceDir, manifestPath }),
      /manifest\.json is stale/,
    )
  } finally {
    fs.rmSync(temporaryRoot, { recursive: true, force: true })
  }
})

function rewriteGlbJson(sourcePath, outputPath, mutate) {
  const source = fs.readFileSync(sourcePath)
  const jsonLength = source.readUInt32LE(12)
  const json = JSON.parse(source.subarray(20, 20 + jsonLength).toString('utf8').trim())
  const binHeaderOffset = 20 + jsonLength
  const binLength = source.readUInt32LE(binHeaderOffset)
  const binType = source.readUInt32LE(binHeaderOffset + 4)
  const bin = source.subarray(binHeaderOffset + 8, binHeaderOffset + 8 + binLength)
  mutate(json)

  const encoded = Buffer.from(JSON.stringify(json))
  const paddedJsonLength = Math.ceil(encoded.length / 4) * 4
  const jsonChunk = Buffer.alloc(paddedJsonLength, 0x20)
  encoded.copy(jsonChunk)
  const output = Buffer.alloc(12 + 8 + jsonChunk.length + 8 + bin.length)
  output.writeUInt32LE(0x46546c67, 0)
  output.writeUInt32LE(2, 4)
  output.writeUInt32LE(output.length, 8)
  output.writeUInt32LE(jsonChunk.length, 12)
  output.writeUInt32LE(0x4e4f534a, 16)
  jsonChunk.copy(output, 20)
  const outputBinHeader = 20 + jsonChunk.length
  output.writeUInt32LE(bin.length, outputBinHeader)
  output.writeUInt32LE(binType, outputBinHeader + 4)
  bin.copy(output, outputBinHeader + 8)
  fs.writeFileSync(outputPath, output)
}
