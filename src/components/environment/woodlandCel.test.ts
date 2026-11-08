import { describe, expect, it, vi } from 'vitest'
import { BufferAttribute, BufferGeometry, DataTexture, Mesh, MeshToonMaterial, Points, ShaderLib, ShaderMaterial } from 'three'
import { createWoodlandResources } from './woodlandGeometry'
import { sunlitGladeCelTheme, sunlitGladeTheme } from '../../themes/woodland'
import { resolveEnvironmentQuality, type WoodlandRecipe } from '../../lib/environmentQuality'

const quality = resolveEnvironmentQuality({ deviceTier: 'high', compactViewport: false, coarsePointer: false, reducedMotion: false })
const options = { recipe: sunlitGladeCelTheme.environment.scene! as WoodlandRecipe, quality, arenaHalfX: 3, arenaHalfZ: 5 }

describe('cel-lit woodland', () => {
  it('quantizes combined direct and indirect illumination once after cloud shade and root occlusion', () => {
    const resources = createWoodlandResources(options)
    const ground = resources.root.getObjectByName('woodland-ground') as Mesh<never, MeshToonMaterial>
    const shader = { uniforms: {}, vertexShader: ShaderLib.toon.vertexShader, fragmentShader: ShaderLib.toon.fragmentShader } as Parameters<MeshToonMaterial['onBeforeCompile']>[0]
    ground.material.onBeforeCompile(shader, {} as never)
    expect(ground.material.userData.woodlandCombinedCel).toBe(true)
    expect(ground.material.gradientMap).toBeNull()
    expect(shader.fragmentShader).toContain('material.diffuseColor = vec3( 1.0 )')
    expect(shader.fragmentShader).toContain('woodlandCelBands')
    expect(shader.fragmentShader.indexOf('vec3 outgoingLight =')).toBeGreaterThan(shader.fragmentShader.indexOf('#include <aomap_fragment>'))
    expect(shader.fragmentShader.indexOf('vec3 outgoingLight =')).toBeGreaterThan(shader.fragmentShader.indexOf('reflectedLight.directDiffuse *= woodlandCloud'))
    expect(shader.fragmentShader).toContain('woodlandGroundOcclusion')
    expect(shader.fragmentShader).not.toContain('shortGrass * (0.92 + field.r * 0.16) * (1.0 - field.b * 0.12)')
    resources.dispose()
  })

  it('frames the clearing with an elevated canopy casting actual shadows without a pick target', () => {
    const resources = createWoodlandResources(options)
    const canopy = resources.root.getObjectByName('woodland-canopy') as Mesh<BufferGeometry, MeshToonMaterial>
    expect(canopy).toBeDefined()
    expect(canopy.material).toBeInstanceOf(MeshToonMaterial)
    expect(canopy.castShadow).toBe(true)
    expect(canopy.receiveShadow).toBe(true)
    expect(canopy.geometry.boundingBox!.min.y).toBeGreaterThan(1)
    const hits: never[] = []
    canopy.raycast({} as never, hits)
    expect(hits).toEqual([])
    const disposed = vi.spyOn(canopy.geometry, 'dispose')
    resources.dispose()
    resources.dispose()
    expect(disposed).toHaveBeenCalledOnce()
  })

  it('shares restrained moving cloud shade between ground and grass without repainting their maps', () => {
    const resources = createWoodlandResources(options)
    const grass = resources.root.getObjectByName('woodland-grass') as Mesh<never, MeshToonMaterial & { uniforms: Record<string, { value: unknown }> }>
    const ground = resources.root.getObjectByName('woodland-ground') as Mesh<never, MeshToonMaterial>
    for (const material of [ground.material, grass.material]) {
      const shader = { uniforms: {}, vertexShader: ShaderLib.toon.vertexShader, fragmentShader: ShaderLib.toon.fragmentShader } as Parameters<MeshToonMaterial['onBeforeCompile']>[0]
      material.onBeforeCompile(shader, {} as never)
      expect(shader.uniforms.uCloudTime).toBe(grass.material.uniforms.uTime)
      expect(shader.uniforms.uCloudNoise.value).toBe(grass.material.uniforms.uWindNoise.value)
      expect(shader.fragmentShader).toContain('reflectedLight.directDiffuse *= woodlandCloud')
      expect(shader.fragmentShader).toContain('#include <shadowmap_pars_fragment>')
      expect(shader.fragmentShader).not.toContain('diffuseColor.rgb *= woodlandCloud')
    }
    resources.dispose()
  })

  it('bands lighting on every opaque environment batch without replacing geometry or painted albedo', () => {
    const cel = createWoodlandResources(options)
    const smooth = createWoodlandResources({ ...options, recipe: sunlitGladeTheme.environment.scene! as WoodlandRecipe })
    const textureDisposals = vi.spyOn(DataTexture.prototype, 'dispose')
    const materials = new Set<MeshToonMaterial>()
    cel.root.traverse(object => {
      if (!(object instanceof Mesh) || object.name.startsWith('woodland-shaft-')) return
      expect(object.material, object.name).toBeInstanceOf(MeshToonMaterial)
      const material = object.material as MeshToonMaterial
      expect(material.gradientMap).toBeNull()
      expect(material.userData.woodlandCombinedCel).toBe(true)
      materials.add(material)
      const shader = { uniforms: {}, vertexShader: ShaderLib.toon.vertexShader, fragmentShader: ShaderLib.toon.fragmentShader } as Parameters<MeshToonMaterial['onBeforeCompile']>[0]
      material.onBeforeCompile(shader, {} as never)
      expect(shader.fragmentShader).toContain('woodlandCelBands(woodlandCelIllumination)')
      expect(shader.fragmentShader).toContain('#include <shadowmap_pars_fragment>')
      if (object.name === 'woodland-wildflowers') {
        expect(shader.vertexShader).toContain('uForestTime')
        expect(material.customProgramCacheKey()).toContain('forest-flowers-pinned-sway-v1')
      }
      const original = smooth.root.getObjectByName(object.name) as Mesh
      if (original && !['woodland-ground','woodland-canopy'].includes(object.name)) {
        expect(object.geometry.getAttribute('position').array).toEqual(original.geometry.getAttribute('position').array)
        expect(object.receiveShadow).toBe(original.receiveShadow)
      }
      expect(material.transparent).toBe(false)
    })
    expect(materials.size).toBeGreaterThan(5)
    for (const name of ['woodland-grass', 'woodland-ground']) {
      const material = (cel.root.getObjectByName(name) as Mesh<never, MeshToonMaterial>).material
      expect(material.map).toBeInstanceOf(DataTexture)
      const shader = { uniforms: {}, vertexShader: ShaderLib.toon.vertexShader, fragmentShader: ShaderLib.toon.fragmentShader } as Parameters<MeshToonMaterial['onBeforeCompile']>[0]
      material.onBeforeCompile(shader, {} as never)
      expect(shader.fragmentShader).toContain('#include <lights_toon_pars_fragment>')
      expect(shader.fragmentShader).toContain('#include <lights_fragment_begin>')
      expect(shader.fragmentShader).toContain('#include <map_fragment>')
      if (name === 'woodland-grass') {
        expect(shader.uniforms.uTime).toBeDefined()
        expect(shader.vertexShader).toContain('dot(woodlandBend, objectNormal.xz)')
        expect(shader.fragmentShader).toContain('step(0.18, vHeight)')
        expect(shader.fragmentShader).not.toContain('smoothstep(0.38, 1.0, vHeight)')
      }
    }
    cel.dispose()
    cel.dispose()
    smooth.dispose()
    expect(textureDisposals.mock.contexts.filter(texture => (texture as DataTexture).image.width === 8)).toHaveLength(1)
    textureDisposals.mockRestore()
  })

  it('carries bounded pollen and airy seed tufts across the clearing on the shared reduced-motion clock', () => {
    const resources = createWoodlandResources(options)
    const motes = resources.root.getObjectByName('woodland-motes') as Points<BufferGeometry, ShaderMaterial>
    expect(motes.geometry.getAttribute('aKind')).toBeDefined()
    const kinds = motes.geometry.getAttribute('aKind')
    expect(kinds.count).toBe(38)
    expect(new Set(kinds.array)).toEqual(new Set([0]))
    expect(motes.material.vertexShader).toContain('mod(')
    expect(motes.material.vertexShader).toContain('uFieldHalf')
    expect(motes.material.fragmentShader).toContain('vKind')
    const grass = resources.root.getObjectByName('woodland-grass') as Mesh<never, ShaderMaterial>
    expect(motes.material.uniforms.uTime).toBe(grass.material.uniforms.uTime)
    const positions = motes.geometry.getAttribute('position') as BufferAttribute
    const version = positions.version
    resources.update(0.1, true)
    const time = motes.material.uniforms.uTime.value
    expect(time).toBeCloseTo(0.1)
    resources.update(0.1, false)
    expect(motes.material.uniforms.uTime.value).toBe(time)
    expect(positions.version).toBe(version)
    expect(motes.material.depthWrite).toBe(false)
    expect(motes.material.depthTest).toBe(true)
    resources.dispose()
  })
})
