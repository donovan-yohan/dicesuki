#!/usr/bin/env node
import { access } from 'node:fs/promises'
import {
  getEnvironmentTexturePaths,
  getThemeAtlasPaths,
  THEME_WORKSHOP,
  THEME_WORKSHOP_SHAPES,
} from './theme-workshop-data.mjs'
import { deriveNormalMaps } from './normal-map-utils.mjs'

const entries = []

for (const theme of THEME_WORKSHOP) {
  const environment = getEnvironmentTexturePaths(theme.id)
  entries.push(
    {
      inputPath: environment.floorAlbedo,
      outputPath: environment.floorNormal,
      profile: 'surface',
      strength: theme.id === 'dark-dungeon' ? 9 : 7,
      blur: 1.25,
      tileable: true,
    },
    {
      inputPath: environment.wallAlbedo,
      outputPath: environment.wallNormal,
      profile: 'surface',
      strength: theme.id === 'dark-dungeon' ? 10 : 7.5,
      blur: 1.15,
      tileable: true,
    },
  )

  for (const shape of THEME_WORKSHOP_SHAPES) {
    const atlas = getThemeAtlasPaths(theme.id, shape)
    entries.push({
      inputPath: atlas.atlas,
      outputPath: atlas.normal,
      profile: 'ornament',
      strength: theme.material.normalScale * 11,
      blur: shape === 'd20' ? 0.9 : 1.15,
      tileable: false,
    })
  }
}

for (const entry of entries) await access(entry.inputPath)
await deriveNormalMaps(entries)
console.log(`Derived ${entries.length} tangent-space normal maps from the final Codex ImageGen albedo assets`)
