#!/usr/bin/env node
import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import sharp from 'sharp'
import { derivePublicSculptedModel, publicSculptedModelDeclaration, validatePublicSculptedModel } from './sculpted-public-model.mjs'
import { sha256 } from './runtime-asset-contract.mjs'
import { SCULPTED_ASSET_PROFILES, SCULPTED_SOURCE_RECORD_FILE } from './sculpted-asset-profiles.mjs'
import { inspectSculptedGlb, readRegularFile, readSculptedSourceRecord, validateSculptedAssetManifest, validateSculptedMetadata } from './sculpted-asset-contract.mjs'

sharp.concurrency(2)
const requireThat = (condition, message) => { if (!condition) throw Error(message) }
const jsonBytes = value => Buffer.from(`${JSON.stringify(value, null, 2)}\n`)
const shapes = ['d4', 'd6', 'd8', 'd10', 'd12', 'd20']

/** Verify an explicit source root. No environment, credentials or network reads. */
export async function packageSculptedAssets(sourceRoot, repoRoot = process.cwd()) {
  const frozen = readSculptedSourceRecord()
  const checked = new Map()
  for (const file of frozen.record.files) {
    const bytes = readRegularFile(sourceRoot, file.path)
    requireThat(bytes.length === file.bytes && sha256(bytes) === file.sha256, `Frozen source hash mismatch: ${file.path}`)
    checked.set(file.path, bytes)
  }
  const readJson = relative => JSON.parse(checked.get(relative))
  const delivery = checked.get('shipping-assets/delivery-manifest.json')
  requireThat(sha256(delivery) === frozen.record.deliveryManifestSha256, 'Delivery manifest selection drift')
  const mapping = readJson('shipping-assets/binary-mapping-proof.json')
  requireThat(mapping.status === 'PASS' && mapping.redSwappedClaimRejected && mapping.models.length === 12, 'Complete binary mapping acceptance is required')
  const outputs = new Map()
  for (const set of frozen.record.sets) {
    const profile = SCULPTED_ASSET_PROFILES[set.setId]
    requireThat(profile && JSON.stringify(set.dice.map(die => die.shape)) === JSON.stringify(shapes), 'Incomplete sculpted profile selection')
    const wood = set.theme === 'woodland'
    const loader = readJson(set.loaderReceipt)
    requireThat(loader.status === 'PASS', 'Loader proof must pass')
    if (wood) {
      requireThat(loader.receipts.length === 2 && loader.receipts.every(receipt => receipt.models.length === 6 && receipt.errors.length === 0 && !receipt.context.lost && !receipt.context.contextLost), 'Woodland six-model loader proof is incomplete')
    } else {
      requireThat(loader.shapes.length === 6, 'Six-model loader proof is incomplete')
    }
    const root = `public/dice/${set.setId}`
    const setMetadata = {
      id: set.setId, name: set.name,
      artist: wood ? 'Local procedural woodland study' : set.theme === 'cyberpunk' ? 'Local procedural original CUTLINE study' : 'Local procedural Monster Dungeon study; Zabi eyes D6',
      description: `${set.name}. Selected sculpted polyhedral dice with canonical numbering.`,
      // Local promotion date, not a claim of public source publication.
      releaseDate: '2026-11-06', tags: [set.theme, 'sculpted', 'complete-polyhedral-set'], availability: 'always',
    }
    outputs.set(`${root}/set.json`, jsonBytes(setMetadata))
    const manifest = {
      contractVersion: 2, assetKind: 'sculpted', setId: set.setId, canonicalReferenceVersion: 2,
      source: { kind: 'local-frozen', record: SCULPTED_SOURCE_RECORD_FILE, sha256: frozen.sha256 },
      budgets: profile.budgets, assets: [],
    }
    for (const die of set.dice) {
      const shape = die.shape
      const sourceMetadata = readJson(die.metadata)
      const faces = sourceMetadata.faces
      const expectedValues = shape === 'd10' ? Array.from({ length: 10 }, (_, n) => n) : Array.from({ length: Number(shape.slice(1)) }, (_, n) => n + 1)
      requireThat(die.faceProofs.length === expectedValues.length && die.faceProofs.every((file, i) => file.endsWith(`/${shape}-${expectedValues[i]}.png`)), 'Every canonical face proof is required')
      if (wood) {
        const predecessor = checked.get(die.geometryPredecessor)
        requireThat(sha256(predecessor) === sourceMetadata.occlusion.sourceGLBSHA256, 'Woodland mapping predecessor drift')
        const accepted = readJson(set.mappingReceipt).shapes.find(row => row.shape === shape)
        requireThat(accepted?.sha256 === sha256(predecessor), 'Woodland geometry predecessor must match accepted face proof')
      } else {
        const accepted = loader.shapes.find(row => row.shape === shape)
        requireThat(accepted?.sha256 === sha256(checked.get(die.model)) && accepted.faceFiles.length === expectedValues.length && !accepted.contextLost && mapping.models.some(row => row.theme === set.theme && row.shape === shape), 'Selected model must match complete loader/mapping acceptance')
      }
      if (shape === 'd4') {
        const copies = wood ? faces.flatMap(face => face.vertexOutcomeGlyphs.map(copy => ({ value: copy.outcome, faceValue: face.value }))) : sourceMetadata.d4VertexCopies
        requireThat(copies.length === 12 && [1, 2, 3, 4].every(value => copies.filter(copy => copy.value === value && copy.faceValue !== value).length === 3), 'D4 requires twelve downward-result vertex copies')
      }
      const metadata = {
        version: '1.0', id: shape, diceType: shape, setId: set.setId,
        name: sourceMetadata.name ?? `Woodland Sculpted ${shape.toUpperCase()}`,
        artist: sourceMetadata.artist ?? setMetadata.artist,
        scale: 1, canonicalReferenceVersion: 2, rarity: 'uncommon',
        description: `${set.name} ${shape.toUpperCase()}. Canonical collider sizing is baked into the model; sculpted margins are visual detail.`,
        faceNormals: faces.map(face => ({ value: face.value, normal: face.normal })),
        physics: { density: 0.3, restitution: 0.3, friction: 0.6 },
        colliderType: shape === 'd6' ? 'cuboid' : 'hull',
        colliderArgs: shape === 'd6' ? { halfExtents: [0.55, 0.55, 0.55] } : {},
        readingConvention: shape === 'd4' ? 'downward-face-vertex-copies' : 'upward-face',
        ...(shape === 'd4' ? { vertexOutcomeCopies: 12 } : {}),
        tags: [set.theme, 'sculpted', shape],
      }
      if (set.theme === 'monster-dungeon' && shape === 'd6') {
        const original = checked.get(die.model)
        const gltf = JSON.parse(original.subarray(20, 20 + original.readUInt32LE(12)).toString().trim())
        requireThat(gltf.animations.length === 22, 'Protected eye animation inventory changed')
        metadata.animations = gltf.animations.map(clip => ({ name: clip.name, autoPlay: true, loop: 'repeat', speed: 1, triggerOn: 'always' }))
      }
      validateSculptedMetadata(metadata, shape, set.setId)
      const originalBytes = checked.get(die.model)
      const sourceSha256 = frozen.record.files.find(file => file.path === die.model).sha256
      const publicDerivation = wood ? publicSculptedModelDeclaration(shape) : undefined
      const modelBytes = wood ? derivePublicSculptedModel(originalBytes, sourceSha256).bytes : originalBytes
      validatePublicSculptedModel(modelBytes, set.setId, shape, sourceSha256, publicDerivation)
      const model = await inspectSculptedGlb(modelBytes, profile.budgets, shape)
      const thumbnail = await sharp(checked.get(die.hero)).resize(320, 320, { fit: 'cover', position: 'centre' }).png({ compressionLevel: 9, adaptiveFiltering: false }).toBuffer()
      requireThat(thumbnail.length <= profile.budgets.thumbnailMaxBytes, 'Thumbnail budget exceeded')
      const metadataBytes = jsonBytes(metadata)
      const base = `/dice/${set.setId}/${shape}`
      outputs.set(`public${base}/model.glb`, modelBytes)
      outputs.set(`public${base}/thumbnail.png`, thumbnail)
      outputs.set(`public${base}/metadata.json`, metadataBytes)
      manifest.assets.push({
        diceId: shape, diceType: shape, catalogKey: `${set.setId}/${shape}`,
        model: { path: `${base}/model.glb`, ...model },
        ...(publicDerivation ? { publicDerivation } : {}),
        thumbnail: { path: `${base}/thumbnail.png`, bytes: thumbnail.length, sha256: sha256(thumbnail), width: 320, height: 320 },
        metadata: { path: `${base}/metadata.json`, bytes: metadataBytes.length, sha256: sha256(metadataBytes) },
      })
    }
    outputs.set(`${root}/runtime-assets.json`, jsonBytes(manifest))
    const total = [...outputs].filter(([file]) => file.startsWith(`${root}/`)).reduce((sum, [, bytes]) => sum + bytes.length, 0)
    requireThat(total <= profile.budgets.completeSetMaxBytes, 'Complete sculpted set exceeds bounded download budget')
  }
  // All inputs, proof coverage and generated payloads have passed before writes.
  // An existing package is immutable: exact regeneration is allowed, drift is not.
  for (const [relative, bytes] of outputs) {
    const target = path.resolve(repoRoot, relative)
    if (fs.existsSync(target)) requireThat(readRegularFile(repoRoot, relative).equals(bytes), `Refusing to rewrite different managed bytes: ${relative}`)
  }
  for (const [relative, bytes] of outputs) {
    const target = path.resolve(repoRoot, relative)
    fs.mkdirSync(path.dirname(target), { recursive: true })
    if (!fs.existsSync(target)) fs.writeFileSync(target, bytes, { flag: 'wx' })
  }
  const results = []
  for (const set of frozen.record.sets) {
    const result = await validateSculptedAssetManifest(path.resolve(repoRoot, 'public/dice', set.setId, 'runtime-assets.json'), repoRoot)
    requireThat(result.valid, result.errors.join('\n'))
    results.push({ setId: set.setId, dice: result.manifest.assets.length, bytes: result.completeSetBytes })
  }
  return results
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(import.meta.filename)) {
  const args = process.argv.slice(2)
  requireThat((args.length === 2 || args.length === 4) && args[0] === '--source' && (args.length !== 4 || args[2] === '--out'), 'Usage: node scripts/runtime-dice-assets/package-sculpted.mjs --source <experiments-root> [--out <repo-root>]')
  console.log(JSON.stringify(await packageSculptedAssets(path.resolve(args[1]), path.resolve(args[3] ?? process.cwd())), null, 2))
}
