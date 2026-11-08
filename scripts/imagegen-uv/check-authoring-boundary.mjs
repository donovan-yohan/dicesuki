#!/usr/bin/env node

import { execFileSync } from 'node:child_process'
import { lstatSync, readFileSync, statSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { SCULPTED_ASSET_PROFILES } from '../runtime-dice-assets/sculpted-asset-profiles.mjs'
import { readSculptedSourceRecord } from '../runtime-dice-assets/sculpted-asset-contract.mjs'
import { validatePublicSculptedModel } from '../runtime-dice-assets/sculpted-public-model.mjs'
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
  '.obj', '.pdf', '.png', '.psd', '.stl', '.tif', '.tiff', '.webp', '.zip',
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
  // Exact reviewed runtime maps and licensed sign font. Never admit this
  // directory wholesale: study captures and authoring sources remain ignored.
  ['public/environments/cyberpunk/SpaceGrotesk.ttf', { maxBytes: 160 * 1024, sha256: 'acad6de1fc93436f5c0f1f4137751ef04f1aea3063e7036535970ffcfbd79f72' }],
  ['public/environments/monster-dungeon/bone-albedo.png', { maxBytes: 192 * 1024, sha256: '65d81d9e34eba5a075799d4125b60aa2c7088c70d38a391c4167fc460382ad19' }],
  ['public/environments/monster-dungeon/bone-normal.png', { maxBytes: 448 * 1024, sha256: 'c93714a257956630799ce818b3ea241a46161235f971e8af25f6c1e37770aa83' }],
  ['public/environments/monster-dungeon/brick-albedo.png', { maxBytes: 96 * 1024, sha256: 'd2ae3dc967fb427cca00d899dd7b5dcda78c04dd678bcd18065cbcced439fff1' }],
  ['public/environments/monster-dungeon/brick-normal.png', { maxBytes: 544 * 1024, sha256: 'd63dbfdcb45a9d804df2ecbe022750f2838b53866b401b849d1c8644f440481e' }],
  ['public/environments/monster-dungeon/iron-albedo.png', { maxBytes: 96 * 1024, sha256: '2e00e5bec98f5cb5e5b2471ee95a9ccc3480bf7bea37ac2c99540b6386b4f588' }],
  ['public/environments/monster-dungeon/iron-normal.png', { maxBytes: 608 * 1024, sha256: '4342eb650e0222050f900f31b9dc0bb7913dea34fe0d9c289af4d3d39e3b5785' }],
  ['public/environments/monster-dungeon/leather-albedo.png', { maxBytes: 160 * 1024, sha256: '2966c0ee05660b35260c6be3fd76532a334285fb5d081007d3fb755690a56fd2' }],
  ['public/environments/monster-dungeon/leather-normal.png', { maxBytes: 608 * 1024, sha256: '9bd4f466f8ea80d148439ecb5fbdf28aed4b0737d2f4adc98b6df74f8126e1fb' }],
  ['public/environments/monster-dungeon/moss-albedo.png', { maxBytes: 64 * 1024, sha256: 'f800afc3eb77e6bf951d91e563267a26ed3cde61289ca2e2a80ab02f06be06de' }],
  ['public/environments/monster-dungeon/moss-normal.png', { maxBytes: 544 * 1024, sha256: '1b3f96c876905cccff269f93a7de3e327f22d2024e233ac1f57a2c0853e71a34' }],
  ['public/environments/monster-dungeon/stone-albedo.png', { maxBytes: 96 * 1024, sha256: '27bc17238f961df418177c30b16171a57a28afd4af3e1ba842ed4045583aa969' }],
  ['public/environments/monster-dungeon/stone-normal.png', { maxBytes: 544 * 1024, sha256: 'd63dbfdcb45a9d804df2ecbe022750f2838b53866b401b849d1c8644f440481e' }],
  ['public/environments/monster-dungeon/wood-albedo.png', { maxBytes: 128 * 1024, sha256: '98e5e63ad216bfdbd468a181a55aad9d7b6320ac2aff9b3a0903654fe9ad663d' }],
  ['public/environments/monster-dungeon/wood-normal.png', { maxBytes: 544 * 1024, sha256: '57c237b9e762a7d8fdff3d5745a9a267ec17c9bd5e68ffef4fa255d964b38a68' }],
  ['src/components/environment/textures/bark-albedo.png', { maxBytes: 160 * 1024, sha256: '1974f20e7a7e69965021f4d386a2478126aa68743f37cf7e4758f5aafe0679bb' }],
  ['src/components/environment/textures/bark-normal.png', { maxBytes: 320 * 1024, sha256: 'b77e30026be4cbc79c550678d766c3a1492db5e17a3845bf0d8d85465693faf0' }],
  ['src/components/environment/textures/leaf-albedo.png', { maxBytes: 32 * 1024, sha256: '2237e257525ef5daa074d2cf8ec7bb1fe15767fd37d9e68af60a7ad658c7c409' }],
  ['public/dice/devil-set/devil-d6/model.glb', 20 * 1024 * 1024],
  ['public/icons/apple-touch-icon.png', 128 * 1024],
  ['public/icons/pwa-192x192.png', 128 * 1024],
  ['public/icons/pwa-512x512-maskable.png', 128 * 1024],
  ['public/icons/pwa-512x512.png', 128 * 1024],
  ['src/generated/wasm-room/dicesuki_wasm_bg.wasm', 2 * 1024 * 1024],

  // Required ORC notice, retrieved and reviewed for the monster-manual catalog.
  // Approval covers this exact third-party PDF, never the directory/extension.
  [
    'public/licenses/monster-manual/ORC_License_FINAL.pdf',
    {
      maxBytes: 256 * 1024,
      sha256: 'e03afd5ccdef506660b29291351035bb92fbf8c26bdc027bd06c9de0c30f1dcc',
    },
  ],

  // Sanitized compiled-browser guest-fixture captures, reviewed as exact bytes.
  ['docs/pr-evidence/dice-visibility/bounce-apex-phone.png', { maxBytes: 368220, sha256: 'e3d4ae2fb929f7ecf5b50bc7e8f168da2ab76395f37b51797db7837b1a276820' }],
  ['docs/pr-evidence/dice-visibility/foliage-after.png', { maxBytes: 1621144, sha256: '545ff034f51b1b0bccff123fb84df2b6c1c17668fccba007bd8a155116399647' }],
  ['docs/pr-evidence/dice-visibility/foliage-before.png', { maxBytes: 1603670, sha256: 'fd4bf00bede0bc0e5f3123184ee72cf87a055200bf7416ca29f529c706a13c00' }],
  ['docs/pr-evidence/themed-worlds/cyberpunk-cutline-1280.png', { maxBytes: 721048, sha256: '201c080752e3ecd83ebe6d261e8450eaf2fd2fa15136097ad7df11d45856ae84' }],
  ['docs/pr-evidence/themed-worlds/cyberpunk-cutline-390.png', { maxBytes: 240509, sha256: 'b8b7a4e39ddb2699edda25c7f71c4777c855fece3a3a38826cf237d0e880708f' }],
  ['docs/pr-evidence/themed-worlds/monster-dungeon-1280.png', { maxBytes: 933253, sha256: 'da55e2e1fd8feed7ffc9fadb640001af224712019a6fd32bb34ad413224137c6' }],
  ['docs/pr-evidence/themed-worlds/monster-dungeon-390.png', { maxBytes: 313403, sha256: 'ebecb885ce1265f113fc7188b9b9e5626b673c0b908a5db7918cf38528f73574' }],
  ['docs/pr-evidence/themed-worlds/sunlit-glade-cel-1280.png', { maxBytes: 1158805, sha256: '74de99c09aa98531aa72da0bb1588b19f5cf96c0606ac67b0efa42bc1a958e58' }],
  ['docs/pr-evidence/themed-worlds/sunlit-glade-cel-390.png', { maxBytes: 372803, sha256: '8768e1ad597252d6f1d4322c7440c04788a8d6a6e599ed473127dcef9b90e1a6' }],
  ['docs/pr-evidence/monster-manual/priest-spellbook-phone.png', { maxBytes: 256 * 1024, sha256: '991006d0092eb7336129e2377410cb456e0914a36a604de1380041bfdca59152' }],
  ['docs/pr-evidence/monster-manual/pf-spellbook-desktop.png', { maxBytes: 256 * 1024, sha256: '7811bc8d30cab77c54f37254f90cf05eae5a6bf72dd58017be32848f27494e30' }],

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
    if (normalized.startsWith('public/artist-resources/')) {
      errors.push(`${normalized} belongs in a checksum-locked external authoring archive, not public/`)
      continue
    }
    let fileStats
    try {
      const linkStats = lstatSync(absolutePath)
      if (linkStats.isSymbolicLink()) {
        try {
          fileStats = statSync(absolutePath)
        } catch (error) {
          if (error?.code === 'ENOENT') {
            errors.push(`${normalized} is a broken symbolic link`)
            continue
          }
          throw error
        }
      } else {
        fileStats = linkStats
      }
    } catch (error) {
      // A file can disappear between the Git query and inspection. Deleted
      // tracked files are filtered before this loop; tolerate only the same
      // ENOENT race here and surface every other filesystem failure.
      if (error?.code === 'ENOENT') continue
      throw error
    }
    const size = fileStats.size
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
        if (manifest.contractVersion === 2) {
          const profile = SCULPTED_ASSET_PROFILES[manifest.setId]
          const frozen = readSculptedSourceRecord().record
          const selected = frozen.sets.find(set => set.setId === manifest.setId)?.dice.find(die => die.shape === asset.diceType)
          const source = frozen.files.find(file => file.path === selected?.model)
          if (!profile || asset.diceId !== asset.diceType || !source) {
            throw new Error(`${manifestPath} has an unrecognized sculpted model`)
          }
          const modelBytes = readFileSync(path.join(repoRoot, `public${asset.model.path}`))
          try {
            validatePublicSculptedModel(modelBytes, manifest.setId, asset.diceType, source.sha256, asset.publicDerivation)
          } catch {
            // Keep reporting mismatched bytes through the existing boundary result.
            limits.set(`public${asset.model.path}`, { maxBytes: profile.budgets.modelMaxBytes[asset.diceType], sha256: 'invalid-sculpted-custody' })
            continue
          }
          limits.set(`public${asset.model.path}`, { maxBytes: profile.budgets.modelMaxBytes[asset.diceType], sha256: asset.model.sha256 })
        } else {
          limits.set(`public${asset.model.path}`, { maxBytes: RUNTIME_ASSET_BUDGETS.modelHardMaxBytes })
        }
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
  const deleted = new Set(execFileSync(
    'git',
    ['ls-files', '--deleted', '-z'],
    { cwd: repoRoot, encoding: 'utf8' },
  ).split('\0').filter(Boolean))
  const output = execFileSync(
    'git',
    ['ls-files', '--cached', '--others', '--exclude-standard', '-z'],
    { cwd: repoRoot, encoding: 'utf8' },
  )
  return [...new Set(output.split('\0').filter(Boolean))]
    // `--cached` includes an unstaged tracked deletion. Skip only paths Git
    // identifies as deleted; `existsSync` would also hide broken symlinks.
    .filter((file) => !deleted.has(file))
    .sort()
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
