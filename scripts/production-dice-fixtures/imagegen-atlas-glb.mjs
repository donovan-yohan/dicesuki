import { readFile } from 'node:fs/promises'
import * as THREE from 'three'

const GLB_MAGIC = 0x46546c67
const GLB_VERSION = 2
const JSON_CHUNK_TYPE = 0x4e4f534a
const BIN_CHUNK_TYPE = 0x004e4942

export async function createImageGenD20Glb(options) {
  const [atlas, normalMap, manifestRaw] = await Promise.all([
    readFile(options.atlasPath),
    options.normalMapPath ? readFile(options.normalMapPath) : Promise.resolve(null),
    readFile(options.manifestPath, 'utf8'),
  ])
  const manifest = JSON.parse(manifestRaw)
  validateManifest(manifest)

  const geometry = new THREE.IcosahedronGeometry(options.radius ?? 0.72, 0)
  const nonIndexed = geometry.index ? geometry.toNonIndexed() : geometry
  const positionAttribute = nonIndexed.getAttribute('position')
  const positions = new Float32Array(positionAttribute.count * 3)
  const normals = new Float32Array(positionAttribute.count * 3)
  const uvs = new Float32Array(positionAttribute.count * 2)
  const islandsByMaterial = new Map(manifest.islands.map((island) => [island.materialIndex, island]))

  for (let triangleIndex = 0; triangleIndex < manifest.islands.length; triangleIndex++) {
    const island = islandsByMaterial.get(triangleIndex)
    if (!island) throw new Error(`Missing atlas island for D20 triangle ${triangleIndex}`)

    const vertices = [0, 1, 2].map((offset) => {
      return new THREE.Vector3().fromBufferAttribute(positionAttribute, triangleIndex * 3 + offset)
    })
    const normal = new THREE.Vector3()
      .crossVectors(vertices[1].clone().sub(vertices[0]), vertices[2].clone().sub(vertices[0]))
      .normalize()

    for (let vertexIndex = 0; vertexIndex < 3; vertexIndex++) {
      const attributeIndex = triangleIndex * 3 + vertexIndex
      const positionOffset = attributeIndex * 3
      const uvOffset = attributeIndex * 2
      const uv = island.uvByVertex.find((candidate) => candidate.vertexIndex === vertexIndex)
      if (!uv) throw new Error(`Missing UV for triangle ${triangleIndex} vertex ${vertexIndex}`)

      positions.set(vertices[vertexIndex].toArray(), positionOffset)
      normals.set(normal.toArray(), positionOffset)
      uvs[uvOffset] = uv.u
      uvs[uvOffset + 1] = uv.v
    }
  }

  geometry.dispose()
  if (nonIndexed !== geometry) nonIndexed.dispose()

  return buildGlb({
    positions,
    normals,
    uvs,
    atlas,
    normalMap,
    roughness: options.roughness ?? 0.38,
    metalness: options.metalness ?? 0.58,
    normalScale: options.normalScale ?? 0.72,
  })
}

function validateManifest(manifest) {
  if (manifest.shape !== 'd20' || manifest.islands?.length !== 20) {
    throw new Error('ImageGen GLB generation requires the canonical 20-island D20 manifest')
  }
  const values = new Set(manifest.islands.map((island) => island.faceValue))
  const materials = new Set(manifest.islands.map((island) => island.materialIndex))
  if (values.size !== 20 || materials.size !== 20) {
    throw new Error('D20 atlas manifest has duplicate face values or material indexes')
  }
}

function buildGlb({ positions, normals, uvs, atlas, normalMap, roughness, metalness, normalScale }) {
  const chunks = []
  const bufferViews = []
  let byteOffset = 0

  const addBufferView = (data, options = {}) => {
    const buffer = Buffer.isBuffer(data)
      ? data
      : Buffer.from(data.buffer, data.byteOffset, data.byteLength)
    const alignedOffset = align4(byteOffset)
    if (alignedOffset > byteOffset) chunks.push(Buffer.alloc(alignedOffset - byteOffset))
    chunks.push(buffer)
    const view = {
      buffer: 0,
      byteOffset: alignedOffset,
      byteLength: buffer.length,
      ...(options.target ? { target: options.target } : {}),
    }
    const index = bufferViews.push(view) - 1
    byteOffset = alignedOffset + buffer.length
    return index
  }

  const positionView = addBufferView(positions, { target: 34962 })
  const normalView = addBufferView(normals, { target: 34962 })
  const uvView = addBufferView(uvs, { target: 34962 })
  const atlasView = addBufferView(atlas)
  const normalMapView = normalMap ? addBufferView(normalMap) : null
  const paddedLength = align4(byteOffset)
  if (paddedLength > byteOffset) chunks.push(Buffer.alloc(paddedLength - byteOffset))
  const binary = Buffer.concat(chunks)

  const images = [{ bufferView: atlasView, mimeType: 'image/png', name: 'codex_imagegen_albedo' }]
  const textures = [{ sampler: 0, source: 0 }]
  if (normalMapView !== null) {
    images.push({ bufferView: normalMapView, mimeType: 'image/png', name: 'derived_relief_normal' })
    textures.push({ sampler: 0, source: 1 })
  }

  const json = {
    asset: {
      version: '2.0',
      generator: 'Daisu canonical D20 ImageGen atlas pipeline',
      extras: { textureSource: 'Codex built-in ImageGen image-to-image' },
    },
    scene: 0,
    scenes: [{ nodes: [0] }],
    nodes: [{ mesh: 0, name: 'Aurelian_Sapphire_ImageGen_D20' }],
    meshes: [{
      name: 'imagegen_atlas_surface',
      primitives: [{
        attributes: { POSITION: 0, NORMAL: 1, TEXCOORD_0: 2 },
        material: 0,
        mode: 4,
      }],
    }],
    materials: [{
      name: 'Codex_ImageGen_Antique_Gold_Blue_Enamel',
      pbrMetallicRoughness: {
        baseColorTexture: { index: 0 },
        baseColorFactor: [1, 1, 1, 1],
        metallicFactor: metalness,
        roughnessFactor: roughness,
      },
      ...(normalMap ? { normalTexture: { index: 1, scale: normalScale } } : {}),
    }],
    samplers: [{
      magFilter: 9729,
      minFilter: 9987,
      wrapS: 33071,
      wrapT: 33071,
    }],
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
    const { min, max } = findBounds(values, itemSize)
    accessor.min = min
    accessor.max = max
  }
  return accessor
}

function findBounds(values, itemSize) {
  const min = Array(itemSize).fill(Infinity)
  const max = Array(itemSize).fill(-Infinity)
  for (let index = 0; index < values.length; index += itemSize) {
    for (let component = 0; component < itemSize; component++) {
      min[component] = Math.min(min[component], values[index + component])
      max[component] = Math.max(max[component], values[index + component])
    }
  }
  return { min, max }
}

function encodeGlb(json, binary) {
  const jsonSource = JSON.stringify(json)
  const jsonLength = align4(Buffer.byteLength(jsonSource))
  const jsonChunk = Buffer.alloc(jsonLength, 0x20)
  jsonChunk.write(jsonSource)
  const binLength = align4(binary.length)
  const binChunk = Buffer.alloc(binLength)
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
