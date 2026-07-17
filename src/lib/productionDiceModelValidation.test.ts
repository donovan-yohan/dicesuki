import { describe, expect, it } from 'vitest'
import * as THREE from 'three'
import type { DiceFace } from './geometries'
import { validateProductionDiceModelFace } from './productionDiceModelValidation'

const FACES: DiceFace[] = [
  { value: 1, normal: new THREE.Vector3(0, 0, 1) },
  { value: 2, normal: new THREE.Vector3(1, 0, 0) },
]

describe('validateProductionDiceModelFace', () => {
  it('matches the requested metadata face to an actual UV-mapped model triangle', () => {
    const scene = createTriangleScene(true)
    const result = validateProductionDiceModelFace(scene, FACES[0], FACES)

    expect(result.matchedValue).toBe(1)
    expect(result.alignment).toBeCloseTo(1)
    expect(result.uvTriangleCount).toBe(1)
    expect(result.modelNormal.toArray()).toEqual([0, 0, 1])
  })

  it('fails closed when the matching geometry has no usable UVs', () => {
    expect(() => validateProductionDiceModelFace(createTriangleScene(false), FACES[0], FACES))
      .toThrow('no non-degenerate UV-mapped triangles')
  })

  it('fails closed when the requested metadata normal is absent from the model', () => {
    expect(() => validateProductionDiceModelFace(createTriangleScene(true), FACES[1], FACES))
      .toThrow('no UV-mapped face matching requested face 2')
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
