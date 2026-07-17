#!/usr/bin/env node
import { access, mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import {
  getThemedDiceFaceNormals,
} from '../imagegen-uv/themed-dice-contract.mjs'
import {
  getThemeAtlasPaths,
  THEME_WORKSHOP,
  THEME_WORKSHOP_RELEASE_DATE,
  THEME_WORKSHOP_SHAPES,
} from '../imagegen-uv/theme-workshop-data.mjs'
import { createThemedPolyhedralGlb } from './themed-polyhedral-glb.mjs'

const DICE_ROOT = path.resolve('public/dice')
const TEMPLATE_ROOT = path.resolve('public/artist-resources/imagegen-uv/theme-sets/templates')

for (const theme of THEME_WORKSHOP) {
  const setDirectory = path.join(DICE_ROOT, theme.setId)
  await mkdir(setDirectory, { recursive: true })
  await writeJson(path.join(setDirectory, 'set.json'), {
    id: theme.setId,
    name: theme.name,
    artist: 'Codex ImageGen via Daisu UV Workflow',
    description: theme.description,
    releaseDate: THEME_WORKSHOP_RELEASE_DATE,
    tags: theme.tags,
    availability: 'always',
  })

  for (const shape of THEME_WORKSHOP_SHAPES) {
    const die = theme.dice[shape]
    const atlas = getThemeAtlasPaths(theme.id, shape)
    const manifestPath = path.join(TEMPLATE_ROOT, shape, `${shape}-mesh-uv-manifest.json`)
    await Promise.all([access(atlas.atlas), access(atlas.normal), access(manifestPath)])

    const dieDirectory = path.join(setDirectory, die.id)
    await mkdir(dieDirectory, { recursive: true })
    const model = await createThemedPolyhedralGlb({
      atlasPath: atlas.atlas,
      normalMapPath: atlas.normal,
      manifestPath,
      radius: shape === 'd6' ? 1 : 0.72,
      roughness: theme.material.roughness,
      metalness: theme.material.metalness,
      normalScale: theme.material.normalScale,
    })
    await writeFile(path.join(dieDirectory, 'model.glb'), model)
    await writeJson(path.join(dieDirectory, 'metadata.json'), {
      version: '1.0',
      diceType: shape,
      name: die.name,
      artist: 'Codex ImageGen via Daisu UV Workflow',
      created: THEME_WORKSHOP_RELEASE_DATE,
      scale: 1,
      rarity: shape === 'd20' ? 'epic' : shape === 'd12' || shape === 'd10' ? 'rare' : 'uncommon',
      description: `${die.name} belongs to ${theme.name}, with Codex ImageGen-authored face art and a derived tangent-space normal map.`,
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
      faceNormals: getThemedDiceFaceNormals(shape, shape === 'd6' ? 1 : 0.72),
      physics: theme.physics,
      colliderType: shape === 'd6' ? 'roundCuboid' : 'hull',
      colliderArgs: shape === 'd6'
        ? { halfExtents: [0.5, 0.5, 0.5], borderRadius: 0.06 }
        : {},
    })
  }
}

console.log(`Generated ${THEME_WORKSHOP.length} complete ImageGen dice sets (${THEME_WORKSHOP.length * THEME_WORKSHOP_SHAPES.length} GLB models)`)

async function writeJson(filePath, value) {
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8')
}
