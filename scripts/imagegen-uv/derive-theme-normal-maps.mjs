#!/usr/bin/env node

/**
 * Step 4 of the themed dice pipeline: derive tangent-space normal maps from the
 * registered ImageGen albedo art.
 *
 * The dice atlases use the `ornament` profile at `material.normalScale * 11`,
 * which is the exact relationship the three released sets were built with — the
 * same `normalScale` then goes onto the GLB material, so relief strength and
 * lighting response stay proportional across themes.
 *
 * Environment textures use the `surface` profile with tileable sampling.
 *
 * Resurrected from commit 7393d112c5e062570ec7caf37970206c4d05c08c; adapted for
 * `.artifacts/` paths and `--theme` selection, and it now skips inputs that do
 * not exist yet instead of failing the whole run.
 *
 * Usage:
 *   node scripts/imagegen-uv/derive-theme-normal-maps.mjs [--theme fantasy-earth] [--out DIR]
 */

import { access } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { deriveNormalMaps } from './normal-map-utils.mjs'
import {
  getEnvironmentTexturePaths,
  getThemeAtlasPaths,
  selectThemes,
  THEME_WORKSHOP_ROOT,
  THEME_WORKSHOP_SHAPES,
} from './theme-workshop-data.mjs'

/** Albedo-to-relief gain. `strength = normalScale * this`. */
export const DICE_NORMAL_STRENGTH_PER_SCALE = 11

export function planNormalMapEntries(theme, root = THEME_WORKSHOP_ROOT) {
  const environment = getEnvironmentTexturePaths(theme.id, root)
  const entries = [
    {
      label: `${theme.id}/environment/floor`,
      inputPath: environment.floorAlbedo,
      outputPath: environment.floorNormal,
      profile: 'surface',
      strength: theme.id === 'dark-dungeon' ? 9 : 7,
      blur: 1.25,
      tileable: true,
    },
    {
      label: `${theme.id}/environment/wall`,
      inputPath: environment.wallAlbedo,
      outputPath: environment.wallNormal,
      profile: 'surface',
      strength: theme.id === 'dark-dungeon' ? 10 : 7.5,
      blur: 1.15,
      tileable: true,
    },
  ]

  for (const shape of THEME_WORKSHOP_SHAPES) {
    const atlas = getThemeAtlasPaths(theme.id, shape, root)
    entries.push({
      label: `${theme.id}/${shape}`,
      inputPath: atlas.atlas,
      outputPath: atlas.normal,
      profile: 'ornament',
      strength: theme.material.normalScale * DICE_NORMAL_STRENGTH_PER_SCALE,
      blur: shape === 'd20' ? 0.9 : 1.15,
      tileable: false,
    })
  }

  return entries
}

export async function deriveThemeNormalMaps(options = {}) {
  const root = options.root ?? THEME_WORKSHOP_ROOT
  const themes = selectThemes(options.themes)
  const planned = themes.flatMap((theme) => planNormalMapEntries(theme, root))
  const runnable = []
  const skipped = []

  for (const entry of planned) {
    try {
      await access(entry.inputPath)
      runnable.push(entry)
    } catch {
      skipped.push(entry.label)
    }
  }

  await deriveNormalMaps(runnable)
  return { derived: runnable.map((entry) => entry.label), skipped, root }
}

function parseArgs(argv) {
  const options = { themes: [] }
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index]
    if (argument === '--theme') options.themes.push(argv[++index])
    else if (argument === '--out') options.root = argv[++index]
    else if (argument === '--help') options.help = true
    else throw new Error(`Unknown argument: ${argument}`)
  }
  return options
}

async function main() {
  const options = parseArgs(process.argv.slice(2))
  if (options.help) {
    console.log('Usage: node scripts/imagegen-uv/derive-theme-normal-maps.mjs [--theme ID] [--out DIR]')
    return
  }
  const result = await deriveThemeNormalMaps(options)
  if (result.derived.length === 0) {
    throw new Error(
      `No registered albedo inputs found under ${result.root}. `
      + 'Run the art pass and `npm run register:theme-atlases` first.',
    )
  }
  console.log(`Derived ${result.derived.length} tangent-space normal map(s): ${result.derived.join(', ')}`)
  if (result.skipped.length > 0) {
    console.log(`Skipped ${result.skipped.length} missing input(s): ${result.skipped.join(', ')}`)
  }
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
if (isMain) await main()
