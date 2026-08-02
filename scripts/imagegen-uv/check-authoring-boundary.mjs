#!/usr/bin/env node

import { execFileSync } from 'node:child_process'
import { readFileSync, statSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  RUNTIME_ASSET_BUDGETS,
  runtimeAssetManifestPaths,
  sha256,
} from '../runtime-dice-assets/runtime-asset-contract.mjs'

const MAX_TOOLING_FILE_BYTES = 128 * 1024
const DEFAULT_MAX_FILE_BYTES = 1024 * 1024
const ALLOWED_TOOLING_EXTENSIONS = new Set(['.mjs', '.json', '.py'])
const AUTHORING_PAYLOAD_EXTENSIONS = new Set([
  '.7z', '.blend', '.blend1', '.exr', '.fbx', '.glb', '.gltf', '.hdr', '.jpeg', '.jpg',
  '.obj', '.png', '.psd', '.stl', '.tif', '.tiff', '.webp', '.zip',
])
/**
 * Binaries that have been reviewed and are allowed to exist in the tree.
 *
 * A value may be either a byte ceiling (the historical form — the file is
 * first-party and regenerated in place, so only its size is governed) or an
 * object that additionally pins `sha256`. Pin the digest for anything we did
 * NOT author, where the reviewed property is "these exact bytes", not "a file
 * of roughly this size at this path". This mirrors the granularity the runtime
 * dice manifests already use (`runtime-asset-contract.mjs` records a per-file
 * `sha256`); the difference is only that those are discovered from a manifest
 * and these are enumerated here.
 */
const REVIEWED_BINARY_FILE_LIMITS = new Map([
  ['bun.lockb', 512 * 1024],
  ['public/artist-resources/uv-spike/assets/attempt-01-d6-cranberry.png', 4 * 1024 * 1024],
  ['public/artist-resources/uv-spike/assets/attempt-02-d20-teal.png', 4 * 1024 * 1024],
  ['public/artist-resources/uv-spike/assets/attempt-03-combined-amethyst.png', 4 * 1024 * 1024],
  ['public/artist-resources/uv-spike/evidence/wrapped-evidence-browser.png', 1024 * 1024],
  ['public/dice/devil-set/devil-d6/model.glb', 20 * 1024 * 1024],
  ['public/icons/apple-touch-icon.png', 128 * 1024],
  ['public/icons/pwa-192x192.png', 128 * 1024],
  ['public/icons/pwa-512x512-maskable.png', 128 * 1024],
  ['public/icons/pwa-512x512.png', 128 * 1024],
  ['src/generated/wasm-room/dicesuki_wasm_bg.wasm', 2 * 1024 * 1024],

  // Runtime HDR environment maps (issue #222). Third-party redistributions, so
  // the digest is the reviewed property: these are byte-for-byte the files drei
  // used to fetch from `raw.githack.com/pmndrs/drei-assets@456060a/hdri/`,
  // authored by Greg Zaal and published on Poly Haven under CC0 1.0, which
  // permits redistribution (verified at review time). Self-hosted so the
  // service worker can precache them and an offline boot keeps full image-based
  // lighting. The 2 MiB ceiling is the mechanism's baseline and caps a future
  // approved re-export at 1k equirectangular RGBE (~1.5-1.7 MB) rather than
  // silently admitting a 2k/4k map; the digest is what actually pins these two.
  [
    'public/textures/env/dikhololo_night_1k.hdr',
    {
      maxBytes: 2 * 1024 * 1024,
      sha256: '6861489f983cdc0c22435b781a3487171bd25f25f9cc52c46ac402d48e08249e',
    },
  ],
  [
    'public/textures/env/potsdamer_platz_1k.hdr',
    {
      maxBytes: 2 * 1024 * 1024,
      sha256: '7afe4c2f9700ee78c7477c53fa355463d7dda1fdede401432d6b5f9ff0a95696',
    },
  ],
])

/** Normalize a reviewed-binary entry to its `{ maxBytes, sha256? }` form. */
function reviewedBinaryEntry(value) {
  return typeof value === 'number' ? { maxBytes: value } : value
}

export function checkAuthoringBoundary(repoRoot = process.cwd()) {
  const files = listVersionedAndCandidateFiles(repoRoot)
  const errors = []
  const reviewedBinaryLimits = reviewedBinaryFileLimits(repoRoot)

  for (const file of files) {
    const normalized = file.split(path.sep).join('/')
    const absolutePath = path.join(repoRoot, file)
    const size = statSync(absolutePath).size
    const extension = path.extname(normalized).toLowerCase()
    const reviewedBinary = reviewedBinaryLimits.get(normalized)
    const maximumBytes = reviewedBinary?.maxBytes ?? DEFAULT_MAX_FILE_BYTES

    if (reviewedBinary === undefined) {
      if (AUTHORING_PAYLOAD_EXTENSIONS.has(extension) || containsNullByte(absolutePath)) {
        errors.push(`${normalized} is an unapproved binary/authoring payload`)
      }
    } else if (reviewedBinary.sha256 !== undefined) {
      // The reviewed property for these is the bytes themselves, so an edited or
      // swapped file is a different file and has to be reviewed again.
      const actual = sha256(readFileSync(absolutePath))
      if (actual !== reviewedBinary.sha256) {
        errors.push(
          `${normalized} has sha256 ${actual}; approved digest is ${reviewedBinary.sha256}`,
        )
      }
    }
    if (size > maximumBytes) {
      errors.push(`${normalized} is ${size} bytes; approved maximum is ${maximumBytes}`)
    }

    if (normalized.startsWith('scripts/imagegen-uv/')) {
      if (!ALLOWED_TOOLING_EXTENSIONS.has(extension)) {
        errors.push(`${normalized} is not a source or compact fixture file`)
      }
      if (size > MAX_TOOLING_FILE_BYTES) {
        errors.push(`${normalized} is ${size} bytes; tooling files must stay <= ${MAX_TOOLING_FILE_BYTES}`)
      }
    }
  }

  return { valid: errors.length === 0, errors, inspectedFiles: files.length }
}

function reviewedBinaryFileLimits(repoRoot) {
  const limits = new Map(
    [...REVIEWED_BINARY_FILE_LIMITS].map(([file, value]) => [file, reviewedBinaryEntry(value)]),
  )
  for (const manifestPath of runtimeAssetManifestPaths(repoRoot)) {
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
    const directorySetId = path.basename(path.dirname(manifestPath))
    if (manifest.setId !== directorySetId || !Array.isArray(manifest.assets)) {
      throw new Error(`${manifestPath} is not a canonical runtime asset manifest`)
    }
    for (const asset of manifest.assets ?? []) {
      const expectedRoot = `/dice/${manifest.setId}/${asset.diceId}`
      if (asset.model?.path === `${expectedRoot}/model.glb`) {
        limits.set(`public${asset.model.path}`, { maxBytes: RUNTIME_ASSET_BUDGETS.modelHardMaxBytes })
      }
      if (asset.thumbnail?.path === `${expectedRoot}/thumbnail.png`) {
        limits.set(`public${asset.thumbnail.path}`, { maxBytes: RUNTIME_ASSET_BUDGETS.thumbnailMaxBytes })
      }
    }
  }
  return limits
}

function containsNullByte(file) {
  return readFileSync(file).subarray(0, 8192).includes(0)
}

function listVersionedAndCandidateFiles(repoRoot) {
  const output = execFileSync(
    'git',
    ['ls-files', '--cached', '--others', '--exclude-standard', '-z'],
    { cwd: repoRoot, encoding: 'utf8' },
  )
  return [...new Set(output.split('\0').filter(Boolean))].sort()
}

function main() {
  const result = checkAuthoringBoundary()
  if (!result.valid) {
    console.error(`ImageGen authoring boundary check failed:\n${result.errors.join('\n')}`)
    process.exitCode = 1
    return
  }
  console.log(`ImageGen authoring boundary passed across ${result.inspectedFiles} candidate files`)
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
if (isMain) main()
