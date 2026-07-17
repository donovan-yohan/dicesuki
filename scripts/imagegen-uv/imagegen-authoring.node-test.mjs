import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { execFileSync, spawnSync } from 'node:child_process'
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

import {
  createCanonicalDiceManifest,
  SUPPORTED_DICE_SHAPES,
  validateManifestStructure,
} from './canonical-dice-contract.mjs'
import {
  buildCanonicalReference,
  loadCanonicalReference,
  selectCanonicalReferencePath,
  validateCanonicalManifest,
} from './canonical-validation.mjs'
import { checkAuthoringBoundary } from './check-authoring-boundary.mjs'
import {
  changedCanonicalReferencePaths,
  validateCurrentReferenceHistory,
} from './check-canonical-history.mjs'
import {
  AUTHORING_OUTPUT_MARKER,
  assertSafeOutputDirectory,
  generateAuthoringKit,
  validateAuthoringKit,
} from './generate-authoring-kit.mjs'

const SCRIPT_DIRECTORY = path.dirname(fileURLToPath(import.meta.url))

test('all six geometry-derived manifests match the frozen canonical reference', () => {
  for (const shape of SUPPORTED_DICE_SHAPES) {
    const manifest = createCanonicalDiceManifest(shape)
    const result = validateCanonicalManifest(manifest)
    assert.equal(result.valid, true, `${shape}: ${result.errors.join('; ')}`)
    assert.equal(manifest.islands.length, manifest.canonicalFaceCount)
    assert.equal(
      manifest.islands.reduce((sum, island) => sum + island.triangleCount, 0),
      manifest.canonicalTriangleCount,
    )
  }
})

test('canonical validation rejects a geometrically valid UV permutation', () => {
  const manifest = createCanonicalDiceManifest('d20')
  const firstFace = manifest.islands[0]
  ;[firstFace.uvByTriangle[0][0], firstFace.uvByTriangle[0][1]] = [
    firstFace.uvByTriangle[0][1],
    firstFace.uvByTriangle[0][0],
  ]
  firstFace.meshTriangles[0].uvs = firstFace.uvByTriangle[0].map(({ u, v }) => [u, v])

  const structural = validateManifestStructure(manifest)
  assert.equal(structural.valid, true, structural.errors.join('; '))
  assert.match(
    validateCanonicalManifest(manifest).errors.join('; '),
    /canonical UV mapping drifted/,
  )
})

test('D10 validation rejects broken two-triangle kite grouping', () => {
  const manifest = createCanonicalDiceManifest('d10')
  manifest.islands[0].triangleIndices[1] = 2
  manifest.islands[0].meshTriangles[1].triangleIndex = 2
  const result = validateCanonicalManifest(manifest)
  assert.equal(result.valid, false)
  assert.match(result.errors.join('; '), /triangles must be 0,1|triangle grouping drifted/)
})

test('authoring generation is byte-for-byte reproducible and stays text-only by default', async () => {
  const temporaryRoot = await mkdtemp(path.join(os.tmpdir(), 'dicesuki-imagegen-'))
  try {
    const first = path.join(temporaryRoot, 'first')
    const second = path.join(temporaryRoot, 'second')
    await generateAuthoringKit({ outputDir: first })
    await generateAuthoringKit({ outputDir: second })

    const firstTree = await hashTree(first)
    const secondTree = await hashTree(second)
    assert.deepEqual(firstTree, secondTree)
    assert.equal([...firstTree.keys()].some((file) => /\.(?:blend|glb|png)$/i.test(file)), false)
    assert.equal((await validateAuthoringKit({ outputDir: first })).valid, true)
  } finally {
    await rm(temporaryRoot, { recursive: true, force: true })
  }
})

test('portable Blender validator accepts every frozen mesh and UV contract', async () => {
  const temporaryRoot = await mkdtemp(path.join(os.tmpdir(), 'dicesuki-blender-'))
  try {
    await generateAuthoringKit({ outputDir: temporaryRoot })
    for (const shape of SUPPORTED_DICE_SHAPES) {
      const manifestPath = path.join(temporaryRoot, shape, 'manifest.json')
      const manifest = JSON.parse(await readFile(manifestPath, 'utf8'))
      const output = execFileSync(
        'python3',
        [
          path.join(SCRIPT_DIRECTORY, 'blender_generate.py'),
          '--manifest',
          manifestPath,
          '--validate-only',
        ],
        { encoding: 'utf8' },
      )
      assert.match(
        output,
        new RegExp(`${manifest.canonicalFaceCount} faces / ${manifest.canonicalTriangleCount} triangles`),
      )
    }
  } finally {
    await rm(temporaryRoot, { recursive: true, force: true })
  }
})

test('portable Blender validator rejects frozen face, material, and topology drift', async () => {
  const temporaryRoot = await mkdtemp(path.join(os.tmpdir(), 'dicesuki-blender-negative-'))
  try {
    await generateAuthoringKit({ outputDir: temporaryRoot, shapes: ['d10'] })
    const manifestPath = path.join(temporaryRoot, 'd10', 'manifest.json')
    const manifest = JSON.parse(await readFile(manifestPath, 'utf8'))
    const cases = [
      {
        name: 'face-order',
        pattern: /canonical face order drifted/,
        mutate(value) {
          value.faceValues = [...value.faceValues]
          value.faceValues[0] = 99
        },
      },
      {
        name: 'material-map',
        pattern: /canonical face\/material mapping drifted/,
        mutate(value) {
          value.materialMap = { ...value.materialMap, 0: 9 }
        },
      },
      {
        name: 'mesh-topology',
        pattern: /canonical mesh topology drifted/,
        mutate(value) {
          value.islands[0].meshTriangles[0].positions[0][0] += 0.125
        },
      },
    ]

    for (const negativeCase of cases) {
      const mutated = structuredClone(manifest)
      negativeCase.mutate(mutated)
      const mutatedPath = path.join(temporaryRoot, `${negativeCase.name}.json`)
      await writeFile(mutatedPath, `${JSON.stringify(mutated, null, 2)}\n`)
      const result = spawnSync(
        'python3',
        [
          path.join(SCRIPT_DIRECTORY, 'blender_generate.py'),
          '--manifest',
          mutatedPath,
          '--validate-only',
        ],
        { encoding: 'utf8' },
      )
      assert.notEqual(result.status, 0, `${negativeCase.name} unexpectedly validated`)
      assert.match(result.stderr, negativeCase.pattern)
    }
  } finally {
    await rm(temporaryRoot, { recursive: true, force: true })
  }
})

test('generator refuses deployable and source-tree output paths', () => {
  assert.throws(() => assertSafeOutputDirectory('public/artist-resources/imagegen-uv'), /cannot be written/)
  assert.throws(() => assertSafeOutputDirectory('scripts/imagegen-uv/output'), /cannot be written/)
  assert.throws(() => assertSafeOutputDirectory('.'), /inside the repo/)
})

test('tracked authoring boundary excludes generated and themed payloads', () => {
  const result = checkAuthoringBoundary()
  assert.equal(result.valid, true, result.errors.join('; '))
})

test('authoring boundary rejects binary and large payloads after arbitrary renames', async () => {
  const repository = await mkdtemp(path.join(os.tmpdir(), 'dicesuki-imagegen-boundary-'))
  try {
    execFileSync('git', ['init', '-q'], { cwd: repository })
    await mkdir(path.join(repository, 'public/renamed'), { recursive: true })
    await mkdir(path.join(repository, 'assets/archive'), { recursive: true })
    await writeFile(
      path.join(repository, 'public/renamed/die-art.png'),
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x00, 0x01]),
    )
    await writeFile(
      path.join(repository, 'assets/archive/innocent-looking.data'),
      Buffer.alloc(1024 * 1024 + 1, 1),
    )

    const result = checkAuthoringBoundary(repository)
    assert.equal(result.valid, false)
    assert.match(result.errors.join('; '), /public\/renamed\/die-art\.png is an unapproved binary/)
    assert.match(
      result.errors.join('; '),
      /assets\/archive\/innocent-looking\.data is 1048577 bytes; approved maximum is 1048576/,
    )
  } finally {
    await rm(repository, { recursive: true, force: true })
  }
})

test('reviewed binary paths still enforce their approved size ceiling', async () => {
  const repository = await mkdtemp(path.join(os.tmpdir(), 'dicesuki-imagegen-approved-size-'))
  try {
    execFileSync('git', ['init', '-q'], { cwd: repository })
    const iconPath = path.join(repository, 'public/icons/pwa-192x192.png')
    await mkdir(path.dirname(iconPath), { recursive: true })
    await writeFile(iconPath, Buffer.alloc(128 * 1024 + 1, 0))

    const result = checkAuthoringBoundary(repository)
    assert.equal(result.valid, false)
    assert.match(
      result.errors.join('; '),
      /public\/icons\/pwa-192x192\.png is 131073 bytes; approved maximum is 131072/,
    )
    assert.doesNotMatch(result.errors.join('; '), /unapproved binary\/authoring payload/)
  } finally {
    await rm(repository, { recursive: true, force: true })
  }
})

test('generator refuses unmanaged dirty output and preserves it', async () => {
  const temporaryRoot = await mkdtemp(path.join(os.tmpdir(), 'dicesuki-imagegen-dirty-'))
  try {
    const outputDir = path.join(temporaryRoot, 'output')
    await mkdir(outputDir)
    const notePath = path.join(outputDir, 'artist-notes.txt')
    await writeFile(notePath, 'keep me\n')
    await assert.rejects(
      generateAuthoringKit({ outputDir, shapes: ['d10'] }),
      new RegExp(`without ${AUTHORING_OUTPUT_MARKER}`),
    )
    assert.equal(await readFile(notePath, 'utf8'), 'keep me\n')
  } finally {
    await rm(temporaryRoot, { recursive: true, force: true })
  }
})

test('managed generation removes stale rasters and shapes and repeats exactly', async () => {
  const temporaryRoot = await mkdtemp(path.join(os.tmpdir(), 'dicesuki-imagegen-managed-'))
  try {
    const outputDir = path.join(temporaryRoot, 'output')
    await generateAuthoringKit({ outputDir })
    await writeFile(path.join(outputDir, 'd10', 'numbered-guide.png'), Buffer.from('stale'))
    const dirtyValidation = await validateAuthoringKit({ outputDir })
    assert.equal(dirtyValidation.valid, false)
    assert.match(dirtyValidation.errors.join('; '), /unexpected generated files: numbered-guide\.png/)

    await generateAuthoringKit({ outputDir, shapes: ['d10'] })
    const firstTree = await hashTree(outputDir)
    assert.deepEqual(
      (await readdir(outputDir)).sort(),
      [AUTHORING_OUTPUT_MARKER, 'INDEX.md', 'd10'].sort(),
    )
    assert.equal(firstTree.has('d10/numbered-guide.png'), false)
    assert.equal((await validateAuthoringKit({ outputDir, shapes: ['d10'] })).valid, true)

    await generateAuthoringKit({ outputDir, shapes: ['d10'] })
    assert.deepEqual(await hashTree(outputDir), firstTree)
  } finally {
    await rm(temporaryRoot, { recursive: true, force: true })
  }
})

test('published canonical references append v2, select it, and preserve v1', async () => {
  const repository = await mkdtemp(path.join(os.tmpdir(), 'dicesuki-imagegen-history-'))
  try {
    execFileSync('git', ['init', '-q'], { cwd: repository })
    execFileSync('git', ['config', 'user.name', 'ImageGen Test'], { cwd: repository })
    execFileSync('git', ['config', 'user.email', 'imagegen-test@example.invalid'], { cwd: repository })
    const fixtureDirectory = path.join(repository, 'scripts/imagegen-uv/fixtures')
    await mkdir(fixtureDirectory, { recursive: true })
    const firstReference = path.join(fixtureDirectory, 'canonical-contract-v1.json')
    const frozenV1 = await readFile(path.join(SCRIPT_DIRECTORY, 'fixtures/canonical-contract-v1.json'), 'utf8')
    await writeFile(firstReference, frozenV1)
    execFileSync('git', ['add', '.'], { cwd: repository })
    execFileSync('git', ['commit', '-qm', 'canonical baseline'], { cwd: repository })
    const baseline = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repository, encoding: 'utf8' }).trim()

    const manifests = SUPPORTED_DICE_SHAPES.map((shape) => createCanonicalDiceManifest(shape))
    const secondReference = buildCanonicalReference(
      manifests,
      { previousReference: 'canonical-contract-v1.json', note: 'test append' },
      2,
    )
    await writeFile(
      path.join(fixtureDirectory, 'canonical-contract-v2.json'),
      `${JSON.stringify(secondReference, null, 2)}\n`,
    )
    const history = validateCurrentReferenceHistory(repository)
    assert.equal(history.newest, 'canonical-contract-v2.json')
    const selectedPath = selectCanonicalReferencePath(fixtureDirectory)
    assert.equal(path.basename(selectedPath), 'canonical-contract-v2.json')
    const selectedReference = loadCanonicalReference(selectedPath)
    assert.equal(selectedReference.referenceVersion, 2)
    assert.equal(validateCanonicalManifest(createCanonicalDiceManifest('d10'), selectedReference).valid, true)
    assert.equal(await readFile(firstReference, 'utf8'), frozenV1)
    assert.deepEqual(changedCanonicalReferencePaths(baseline, repository), [])

    await writeFile(firstReference, frozenV1.replace('"referenceVersion": 1', '"referenceVersion": 1,\n  "rewritten": true'))
    assert.deepEqual(changedCanonicalReferencePaths(baseline, repository), [
      'scripts/imagegen-uv/fixtures/canonical-contract-v1.json',
    ])
  } finally {
    await rm(repository, { recursive: true, force: true })
  }
})

async function hashTree(root) {
  const result = new Map()
  await walk(root, '')
  return result

  async function walk(directory, relativeDirectory) {
    const entries = await readdir(directory, { withFileTypes: true })
    for (const entry of entries.sort((first, second) => first.name.localeCompare(second.name))) {
      const relativePath = path.join(relativeDirectory, entry.name)
      const absolutePath = path.join(directory, entry.name)
      if (entry.isDirectory()) await walk(absolutePath, relativePath)
      else {
        const contents = await readFile(absolutePath)
        result.set(relativePath.split(path.sep).join('/'), createHash('sha256').update(contents).digest('hex'))
      }
    }
  }
}
