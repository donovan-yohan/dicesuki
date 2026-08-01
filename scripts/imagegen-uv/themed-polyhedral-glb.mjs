/**
 * Canonical themed polyhedral GLB builder.
 *
 * Resurrected from `scripts/production-dice-fixtures/themed-polyhedral-glb.mjs`
 * at commit 7393d112c5e062570ec7caf37970206c4d05c08c, reformatted, and rewired
 * onto the canonical-contract-v2 API that survives on `main`:
 *
 *   createThemedDiceGeometry   -> createCanonicalDiceGeometry
 *   getThemedDiceShapeSpec     -> getCanonicalDiceSpec
 *   validateThemedDiceManifest -> validateCanonicalManifest (fixture-anchored,
 *                                 strictly stronger than the old structural check)
 *
 * The builder writes a single-material glTF 2.0 binary with the ImageGen albedo
 * atlas and the derived normal map embedded as PNG buffer views. Runtime
 * promotion (`scripts/runtime-dice-assets/optimize.mjs`) later resizes these to
 * 1024px and re-encodes them as WebP.
 */

import { readFile } from 'node:fs/promises'

import * as THREE from 'three'

import {
  createCanonicalDiceGeometry,
  getCanonicalDiceSpec,
} from './canonical-dice-contract.mjs'
import { validateCanonicalManifest } from './canonical-validation.mjs'

const GLB_MAGIC = 0x46546c67
const GLB_VERSION = 2
const JSON_CHUNK_TYPE = 0x4e4f534a
const BIN_CHUNK_TYPE = 0x004e4942

export async function createThemedPolyhedralGlb(options) {
  const [atlas, normalMap, manifestRaw] = await Promise.all([
    readFile(options.atlasPath),
    options.normalMapPath ? readFile(options.normalMapPath) : Promise.resolve(null),
    readFile(options.manifestPath, 'utf8'),
  ])
  const manifest = JSON.parse(manifestRaw)
  const validation = validateCanonicalManifest(manifest)
  if (!validation.valid) {
    throw new Error(`Invalid canonical dice manifest:\n${validation.errors.join('\n')}`)
  }

  const spec = getCanonicalDiceSpec(manifest.shape)
  const geometry = createCanonicalDiceGeometry(manifest.shape, options.radius ?? 0.72)
  const nonIndexed = geometry.index ? geometry.toNonIndexed() : geometry

  try {
    const position = nonIndexed.getAttribute('position')
    const positions = new Float32Array(position.count * 3)
    const normals = new Float32Array(position.count * 3)
    const uvs = new Float32Array(position.count * 2)
    const uvByTriangleIndex = new Map(manifest.islands.flatMap((island) => (
      island.triangleIndices.map((triangleIndex, offset) => [triangleIndex, island.uvByTriangle[offset]])
    )))

    for (let triangleIndex = 0; triangleIndex < spec.canonicalTriangleCount; triangleIndex += 1) {
      const triangleUvs = uvByTriangleIndex.get(triangleIndex)
      if (!triangleUvs) throw new Error(`Missing UV mapping for triangle ${triangleIndex}`)
      const vertices = [0, 1, 2].map((offset) => (
        new THREE.Vector3().fromBufferAttribute(position, triangleIndex * 3 + offset)
      ))
      const normal = new THREE.Vector3()
        .crossVectors(
          vertices[1].clone().sub(vertices[0]),
          vertices[2].clone().sub(vertices[0]),
        )
        .normalize()

      for (let vertex = 0; vertex < 3; vertex += 1) {
        const attribute = triangleIndex * 3 + vertex
        positions.set(vertices[vertex].toArray(), attribute * 3)
        normals.set(normal.toArray(), attribute * 3)
        uvs[attribute * 2] = triangleUvs[vertex].u
        uvs[attribute * 2 + 1] = triangleUvs[vertex].v
      }
    }

    return buildGlb({
      shape: manifest.shape,
      name: options.name,
      positions,
      normals,
      uvs,
      atlas,
      normalMap,
      roughness: options.roughness ?? 0.38,
      metalness: options.metalness ?? 0.58,
      normalScale: options.normalScale ?? 0.72,
    })
  } finally {
    geometry.dispose()
    if (nonIndexed !== geometry) nonIndexed.dispose()
  }
}

/**
 * Outward face normals per face value, taken from the canonical manifest's mesh
 * triangles. Normals are scale invariant, so the manifest's unit-radius
 * positions describe any baked radius. Consumed by `metadata.json` and by the
 * proof renderer to aim a specific face at the camera.
 */
export function faceNormalsFromManifest(manifest) {
  return manifest.islands.map((island) => {
    const [a, b, c] = island.meshTriangles[0].positions.map((position) => new THREE.Vector3(...position))
    const normal = new THREE.Vector3()
      .crossVectors(b.clone().sub(a), c.clone().sub(a))
      .normalize()
    return {
      value: island.faceValue,
      normal: [round(normal.x, 6), round(normal.y, 6), round(normal.z, 6)],
    }
  })
}

/**
 * Model-space direction that the numeral's baseline runs along, per face value.
 *
 * The authoring kit draws each numeral rotated by `baselineAngleDegrees` about
 * its island centre, so in atlas space the numeral reads left-to-right along
 * `(cos θ, sin θ)`. Pushing that texture-space direction back through the
 * face's UV→position mapping yields the 3D direction a viewer must see as
 * horizontal for the numeral to appear upright — which is what the proof
 * renderer needs to roll the die correctly for its thumbnail.
 */
export function faceNumeralBaselinesFromManifest(manifest) {
  return manifest.islands.map((island) => {
    const radians = island.baselineAngleDegrees * Math.PI / 180
    const direction = textureDirectionToModel(island.meshTriangles[0], {
      u: Math.cos(radians),
      v: Math.sin(radians),
    })
    return {
      value: island.faceValue,
      baseline: [round(direction.x, 6), round(direction.y, 6), round(direction.z, 6)],
    }
  })
}

/**
 * Map a direction in texture space onto the plane of one mesh triangle.
 * Solves `duv = a * edge1uv + b * edge2uv` and reapplies `a`/`b` to the
 * matching 3D edges.
 */
function textureDirectionToModel(meshTriangle, duv) {
  const [p0, p1, p2] = meshTriangle.positions.map((position) => new THREE.Vector3(...position))
  const [uv0, uv1, uv2] = meshTriangle.uvs
  const e1u = uv1[0] - uv0[0]
  const e1v = uv1[1] - uv0[1]
  const e2u = uv2[0] - uv0[0]
  const e2v = uv2[1] - uv0[1]
  const determinant = e1u * e2v - e2u * e1v
  if (Math.abs(determinant) < 1e-12) throw new Error('Degenerate UV triangle; cannot orient numerals')
  const a = (duv.u * e2v - e2u * duv.v) / determinant
  const b = (e1u * duv.v - duv.u * e1v) / determinant
  return p1.clone().sub(p0).multiplyScalar(a)
    .add(p2.clone().sub(p0).multiplyScalar(b))
    .normalize()
}

function round(value, digits) {
  const multiplier = 10 ** digits
  const rounded = Math.round(value * multiplier) / multiplier
  return Object.is(rounded, -0) ? 0 : rounded
}

function buildGlb({ shape, name, positions, normals, uvs, atlas, normalMap, roughness, metalness, normalScale }) {
  const chunks = []
  const bufferViews = []
  let byteOffset = 0

  const addBufferView = (data, target) => {
    const buffer = Buffer.isBuffer(data)
      ? data
      : Buffer.from(data.buffer, data.byteOffset, data.byteLength)
    const alignedOffset = align4(byteOffset)
    if (alignedOffset > byteOffset) chunks.push(Buffer.alloc(alignedOffset - byteOffset))
    chunks.push(buffer)
    bufferViews.push({
      buffer: 0,
      byteOffset: alignedOffset,
      byteLength: buffer.length,
      ...(target ? { target } : {}),
    })
    byteOffset = alignedOffset + buffer.length
    return bufferViews.length - 1
  }

  const positionView = addBufferView(positions, 34962)
  const normalView = addBufferView(normals, 34962)
  const uvView = addBufferView(uvs, 34962)
  const atlasView = addBufferView(atlas)
  const normalMapView = normalMap ? addBufferView(normalMap) : null
  const paddedLength = align4(byteOffset)
  if (paddedLength > byteOffset) chunks.push(Buffer.alloc(paddedLength - byteOffset))
  const binary = Buffer.concat(chunks)

  const images = [{ bufferView: atlasView, mimeType: 'image/png', name: 'themed_dice_albedo_atlas' }]
  const textures = [{ sampler: 0, source: 0 }]
  if (normalMapView !== null) {
    images.push({ bufferView: normalMapView, mimeType: 'image/png', name: 'themed_dice_normal_map' })
    textures.push({ sampler: 0, source: 1 })
  }

  const json = {
    asset: {
      version: '2.0',
      generator: 'Dicesuki canonical themed polyhedral GLB builder',
      extras: { textureSource: 'Codex ImageGen image-to-image, canonical UV registered' },
    },
    scene: 0,
    scenes: [{ nodes: [0] }],
    nodes: [{ mesh: 0, name: name ?? `Themed_${shape.toUpperCase()}` }],
    meshes: [{
      name: 'themed_atlas_surface',
      primitives: [{
        attributes: { POSITION: 0, NORMAL: 1, TEXCOORD_0: 2 },
        material: 0,
        mode: 4,
      }],
    }],
    materials: [{
      name: 'ThemedDiceAtlasMaterial',
      pbrMetallicRoughness: {
        baseColorTexture: { index: 0 },
        baseColorFactor: [1, 1, 1, 1],
        metallicFactor: metalness,
        roughnessFactor: roughness,
      },
      ...(normalMap ? { normalTexture: { index: 1, scale: normalScale } } : {}),
    }],
    samplers: [{ magFilter: 9729, minFilter: 9987, wrapS: 33071, wrapT: 33071 }],
    textures,
    images,
    accessors: [
      createAccessor(positionView, positions, 3, 'VEC3', true),
      createAccessor(normalView, normals, 3, 'VEC3', false),
      createAccessor(uvView, uvs, 2, 'VEC2', true),
    ],
    bufferViews,
    buffers: [{ byteLength: binary.length }],
  }

  return encodeGlb(json, binary)
}

function createAccessor(bufferView, values, itemSize, type, includeBounds) {
  const accessor = {
    bufferView,
    byteOffset: 0,
    componentType: 5126,
    count: values.length / itemSize,
    type,
  }
  if (includeBounds) {
    const min = Array(itemSize).fill(Infinity)
    const max = Array(itemSize).fill(-Infinity)
    for (let index = 0; index < values.length; index += itemSize) {
      for (let component = 0; component < itemSize; component += 1) {
        min[component] = Math.min(min[component], values[index + component])
        max[component] = Math.max(max[component], values[index + component])
      }
    }
    accessor.min = min
    accessor.max = max
  }
  return accessor
}

function encodeGlb(json, binary) {
  const source = JSON.stringify(json)
  const jsonChunk = Buffer.alloc(align4(Buffer.byteLength(source)), 0x20)
  jsonChunk.write(source)
  const binChunk = Buffer.alloc(align4(binary.length))
  binary.copy(binChunk)
  const totalLength = 12 + 8 + jsonChunk.length + 8 + binChunk.length
  const output = Buffer.alloc(totalLength)
  let offset = 0

  output.writeUInt32LE(GLB_MAGIC, offset); offset += 4
  output.writeUInt32LE(GLB_VERSION, offset); offset += 4
  output.writeUInt32LE(totalLength, offset); offset += 4
  output.writeUInt32LE(jsonChunk.length, offset); offset += 4
  output.writeUInt32LE(JSON_CHUNK_TYPE, offset); offset += 4
  jsonChunk.copy(output, offset); offset += jsonChunk.length
  output.writeUInt32LE(binChunk.length, offset); offset += 4
  output.writeUInt32LE(BIN_CHUNK_TYPE, offset); offset += 4
  binChunk.copy(output, offset)

  return output
}

function align4(value) {
  return (value + 3) & ~3
}
