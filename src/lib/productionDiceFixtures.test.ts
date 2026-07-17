import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import * as THREE from 'three'
import {
  D6_FACE_NORMALS,
  D20_FACE_NORMALS,
  getDiceFaceValue,
  type DiceFace,
  type DiceShape,
} from './geometries'
import type { DiceMetadata } from '../types/customDice'

const FIXTURE_DICE = [
  ['fantasy-set', 'emerald-d20'],
  ['fantasy-set', 'aurelian-imagegen-d20'],
  ['fantasy-set', 'rune-d6'],
  ['dungeon-set', 'stone-d20'],
  ['dungeon-set', 'iron-d6'],
] as const

const IMAGEGEN_THEME_DICE = [
  ['cozy-forest-imagegen-set', 'mossheart-d4'],
  ['cozy-forest-imagegen-set', 'hearthwood-d6'],
  ['cozy-forest-imagegen-set', 'fernlight-d8'],
  ['cozy-forest-imagegen-set', 'acorn-compass-d10'],
  ['cozy-forest-imagegen-set', 'grovekeeper-d12'],
  ['cozy-forest-imagegen-set', 'elder-canopy-d20'],
  ['dark-dungeon-imagegen-set', 'cinder-spike-d4'],
  ['dark-dungeon-imagegen-set', 'iron-vault-d6'],
  ['dark-dungeon-imagegen-set', 'obsidian-fang-d8'],
  ['dark-dungeon-imagegen-set', 'gaoler-key-d10'],
  ['dark-dungeon-imagegen-set', 'crypt-seal-d12'],
  ['dark-dungeon-imagegen-set', 'dread-gate-d20'],
  ['cyberpunk-imagegen-set', 'pulse-shard-d4'],
  ['cyberpunk-imagegen-set', 'neon-grid-d6'],
  ['cyberpunk-imagegen-set', 'volt-prism-d8'],
  ['cyberpunk-imagegen-set', 'cipher-core-d10'],
  ['cyberpunk-imagegen-set', 'chrome-relay-d12'],
  ['cyberpunk-imagegen-set', 'overdrive-d20'],
] as const

const FACE_COUNTS: Record<DiceShape, number> = {
  d4: 4,
  d6: 6,
  d8: 8,
  d10: 10,
  d12: 12,
  d20: 20,
}

const GLB_VERTEX_COUNTS: Record<DiceShape, number> = {
  d4: 12,
  d6: 36,
  d8: 24,
  d10: 60,
  d12: 108,
  d20: 60,
}

const CANONICAL_FACE_NORMALS: Partial<Record<DiceShape, DiceFace[]>> = {
  d6: D6_FACE_NORMALS,
  d20: D20_FACE_NORMALS,
}

describe('production dice fixtures', () => {
  it.each(FIXTURE_DICE)('%s/%s metadata matches canonical face reading order', (setId, diceId) => {
    const metadata = readFixtureMetadata(setId, diceId)
    const canonicalFaces = CANONICAL_FACE_NORMALS[metadata.diceType]
    expect(canonicalFaces, `${metadata.diceType} canonical faces`).toBeDefined()
    expect(metadata.faceNormals).toHaveLength(canonicalFaces!.length)

    const customFaces = metadata.faceNormals.map((face) => ({
      value: face.value,
      normal: new THREE.Vector3(...face.normal),
    }))

    for (let index = 0; index < canonicalFaces!.length; index++) {
      const expected = canonicalFaces![index]
      const actual = customFaces[index]

      expect(actual.value).toBe(expected.value)
      expect(actual.normal.x).toBeCloseTo(expected.normal.x, 4)
      expect(actual.normal.y).toBeCloseTo(expected.normal.y, 4)
      expect(actual.normal.z).toBeCloseTo(expected.normal.z, 4)

      const quaternion = new THREE.Quaternion().setFromUnitVectors(
        actual.normal.clone().normalize(),
        new THREE.Vector3(0, 1, 0),
      )

      expect(getDiceFaceValue(quaternion, metadata.diceType, customFaces)).toBe(actual.value)
    }
  })

  it('embeds the Codex ImageGen albedo and derived normal map in the Aurelian D20 GLB', () => {
    const glbPath = path.join(process.cwd(), 'public', 'dice', 'fantasy-set', 'aurelian-imagegen-d20', 'model.glb')
    const glb = readFileSync(glbPath)
    expect(glb.readUInt32LE(0)).toBe(0x46546c67)
    expect(glb.readUInt32LE(4)).toBe(2)

    const jsonLength = glb.readUInt32LE(12)
    const json = JSON.parse(glb.subarray(20, 20 + jsonLength).toString('utf8').trim()) as ImageGenGlbJson
    expect(json.asset.generator).toBe('Daisu canonical D20 ImageGen atlas pipeline')
    expect(json.images.map((image) => image.name)).toEqual([
      'codex_imagegen_albedo',
      'derived_relief_normal',
    ])
    expect(json.textures).toHaveLength(2)
    expect(json.materials[0].normalTexture?.index).toBe(1)
    expect(json.meshes[0].primitives[0].attributes.TEXCOORD_0).toBe(2)
    expect(json.accessors[2]).toMatchObject({ count: 60, type: 'VEC2' })
  })

  it.each(IMAGEGEN_THEME_DICE)('%s/%s embeds both generated maps and round-trips every face normal', (setId, diceId) => {
    const metadata = readFixtureMetadata(setId, diceId)
    const expectedValues = metadata.diceType === 'd10'
      ? Array.from({ length: 10 }, (_, value) => value)
      : Array.from({ length: FACE_COUNTS[metadata.diceType] }, (_, index) => index + 1)
    expect(metadata.faceNormals).toHaveLength(FACE_COUNTS[metadata.diceType])
    expect(metadata.faceNormals.map((face) => face.value).sort((a, b) => a - b)).toEqual(expectedValues)

    const customFaces = metadata.faceNormals.map((face) => ({
      value: face.value,
      normal: new THREE.Vector3(...face.normal),
    }))
    const readingTarget = metadata.diceType === 'd4'
      ? new THREE.Vector3(0, -1, 0)
      : new THREE.Vector3(0, 1, 0)

    for (const face of customFaces) {
      expect(face.normal.length()).toBeCloseTo(1, 4)
      const quaternion = new THREE.Quaternion().setFromUnitVectors(
        face.normal.clone().normalize(),
        readingTarget,
      )
      expect(getDiceFaceValue(quaternion, metadata.diceType, customFaces)).toBe(face.value)
    }

    const glbPath = path.join(process.cwd(), 'public', 'dice', setId, diceId, 'model.glb')
    const glb = readFileSync(glbPath)
    const jsonLength = glb.readUInt32LE(12)
    const json = JSON.parse(glb.subarray(20, 20 + jsonLength).toString('utf8').trim()) as ImageGenGlbJson
    expect(json.asset.generator).toBe('Daisu generalized themed polyhedral GLB builder')
    expect(json.images.map((image) => image.name)).toEqual([
      'themed_dice_albedo_atlas',
      'themed_dice_normal_map',
    ])
    expect(json.materials[0].normalTexture?.index).toBe(1)
    expect(json.meshes[0].primitives[0].attributes.TEXCOORD_0).toBe(2)
    expect(json.accessors[2]).toMatchObject({
      count: GLB_VERTEX_COUNTS[metadata.diceType],
      type: 'VEC2',
    })
  })
})

interface ImageGenGlbJson {
  asset: { generator: string }
  images: Array<{ name: string }>
  textures: unknown[]
  materials: Array<{ normalTexture?: { index: number } }>
  meshes: Array<{ primitives: Array<{ attributes: { TEXCOORD_0: number } }> }>
  accessors: Array<{ count: number; type: string }>
}

function readFixtureMetadata(setId: string, diceId: string): DiceMetadata {
  const metadataPath = path.join(process.cwd(), 'public', 'dice', setId, diceId, 'metadata.json')
  return JSON.parse(readFileSync(metadataPath, 'utf8')) as DiceMetadata
}
