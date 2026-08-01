#!/usr/bin/env node

/**
 * Step 5 of the themed dice pipeline: bake registered albedo + derived normal
 * maps into per-die GLB models with `set.json` / `metadata.json` siblings.
 *
 * Resurrected from `scripts/production-dice-fixtures/generate-themed-imagegen-sets.mjs`
 * at commit 7393d112c5e062570ec7caf37970206c4d05c08c. Two adaptations:
 *
 * 1. Output goes to `.artifacts/theme-workshop/<theme>/source-root/`, laid out
 *    exactly like a repository checkout, so the directory can be handed
 *    straight to `node scripts/runtime-dice-assets/optimize.mjs --source <dir>`
 *    (and archived/checksummed as the release tarball) instead of writing raw
 *    GLBs into `public/`, which the authoring boundary forbids.
 * 2. Face normals come from the canonical manifest instead of the removed
 *    `getThemedDiceFaceNormals` helper.
 *
 * Usage:
 *   node scripts/imagegen-uv/bake-theme-dice-sets.mjs [--theme fantasy-earth] [--out DIR]
 */

import { access, mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import {
  createThemedPolyhedralGlb,
  faceNormalsFromManifest,
} from './themed-polyhedral-glb.mjs'
import {
  getBakeRadius,
  getBakeRarity,
  getTemplatePaths,
  getThemeAtlasPaths,
  getThemeBakePaths,
  selectThemes,
  THEME_WORKSHOP_ARTIST,
  THEME_WORKSHOP_ROOT,
  THEME_WORKSHOP_SHAPES,
  resolveWorkshopRoot,
} from './theme-workshop-data.mjs'

export async function bakeThemeDiceSets(options = {}) {
  const root = options.root ?? THEME_WORKSHOP_ROOT
  const themes = selectThemes(options.themes)
  const baked = []
  const skipped = []

  for (const theme of themes) {
    const ready = []
    for (const shape of THEME_WORKSHOP_SHAPES) {
      const atlas = getThemeAtlasPaths(theme.id, shape, root)
      if (await exists(atlas.atlas) && await exists(atlas.normal)) ready.push(shape)
      else skipped.push(`${theme.id}/${shape}`)
    }
    if (ready.length === 0) continue

    if (ready.length !== THEME_WORKSHOP_SHAPES.length && !options.allowPartial) {
      throw new Error(
        `${theme.id} is missing registered art for ${THEME_WORKSHOP_SHAPES.filter((shape) => !ready.includes(shape)).join(', ')}. `
        + 'A starter set must be complete; pass --allow-partial to bake anyway.',
      )
    }

    const { setDirectory, setJson } = getThemeBakePaths(theme.id, ready[0], root)
    await mkdir(setDirectory, { recursive: true })
    await writeJson(setJson, {
      id: theme.setId,
      name: theme.name,
      artist: THEME_WORKSHOP_ARTIST,
      description: theme.description,
      releaseDate: theme.releaseDate,
      tags: [...theme.tags],
      availability: 'always',
    })

    for (const shape of ready) {
      const die = theme.dice[shape]
      const atlas = getThemeAtlasPaths(theme.id, shape, root)
      const manifestPath = getTemplatePaths(shape, root).manifest
      await access(manifestPath)
      const manifest = JSON.parse(await readFile(manifestPath, 'utf8'))
      const radius = getBakeRadius(shape)
      const bake = getThemeBakePaths(theme.id, shape, root)

      const model = await createThemedPolyhedralGlb({
        atlasPath: atlas.atlas,
        normalMapPath: atlas.normal,
        manifestPath,
        name: die.name.replace(/\s+/g, '_'),
        radius,
        roughness: theme.material.roughness,
        metalness: theme.material.metalness,
        normalScale: theme.material.normalScale,
      })

      await mkdir(bake.dieDirectory, { recursive: true })
      await writeFile(bake.model, model)
      await writeJson(bake.metadata, buildDieMetadata(theme, shape, manifest))
      baked.push(`${theme.id}/${shape}`)
    }
  }

  return { baked, skipped, root }
}

export function buildDieMetadata(theme, shape, manifest) {
  const die = theme.dice[shape]
  return {
    version: '1.0',
    diceType: shape,
    name: die.name,
    artist: THEME_WORKSHOP_ARTIST,
    created: theme.releaseDate,
    scale: 1,
    rarity: getBakeRarity(shape),
    description: `${die.name} belongs to ${theme.name}, with Codex ImageGen-authored face art and a derived tangent-space normal map.`,
    canonicalReferenceVersion: 2,
    tags: [
      ...theme.tags,
      shape,
      'complete-polyhedral-set',
      'numbered-faces',
      'edge-parallel-numerals',
      'uv-atlas',
      'derived-normal-map',
      ...(shape === 'd10' ? ['planar-kite-faces', 'two-triangles-per-kite'] : []),
    ],
    faceNormals: faceNormalsFromManifest(manifest),
    physics: { ...theme.physics },
    colliderType: shape === 'd6' ? 'roundCuboid' : 'hull',
    colliderArgs: shape === 'd6'
      ? { halfExtents: [0.5, 0.5, 0.5], borderRadius: 0.06 }
      : {},
  }
}

async function exists(filePath) {
  try {
    await access(filePath)
    return true
  } catch {
    return false
  }
}

async function writeJson(filePath, value) {
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8')
}

function parseArgs(argv) {
  const options = { themes: [] }
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index]
    if (argument === '--theme') options.themes.push(argv[++index])
    else if (argument === '--out') options.root = resolveWorkshopRoot(argv[++index])
    else if (argument === '--allow-partial') options.allowPartial = true
    else if (argument === '--help') options.help = true
    else throw new Error(`Unknown argument: ${argument}`)
  }
  return options
}

async function main() {
  const options = parseArgs(process.argv.slice(2))
  if (options.help) {
    console.log('Usage: node scripts/imagegen-uv/bake-theme-dice-sets.mjs [--theme ID] [--out DIR] [--allow-partial]')
    return
  }
  const result = await bakeThemeDiceSets(options)
  if (result.baked.length === 0) {
    throw new Error(
      `No registered atlas + normal-map pairs found under ${result.root}. `
      + 'Run the art pass, `npm run register:theme-atlases`, and `npm run generate:theme-normal-maps` first.',
    )
  }
  console.log(`Baked ${result.baked.length} themed dice GLB(s): ${result.baked.join(', ')}`)
  if (result.skipped.length > 0) {
    console.log(`Skipped ${result.skipped.length} shape(s) without registered art: ${result.skipped.join(', ')}`)
  }
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
if (isMain) await main()
