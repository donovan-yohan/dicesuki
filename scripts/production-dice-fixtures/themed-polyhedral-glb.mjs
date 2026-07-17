import { readFile } from 'node:fs/promises'
import * as THREE from 'three'
import { createThemedDiceGeometry, getThemedDiceShapeSpec, validateThemedDiceManifest } from '../imagegen-uv/themed-dice-contract.mjs'

const GLB_MAGIC = 0x46546c67
const GLB_VERSION = 2
const JSON_CHUNK_TYPE = 0x4e4f534a
const BIN_CHUNK_TYPE = 0x004e4942

export async function createThemedPolyhedralGlb(options) {
  const [atlas, normalMap, manifestRaw] = await Promise.all([readFile(options.atlasPath), options.normalMapPath ? readFile(options.normalMapPath) : null, readFile(options.manifestPath, 'utf8')])
  const manifest = typeof manifestRaw === 'string' ? JSON.parse(manifestRaw) : JSON.parse(manifestRaw.toString('utf8'))
  const result = validateThemedDiceManifest(manifest)
  if (!result.valid) throw new Error(`Invalid themed dice manifest:\n${result.errors.join('\n')}`)
  const spec = getThemedDiceShapeSpec(manifest.shape)
  const geometry = createThemedDiceGeometry(manifest.shape, options.radius ?? 0.72)
  const nonIndexed = geometry.index ? geometry.toNonIndexed() : geometry
  const position = nonIndexed.getAttribute('position')
  const positions = new Float32Array(position.count * 3)
  const normals = new Float32Array(position.count * 3)
  const uvs = new Float32Array(position.count * 2)
  const byTriangle = new Map(manifest.islands.flatMap((island) => island.triangleIndices.map((triangleIndex, offset) => [triangleIndex, island.uvByTriangle[offset]])))
  for (let triangleIndex = 0; triangleIndex < spec.canonicalTriangleCount; triangleIndex += 1) {
    const triangleUvs = byTriangle.get(triangleIndex)
    if (!triangleUvs) throw new Error(`Missing UV mapping for triangle ${triangleIndex}`)
    const a = new THREE.Vector3().fromBufferAttribute(position, triangleIndex * 3)
    const b = new THREE.Vector3().fromBufferAttribute(position, triangleIndex * 3 + 1)
    const c = new THREE.Vector3().fromBufferAttribute(position, triangleIndex * 3 + 2)
    const normal = new THREE.Vector3().crossVectors(b.clone().sub(a), c.clone().sub(a)).normalize()
    for (let vertex = 0; vertex < 3; vertex += 1) {
      const attribute = triangleIndex * 3 + vertex
      positions.set([a, b, c][vertex].toArray(), attribute * 3)
      normals.set(normal.toArray(), attribute * 3)
      uvs[attribute * 2] = triangleUvs[vertex].u
      uvs[attribute * 2 + 1] = triangleUvs[vertex].v
    }
  }
  geometry.dispose(); if (nonIndexed !== geometry) nonIndexed.dispose()
  return buildGlb({ shape: manifest.shape, positions, normals, uvs, atlas, normalMap, roughness: options.roughness ?? 0.38, metalness: options.metalness ?? 0.58, normalScale: options.normalScale ?? 0.72 })
}

export const buildThemedPolyhedralGlb = createThemedPolyhedralGlb

function buildGlb({ shape, positions, normals, uvs, atlas, normalMap, roughness, metalness, normalScale }) {
  const chunks = []; const bufferViews = []; let byteOffset = 0
  const addView = (data, target) => { const buffer = Buffer.isBuffer(data) ? data : Buffer.from(data.buffer, data.byteOffset, data.byteLength); const offset = align4(byteOffset); if (offset > byteOffset) chunks.push(Buffer.alloc(offset - byteOffset)); chunks.push(buffer); bufferViews.push({ buffer: 0, byteOffset: offset, byteLength: buffer.length, ...(target ? { target } : {}) }); byteOffset = offset + buffer.length; return bufferViews.length - 1 }
  const positionView = addView(positions, 34962); const normalView = addView(normals, 34962); const uvView = addView(uvs, 34962); const atlasView = addView(atlas); const normalViewImage = normalMap ? addView(normalMap) : null
  const binary = Buffer.concat(chunks); const images = [{ bufferView: atlasView, mimeType: 'image/png', name: 'themed_dice_albedo_atlas' }]; const textures = [{ sampler: 0, source: 0 }]
  if (normalViewImage !== null) { images.push({ bufferView: normalViewImage, mimeType: 'image/png', name: 'themed_dice_normal_map' }); textures.push({ sampler: 0, source: 1 }) }
  const json = { asset: { version: '2.0', generator: 'Daisu generalized themed polyhedral GLB builder' }, scene: 0, scenes: [{ nodes: [0] }], nodes: [{ mesh: 0, name: `Themed_${shape.toUpperCase()}` }], meshes: [{ primitives: [{ attributes: { POSITION: 0, NORMAL: 1, TEXCOORD_0: 2 }, material: 0, mode: 4 }] }], materials: [{ name: 'ThemedDiceAtlasMaterial', pbrMetallicRoughness: { baseColorTexture: { index: 0 }, baseColorFactor: [1, 1, 1, 1], metallicFactor: metalness, roughnessFactor: roughness }, ...(normalMap ? { normalTexture: { index: 1, scale: normalScale } } : {}) }], samplers: [{ magFilter: 9729, minFilter: 9987, wrapS: 33071, wrapT: 33071 }], textures, images, accessors: [accessor(positionView, positions, 3, 'VEC3', true), accessor(normalView, normals, 3, 'VEC3', false), accessor(uvView, uvs, 2, 'VEC2', true)], bufferViews, buffers: [{ byteLength: binary.length }] }
  return encodeGlb(json, binary)
}

function accessor(bufferView, values, itemSize, type, bounds) { const result = { bufferView, byteOffset: 0, componentType: 5126, count: values.length / itemSize, type }; if (bounds) { result.min = []; result.max = []; for (let component = 0; component < itemSize; component += 1) { const valuesForComponent = []; for (let index = component; index < values.length; index += itemSize) valuesForComponent.push(values[index]); result.min.push(Math.min(...valuesForComponent)); result.max.push(Math.max(...valuesForComponent)) } } return result }
function align4(value) { return (value + 3) & ~3 }
function encodeGlb(json, binary) { const source = JSON.stringify(json); const jsonChunk = Buffer.alloc(align4(Buffer.byteLength(source)), 0x20); jsonChunk.write(source); const binChunk = Buffer.alloc(align4(binary.length)); binary.copy(binChunk); const totalLength = 12 + 8 + jsonChunk.length + 8 + binChunk.length; const output = Buffer.alloc(totalLength); let offset = 0; output.writeUInt32LE(GLB_MAGIC, offset); offset += 4; output.writeUInt32LE(GLB_VERSION, offset); offset += 4; output.writeUInt32LE(totalLength, offset); offset += 4; output.writeUInt32LE(jsonChunk.length, offset); offset += 4; output.writeUInt32LE(JSON_CHUNK_TYPE, offset); offset += 4; jsonChunk.copy(output, offset); offset += jsonChunk.length; output.writeUInt32LE(binChunk.length, offset); offset += 4; output.writeUInt32LE(BIN_CHUNK_TYPE, offset); offset += 4; binChunk.copy(output, offset); return output }
