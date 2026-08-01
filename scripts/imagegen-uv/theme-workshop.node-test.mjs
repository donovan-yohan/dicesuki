import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'

import { createCanonicalDiceManifest, SUPPORTED_DICE_SHAPES } from './canonical-dice-contract.mjs'
import { DICE_NORMAL_STRENGTH_PER_SCALE, planNormalMapEntries } from './derive-theme-normal-maps.mjs'
import {
  generateThemeWorkshop,
  renderDicePrompt,
  validateThemeWorkshop,
} from './generate-theme-workshop.mjs'
import { heightForPixel } from './normal-map-utils.mjs'
import {
  faceNormalsFromManifest,
  faceNumeralBaselinesFromManifest,
} from './themed-polyhedral-glb.mjs'
import {
  DEFAULT_ENVIRONMENT_NORMAL_STRENGTH,
  getProofFace,
  getThemeAtlasPaths,
  getThemeBakePaths,
  getThemeProofSheetPath,
  getThemeWorkshopEntry,
  PROOF_BACKGROUND_RGB,
  PROOF_SUBJECT_FILL,
  resolveWorkshopRoot,
  selectThemes,
  THEME_WORKSHOP,
  THEME_WORKSHOP_SHAPES,
} from './theme-workshop-data.mjs'

const FANTASY = 'fantasy-earth'

test('workshop shapes track the canonical contract', () => {
  assert.deepEqual([...THEME_WORKSHOP_SHAPES], [...SUPPORTED_DICE_SHAPES])
})

test('every theme defines a complete, uniquely-identified polyhedral set', () => {
  const setIds = new Set()
  const diceIds = new Set()
  for (const theme of THEME_WORKSHOP) {
    assert.equal(setIds.has(theme.setId), false, `duplicate set id ${theme.setId}`)
    setIds.add(theme.setId)
    assert.match(theme.releaseDate, /^\d{4}-\d{2}-\d{2}$/)
    assert.ok(theme.materialPrompt.length > 80, `${theme.id} needs a substantive material prompt`)
    for (const key of ['floorPrompt', 'wallPrompt', 'skyboxPrompt']) {
      assert.ok(theme.environment[key]?.length > 80, `${theme.id} needs a ${key}`)
    }
    for (const key of ['roughness', 'metalness', 'normalScale']) {
      assert.ok(theme.material[key] > 0 && theme.material[key] <= 1, `${theme.id}.${key} out of range`)
    }
    // Rapier reads these straight off metadata.json; out-of-range values give
    // dice that float, tunnel, or never settle.
    for (const [key, min, max] of [['density', 0.05, 5], ['restitution', 0, 1], ['friction', 0, 2]]) {
      const value = theme.physics[key]
      assert.equal(typeof value, 'number', `${theme.id}.physics.${key} must be a number`)
      assert.ok(value >= min && value <= max, `${theme.id}.physics.${key}=${value} outside [${min}, ${max}]`)
    }
    for (const shape of THEME_WORKSHOP_SHAPES) {
      const die = theme.dice[shape]
      assert.ok(die, `${theme.id} is missing ${shape}`)
      assert.ok(die.id.endsWith(`-${shape}`), `${die.id} must end with -${shape}`)
      assert.equal(diceIds.has(die.id), false, `duplicate dice id ${die.id}`)
      diceIds.add(die.id)
    }
  }
})

test('the released sets keep the ids the runtime asset profiles already lock', () => {
  // runtime-asset-profiles.mjs and the published runtime-assets.json manifests
  // are immutable history; the workshop data must keep reproducing them.
  assert.equal(getThemeWorkshopEntry('cozy-forest').setId, 'cozy-forest-imagegen-set')
  assert.equal(getThemeWorkshopEntry('cyberpunk-box').setId, 'cyberpunk-imagegen-set')
  assert.equal(getThemeWorkshopEntry('dark-dungeon').setId, 'dark-dungeon-imagegen-set')
  assert.equal(getThemeWorkshopEntry('cozy-forest').dice.d20.id, 'elder-canopy-d20')
  assert.deepEqual(
    THEME_WORKSHOP_SHAPES.map(getProofFace),
    [4, 6, 8, 9, 12, 20],
  )
})

test('the fantasy set is defined and distinct from the released three', () => {
  const fantasy = getThemeWorkshopEntry(FANTASY)
  assert.equal(fantasy.setId, 'fantasy-earth-imagegen-set')
  assert.equal(fantasy.themeId, 'fantasy-earth', 'must bind to the shipped fantasy-earth theme')
  assert.equal(fantasy.status, 'authoring')
  assert.deepEqual(
    THEME_WORKSHOP_SHAPES.map((shape) => fantasy.dice[shape].id),
    ['runeleaf-d4', 'oathstone-d6', 'greenwarden-d8', 'sunspire-d10', 'emerald-crown-d12', 'aurelian-d20'],
  )
})

test('selectThemes defaults to every theme and rejects unknown ids', () => {
  assert.equal(selectThemes().length, THEME_WORKSHOP.length)
  assert.deepEqual(selectThemes([FANTASY]).map((theme) => theme.id), [FANTASY])
  assert.throws(() => selectThemes(['not-a-theme']), /Unknown workshop theme/)
})

test('resolveWorkshopRoot refuses to let --out escape into the repo', () => {
  assert.equal(resolveWorkshopRoot(undefined), '.artifacts/theme-workshop')
  assert.throws(() => resolveWorkshopRoot('public/dice'), /cannot be written under public/)
  assert.throws(() => resolveWorkshopRoot('src'), /cannot be written under src/)
  assert.throws(() => resolveWorkshopRoot('scripts/imagegen-uv'), /cannot be written under scripts/)
  assert.throws(() => resolveWorkshopRoot('docs/guides'), /must stay under \.artifacts/)
  assert.ok(path.isAbsolute(resolveWorkshopRoot('.artifacts/theme-workshop-smoke')))
})

test('workshop paths stay inside .artifacts and never touch public/', () => {
  for (const theme of THEME_WORKSHOP) {
    for (const shape of THEME_WORKSHOP_SHAPES) {
      const atlas = getThemeAtlasPaths(theme.id, shape)
      const bake = getThemeBakePaths(theme.id, shape)
      for (const candidate of [atlas.rawAtlas, atlas.atlas, atlas.normal, atlas.prompt, bake.model, bake.proof]) {
        assert.ok(candidate.startsWith('.artifacts/'), `${candidate} escapes .artifacts/`)
        // A `public/` segment is only ever the staged copy inside `source-root/`,
        // never a write into the repo's deployed `public/` tree.
        if (candidate.includes(`${path.sep}public${path.sep}`)) {
          assert.ok(
            candidate.includes(path.join('source-root', 'public') + path.sep),
            `${candidate} writes to public/ outside a staging source-root`,
          )
        }
      }
    }
  }
})

test('the bake source root mirrors the layout optimize.mjs consumes', () => {
  const bake = getThemeBakePaths(FANTASY, 'd20')
  assert.ok(bake.model.endsWith(
    path.join('source-root', 'public', 'dice', 'fantasy-earth-imagegen-set', 'aurelian-d20', 'model.glb'),
  ))
  assert.ok(bake.proof.endsWith(path.join(
    'source-root', 'public', 'artist-resources', 'imagegen-uv', 'screenshots', 'theme-workshop',
    'fantasy-earth-aurelian-d20-face-20.png',
  )))
})

test('every dice prompt pins its face values, filename, and D10 kite rule', () => {
  const fantasy = getThemeWorkshopEntry(FANTASY)
  for (const shape of THEME_WORKSHOP_SHAPES) {
    const manifest = createCanonicalDiceManifest(shape)
    const prompt = renderDicePrompt(fantasy, manifest)
    assert.match(prompt, new RegExp(`${manifest.faceValues.join(', ')}`))
    assert.match(prompt, new RegExp(`fantasy-earth-${shape}-imagegen-atlas-raw\\.png`))
    assert.equal(/D10 geometry contract/.test(prompt), shape === 'd10')
    assert.match(prompt, /Preserve the exact rotation of every numeral/)
  }
})

test('dice normal-map strength is derived from the theme normalScale', () => {
  const fantasy = getThemeWorkshopEntry(FANTASY)
  const entries = planNormalMapEntries(fantasy)
  const d20 = entries.find((entry) => entry.label === `${FANTASY}/d20`)
  assert.equal(d20.profile, 'ornament')
  assert.equal(d20.strength, fantasy.material.normalScale * DICE_NORMAL_STRENGTH_PER_SCALE)
  assert.equal(d20.tileable, false)
  const floor = entries.find((entry) => entry.label === `${FANTASY}/environment/floor`)
  assert.equal(floor.profile, 'surface')
  assert.equal(floor.tileable, true)
})

test('environment normal strength comes from the theme entry, not the script', () => {
  // The dark-dungeon override used to be an `id === 'dark-dungeon'` branch in
  // derive-theme-normal-maps; set definitions must live in one place.
  const dungeon = planNormalMapEntries(getThemeWorkshopEntry('dark-dungeon'))
  assert.equal(dungeon.find((entry) => entry.label.endsWith('/floor')).strength, 9)
  assert.equal(dungeon.find((entry) => entry.label.endsWith('/wall')).strength, 10)
  const fantasy = planNormalMapEntries(getThemeWorkshopEntry(FANTASY))
  assert.equal(fantasy.find((entry) => entry.label.endsWith('/floor')).strength, DEFAULT_ENVIRONMENT_NORMAL_STRENGTH.floor)
  assert.equal(fantasy.find((entry) => entry.label.endsWith('/wall')).strength, DEFAULT_ENVIRONMENT_NORMAL_STRENGTH.wall)
})

test('every pipeline module parses and exports its CLI entry point', async () => {
  // capture-theme-proofs embeds a browser page in a template literal; a stray
  // backtick in that string is a syntax error no other test would reach.
  const modules = await Promise.all([
    import('./capture-theme-proofs.mjs'),
    import('./register-theme-atlases.mjs'),
    import('./bake-theme-dice-sets.mjs'),
    import('./derive-theme-normal-maps.mjs'),
    import('./generate-theme-workshop.mjs'),
  ])
  const [proofs, register, bake, normals, workshop] = modules
  assert.equal(typeof proofs.captureThemeProofs, 'function')
  assert.equal(typeof register.registerThemeAtlases, 'function')
  assert.equal(typeof bake.bakeThemeDiceSets, 'function')
  assert.equal(typeof normals.deriveThemeNormalMaps, 'function')
  assert.equal(typeof workshop.generateThemeWorkshop, 'function')
})

test('proof rendering matches the released thumbnail convention', () => {
  // Sampled from public/dice/cozy-forest-imagegen-set/*/thumbnail.png.
  assert.deepEqual({ ...PROOF_BACKGROUND_RGB }, { r: 15, g: 23, b: 42 })
  // Released subjects fill 0.86-1.00 of the 320px thumbnail, which is a 512px
  // crop of the 720px proof.
  const thumbnailFill = PROOF_SUBJECT_FILL * 720 / 512
  assert.ok(thumbnailFill > 0.86 && thumbnailFill < 1.0, `thumbnail fill ${thumbnailFill} outside released range`)
})

test('contact sheets stay out of the release source root', () => {
  const sheet = getThemeProofSheetPath(FANTASY, 'd20')
  const bake = getThemeBakePaths(FANTASY, 'd20')
  assert.ok(sheet.endsWith(path.join('proofs', 'aurelian-d20-all-faces.png')))
  assert.equal(sheet.includes('source-root'), false, 'review artifacts must not enter the archive')
  assert.ok(bake.proof.includes('source-root'), 'the thumbnail source must stay in the archive')
})

test('the ornament height profile favours metal trim over flat luminance', () => {
  const gold = heightForPixel({ red: 0.85, green: 0.68, blue: 0.22 }, 'ornament')
  const enamel = heightForPixel({ red: 0.16, green: 0.3, blue: 0.14 }, 'ornament')
  assert.ok(gold > enamel, 'gilded trim must sit above the enamel panel')
  assert.ok(gold <= 1 && enamel >= 0)
  const flat = heightForPixel({ red: 0.5, green: 0.5, blue: 0.5 }, 'surface')
  assert.ok(flat > 0 && flat <= 1)
})

test('face normals and numeral baselines are unit vectors orthogonal to each other', () => {
  for (const shape of THEME_WORKSHOP_SHAPES) {
    const manifest = createCanonicalDiceManifest(shape)
    const normals = faceNormalsFromManifest(manifest)
    const baselines = faceNumeralBaselinesFromManifest(manifest)
    assert.equal(normals.length, manifest.canonicalFaceCount)
    assert.equal(baselines.length, manifest.canonicalFaceCount)
    for (const { value, normal } of normals) {
      assert.ok(Math.abs(Math.hypot(...normal) - 1) < 1e-4, `${shape} face ${value} normal is not unit length`)
      const baseline = baselines.find((entry) => entry.value === value).baseline
      assert.ok(Math.abs(Math.hypot(...baseline) - 1) < 1e-4, `${shape} face ${value} baseline is not unit length`)
      const dot = normal[0] * baseline[0] + normal[1] * baseline[1] + normal[2] * baseline[2]
      assert.ok(Math.abs(dot) < 1e-4, `${shape} face ${value} baseline must lie in the face plane`)
    }
  }
})

test('generateThemeWorkshop emits a validating, idempotent fantasy kit', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'dicesuki-theme-workshop-'))
  try {
    const result = await generateThemeWorkshop({ root, themes: [FANTASY] })
    assert.deepEqual(result.themes, [FANTASY])

    for (const shape of THEME_WORKSHOP_SHAPES) {
      const prompt = await readFile(getThemeAtlasPaths(FANTASY, shape, root).prompt, 'utf8')
      assert.match(prompt, /Aurelian Wildwood/)
      const manifest = JSON.parse(await readFile(path.join(root, 'templates', shape, 'manifest.json'), 'utf8'))
      assert.equal(manifest.shape, shape)
    }

    const first = await validateThemeWorkshop({ root, themes: [FANTASY] })
    assert.deepEqual(first.errors, [])

    // Re-running must be a no-op rather than drifting or refusing.
    await generateThemeWorkshop({ root, themes: [FANTASY] })
    const second = await validateThemeWorkshop({ root, themes: [FANTASY] })
    assert.deepEqual(second.errors, [])
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('validateThemeWorkshop fails closed when a prompt is edited by hand', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'dicesuki-theme-workshop-'))
  try {
    await generateThemeWorkshop({ root, themes: [FANTASY] })
    const { writeFile } = await import('node:fs/promises')
    await writeFile(getThemeAtlasPaths(FANTASY, 'd20', root).prompt, '# hand edited\n', 'utf8')
    const validation = await validateThemeWorkshop({ root, themes: [FANTASY] })
    assert.equal(validation.valid, false)
    assert.ok(validation.errors.some((error) => error.includes('d20')))
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
