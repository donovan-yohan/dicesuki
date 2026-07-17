import { describe, expect, it } from 'vitest'
import * as THREE from 'three'
import { collectConvexHullVertices } from './customDiceCollider'

describe('collectConvexHullVertices', () => {
  it('includes nested mesh transforms and the custom-die visual scale', () => {
    const scene = new THREE.Group()
    const parent = new THREE.Group()
    parent.position.set(2, 3, 4)
    const mesh = new THREE.Mesh(new THREE.BufferGeometry())
    mesh.geometry.setAttribute('position', new THREE.Float32BufferAttribute([
      0, 0, 0,
      1, 0, 0,
      0, 1, 0,
      0, 0, 1,
    ], 3))
    parent.add(mesh)
    scene.add(parent)

    expect(Array.from(collectConvexHullVertices(scene, 0.5))).toEqual([
      1, 1.5, 2,
      1.5, 1.5, 2,
      1, 2, 2,
      1, 1.5, 2.5,
    ])
  })
})
