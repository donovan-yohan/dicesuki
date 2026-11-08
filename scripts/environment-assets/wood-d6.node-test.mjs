import test from 'node:test'
import assert from 'node:assert/strict'
import path from 'node:path'

import { readFile } from 'node:fs/promises'
import { createCanonicalDiceManifest } from '../imagegen-uv/canonical-dice-contract.mjs'

import { stat } from 'node:fs/promises'

const pipeline = await import('./wood-d6.mjs').catch(() => ({}))

test('Blender proof exports a real textured canonical GLB and all six runtime faces', { skip: !process.env.WOOD_D6_E2E }, async () => {
  assert.equal(typeof pipeline.runWoodProof, 'function', 'runnable Blender proof pipeline must exist')
  const out = '.artifacts/theme-workshop/experiments/woodland'
  const result = await pipeline.runWoodProof({ outputDir: out })
  assert.equal(result.procedural, true)
  assert.deepEqual(result.contract.bounds.size.map(v => Number(v.toFixed(4))), [1, 1, 1])
  assert.deepEqual(result.runtime.worldBounds.size.map(v => Number(v.toFixed(4))), [1.1, 1.1, 1.1])
  assert.equal(result.contract.triangles, 12)
  assert.deepEqual(result.contract.faceValues, [1, 2, 3, 4, 5, 6])
  assert.equal(result.runtime.faces.length, 6)
  assert.equal(result.runtime.materials[0].normalMap, true)
  assert.equal(result.runtime.materials[0].roughnessMap, true)
  assert.equal(result.runtime.errors.length, 0)
  assert.ok(result.runtime.normalReliefDeltaPixels > 100, 'disabling the embedded normal map must visibly change actual runtime shading')
  const metadata = JSON.parse(await readFile(result.outputs.metadata, 'utf8'))
  assert.equal(metadata.scale, 1.1)
  assert.deepEqual(metadata.colliderArgs.halfExtents, [0.55, 0.55, 0.55])
  assert.equal(metadata.diceType, 'd6')
  for (const field of ['blend', 'glb', 'contactSheet', 'blenderHero']) {
    assert.ok((await stat(result.outputs[field])).size > 1000, field)
  }
  for (const map of Object.values(result.materialMaps)) assert.deepEqual(map.dimensions, [2048, 2048])
  const glb = await readFile(result.outputs.glb)
  pipeline.validateGlbContract(glb, createCanonicalDiceManifest('d6'))
  assert.throws(() => pipeline.validateGlbContract(Buffer.from('not a glb'), createCanonicalDiceManifest('d6')), /GLB/)
  const mutated = Buffer.from(glb)
  // A valid header does not make changed geometry valid: perturb first float in binary chunk.
  const jsonLength = mutated.readUInt32LE(12)
  mutated.writeFloatLE(13, 28 + jsonLength)
  assert.throws(() => pipeline.validateGlbContract(mutated, createCanonicalDiceManifest('d6')), /canonical|bound/)
})

test('wood D6 manifest validation rejects altered numbering and non-D6 contracts', () => {
  assert.equal(typeof pipeline.assertWoodManifest, 'function', 'manifest guard must exist')
  const manifest = createCanonicalDiceManifest('d6')
  pipeline.assertWoodManifest(manifest)
  const altered = structuredClone(manifest)
  altered.islands[0].faceValue = 6
  assert.throws(() => pipeline.assertWoodManifest(altered), /canonical/)
  assert.throws(() => pipeline.assertWoodManifest(createCanonicalDiceManifest('d8')), /D6/)
})

test('proof outputs refuse runtime/public and paths outside the woodland experiment', () => {
  assert.equal(typeof pipeline.assertProofOutput, 'function', 'wood proof output guard must exist')
  const root = process.cwd()
  const safe = '.artifacts/theme-workshop/experiments/woodland/d6'
  assert.equal(pipeline.assertProofOutput(safe), path.resolve(safe))
  for (const out of ['public/dice/wood', 'scripts/generated', '../wood', '.artifacts/other']) {
    assert.throws(() => pipeline.assertProofOutput(out), /woodland experiment/)
  }
  assert.throws(() => pipeline.assertProofOutput(root), /woodland experiment/)
})
