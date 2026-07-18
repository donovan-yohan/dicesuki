#!/usr/bin/env node

import { execFile } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import process from 'node:process'
import { promisify } from 'node:util'
import { createRuntimeThumbnail } from './capture-thumbnails.mjs'
import {
  DEFAULT_RUNTIME_ASSET_PROFILE,
  getRuntimeAssetProfile,
} from './runtime-asset-profiles.mjs'
import {
  inspectGlb,
  inspectThumbnail,
  RUNTIME_ASSET_BUDGETS,
  RUNTIME_ASSET_CONTRACT_VERSION,
  sha256,
} from './runtime-asset-contract.mjs'

const execFileAsync = promisify(execFile)
const REPO_ROOT = path.resolve(import.meta.dirname, '..', '..')
const SOURCE_LOCK_ROOT = path.join(import.meta.dirname, 'sources')
const GLTF_TRANSFORM = path.join(REPO_ROOT, 'node_modules', '.bin', 'gltf-transform')

export async function optimizeRuntimeAssetSet({
  profileId = DEFAULT_RUNTIME_ASSET_PROFILE,
  sourceRoot,
  outputRoot = REPO_ROOT,
}) {
  const profile = getRuntimeAssetProfile(profileId)
  const sourceLockFiles = [profile.sourceLockFile, ...profile.sourceLockSupplementFiles]
  const sourceLocks = sourceLockFiles.map(sourceLockFile => JSON.parse(
    fs.readFileSync(path.join(SOURCE_LOCK_ROOT, sourceLockFile), 'utf8'),
  ))
  const [sourceLock] = sourceLocks
  verifyLockedSources(sourceRoot, sourceLocks, profile.sourceLockFile)
  const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'dicesuki-runtime-assets-'))
  const outputSetRoot = path.join(outputRoot, 'public', 'dice', profile.setId)
  const manifestAssets = []

  try {
    fs.mkdirSync(outputSetRoot, { recursive: true })
    const sourceSetPath = path.join(sourceRoot, 'public', 'dice', profile.setId, 'set.json')
    const outputSetPath = path.join(outputSetRoot, 'set.json')
    if (profile.appearance) {
      atomicWrite(normalizeSetMetadata(sourceSetPath, profile.appearance), outputSetPath)
    } else {
      atomicCopy(sourceSetPath, outputSetPath)
    }

    for (const { diceId, diceType, proofFace, scale } of profile.dice) {
      const sourceDieRoot = path.join(sourceRoot, 'public', 'dice', profile.setId, diceId)
      const input = path.join(sourceDieRoot, 'model.glb')
      const proof = path.join(
        sourceRoot,
        'public',
        'artist-resources',
        'imagegen-uv',
        'screenshots',
        'theme-workshop',
        `${profile.proofPrefix}-${diceId}-face-${proofFace}.png`,
      )
      const temporaryDieRoot = path.join(temporaryRoot, diceId)
      fs.mkdirSync(temporaryDieRoot, { recursive: true })
      const resized = path.join(temporaryDieRoot, '01-resized.glb')
      const baseColor = path.join(temporaryDieRoot, '02-base-color.glb')
      const model = path.join(temporaryDieRoot, 'model.glb')
      const thumbnail = path.join(temporaryDieRoot, 'thumbnail.png')

      await runGltfTransform(['resize', input, resized, '--width', '1024', '--height', '1024'])
      await runGltfTransform([
        'webp', resized, baseColor,
        '--slots', 'baseColorTexture', '--quality', '80', '--effort', '80',
      ])
      await runGltfTransform([
        'webp', baseColor, model,
        '--slots', 'normalTexture', '--lossless', '--effort', '80',
      ])
      await createRuntimeThumbnail(proof, thumbnail)

      const targetDieRoot = path.join(outputSetRoot, diceId)
      fs.mkdirSync(targetDieRoot, { recursive: true })
      atomicCopy(model, path.join(targetDieRoot, 'model.glb'))
      atomicCopy(thumbnail, path.join(targetDieRoot, 'thumbnail.png'))
      atomicWrite(
        normalizeMetadata(path.join(sourceDieRoot, 'metadata.json'), { diceId, diceType, scale }),
        path.join(targetDieRoot, 'metadata.json'),
      )

      const modelInspection = await inspectGlb(model)
      const thumbnailInspection = await inspectThumbnail(thumbnail)
      manifestAssets.push({
        catalogKey: `${profile.setId}/${diceId}`,
        diceId,
        diceType,
        model: {
          path: `/dice/${profile.setId}/${diceId}/model.glb`,
          ...pick(modelInspection, [
            'bytes', 'sha256', 'embeddedTextureBytes', 'textureFormat', 'maxTextureDimension',
          ]),
        },
        thumbnail: {
          path: `/dice/${profile.setId}/${diceId}/thumbnail.png`,
          ...thumbnailInspection,
        },
      })
    }

    const manifest = {
      contractVersion: RUNTIME_ASSET_CONTRACT_VERSION,
      setId: profile.setId,
      canonicalReferenceVersion: 2,
      budgets: RUNTIME_ASSET_BUDGETS,
      optimization: {
        tool: '@gltf-transform/cli',
        toolVersion: '4.4.1',
        maxTextureDimension: 1024,
        baseColor: { format: 'webp', quality: 80, effort: 80 },
        normal: { format: 'webp', lossless: true, effort: 80 },
        geometryCompression: 'none',
      },
      source: {
        tag: sourceLock.release.tag,
        archiveSha256: sourceLock.release.sha256,
        sourceCommit: sourceLock.sourceCommit,
      },
      assets: manifestAssets,
    }
    atomicWrite(
      Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`),
      path.join(outputSetRoot, 'runtime-assets.json'),
    )
    return manifest
  } finally {
    fs.rmSync(temporaryRoot, { recursive: true, force: true })
  }
}

export function optimizeCozyForest(options) {
  return optimizeRuntimeAssetSet({ ...options, profileId: 'cozy-forest-v1' })
}

function verifyLockedSources(sourceRoot, sourceLocks, primaryLockFile) {
  const sourceCommit = sourceLocks[0]?.sourceCommit
  if (!sourceCommit) throw new Error('Runtime source profile has no primary lock')
  const lockedPaths = new Set()
  for (const [index, sourceLock] of sourceLocks.entries()) {
    if (sourceLock.sourceCommit !== sourceCommit) {
      throw new Error('Runtime source lock supplements must share one source commit')
    }
    if (index > 0 && sourceLock.supplements !== primaryLockFile) {
      throw new Error(`Runtime source lock supplement must anchor ${primaryLockFile}`)
    }
    if (!Array.isArray(sourceLock.files)) throw new Error('Runtime source lock files must be an array')
    for (const source of sourceLock.files) {
      if (lockedPaths.has(source.path)) {
        throw new Error(`Runtime source path is locked more than once: ${source.path}`)
      }
      lockedPaths.add(source.path)
      const sourcePath = path.resolve(sourceRoot, source.path)
      if (!sourcePath.startsWith(`${path.resolve(sourceRoot)}${path.sep}`)) {
        throw new Error(`Source lock path escapes its root: ${source.path}`)
      }
      const actual = sha256(fs.readFileSync(sourcePath))
      if (actual !== source.sha256) throw new Error(`Source hash mismatch: ${source.path}`)
    }
  }
}

async function runGltfTransform(args) {
  await execFileAsync(GLTF_TRANSFORM, args, {
    cwd: REPO_ROOT,
    env: { ...process.env, NO_COLOR: '1' },
    maxBuffer: 8 * 1024 * 1024,
  })
}

function atomicCopy(source, destination) {
  atomicWrite(fs.readFileSync(source), destination)
}

function atomicWrite(buffer, destination) {
  const temporary = `${destination}.tmp-${process.pid}`
  fs.writeFileSync(temporary, buffer, { flag: 'wx' })
  fs.renameSync(temporary, destination)
}

function normalizeMetadata(sourcePath, die) {
  const source = JSON.parse(fs.readFileSync(sourcePath, 'utf8'))
  if (source.diceType !== die.diceType) {
    throw new Error(`${die.diceId} metadata declares ${source.diceType}; expected ${die.diceType}`)
  }
  const hasCanonicalSlot = Object.hasOwn(source, 'uvManifestUrl') ||
    Object.hasOwn(source, 'canonicalReferenceVersion')
  const normalized = {}
  let canonicalInserted = false
  for (const [key, value] of Object.entries(source)) {
    if (key === 'scale') {
      normalized.scale = die.scale
    } else if (key === 'uvManifestUrl' || key === 'canonicalReferenceVersion') {
      if (!canonicalInserted) normalized.canonicalReferenceVersion = 2
      canonicalInserted = true
    } else {
      normalized[key] = value
      if (key === 'description' && !hasCanonicalSlot) {
        normalized.canonicalReferenceVersion = 2
        canonicalInserted = true
      }
    }
  }
  if (!canonicalInserted) normalized.canonicalReferenceVersion = 2
  return Buffer.from(`${JSON.stringify(normalized, null, 2)}\n`)
}

function normalizeSetMetadata(sourcePath, appearance) {
  const source = JSON.parse(fs.readFileSync(sourcePath, 'utf8'))
  return Buffer.from(`${JSON.stringify({ ...source, appearance }, null, 2)}\n`)
}

function pick(source, keys) {
  return Object.fromEntries(keys.map(key => [key, source[key]]))
}

async function main() {
  const sourceIndex = process.argv.indexOf('--source')
  const sourceRoot = sourceIndex >= 0 ? process.argv[sourceIndex + 1] : undefined
  const profileIndex = process.argv.indexOf('--profile')
  const profileId = profileIndex >= 0
    ? process.argv[profileIndex + 1]
    : DEFAULT_RUNTIME_ASSET_PROFILE
  if (!sourceRoot || !profileId) {
    throw new Error('Usage: optimize.mjs --source <extracted-source-archive> [--profile <profile-id>]')
  }
  const profile = getRuntimeAssetProfile(profileId)
  const manifest = await optimizeRuntimeAssetSet({
    profileId,
    sourceRoot: path.resolve(sourceRoot),
  })
  console.log(`Built ${manifest.assets.length} ${profile.displayName} runtime dice`)
}

if (process.argv[1]?.endsWith('optimize.mjs')) await main()
