import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import sharp from 'sharp'

export const RUNTIME_ASSET_CONTRACT_VERSION = 1
export const RUNTIME_ASSET_BUDGETS = Object.freeze({
  thumbnailMaxBytes: 150 * 1024,
  modelTargetBytes: 1.5 * 1024 * 1024,
  modelHardMaxBytes: 3 * 1024 * 1024,
  embeddedTextureMaxBytesPerDie: 1024 * 1024,
  completeSetMaxBytes: 10 * 1024 * 1024,
})

const SHA256_PATTERN = /^[0-9a-f]{64}$/
const PUBLIC_DICE_PATH_PATTERN = /^\/dice\/[a-z0-9][a-z0-9_-]*\/[a-z0-9][a-z0-9_-]*\/(?:model\.glb|thumbnail\.png)$/
const GLB_MAGIC = 0x46546c67
const JSON_CHUNK = 0x4e4f534a
const BIN_CHUNK = 0x004e4942
const DISALLOWED_GEOMETRY_EXTENSIONS = new Set([
  'EXT_meshopt_compression',
  'KHR_draco_mesh_compression',
])

export function sha256(buffer) {
  return crypto.createHash('sha256').update(buffer).digest('hex')
}

export function publicAssetFile(repoRoot, publicPath) {
  if (typeof publicPath !== 'string' || !PUBLIC_DICE_PATH_PATTERN.test(publicPath)) {
    throw new Error(`Runtime asset path is not canonical: ${publicPath}`)
  }
  const publicRoot = path.resolve(repoRoot, 'public')
  const candidate = path.resolve(publicRoot, publicPath.slice(1))
  if (!candidate.startsWith(`${publicRoot}${path.sep}`)) {
    throw new Error(`Runtime asset path escapes public/: ${publicPath}`)
  }
  return candidate
}

export function runtimeAssetManifestPaths(repoRoot = process.cwd()) {
  const diceRoot = path.resolve(repoRoot, 'public', 'dice')
  if (!fs.existsSync(diceRoot)) return []
  return fs.readdirSync(diceRoot, { withFileTypes: true })
    .filter(entry => entry.isDirectory())
    .map(entry => path.join(diceRoot, entry.name, 'runtime-assets.json'))
    .filter(manifestPath => fs.existsSync(manifestPath))
    .sort()
}

export async function inspectGlb(filePath) {
  const buffer = fs.readFileSync(filePath)
  if (buffer.length < 20 || buffer.readUInt32LE(0) !== GLB_MAGIC) {
    throw new Error(`${filePath} is not a GLB file`)
  }
  if (buffer.readUInt32LE(4) !== 2) {
    throw new Error(`${filePath} must use glTF 2.0`)
  }
  if (buffer.readUInt32LE(8) !== buffer.length) {
    throw new Error(`${filePath} GLB length header does not match its bytes`)
  }

  let offset = 12
  let json
  let bin
  let jsonChunkCount = 0
  let binChunkCount = 0
  while (offset + 8 <= buffer.length) {
    const chunkLength = buffer.readUInt32LE(offset)
    const chunkType = buffer.readUInt32LE(offset + 4)
    const chunkStart = offset + 8
    const chunkEnd = chunkStart + chunkLength
    if (chunkEnd > buffer.length) throw new Error(`${filePath} has a truncated GLB chunk`)
    if (chunkType === JSON_CHUNK) {
      jsonChunkCount += 1
      json = JSON.parse(buffer.subarray(chunkStart, chunkEnd).toString('utf8').trim())
    } else if (chunkType === BIN_CHUNK) {
      binChunkCount += 1
      bin = buffer.subarray(chunkStart, chunkEnd)
    }
    offset = chunkEnd
  }
  if (!json || !bin || jsonChunkCount !== 1 || binChunkCount !== 1) {
    throw new Error(`${filePath} must contain exactly one JSON chunk and one BIN chunk`)
  }
  if (
    !Array.isArray(json.buffers) ||
    json.buffers.length !== 1 ||
    json.buffers[0]?.uri !== undefined ||
    !Number.isInteger(json.buffers[0]?.byteLength) ||
    json.buffers[0].byteLength <= 0 ||
    json.buffers[0].byteLength > bin.length ||
    bin.length - json.buffers[0].byteLength > 3
  ) {
    throw new Error(`${filePath} must use exactly one URI-free embedded buffer`)
  }

  const extensions = new Set([
    ...(json.extensionsUsed ?? []),
    ...(json.extensionsRequired ?? []),
  ])
  for (const extension of DISALLOWED_GEOMETRY_EXTENSIONS) {
    if (extensions.has(extension)) {
      throw new Error(`${filePath} uses ${extension}; canonical geometry must remain directly inspectable`)
    }
  }
  if (!extensions.has('EXT_texture_webp')) {
    throw new Error(`${filePath} must declare EXT_texture_webp`)
  }

  const images = json.images ?? []
  if (images.length !== 2) throw new Error(`${filePath} must embed exactly two textures`)
  let embeddedTextureBytes = 0
  let maxTextureDimension = 0
  for (const image of images) {
    if (image.uri !== undefined) throw new Error(`${filePath} must not reference external texture URIs`)
    if (image.mimeType !== 'image/webp') throw new Error(`${filePath} textures must be image/webp`)
    const view = json.bufferViews?.[image.bufferView]
    if (
      !view ||
      view.buffer !== 0 ||
      !Number.isInteger(view.byteLength) ||
      view.byteLength <= 0
    ) {
      throw new Error(`${filePath} texture has no valid buffer view`)
    }
    const start = view.byteOffset ?? 0
    const end = start + view.byteLength
    if (start < 0 || end > bin.length) throw new Error(`${filePath} texture buffer view is out of bounds`)
    const metadata = await sharp(bin.subarray(start, end)).metadata()
    if (metadata.format !== 'webp' || !metadata.width || !metadata.height) {
      throw new Error(`${filePath} contains an unreadable WebP texture`)
    }
    embeddedTextureBytes += view.byteLength
    maxTextureDimension = Math.max(maxTextureDimension, metadata.width, metadata.height)
  }

  return {
    bytes: buffer.length,
    sha256: sha256(buffer),
    embeddedTextureBytes,
    textureFormat: 'image/webp',
    maxTextureDimension,
    json,
  }
}

export async function inspectThumbnail(filePath) {
  const buffer = fs.readFileSync(filePath)
  const metadata = await sharp(buffer).metadata()
  if (metadata.format !== 'png' || metadata.width !== 320 || metadata.height !== 320) {
    throw new Error(`${filePath} thumbnail must be a 320x320 PNG`)
  }
  return {
    bytes: buffer.length,
    sha256: sha256(buffer),
    width: metadata.width,
    height: metadata.height,
  }
}

export function validateManifestShape(manifest) {
  const errors = []
  if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest)) {
    return ['Runtime asset manifest must be an object']
  }
  if (manifest.contractVersion !== RUNTIME_ASSET_CONTRACT_VERSION) {
    errors.push(`contractVersion must be ${RUNTIME_ASSET_CONTRACT_VERSION}`)
  }
  if (!/^[a-z0-9][a-z0-9_-]*$/.test(manifest.setId ?? '')) errors.push('setId is invalid')
  if (manifest.canonicalReferenceVersion !== 2) errors.push('canonicalReferenceVersion must be 2')
  if (JSON.stringify(manifest.budgets) !== JSON.stringify(RUNTIME_ASSET_BUDGETS)) {
    errors.push('budgets must match the runtime asset contract')
  }
  if (!Array.isArray(manifest.assets) || manifest.assets.length !== 6) {
    errors.push('a complete runtime set must contain exactly six dice')
    return errors
  }
  const ids = new Set()
  const shapes = new Set()
  for (const asset of manifest.assets) {
    if (ids.has(asset.diceId)) errors.push(`duplicate diceId ${asset.diceId}`)
    ids.add(asset.diceId)
    if (shapes.has(asset.diceType)) errors.push(`duplicate diceType ${asset.diceType}`)
    shapes.add(asset.diceType)
    if (asset.catalogKey !== `${manifest.setId}/${asset.diceId}`) {
      errors.push(`${asset.diceId} has a mismatched catalogKey`)
    }
    const expectedAssetRoot = `/dice/${manifest.setId}/${asset.diceId}`
    if (asset.model?.path !== `${expectedAssetRoot}/model.glb`) {
      errors.push(`${asset.diceId} has a mismatched model path`)
    }
    if (asset.thumbnail?.path !== `${expectedAssetRoot}/thumbnail.png`) {
      errors.push(`${asset.diceId} has a mismatched thumbnail path`)
    }
    for (const record of [asset.model, asset.thumbnail]) {
      if (!record || !SHA256_PATTERN.test(record.sha256 ?? '')) {
        errors.push(`${asset.diceId} has an invalid SHA-256`)
      }
      if (!Number.isInteger(record?.bytes) || record.bytes <= 0) {
        errors.push(`${asset.diceId} has an invalid byte count`)
      }
    }
  }
  const expectedShapes = ['d4', 'd6', 'd8', 'd10', 'd12', 'd20']
  if (expectedShapes.some(shape => !shapes.has(shape))) errors.push('runtime set must cover D4, D6, D8, D10, D12, and D20')
  return errors
}

export async function validateRuntimeAssetManifest(manifestPath, repoRoot = process.cwd()) {
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'))
  const errors = validateManifestShape(manifest)
  let completeSetBytes = 0

  for (const asset of manifest.assets ?? []) {
    let model
    let thumbnail
    try {
      const modelFile = publicAssetFile(repoRoot, asset.model?.path)
      const thumbnailFile = publicAssetFile(repoRoot, asset.thumbnail?.path)
      assertRegularFileWithoutSymlinks(repoRoot, modelFile)
      assertRegularFileWithoutSymlinks(repoRoot, thumbnailFile)
      model = await inspectGlb(modelFile)
      thumbnail = await inspectThumbnail(thumbnailFile)
    } catch (error) {
      errors.push(error instanceof Error ? error.message : String(error))
      continue
    }

    completeSetBytes += model.bytes + thumbnail.bytes
    compareRecord(errors, asset.diceId, 'model', asset.model, model)
    compareRecord(errors, asset.diceId, 'thumbnail', asset.thumbnail, thumbnail)
    if (model.bytes > RUNTIME_ASSET_BUDGETS.modelHardMaxBytes) {
      errors.push(`${asset.diceId} model is ${model.bytes} bytes; hard maximum is ${RUNTIME_ASSET_BUDGETS.modelHardMaxBytes}`)
    } else if (model.bytes > RUNTIME_ASSET_BUDGETS.modelTargetBytes && !validReviewException(asset.reviewException)) {
      errors.push(`${asset.diceId} model exceeds the target and has no reviewed exception`)
    }
    if (model.embeddedTextureBytes > RUNTIME_ASSET_BUDGETS.embeddedTextureMaxBytesPerDie) {
      errors.push(`${asset.diceId} embeds ${model.embeddedTextureBytes} texture bytes; maximum is ${RUNTIME_ASSET_BUDGETS.embeddedTextureMaxBytesPerDie}`)
    }
    if (model.maxTextureDimension > 1024) {
      errors.push(`${asset.diceId} texture dimension ${model.maxTextureDimension} exceeds 1024`)
    }
    if (thumbnail.bytes > RUNTIME_ASSET_BUDGETS.thumbnailMaxBytes) {
      errors.push(`${asset.diceId} thumbnail is ${thumbnail.bytes} bytes; maximum is ${RUNTIME_ASSET_BUDGETS.thumbnailMaxBytes}`)
    }
  }

  if (completeSetBytes > RUNTIME_ASSET_BUDGETS.completeSetMaxBytes) {
    errors.push(`complete set is ${completeSetBytes} bytes; maximum is ${RUNTIME_ASSET_BUDGETS.completeSetMaxBytes}`)
  }
  return { valid: errors.length === 0, errors, manifest, completeSetBytes }
}

function compareRecord(errors, diceId, kind, declared, actual) {
  for (const key of ['bytes', 'sha256']) {
    if (declared?.[key] !== actual[key]) errors.push(`${diceId} ${kind} ${key} does not match its file`)
  }
  for (const key of kind === 'model'
    ? ['embeddedTextureBytes', 'textureFormat', 'maxTextureDimension']
    : ['width', 'height']) {
    if (declared?.[key] !== actual[key]) errors.push(`${diceId} ${kind} ${key} does not match its file`)
  }
}

function validReviewException(value) {
  return Boolean(
    value &&
    typeof value.reason === 'string' && value.reason.trim().length >= 20 &&
    typeof value.issue === 'string' && /^#[1-9]\d*$/.test(value.issue),
  )
}

function assertRegularFileWithoutSymlinks(repoRoot, filePath) {
  const publicRoot = path.resolve(repoRoot, 'public')
  let current = publicRoot
  for (const segment of path.relative(publicRoot, filePath).split(path.sep)) {
    current = path.join(current, segment)
    const stat = fs.lstatSync(current)
    if (stat.isSymbolicLink()) throw new Error(`${filePath} must not use symbolic links`)
  }
  if (!fs.statSync(filePath).isFile()) throw new Error(`${filePath} is not a regular file`)
}
