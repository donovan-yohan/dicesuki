import { describe, expect, it, vi } from 'vitest'
import { BoxGeometry, Color, DoubleSide, Float32BufferAttribute, Group, Mesh, MeshStandardMaterial, MeshToonMaterial, ObjectSpaceNormalMap, ShaderChunk, ShaderLib, Texture } from 'three'
import { attachCombinedCel, createCelPreviewScene } from './woodlandCelMaterial'

function compile(material: MeshToonMaterial) {
  const shader = { uniforms: {}, vertexShader: ShaderLib.toon.vertexShader, fragmentShader: ShaderLib.toon.fragmentShader } as Parameters<MeshToonMaterial['onBeforeCompile']>[0]
  material.onBeforeCompile(shader, {} as never)
  return shader
}

describe('combined woodland cel materials', () => {
  it('keeps four crisp pastel daytime values without near-black shadow bands', () => {
    const material = new MeshToonMaterial()
    attachCombinedCel(material)
    const { fragmentShader } = compile(material)
    expect(fragmentShader).toContain('vec3(0.56, 0.65, 0.61)')
    expect(fragmentShader).toContain('vec3(0.70, 0.77, 0.70)')
    expect(fragmentShader).toContain('vec3(0.88, 0.90, 0.80)')
    expect(fragmentShader).toContain('mix(band, vec3(1.0, 0.98, 0.90), woodlandCelEdge(light, 0.76, width, ordered))')
    for (const threshold of ['0.09', '0.38', '0.76']) {
      expect(fragmentShader).toContain(`woodlandCelEdge(light, ${threshold}, width, ordered)`)
    }
    expect(fragmentShader).toContain('/ 0.80714')
    expect(fragmentShader).toContain('diffuseColor.rgb * woodlandCelBands(woodlandCelIllumination)')
    material.dispose()
  })

  it('composes hooks once without global chunks, albedo-dependent light or per-light bands', () => {
    const chunks = { ...ShaderChunk }
    const material = new MeshToonMaterial()
    const prior = vi.fn((shader: Parameters<MeshToonMaterial['onBeforeCompile']>[0]) => {
      shader.uniforms.previous = { value: 1 }
      shader.vertexShader = `// preserved deformation\n${shader.vertexShader}`
    })
    material.onBeforeCompile = prior
    material.customProgramCacheKey = () => 'caller-v2'
    attachCombinedCel(material)
    attachCombinedCel(material)
    const shader = compile(material)
    expect(prior).toHaveBeenCalledOnce()
    expect(shader.uniforms.previous.value).toBe(1)
    expect(shader.vertexShader).toContain('// preserved deformation')
    expect(material.customProgramCacheKey()).toBe('caller-v2-woodland-combined-cel-v1')
    expect(material.dithering).toBe(false)
    expect((material as MeshToonMaterial & { extensions: { derivatives: boolean } }).extensions.derivatives).toBe(true)
    expect(shader.fragmentShader).toContain('max(dot(normal, lightDirection), 0.0)')
    expect(shader.fragmentShader).toContain('material.diffuseColor = vec3( 1.0 )')
    expect(shader.fragmentShader).toContain('diffuseColor.rgb * woodlandCelBands(woodlandCelIllumination) + totalEmissiveRadiance')
    expect(shader.fragmentShader).not.toContain('#include <gradientmap_pars_fragment>')
    expect(shader.fragmentShader).not.toContain('#include <lights_toon_fragment>')
    expect(shader.fragmentShader).toContain('#include <shadowmap_pars_fragment>')
    expect(ShaderChunk).toEqual(chunks)
  })

  it('guards derivative AA and keeps deterministic ordered coverage inside a narrow boundary', () => {
    const material = new MeshToonMaterial()
    attachCombinedCel(material)
    const { fragmentShader } = compile(material)
    expect(fragmentShader).toContain('#if defined(GL_OES_standard_derivatives) || __VERSION__ >= 300')
    expect(fragmentShader).toContain('width = min(fwidth(light), 0.015)')
    expect(fragmentShader).toContain('if (width <= 0.0) return step(threshold, light)')
    expect(fragmentShader).toContain('woodlandCelBayer(gl_FragCoord.xy)')
    expect(fragmentShader).not.toMatch(/uTime|random\(|sin\(/)
    const ranks = Array.from({ length: 16 }, (_, i) => {
      const x = i % 4, y = Math.floor(i / 4)
      return ((x % 2 * 2 + y % 2 * 3) % 4) * 4 + (Math.floor(x / 2) * 2 + Math.floor(y / 2) * 3) % 4
    })
    expect([...ranks].sort((a, b) => a - b)).toEqual(Array.from({ length: 16 }, (_, i) => i))
  })

  it('owns cached replacements and preserves arrays, albedo, maps and render settings without mutating sources', () => {
    const source = new Group()
    const geometry = new BoxGeometry()
    const maps = Array.from({ length: 5 }, () => new Texture())
    const original = new MeshStandardMaterial({
      color: new Color('#74653f'), map: maps[0], normalMap: maps[1], aoMap: maps[2], lightMap: maps[3], emissiveMap: maps[4],
      emissive: '#123456', emissiveIntensity: 0.7, aoMapIntensity: 0.8, lightMapIntensity: 0.9,
      side: DoubleSide, depthWrite: false, depthTest: false, opacity: 0.6, transparent: true, vertexColors: true,
      normalMapType: ObjectSpaceNormalMap,
    })
    original.normalScale.set(0.4, 0.8)
    source.add(new Mesh(geometry, [original, original]), new Mesh(geometry, original))
    const originalDispose = vi.spyOn(original, 'dispose')
    const geometryDispose = vi.spyOn(geometry, 'dispose')
    const textureDispose = maps.map(texture => vi.spyOn(texture, 'dispose'))
    const preview = createCelPreviewScene(source)
    const materialArray = (preview.scene.children[0] as Mesh).material as MeshToonMaterial[]
    const replacement = materialArray[0]
    expect(replacement).toBeInstanceOf(MeshToonMaterial)
    expect(replacement).not.toBe(original)
    expect(materialArray[1]).toBe(replacement)
    expect((preview.scene.children[1] as Mesh).material).toBe(replacement)
    expect((preview.scene.children[0] as Mesh).geometry).toBe(geometry)
    for (const key of ['color', 'emissive', 'normalScale', 'map', 'normalMap', 'normalMapType', 'aoMap', 'aoMapIntensity', 'lightMap', 'lightMapIntensity', 'emissiveMap', 'emissiveIntensity', 'side', 'depthWrite', 'depthTest', 'opacity', 'transparent', 'vertexColors'] as const) {
      expect(replacement[key], key).toEqual(original[key])
    }
    expect((source.children[0] as Mesh).material).toEqual([original, original])
    expect(original.userData).toEqual({})
    const disposed = vi.spyOn(replacement, 'dispose')
    preview.dispose()
    preview.dispose()
    expect(disposed).toHaveBeenCalledOnce()
    expect(originalDispose).not.toHaveBeenCalled()
    expect(geometryDispose).not.toHaveBeenCalled()
    textureDispose.forEach(spy => expect(spy).not.toHaveBeenCalled())
    original.dispose()
    geometry.dispose()
    maps.forEach(texture => texture.dispose())
  })

  it('selects occlusion per geometry and attenuates only indirect illumination before bands', () => {
    const source = new Group()
    const original = new MeshStandardMaterial()
    const geometry = new BoxGeometry()
    const occluded = geometry.clone()
    occluded.setAttribute('_cel_occlusion', new Float32BufferAttribute(new Float32Array(occluded.getAttribute('position').count).fill(0.4), 1))
    source.add(new Mesh(geometry, original), new Mesh(occluded, original), new Mesh(occluded, original))
    const preview = createCelPreviewScene(source)
    const plain = (preview.scene.children[0] as Mesh).material as MeshToonMaterial
    const shaded = (preview.scene.children[1] as Mesh).material as MeshToonMaterial
    expect(shaded).not.toBe(plain)
    expect((preview.scene.children[2] as Mesh).material).toBe(shaded)
    expect(plain.defines.WOODLAND_CEL_VERTEX_OCCLUSION).toBeUndefined()
    expect(shaded.defines.WOODLAND_CEL_VERTEX_OCCLUSION).toBe('')
    const shader = compile(shaded)
    expect(shader.vertexShader).toContain('attribute float _cel_occlusion')
    expect(shader.fragmentShader).toContain('float woodlandCelOcclusion = 1.0')
    expect(shader.fragmentShader).toContain('reflectedLight.directDiffuse + reflectedLight.indirectDiffuse * woodlandCelOcclusion')
    expect(shader.fragmentShader).not.toContain('diffuseColor.rgb *= woodlandCelOcclusion')
    preview.dispose()
    original.dispose()
    geometry.dispose()
    occluded.dispose()
  })
})
