#!/usr/bin/env node

import { execFile } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import process from 'node:process'
import { promisify } from 'node:util'
import { createRuntimeThumbnail } from './capture-thumbnails.mjs'
import {
  inspectGlb,
  inspectThumbnail,
  RUNTIME_ASSET_BUDGETS,
  RUNTIME_ASSET_CONTRACT_VERSION,
  sha256,
} from './runtime-asset-contract.mjs'

const execFileAsync = promisify(execFile)
const REPO_ROOT = path.resolve(import.meta.dirname, '..', '..')
const SET_ID = 'cozy-forest-imagegen-set'
const SOURCE_LOCK_PATH = path.join(import.meta.dirname, 'sources', 'cozy-forest-v1.lock.json')
const GLTF_TRANSFORM = path.join(REPO_ROOT, 'node_modules', '.bin', 'gltf-transform')
const DICE = Object.freeze([
  ['acorn-compass-d10', 'd10', 9],
  ['elder-canopy-d20', 'd20', 20],
  ['fernlight-d8', 'd8', 8],
  ['grovekeeper-d12', 'd12', 12],
  ['hearthwood-d6', 'd6', 6],
  ['mossheart-d4', 'd4', 4],
])

export async function optimizeCozyForest({ sourceRoot, outputRoot = REPO_ROOT }) {
  const sourceLock = JSON.parse(fs.readFileSync(SOURCE_LOCK_PATH, 'utf8'))
  verifyLockedSources(sourceRoot, sourceLock)
  const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'dicesuki-runtime-assets-'))
  const outputSetRoot = path.join(outputRoot, 'public', 'dice', SET_ID)
  const manifestAssets = []

  try {
    for (const [diceId, diceType, proofFace] of DICE) {
      const input = path.join(sourceRoot, 'public', 'dice', SET_ID, diceId, 'model.glb')
      const proof = path.join(
        sourceRoot,
        'public',
        'artist-resources',
        'imagegen-uv',
        'screenshots',
        'theme-workshop',
        `cozy-forest-${diceId}-face-${proofFace}.png`,
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

      const modelInspection = await inspectGlb(model)
      const thumbnailInspection = await inspectThumbnail(thumbnail)
      manifestAssets.push({
        catalogKey: `${SET_ID}/${diceId}`,
        diceId,
        diceType,
        model: {
          path: `/dice/${SET_ID}/${diceId}/model.glb`,
          ...pick(modelInspection, [
            'bytes', 'sha256', 'embeddedTextureBytes', 'textureFormat', 'maxTextureDimension',
          ]),
        },
        thumbnail: {
          path: `/dice/${SET_ID}/${diceId}/thumbnail.png`,
          ...thumbnailInspection,
        },
      })
    }

    const manifest = {
      contractVersion: RUNTIME_ASSET_CONTRACT_VERSION,
      setId: SET_ID,
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

function verifyLockedSources(sourceRoot, sourceLock) {
  for (const source of sourceLock.files) {
    const sourcePath = path.resolve(sourceRoot, source.path)
    if (!sourcePath.startsWith(`${path.resolve(sourceRoot)}${path.sep}`)) {
      throw new Error(`Source lock path escapes its root: ${source.path}`)
    }
    const actual = sha256(fs.readFileSync(sourcePath))
    if (actual !== source.sha256) throw new Error(`Source hash mismatch: ${source.path}`)
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

function pick(source, keys) {
  return Object.fromEntries(keys.map(key => [key, source[key]]))
}

async function main() {
  const sourceIndex = process.argv.indexOf('--source')
  const sourceRoot = sourceIndex >= 0 ? process.argv[sourceIndex + 1] : undefined
  if (!sourceRoot) throw new Error('Usage: optimize.mjs --source <extracted-source-archive>')
  const manifest = await optimizeCozyForest({ sourceRoot: path.resolve(sourceRoot) })
  console.log(`Built ${manifest.assets.length} Cozy Forest runtime dice`)
}

if (process.argv[1]?.endsWith('optimize.mjs')) await main()
