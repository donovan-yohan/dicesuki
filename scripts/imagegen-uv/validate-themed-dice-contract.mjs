#!/usr/bin/env node
import assert from 'node:assert/strict'
import { createThemedDiceManifest, SUPPORTED_DICE_SHAPES, validateThemedDiceManifest } from './themed-dice-contract.mjs'

for (const shape of SUPPORTED_DICE_SHAPES) {
  const manifest = createThemedDiceManifest(shape)
  const result = validateThemedDiceManifest(manifest)
  assert.equal(result.valid, true, `${shape}: ${result.errors.join('; ')}`)
  assert.equal(manifest.islands.length, manifest.canonicalFaceCount)
  for (const island of manifest.islands) assert.equal(island.uvByTriangle.length, manifest.trianglesPerFace)
}

const d10 = createThemedDiceManifest('d10')
assert.deepEqual(d10.faceValues, [0, 1, 2, 3, 4, 5, 6, 7, 8, 9])
assert.equal(d10.canonicalFaceCount, 10)
assert.equal(d10.canonicalTriangleCount, 20)
assert.ok(d10.islands.every((island) => island.triangleCount === 2 && island.sharedAtlasIsland))

const duplicate = structuredClone(d10)
duplicate.islands[1].faceValue = duplicate.islands[0].faceValue
assert.equal(validateThemedDiceManifest(duplicate).valid, false)

const malformedD10 = structuredClone(d10)
malformedD10.islands[0].triangleCount = 1
assert.equal(validateThemedDiceManifest(malformedD10).valid, false)

const malformedD10Topology = structuredClone(d10)
malformedD10Topology.islands[0].triangleIndices[1] = 2
assert.equal(validateThemedDiceManifest(malformedD10Topology).valid, false)

assert.doesNotMatch(
  validateThemedDiceManifest(d10).errors.join('; '),
  /not coplanar/,
  'each D10 kite must be a flat physical face',
)

console.log(`Themed dice contract validation passed for ${SUPPORTED_DICE_SHAPES.join(', ')} (D10: 10 kites / 20 triangles)`)
