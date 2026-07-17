import { describe, expect, it } from 'vitest'
import * as THREE from 'three'
import type { DiceFace } from './geometries'
import {
  validateProductionDiceModelFace,
  type CanonicalDiceUvManifest,
} from './productionDiceModelValidation'

const FACES: DiceFace[] = [
  { value: 1, normal: new THREE.Vector3(0, 0, 1) },
  { value: 2, normal: new THREE.Vector3(1, 0, 0) },
]
const D10_FACES: DiceFace[] = [
  { value: 0, normal: new THREE.Vector3(0, 0, 1) },
  { value: 1, normal: new THREE.Vector3(1, 0, 0) },
]

describe('validateProductionDiceModelFace', () => {
  it('matches the requested metadata face to an actual UV-mapped model triangle', () => {
    const scene = createTriangleScene(true)
    const result = validateProductionDiceModelFace(scene, 'd6', FACES[0], FACES, triangleManifest())

    expect(result.matchedValue).toBe(1)
    expect(result.alignment).toBeCloseTo(1)
    expect(result.uvTriangleCount).toBe(1)
    expect(result.materialIndex).toBe(0)
    expect(result.modelNormal.toArray()).toEqual([0, 0, 1])
  })

  it('fails closed when the matching geometry has no usable UVs', () => {
    expect(() => validateProductionDiceModelFace(createTriangleScene(false), 'd6', FACES[0], FACES, triangleManifest()))
      .toThrow('no non-degenerate UV-mapped triangles')
  })

  it('fails closed when the requested metadata normal is absent from the model', () => {
    expect(() => validateProductionDiceModelFace(createTriangleScene(true), 'd6', FACES[1], FACES, triangleManifest()))
      .toThrow('no UV-mapped face matching requested face 2')
  })

  it('validates both triangles in a canonical D10 kite island', () => {
    const result = validateProductionDiceModelFace(
      createKiteScene(),
      'd10',
      D10_FACES[0],
      D10_FACES,
      kiteManifest(),
    )

    expect(result.uvTriangleCount).toBe(2)
    expect(result.materialIndex).toBe(0)
  })

  it('fails when the model face uses a permuted canonical UV island', () => {
    const permuted = triangleManifest()
    permuted.islands[0].uvByVertex = [
      { u: 0.5, v: 0.5 },
      { u: 0.75, v: 0.5 },
      { u: 0.5, v: 0.75 },
    ]

    expect(() => validateProductionDiceModelFace(createTriangleScene(true), 'd6', FACES[0], FACES, permuted))
      .toThrow('does not match canonical material island 0')
  })

  it('fails when the model face is assigned to a permuted canonical triangle group', () => {
    const permuted = triangleManifest()
    permuted.islands[0].triangleIndices = [1]

    expect(() => validateProductionDiceModelFace(createTriangleScene(true), 'd6', FACES[0], FACES, permuted))
      .toThrow('Canonical material island 0 has inconsistent triangle indices')
  })
})

function createTriangleScene(withUvs: boolean): THREE.Scene {
  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.Float32BufferAttribute([
    0, 0, 0,
    1, 0, 0,
    0, 1, 0,
  ], 3))
  if (withUvs) {
    geometry.setAttribute('uv', new THREE.Float32BufferAttribute([
      0, 0,
      1, 0,
      0, 1,
    ], 2))
  }
  const scene = new THREE.Scene()
  scene.add(new THREE.Mesh(geometry, new THREE.MeshBasicMaterial()))
  return scene
}

function createKiteScene(): THREE.Scene {
  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.Float32BufferAttribute([
    0, 0, 0, 1, 0, 0, 1, 1, 0,
    0, 0, 0, 1, 1, 0, 0, 1, 0,
  ], 3))
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute([
    0, 0, 1, 0, 1, 1,
    0, 0, 1, 1, 0, 1,
  ], 2))
  const scene = new THREE.Scene()
  scene.add(new THREE.Mesh(geometry, new THREE.MeshBasicMaterial()))
  return scene
}

function triangleManifest(): CanonicalDiceUvManifest {
  return {
    shape: 'd6',
    islands: [
      {
        faceValue: 1,
        materialIndex: 0,
        triangleIndices: [0],
        uvByVertex: [
          { u: 0, v: 0 },
          { u: 1, v: 0 },
          { u: 0, v: 1 },
        ],
      },
      {
        faceValue: 2,
        materialIndex: 1,
        triangleIndices: [1],
        uvByVertex: [
          { u: 0.5, v: 0.5 },
          { u: 0.75, v: 0.5 },
          { u: 0.5, v: 0.75 },
        ],
      },
    ],
  }
}

function kiteManifest(): CanonicalDiceUvManifest {
  return {
    shape: 'd10',
    islands: [
      {
        faceValue: 1,
        materialIndex: 8,
        triangleIndices: [16, 17],
        uvByVertex: [
          { u: 0.2, v: 0.2 },
          { u: 0.3, v: 0.2 },
          { u: 0.2, v: 0.3 },
        ],
      },
      {
        faceValue: 0,
        materialIndex: 0,
        triangleIndices: [0, 1],
        uvByTriangle: [
          [{ u: 0, v: 0 }, { u: 1, v: 0 }, { u: 1, v: 1 }],
          [{ u: 0, v: 0 }, { u: 1, v: 1 }, { u: 0, v: 1 }],
        ],
      },
    ],
  }
}
