import test from 'node:test'
import assert from 'node:assert/strict'
import path from 'node:path'
import { readFile, stat } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import sharp from 'sharp'
import { validateGlbContract } from './wood-d6.mjs'
import { createCanonicalDiceManifest } from '../imagegen-uv/canonical-dice-contract.mjs'

const hash = buffer => createHash('sha256').update(buffer).digest('hex')

const pipeline = await import('./wood-d6-variants.mjs').catch(error => {
  if (error.code !== 'ERR_MODULE_NOT_FOUND' || !error.message.includes('wood-d6-variants.mjs')) throw error
  return {}
})

// Optimizations must never overwrite the raw Blender proof or become catalog assets.
test('variant output fence permits only the ignored woodland variants subtree', () => {
  assert.equal(typeof pipeline.assertVariantOutput, 'function', 'variant output guard must exist')
  const root = '.artifacts/theme-workshop/experiments/woodland/variants'
  assert.equal(pipeline.assertVariantOutput(root), path.resolve(root))
  assert.equal(pipeline.assertVariantOutput(`${root}/repeat`), path.resolve(root, 'repeat'))
  for (const output of ['public/dice/wood', 'scripts/generated', '../wood', root + '-outside', root + '/..', '.artifacts/theme-workshop/experiments/woodland']) {
    assert.throws(() => pipeline.assertVariantOutput(output), /woodland variants/)
  }
})

// Manual offline acceptance gate: real CLI, embedded images and canonical validator.
test('optimizer emits smaller mobile512/desktop1024 GLBs without changing raw inputs', { timeout: 240000 }, async () => {
  assert.equal(typeof pipeline.buildWoodVariants, 'function', 'reproducible variant builder must exist')
  const root = '.artifacts/theme-workshop/experiments/woodland'
  const source = await readFile(`${root}/wood-d6.glb`)
  const metadata = await readFile(`${root}/wood-d6.metadata.json`)
  const result = await pipeline.buildWoodVariants()
  assert.equal(result.tool.version, '4.4.1')
  assert.equal(result.source.sha256, hash(source))
  assert.equal(result.source.bytes, source.length)
  assert.equal(result.scale, 1.1)
  assert.deepEqual(result.variants.map(v => v.tier), ['mobile', 'desktop'])
  for (const [index, variant] of result.variants.entries()) {
    const dimension = [512, 1024][index]
    assert.equal(variant.dimension, dimension)
    assert.equal(variant.path, `${root}/variants/${variant.tier}.glb`)
    const buffer = await readFile(variant.path)
    assert.ok(buffer.length < source.length, `${variant.tier} must be smaller than raw`)
    assert.equal(variant.bytes, buffer.length)
    assert.equal(variant.sha256, hash(buffer))
    const contract = validateGlbContract(buffer, createCanonicalDiceManifest('d6'))
    assert.deepEqual(contract.bounds.size, [1, 1, 1])
    assert.equal(contract.triangles, 12)
    assert.deepEqual(contract.faceValues, [1, 2, 3, 4, 5, 6])
    assert.deepEqual(variant.preservedAttributes, ['POSITION', 'NORMAL', 'TEXCOORD_0', 'indices'])
    assert.equal(variant.images.length, 3)
    assert.deepEqual(variant.images.map(image => image.slot), ['baseColorTexture', 'normalTexture', 'metallicRoughnessTexture'])
    const jsonLength = buffer.readUInt32LE(12)
    const gltf = JSON.parse(buffer.toString('utf8', 20, 20 + jsonLength))
    assert.ok(gltf.extensionsRequired.includes('EXT_texture_webp'))
    for (const image of variant.images) {
      const texture = gltf.textures[image.textureIndex]
      const definition = gltf.images[texture.extensions.EXT_texture_webp.source]
      const view = gltf.bufferViews[definition.bufferView]
      const embedded = buffer.subarray(28 + jsonLength + (view.byteOffset ?? 0), 28 + jsonLength + (view.byteOffset ?? 0) + view.byteLength)
      const info = await sharp(embedded).metadata()
      assert.equal(info.format, 'webp')
      assert.deepEqual([info.width, info.height], [dimension, dimension])
      assert.deepEqual(image.dimensions, [dimension, dimension])
      if (image.slot !== 'baseColorTexture') assert.equal(image.losslessPixelMatch, true)
    }
  }
  assert.equal(hash(await readFile(`${root}/wood-d6.glb`)), hash(source))
  assert.deepEqual(await readFile(`${root}/wood-d6.metadata.json`), metadata)
  assert.deepEqual(JSON.parse(await readFile(result.receiptPath, 'utf8')), result)
  const repeated = await pipeline.buildWoodVariants()
  assert.deepEqual(repeated, result, 'same pinned tools and inputs must produce identical hashes/receipts')
})

// Actual GLTFLoader + WebGL proves extension decoding, data maps and scale policy.
test('installed Chrome renders canonical face 6 and hero for both optimized tiers', { timeout: 120000 }, async () => {
  assert.equal(typeof pipeline.captureWoodVariantProof, 'function', 'actual browser variant proof must exist')
  const result = await pipeline.captureWoodVariantProof()
  assert.equal(result.browser.executable, process.env.WOOD_D6_CHROME ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome')
  assert.equal(result.browser.network, 'fixed local route fulfillment; no server')
  for (const variant of result.variants) {
    assert.deepEqual(variant.runtime.errors, [])
    assert.deepEqual(variant.runtime.bounds.size, [1, 1, 1])
    assert.deepEqual(variant.runtime.worldBounds.size, [1.1, 1.1, 1.1])
    assert.equal(variant.runtime.faces[0].value, 6)
    assert.deepEqual(variant.runtime.faces[0].normal, [0, 1, 0])
    assert.ok(variant.runtime.materials.length > 0)
    for (const material of variant.runtime.materials) {
      for (const map of ['albedo', 'normal', 'roughness']) {
        assert.deepEqual(material[map].dimensions, [variant.dimension, variant.dimension])
      }
      assert.equal(material.albedo.colorSpace, 'srgb')
      assert.equal(material.normal.colorSpace, '')
      assert.equal(material.roughness.colorSpace, '')
    }
    assert.ok(variant.runtime.normalReliefDeltaPixels > 100)
    assert.ok(variant.runtime.roughnessDeltaPixels > 100)
    for (const view of ['face6', 'hero']) {
      assert.ok(variant.runtime.pixels[view].foreground > 10000, 'not a blank canvas')
      assert.ok(variant.runtime.pixels[view].colors > 100, 'actual shaded wood pixels')
      assert.ok((await stat(variant.proofs[view])).size > 1000)
      const info = await sharp(variant.proofs[view]).metadata()
      assert.deepEqual([info.width, info.height], [720, 720])
    }
  }
  assert.ok((await stat(result.proofContactSheet)).size > 1000)
  assert.deepEqual(JSON.parse(await readFile(result.receiptPath, 'utf8')), result)
})
