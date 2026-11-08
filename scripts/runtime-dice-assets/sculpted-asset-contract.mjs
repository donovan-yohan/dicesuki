import fs from 'node:fs'
import path from 'node:path'
import sharp from 'sharp'
import { validatePublicSculptedModel } from './sculpted-public-model.mjs'
import { SCULPTED_ASSET_PROFILES, SCULPTED_SOURCE_RECORD_FILE } from './sculpted-asset-profiles.mjs'
import { inspectThumbnail, publicAssetFile, sha256 } from './runtime-asset-contract.mjs'
import { createCanonicalDiceManifest } from '../imagegen-uv/canonical-dice-contract.mjs'
import { faceNormalsFromManifest } from '../imagegen-uv/themed-polyhedral-glb.mjs'

/** v2 Manifest = {assetKind:'sculpted', setId, source, budgets, assets[6]}.
 * Model stats are measured, never supplied by authoring metadata. */
const shapes = ['d4', 'd6', 'd8', 'd10', 'd12', 'd20']
const sourceRecordPath = path.join(import.meta.dirname, 'sources', SCULPTED_SOURCE_RECORD_FILE)
const allowedExtensions = new Set(['EXT_texture_webp', 'KHR_materials_emissive_strength', 'KHR_materials_specular', 'KHR_materials_transmission', 'KHR_materials_ior'])
const record = value => value !== null && typeof value === 'object' && !Array.isArray(value)
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b)
const requireThat = (condition, message) => { if (!condition) throw Error(message) }

export function readSculptedSourceRecord() {
  const bytes = fs.readFileSync(sourceRecordPath)
  return { record: JSON.parse(bytes), sha256: sha256(bytes) }
}

export function readRegularFile(root, relative) {
  requireThat(typeof relative === 'string' && !path.isAbsolute(relative) && relative.split('/').every(part => part && part !== '.' && part !== '..'), 'Invalid bounded relative path')
  const base = path.resolve(root)
  let current = path.parse(base).root
  for (const segment of path.join(base, relative).slice(current.length).split(path.sep)) {
    current = path.join(current, segment)
    const stat = fs.lstatSync(current)
    requireThat(!stat.isSymbolicLink(), 'Symbolic links are not admitted')
  }
  requireThat(fs.statSync(current).isFile(), 'Input is not a regular file')
  return fs.readFileSync(current)
}

export async function inspectSculptedGlb(bytes, budgets, shape) {
  requireThat(Buffer.isBuffer(bytes) && bytes.length >= 28 && bytes.length <= budgets.modelMaxBytes[shape], 'Sculpted model exceeds byte budget or is truncated')
  requireThat(bytes.readUInt32LE(0) === 0x46546c67 && bytes.readUInt32LE(4) === 2 && bytes.readUInt32LE(8) === bytes.length, 'Invalid GLB header or length')
  let offset = 12
  const chunks = []
  while (offset < bytes.length) {
    requireThat(offset + 8 <= bytes.length, 'Truncated GLB chunk')
    const length = bytes.readUInt32LE(offset)
    requireThat(length % 4 === 0 && offset + 8 + length <= bytes.length, 'Invalid GLB chunk length')
    chunks.push({ type: bytes.readUInt32LE(offset + 4), bytes: bytes.subarray(offset + 8, offset + 8 + length) })
    offset += 8 + length
  }
  requireThat(chunks.length === 2 && chunks[0].type === 0x4e4f534a && chunks[1].type === 0x004e4942, 'Expected one JSON and one BIN chunk')
  const json = JSON.parse(chunks[0].bytes.toString('utf8').trim())
  const bin = chunks[1].bytes
  requireThat(json.asset?.version === '2.0' && json.buffers?.length === 1 && json.buffers[0].uri === undefined && Number.isInteger(json.buffers[0].byteLength) && json.buffers[0].byteLength > 0 && bin.length - json.buffers[0].byteLength >= 0 && bin.length - json.buffers[0].byteLength <= 3, 'Expected one URI-free embedded buffer')
  for (const extension of [...(json.extensionsUsed ?? []), ...(json.extensionsRequired ?? [])]) {
    requireThat(allowedExtensions.has(extension), `Unsupported sculpted extension ${extension}`)
  }
  for (const view of json.bufferViews ?? []) {
    requireThat(view.buffer === 0 && Number.isInteger(view.byteLength) && view.byteLength > 0 && Number.isInteger(view.byteOffset ?? 0) && (view.byteOffset ?? 0) >= 0 && (view.byteOffset ?? 0) + view.byteLength <= json.buffers[0].byteLength, 'Invalid buffer view bounds')
  }
  const widths = { 5120: 1, 5121: 1, 5122: 2, 5123: 2, 5125: 4, 5126: 4 }
  const components = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT4: 16 }
  for (const accessor of json.accessors ?? []) {
    const view = json.bufferViews?.[accessor.bufferView]
    const element = widths[accessor.componentType] * components[accessor.type]
    const stride = view?.byteStride ?? element
    requireThat(!accessor.sparse && view && Number.isInteger(accessor.count) && accessor.count > 0 && Number.isFinite(element) && Number.isInteger(stride) && stride >= element && (accessor.byteOffset ?? 0) >= 0 && (accessor.byteOffset ?? 0) + (accessor.count - 1) * stride + element <= view.byteLength, 'Invalid accessor bounds')
  }
  let triangleCount = 0
  let primitiveCount = 0
  for (const mesh of json.meshes ?? []) {
    for (const primitive of mesh.primitives ?? []) {
      requireThat((primitive.mode ?? 4) === 4 && !primitive.targets, 'Only direct triangle sculptures are admitted')
      const position = json.accessors?.[primitive.attributes?.POSITION]
      const count = primitive.indices === undefined ? position?.count : json.accessors?.[primitive.indices]?.count
      requireThat(position?.type === 'VEC3' && position.componentType === 5126 && Number.isInteger(count) && count > 0 && count % 3 === 0 && json.materials?.[primitive.material], 'Invalid triangle primitive')
      triangleCount += count / 3
      primitiveCount += 1
    }
  }
  const materialCount = json.materials?.length ?? 0
  const animationCount = json.animations?.length ?? 0
  requireThat(primitiveCount > 0 && primitiveCount <= budgets.maxPrimitives && triangleCount <= budgets.triangleMaxCounts[shape], 'Sculpted geometry budget exceeded')
  requireThat(materialCount > 0 && materialCount <= budgets.maxMaterials && animationCount <= budgets.maxAnimations && (json.nodes?.length ?? 0) <= budgets.maxNodes && !json.skins?.length, 'Sculpted graph budget exceeded')
  const images = json.images ?? []
  requireThat(images.length <= budgets.maxImages, 'Sculpted image budget exceeded')
  let embeddedTextureBytes = 0
  let maxTextureDimension = 0
  const formats = new Set()
  for (const image of images) {
    const view = json.bufferViews?.[image.bufferView]
    requireThat(image.uri === undefined && view && ['image/png', 'image/webp'].includes(image.mimeType), 'External or unsupported sculpted image')
    const imageBytes = bin.subarray(view.byteOffset ?? 0, (view.byteOffset ?? 0) + view.byteLength)
    const metadata = await sharp(imageBytes).metadata()
    requireThat(`image/${metadata.format}` === image.mimeType && metadata.width > 0 && metadata.height > 0 && Math.max(metadata.width, metadata.height) <= budgets.textureMaxDimension, 'Invalid sculpted texture format or dimensions')
    embeddedTextureBytes += imageBytes.length
    maxTextureDimension = Math.max(maxTextureDimension, metadata.width, metadata.height)
    formats.add(image.mimeType)
  }
  requireThat(embeddedTextureBytes <= budgets.embeddedTextureMaxBytesPerDie, 'Embedded sculpted texture budget exceeded')
  for (const texture of json.textures ?? []) {
    const index = texture.extensions?.EXT_texture_webp?.source ?? texture.source
    requireThat(Number.isInteger(index) && images[index], 'Invalid sculpted texture reference')
  }
  return { bytes: bytes.length, sha256: sha256(bytes), embeddedTextureBytes, textureFormat: formats.size ? [...formats].sort().join('+') : 'none', maxTextureDimension, triangleCount, primitiveCount, materialCount, imageCount: images.length, animationCount }
}

export function validateSculptedMetadata(metadata, shape, setId) {
  requireThat(record(metadata) && metadata.diceType === shape && metadata.id === shape && metadata.setId === setId && metadata.scale === 1 && metadata.canonicalReferenceVersion === 2, 'Invalid sculpted metadata identity or baked scale')
  const expected = faceNormalsFromManifest(createCanonicalDiceManifest(shape))
  requireThat(Array.isArray(metadata.faceNormals) && metadata.faceNormals.length === expected.length, 'Invalid canonical face inventory')
  for (const face of expected) {
    const actual = metadata.faceNormals.find(row => row?.value === face.value)
    requireThat(actual && Array.isArray(actual.normal) && actual.normal.length === 3 && actual.normal.every((v, i) => Number.isFinite(v) && Math.abs(v - face.normal[i]) < 0.00001), 'Invalid canonical value-to-normal mapping')
  }
  requireThat(['name', 'artist', 'description'].every(key => typeof metadata[key] === 'string' && metadata[key].trim().length > 0) && metadata.version === '1.0' && metadata.rarity === 'uncommon', 'Invalid sculpted catalog metadata')
  requireThat(record(metadata.physics) && ['density', 'restitution', 'friction'].every(key => Number.isFinite(metadata.physics[key])) && metadata.physics.density > 0 && metadata.physics.restitution >= 0 && metadata.physics.restitution <= 1 && metadata.physics.friction >= 0 && !Object.hasOwn(metadata.physics, 'mass'), 'Invalid sculpted physics metadata')
  requireThat(metadata.colliderType === (shape === 'd6' ? 'cuboid' : 'hull') && same(metadata.colliderArgs, shape === 'd6' ? { halfExtents: [0.55, 0.55, 0.55] } : {}), 'Invalid canonical sculpted collider')
  if (metadata.animations !== undefined) {
    requireThat(setId === 'monster-dungeon-set' && shape === 'd6' && Array.isArray(metadata.animations) && metadata.animations.length === 22 && new Set(metadata.animations.map(clip => clip.name)).size === 22 && metadata.animations.every(clip => typeof clip.name === 'string' && clip.name.length > 0 && clip.autoPlay === true && clip.loop === 'repeat' && clip.speed === 1 && clip.triggerOn === 'always'), 'Invalid sculpted animation configuration')
  }
  requireThat(metadata.readingConvention === (shape === 'd4' ? 'downward-face-vertex-copies' : 'upward-face') && (shape !== 'd4' || metadata.vertexOutcomeCopies === 12), 'Invalid sculpted reading convention')
}

export async function validateSculptedAssetManifest(manifestPath, repoRoot) {
  const errors = []
  let manifest
  let completeSetBytes = 0
  try {
    manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'))
    requireThat(record(manifest) && Array.isArray(manifest.assets) && manifest.assets.length === 6 && manifest.assets.every(record), 'A sculpted runtime set must contain exactly six dice')
    const profile = SCULPTED_ASSET_PROFILES[manifest.setId]
    requireThat(profile && manifest.assetKind === 'sculpted' && manifest.contractVersion === 2 && manifest.canonicalReferenceVersion === 2, 'Invalid sculpted contract/profile')
    requireThat(path.resolve(manifestPath) === path.resolve(repoRoot, 'public/dice', profile.setId, 'runtime-assets.json'), 'Sculpted manifest is outside its canonical path')
    requireThat(same(manifest.budgets, profile.budgets), 'Sculpted budgets must match the bounded profile')
    const frozen = readSculptedSourceRecord()
    requireThat(same(manifest.source, { kind: 'local-frozen', record: SCULPTED_SOURCE_RECORD_FILE, sha256: frozen.sha256 }), 'Invalid local-frozen source provenance')
    requireThat(same(manifest.assets.map(asset => asset.diceType).sort(), [...shapes].sort()), 'Invalid sculpted shape inventory')
    const selection = frozen.record.sets.find(set => set.setId === profile.setId)
    const set = JSON.parse(readRegularFile(repoRoot, `public/dice/${profile.setId}/set.json`))
    requireThat(set.id === profile.setId && set.availability === 'always', 'Sculpted availability must remain outside banners')
    for (const asset of manifest.assets) {
      const shape = asset.diceType
      const base = `/dice/${profile.setId}/${shape}`
      requireThat(asset.diceId === shape && asset.catalogKey === `${profile.setId}/${shape}` && asset.model?.path === `${base}/model.glb` && asset.thumbnail?.path === `${base}/thumbnail.png` && asset.metadata?.path === `${base}/metadata.json`, 'Invalid canonical sculpted paths')
      const selected = selection.dice.find(die => die.shape === shape)
      const modelBytes = readRegularFile(repoRoot, `public${asset.model.path}`)
      const model = await inspectSculptedGlb(modelBytes, profile.budgets, shape)
      validatePublicSculptedModel(modelBytes, profile.setId, shape, frozen.record.files.find(file => file.path === selected.model).sha256, asset.publicDerivation)
      const thumbPath = publicAssetFile(repoRoot, asset.thumbnail.path)
      readRegularFile(repoRoot, `public${asset.thumbnail.path}`)
      const thumbnail = await inspectThumbnail(thumbPath)
      const metadataBytes = readRegularFile(repoRoot, `public${asset.metadata.path}`)
      validateSculptedMetadata(JSON.parse(metadataBytes), shape, profile.setId)
      for (const [kind, actual] of [['model', model], ['thumbnail', thumbnail], ['metadata', { bytes: metadataBytes.length, sha256: sha256(metadataBytes) }]]) {
        requireThat(same(asset[kind], { path: asset[kind].path, ...actual }), `${shape} ${kind} record does not match its file`)
      }
      requireThat(thumbnail.bytes <= profile.budgets.thumbnailMaxBytes, 'Sculpted thumbnail budget exceeded')
      completeSetBytes += model.bytes + thumbnail.bytes + metadataBytes.length
    }
    completeSetBytes += fs.statSync(manifestPath).size + readRegularFile(repoRoot, `public/dice/${profile.setId}/set.json`).length
    requireThat(completeSetBytes <= profile.budgets.completeSetMaxBytes, 'Complete sculpted set byte budget exceeded')
  } catch (error) {
    errors.push(error instanceof Error ? error.message : String(error))
  }
  return { valid: errors.length === 0, errors, manifest, completeSetBytes }
}
