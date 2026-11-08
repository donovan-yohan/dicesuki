import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import test from 'node:test'
import os from 'node:os'
import * as publication from './sculpted-public-model.mjs'
import { sha256 } from './runtime-asset-contract.mjs'
import { readSculptedSourceRecord } from './sculpted-asset-contract.mjs'

const root = path.resolve(import.meta.dirname, '../..')
const shapes = ['d4', 'd6', 'd8', 'd10', 'd12', 'd20']

function rewriteGlb(bytes, mutate) {
  const n = bytes.readUInt32LE(12)
  const json = JSON.parse(bytes.subarray(20, 20 + n).toString())
  mutate(json)
  const text = Buffer.from(JSON.stringify(json))
  const padded = Buffer.concat([text, Buffer.alloc((4 - text.length % 4) % 4, 32)])
  const header = Buffer.from(bytes.subarray(0, 20))
  header.writeUInt32LE(20 + padded.length + bytes.length - 20 - n, 8)
  header.writeUInt32LE(padded.length, 12)
  return Buffer.concat([header, padded, bytes.subarray(20 + n)])
}

const authoringKeys = ['type_source_scene', 'selected_source_scene', 'inset_base_scene', 'inset_recovered_source', 'canonical_export_metadata', 'source_hashes']

test('deterministic derivation removes only existing scene authoring extras and preserves the complete BIN', () => {
  const original = fs.readFileSync(path.join(root, 'public/dice/woodland-sculpted-set/d4/model.glb'))
  const bytes = rewriteGlb(original, json => {
    json.scenes[0].extras ??= {}
    for (const key of authoringKeys) json.scenes[0].extras[key] = '/home/synthetic-author/source.blend'
    json.nodes[0].extras = { source_hashes: 'non-scene-key-must-survive' }
    json.scenes[0].extras.keep = { nested: [1, true, 'runtime metadata'] }
  })
  const source = JSON.parse(bytes.subarray(20, 20 + bytes.readUInt32LE(12)).toString())
  const expected = structuredClone(source)
  const pointers = []
  for (const [index, scene] of expected.scenes.entries()) {
    for (const key of authoringKeys) {
      if (Object.hasOwn(scene.extras ?? {}, key)) {
        delete scene.extras[key]
        pointers.push(`/scenes/${index}/extras/${key}`)
      }
    }
  }
  const result = publication.derivePublicSculptedModel(bytes, sha256(bytes))
  assert.deepEqual(result.bytes, publication.derivePublicSculptedModel(bytes, sha256(bytes)).bytes)
  assert.deepEqual(result.removedPointers, pointers)
  const n = result.bytes.readUInt32LE(12)
  assert.deepEqual(JSON.parse(result.bytes.subarray(20, 20 + n).toString()), expected)
  assert.deepEqual(result.bytes.subarray(20 + n), bytes.subarray(20 + bytes.readUInt32LE(12)))
  assert.throws(() => publication.derivePublicSculptedModel(bytes, '0'.repeat(64)), /source hash/i)
})

test('public model custody rejects missing, unknown or forged derivation declarations', async () => {
  const { record } = readSculptedSourceRecord()
  const set = record.sets.find(set => set.setId === 'woodland-sculpted-set')
  const asset = JSON.parse(fs.readFileSync(path.join(root, 'public/dice/woodland-sculpted-set/runtime-assets.json'))).assets[0]
  const bytes = fs.readFileSync(path.join(root, `public${asset.model.path}`))
  const source = record.files.find(file => file.path === set.dice[0].model)
  publication.validatePublicSculptedModel(bytes, 'woodland-sculpted-set', 'd4', source.sha256, asset.publicDerivation)
  assert.throws(() => publication.validatePublicSculptedModel(bytes, 'woodland-sculpted-set', 'd4', '0'.repeat(64), asset.publicDerivation), /source hash drift/)
  for (const changed of [
    rewriteGlb(bytes, json => { json.materials[0].name = 'forged material' }),
    rewriteGlb(bytes, json => { json.scenes[0].extras.private = '/home/synthetic/private.blend' }),
    Buffer.from(bytes),
  ]) {
    if (changed.equals(bytes)) changed[changed.length - 1] ^= 1
    assert.throws(() => publication.validatePublicSculptedModel(changed, 'woodland-sculpted-set', 'd4', source.sha256, asset.publicDerivation))
  }
  for (const transform of [undefined, {}, { kind: 'unknown' }, { ...asset.publicDerivation, sourceSha256: '0'.repeat(64) }, { ...asset.publicDerivation, publicSha256: '0'.repeat(64) }]) {
    assert.throws(() => publication.validatePublicSculptedModel(bytes, 'woodland-sculpted-set', 'd4', source.sha256, transform))
  }
})

test('Woodland manifest consumer refuses missing and forged transform metadata', async () => {
  const { validateSculptedAssetManifest } = await import('./sculpted-asset-contract.mjs')
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'woodland-public-manifest-'))
  try {
    const dir = path.join(temp, 'public/dice/woodland-sculpted-set')
    fs.mkdirSync(path.dirname(dir), { recursive: true })
    fs.cpSync(path.join(root, 'public/dice/woodland-sculpted-set'), dir, { recursive: true })
    const file = path.join(dir, 'runtime-assets.json')
    const original = JSON.parse(fs.readFileSync(file))
    for (const mutate of [
      value => { delete value.assets[0].publicDerivation },
      value => { value.assets[0].publicDerivation.kind = 'unknown-v2' },
      value => { value.assets[0].publicDerivation.sourceSha256 = '0'.repeat(64) },
      value => { value.assets[0].publicDerivation.publicSha256 = '0'.repeat(64) },
      value => { value.assets[0].publicDerivation.extra = true },
    ]) {
      const changed = structuredClone(original)
      mutate(changed)
      fs.writeFileSync(file, JSON.stringify(changed))
      const result = await validateSculptedAssetManifest(file, temp)
      assert.equal(result.valid, false)
      assert.match(result.errors.join('\n'), /derivation declaration/)
    }
    fs.writeFileSync(file, JSON.stringify(original))
    assert.equal((await validateSculptedAssetManifest(file, temp)).valid, true)
  } finally { fs.rmSync(temp, { recursive: true, force: true }) }
})

test('all six original Woodland models reproduce exactly with JSON-minus-allowlist and full BIN preservation', { skip: !process.env.SCULPTED_SOURCE_ROOT }, () => {
  const { record } = readSculptedSourceRecord()
  for (const set of record.sets) {
    for (const die of set.dice) {
      const original = fs.readFileSync(path.join(process.env.SCULPTED_SOURCE_ROOT, die.model))
      const sourceSha256 = record.files.find(file => file.path === die.model).sha256
      assert.equal(sha256(original), sourceSha256)
      const current = fs.readFileSync(path.join(root, 'public/dice', set.setId, die.shape, 'model.glb'))
      if (set.setId !== 'woodland-sculpted-set') {
        assert.deepEqual(current, original)
        assert.throws(() => publication.validatePublicSculptedModel(current, set.setId, die.shape, sourceSha256, { kind: publication.PUBLIC_MODEL_TRANSFORM }))
        continue
      }
      const derived = publication.derivePublicSculptedModel(original, sourceSha256)
      assert.deepEqual(derived.bytes, current)
      const n = original.readUInt32LE(12), m = current.readUInt32LE(12)
      const expected = JSON.parse(original.subarray(20, 20 + n).toString())
      for (const scene of expected.scenes) for (const key of authoringKeys) delete scene.extras[key]
      assert.deepEqual(JSON.parse(current.subarray(20, 20 + m).toString()), expected)
      assert.deepEqual(current.subarray(20 + m), original.subarray(20 + n))
      const drifted = Buffer.from(original)
      drifted[drifted.length - 1] ^= 1
      assert.throws(() => publication.derivePublicSculptedModel(drifted, sourceSha256), /source hash/)
    }
  }
})

test('public Woodland GLBs contain no authoring coordinates or private absolute paths', () => {
  for (const shape of shapes) {
    const bytes = fs.readFileSync(path.join(root, 'public/dice/woodland-sculpted-set', shape, 'model.glb'))
    const json = JSON.parse(bytes.subarray(20, 20 + bytes.readUInt32LE(12)).toString())
    for (const scene of json.scenes) {
      assert.equal(authoringKeys.some(key => Object.hasOwn(scene.extras ?? {}, key)), false, `${shape} has private authoring extras`)
    }
    assert.doesNotMatch(JSON.stringify(json), /(?:\/Users\/|\/home\/|[A-Za-z]:\\\\|file:\/\/)/)
  }
})
