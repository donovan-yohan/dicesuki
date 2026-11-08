import { describe, expect, it } from 'vitest'
import { BoxGeometry, Group, Mesh, MeshPhysicalMaterial, MeshStandardMaterial, MeshToonMaterial, ShaderLib } from 'three'
import { createManagedSculptedVisual } from './managedSculptedDice'
import type { GltfDiceAsset } from '../types/gltfDice'

const asset = (setId: string): GltfDiceAsset => ({ id: `${setId}/selected`, modelUrl: '/selected.glb', metadata: { setId, diceType: 'd10', scale: 1 } } as GltfDiceAsset)

describe('managed night lighting response', () => {
  it('keeps one dynamic profile suffix for shared woodland palette materials and restores the original wrapper key', () => {
    const source = new Group()
    const original = new MeshStandardMaterial()
    const geometry = new BoxGeometry()
    source.add(new Mesh(geometry, [original, original]), new Mesh(geometry, original))
    const owned = createManagedSculptedVisual(source, asset('woodland-sculpted-set'), true)
    const material = ((owned.scene.children[0] as Mesh).material as MeshToonMaterial[])[0]
    const originalKey = material.customProgramCacheKey()
    expect(originalKey.endsWith('-woodland-combined-cel-v1-palette-repair-0')).toBe(true)
    owned.setLightingResponse('night')
    expect(material.customProgramCacheKey()).toBe(`${originalKey}-night-v1`)
    owned.setLightingResponse('night')
    expect(material.customProgramCacheKey()).toBe(`${originalKey}-night-v1`)
    owned.setLightingResponse('original')
    expect(material.customProgramCacheKey()).toBe(originalKey)
    expect((owned.scene.children[1] as Mesh).material).toBe(material)
    owned.dispose()
  })

  it.each(['woodland-sculpted-set', 'monster-dungeon-set', 'cyberpunk-cutline-set'])('uses the requested room response for %s, not the selected family', setId => {
    const source = new Group()
    source.add(new Mesh(new BoxGeometry(), new MeshStandardMaterial()), new Mesh(new BoxGeometry(), new MeshPhysicalMaterial({ transmission: 0.8, ior: 1.38 })))
    const owned = createManagedSculptedVisual(source, asset(setId), true, [], 'night')
    const materials = owned.scene.children.map(child => (child as Mesh).material as MeshToonMaterial | MeshPhysicalMaterial)
    expect(materials.every(material => material.defines.MANAGED_CEL_NIGHT_RESPONSE === '')).toBe(true)
    expect(materials.every(material => material.customProgramCacheKey().endsWith('-night-v1'))).toBe(true)
    expect((materials[1] as MeshPhysicalMaterial).transmission).toBe(0.8)
    owned.setLightingResponse('original')
    expect(materials.every(material => material.defines.MANAGED_CEL_NIGHT_RESPONSE === undefined)).toBe(true)
    expect(materials.every(material => !material.customProgramCacheKey().endsWith('-night-v1'))).toBe(true)
    owned.setLightingResponse('night')
    expect(materials.every(material => material.customProgramCacheKey().endsWith('-night-v1'))).toBe(true)
    owned.dispose()
    owned.setLightingResponse('original')
    expect(materials.every(material => material.defines.MANAGED_CEL_NIGHT_RESPONSE === '')).toBe(true)
  })

  it('retains native physical refraction and additive authored emission after night diffuse bands', () => {
    const source = new Group()
    const original = new MeshPhysicalMaterial({ transmission: 0.8, ior: 1.38, emissive: '#123456', emissiveIntensity: 1.7 })
    source.add(new Mesh(new BoxGeometry(), original))
    const owned = createManagedSculptedVisual(source, asset('monster-dungeon-set'), true, [], 'night')
    const material = (owned.scene.children[0] as Mesh).material as MeshPhysicalMaterial
    const shader = { uniforms: {}, vertexShader: ShaderLib.physical.vertexShader, fragmentShader: ShaderLib.physical.fragmentShader }
    material.onBeforeCompile(shader as Parameters<MeshPhysicalMaterial['onBeforeCompile']>[0], {} as never)
    expect(shader.fragmentShader.indexOf('woodlandCelBands(totalDiffuse)')).toBeLessThan(shader.fragmentShader.indexOf('#include <transmission_fragment>'))
    expect(shader.fragmentShader).toContain('vec3 outgoingLight = totalDiffuse + totalSpecular + totalEmissiveRadiance;')
    expect(material.emissive.equals(original.emissive)).toBe(true)
    expect(material.emissiveIntensity).toBe(1.7)
    owned.dispose()
  })

  it.each([false, true])('does not adapt unmanaged assets when cel=%s', cel => {
    const source = new Group()
    const original = new MeshStandardMaterial()
    source.add(new Mesh(new BoxGeometry(), original))
    const owned = createManagedSculptedVisual(source, asset('personal-custom-set'), cel, [], 'night')
    const material = (owned.scene.children[0] as Mesh).material as MeshStandardMaterial
    expect(material).toBeInstanceOf(MeshStandardMaterial)
    owned.setLightingResponse('night')
    expect(material.defines.MANAGED_CEL_NIGHT_RESPONSE).toBeUndefined()
    owned.dispose()
  })
})
