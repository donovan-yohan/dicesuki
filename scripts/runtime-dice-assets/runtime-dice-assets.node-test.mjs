import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'

import {
  RUNTIME_ASSET_BUDGETS,
  inspectGlb,
  runtimeAssetManifestPaths,
  validateRuntimeAssetManifest,
} from './runtime-asset-contract.mjs'
import { RUNTIME_ASSET_PROFILES } from './runtime-asset-profiles.mjs'
import {
  buildDiceManifest,
  checkDiceManifest,
  renderDiceManifest,
  writeDiceManifest,
} from '../generate-dice-manifest.js'

const REPO_ROOT = path.resolve(import.meta.dirname, '..', '..')
const MANIFEST_PATHS = runtimeAssetManifestPaths(REPO_ROOT)
const COZY_SET_ROOT = path.join(REPO_ROOT, 'public', 'dice', 'cozy-forest-imagegen-set')

test('every runtime set is complete, hashed, WebP-backed, and within budgets', async () => {
  assert.deepEqual(
    MANIFEST_PATHS.map(manifestPath => path.basename(path.dirname(manifestPath))),
    Object.values(RUNTIME_ASSET_PROFILES).map(profile => profile.setId).sort(),
  )
  for (const manifestPath of MANIFEST_PATHS) {
    const result = await validateRuntimeAssetManifest(manifestPath, REPO_ROOT)
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
  }
})

test('runtime validation fails closed when a published model changes in place', async () => {
  const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'dicesuki-runtime-drift-'))
  try {
    const copiedSet = path.join(temporaryRoot, 'public', 'dice', 'cozy-forest-imagegen-set')
    fs.mkdirSync(path.dirname(copiedSet), { recursive: true })
    fs.cpSync(COZY_SET_ROOT, copiedSet, { recursive: true })
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
  const sourceModel = path.join(COZY_SET_ROOT, 'hearthwood-d6', 'model.glb')
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
  for (const manifestPath of MANIFEST_PATHS) {
    const setRoot = path.dirname(manifestPath)
    for (const diceId of fs.readdirSync(setRoot)) {
      const metadataPath = path.join(setRoot, diceId, 'metadata.json')
      if (!fs.existsSync(metadataPath)) continue
      const metadata = JSON.parse(fs.readFileSync(metadataPath, 'utf8'))
      assert.equal(metadata.canonicalReferenceVersion, 2)
      assert.equal(metadata.scale, expectedScales.get(metadata.diceType))
      assert.equal(typeof metadata.physics.density, 'number')
      assert.equal(Object.hasOwn(metadata.physics, 'mass'), false)
      assert.equal(Object.hasOwn(metadata, 'uvManifestUrl'), false)
    }
  }
})

test('runtime set metadata applies only explicit profile appearance overrides', () => {
  for (const [profileId, profile] of Object.entries(RUNTIME_ASSET_PROFILES)) {
    const setMetadata = JSON.parse(fs.readFileSync(
      path.join(REPO_ROOT, 'public', 'dice', profile.setId, 'set.json'),
      'utf8',
    ))
    if (profile.appearance) {
      assert.deepEqual(setMetadata.appearance, profile.appearance, profileId)
    } else {
      assert.equal(Object.hasOwn(setMetadata, 'appearance'), false, profileId)
    }
  }
})

test('runtime profiles and manifests anchor complete source locks', () => {
  for (const [profileId, profile] of Object.entries(RUNTIME_ASSET_PROFILES)) {
    const sourceLockFiles = [profile.sourceLockFile, ...profile.sourceLockSupplementFiles]
    const sourceLocks = sourceLockFiles.map(sourceLockFile => JSON.parse(
      fs.readFileSync(
        path.join(REPO_ROOT, 'scripts', 'runtime-dice-assets', 'sources', sourceLockFile),
        'utf8',
      ),
    ))
    const [sourceLock] = sourceLocks
    const manifest = JSON.parse(fs.readFileSync(
      path.join(REPO_ROOT, 'public', 'dice', profile.setId, 'runtime-assets.json'),
      'utf8',
    ))
    assert.equal(sourceLock.contractVersion, 1, profileId)
    assert.equal(manifest.source.tag, sourceLock.release.tag, profileId)
    assert.equal(manifest.source.archiveSha256, sourceLock.release.sha256, profileId)
    assert.equal(manifest.source.sourceCommit, sourceLock.sourceCommit, profileId)
    assert.match(sourceLock.release.sha256, /^[0-9a-f]{64}$/)
    assert.equal(sourceLock.release.url.endsWith(`/${sourceLock.release.assetName}`), true)

    const allLockedFiles = sourceLocks.flatMap((lock, index) => {
      assert.equal(lock.contractVersion, 1, profileId)
      assert.equal(lock.sourceCommit, sourceLock.sourceCommit, profileId)
      if (index > 0) assert.equal(lock.supplements, profile.sourceLockFile, profileId)
      return lock.files
    })
    const lockedPaths = new Set(allLockedFiles.map(file => file.path))
    assert.equal(lockedPaths.size, allLockedFiles.length, profileId)
    assert.equal(
      lockedPaths.has(`public/dice/${profile.setId}/set.json`),
      true,
      profileId,
    )
    for (const die of profile.dice) {
      assert.equal(
        lockedPaths.has(`public/dice/${profile.setId}/${die.diceId}/metadata.json`),
        true,
        profileId,
      )
      assert.equal(
        lockedPaths.has(`public/dice/${profile.setId}/${die.diceId}/model.glb`),
        true,
        profileId,
      )
      assert.equal(
        lockedPaths.has(
          `public/artist-resources/imagegen-uv/screenshots/theme-workshop/` +
          `${profile.proofPrefix}-${die.diceId}-face-${die.proofFace}.png`,
        ),
        true,
        profileId,
      )
    }
    for (const file of allLockedFiles) assert.match(file.sha256, /^[0-9a-f]{64}$/)
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
