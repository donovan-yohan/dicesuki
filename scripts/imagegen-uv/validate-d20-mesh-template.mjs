#!/usr/bin/env node
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { createD20MeshTemplateManifest } from './d20-mesh-template.mjs'

const ROOT = path.resolve('public/artist-resources/imagegen-uv/d20-imagegen')
const paths = {
  manifest: path.join(ROOT, 'd20-mesh-uv-manifest.json'),
  guide: path.join(ROOT, 'd20-numbered-mesh-guide.png'),
  input: path.join(ROOT, 'd20-imagegen-input.png'),
  generated: path.join(ROOT, 'antique-gold-blue-enamel-imagegen-v2-edge-aligned.png'),
  normal: path.join(ROOT, 'antique-gold-blue-enamel-normal-v2-edge-aligned.png'),
  prompt: path.join(ROOT, 'd20-imagegen-edge-aligned-prompt.md'),
}

const storedManifest = JSON.parse(await readFile(paths.manifest, 'utf8'))
const generatedManifest = createD20MeshTemplateManifest()
assert.deepEqual(storedManifest, generatedManifest, 'stored D20 mesh manifest must match the Three.js geometry projection')
assert.deepEqual(storedManifest.islands.map((island) => island.faceValue), Array.from({ length: 20 }, (_, index) => index + 1))
assert.equal(new Set(storedManifest.islands.map((island) => island.materialIndex)).size, 20)

for (const island of storedManifest.islands) {
  assert.equal(island.points.length, 3, `face ${island.faceValue} triangle points`)
  assert.equal(island.uvByVertex.length, 3, `face ${island.faceValue} vertex UVs`)
  assert.deepEqual(island.uvByVertex.map((uv) => uv.vertexIndex).sort(), [0, 1, 2])
  assert.equal(island.baselineEdge.length, 2, `face ${island.faceValue} baseline edge`)
  const baselineStart = island.points.find((point) => point.vertexIndex === island.baselineEdge[0])
  const baselineEnd = island.points.find((point) => point.vertexIndex === island.baselineEdge[1])
  assert.ok(baselineStart && baselineEnd, `face ${island.faceValue} baseline vertices exist`)
  const baselineAngle = normalizeUndirectedAngle(
    Math.atan2(baselineEnd.y - baselineStart.y, baselineEnd.x - baselineStart.x) * 180 / Math.PI,
  )
  assert.ok(Math.abs(baselineAngle - island.baselineAngleDegrees) < 0.001, `face ${island.faceValue} numeral follows base edge`)

  const edgeAngles = island.points.map((start, index) => {
    const end = island.points[(index + 1) % island.points.length]
    return Math.abs(normalizeUndirectedAngle(Math.atan2(end.y - start.y, end.x - start.x) * 180 / Math.PI))
  })
  assert.ok(Math.abs(baselineAngle) <= Math.min(...edgeAngles) + 0.001, `face ${island.faceValue} uses the canonical base edge`)
  for (const uv of island.uvByVertex) {
    assert.ok(uv.u >= 0 && uv.u <= 1, `face ${island.faceValue} u in range`)
    assert.ok(uv.v >= 0 && uv.v <= 1, `face ${island.faceValue} v in range`)
  }
}

const guideSize = readPngSize(await readFile(paths.guide))
const inputSize = readPngSize(await readFile(paths.input))
const generatedSize = readPngSize(await readFile(paths.generated))
const normalSize = readPngSize(await readFile(paths.normal))
assert.deepEqual(guideSize, { width: 2048, height: 2048 })
assert.deepEqual(inputSize, guideSize)
assert.equal(generatedSize.width, generatedSize.height)
assert.ok(generatedSize.width >= 1024)
assert.deepEqual(normalSize, generatedSize)
assert.match(await readFile(paths.prompt, 'utf8'), /built-in Codex ImageGen/)

console.log('Canonical numbered D20 ImageGen template, generated atlas, and normal map validation passed')

function readPngSize(buffer) {
  const signature = buffer.subarray(0, 8).toString('hex')
  assert.equal(signature, '89504e470d0a1a0a', 'expected PNG signature')
  return {
    width: buffer.readUInt32BE(16),
    height: buffer.readUInt32BE(20),
  }
}

function normalizeUndirectedAngle(angleDegrees) {
  let normalized = ((angleDegrees + 90) % 180 + 180) % 180 - 90
  if (Math.abs(normalized) < 1e-9) normalized = 0
  return normalized
}
