import { describe, expect, it, vi } from 'vitest'
import { createDungeonEnvironment } from './dungeonEnvironment'
import { Mesh, TextureLoader, MeshToonMaterial, type WebGLProgramParametersWithUniforms, type WebGLRenderer } from 'three'
import { resolveEnvironmentQuality } from '../../lib/environmentQuality'
import * as floor from './dungeonFloor'

describe('original dungeon flagstone field', () => {
  it('uses the original field in the native world, with receive-only shadows, no raycasts and once-only disposal', () => {
    const loader = vi.spyOn(TextureLoader.prototype, 'loadAsync').mockImplementation(() => new Promise(() => {}))
    const quality = resolveEnvironmentQuality({ deviceTier: 'mid', compactViewport: false, coarsePointer: false, reducedMotion: true })
    const world = createDungeonEnvironment({ quality, arenaHalfX: 4, arenaHalfZ: 7, groundY: -.5, seed: 391 })
    try {
      const mesh = world.root.getObjectByName('2565 continuous worn flagstones') as Mesh
      expect(mesh.geometry.userData.recipe).toBe('hand-cut-crypt-v1')
      expect(mesh.receiveShadow).toBe(true)
      expect(mesh.castShadow).toBe(false)
      const hits: never[] = []; mesh.raycast({} as never, hits)
      expect(hits).toEqual([])
      const disposeGeometry = vi.spyOn(mesh.geometry, 'dispose')
      const disposeMaterial = vi.spyOn(mesh.material as MeshToonMaterial, 'dispose')
      world.dispose(); world.dispose()
      expect(disposeGeometry).toHaveBeenCalledTimes(1)
      expect(disposeMaterial).toHaveBeenCalledTimes(1)
    } finally { world.dispose(); loader.mockRestore() }
  })

  it('builds deterministic uniquely chipped slabs with offscreen coverage in one bounded geometry', () => {
    expect(floor).toHaveProperty('createDungeonFloorGeometry')
    const a = floor.createDungeonFloorGeometry(391)
    const b = floor.createDungeonFloorGeometry(391)
    expect(Array.from(a.attributes.position.array)).toEqual(Array.from(b.attributes.position.array))
    expect(a.userData.stoneCount).toBe(2565)
    expect(a.userData.widthRange[1] / a.userData.widthRange[0]).toBeGreaterThan(2)
    expect(a.userData.depthRange[1] / a.userData.depthRange[0]).toBeGreaterThan(1.6)
    expect(a.attributes.position.count).toBeLessThan(70000)
    expect(a.boundingBox!.min.x).toBeLessThan(-27)
    expect(a.boundingBox!.max.x).toBeGreaterThan(27)
    expect(a.boundingBox!.min.z).toBeLessThan(-27)
    expect(a.boundingBox!.max.z).toBeGreaterThan(27)
    const identities = new Set<number>()
    const stone = a.getAttribute('aStone')
    for (let i = 0; i < stone.count; i++) identities.add(stone.getZ(i))
    expect(identities.size).toBe(2565)
    a.dispose(); b.dispose()
  })

  it('chains native cel/shadow shading with nonperiodic wear, damp fields and stone-specific fractures', () => {
    expect(floor).toHaveProperty('attachDungeonFloorSurface')
    const material = new MeshToonMaterial()
    let inherited = false
    material.onBeforeCompile = () => { inherited = true }
    floor.attachDungeonFloorSurface(material)
    const shader = { vertexShader: '#include <common>\n#include <begin_vertex>', fragmentShader: '#include <common>\n#include <map_fragment>', uniforms: {} }
    material.onBeforeCompile(shader as WebGLProgramParametersWithUniforms, {} as WebGLRenderer)
    expect(inherited).toBe(true)
    expect(shader.fragmentShader).toContain('dungeonStoneNoise')
    expect(shader.fragmentShader).toContain('fwidth')
    expect(shader.fragmentShader).toContain('floorFracture')
    expect(material.vertexColors).toBe(true)
    material.dispose()
  })
})
