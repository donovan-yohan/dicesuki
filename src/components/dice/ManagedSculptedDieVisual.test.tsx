import { act, render } from '@testing-library/react'
import { StrictMode } from 'react'
import * as THREE from 'three'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ManagedSculptedDieVisual } from './ManagedSculptedDieVisual'
import { createManagedSculptedVisual, managedSculptedSetId } from '../../lib/managedSculptedDice'
import type { GltfDiceAsset } from '../../types/gltfDice'

const host = vi.hoisted(() => ({ frames: [] as Array<(state: unknown, delta: number) => void> }))
vi.mock('@react-three/fiber', () => ({ useFrame: (fn: (state: unknown, delta: number) => void) => host.frames.push(fn) }))
const makeAsset = (set = 'monster-dungeon-set', shape = 'd6'): GltfDiceAsset => ({
  id: `${set}/catalog-item`, modelUrl: '/not-an-identity.glb', metadata: { setId: set, diceType: shape, scale: 1 },
} as GltfDiceAsset)
function fixture() {
  const source = new THREE.Group()
  source.name = 'cached-loader-scene'
  const wrapper = new THREE.Group()
  wrapper.name = 'canonical-wrapper'
  wrapper.rotation.set(-Math.PI / 2, 0, 0)
  const eye = new THREE.Group()
  eye.name = '1_eye'
  const texture = new THREE.Texture()
  eye.add(new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshStandardMaterial({ color: '#c48d65', map: texture })))
  wrapper.add(eye)
  source.add(wrapper)
  const clip = new THREE.AnimationClip('1_eyeAction', 1, [new THREE.QuaternionKeyframeTrack('1_eye.quaternion', [0, 1], [0, 0, 0, 1, 0, 0, 0.70710678, 0.70710678])])
  const clips = [clip, ...Array.from({ length: 21 }, (_, index) => new THREE.AnimationClip(`preserved-${index}`, 1, []))]
  source.animations = clips
  return { source, wrapper, eye, texture, clips }
}
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); host.frames = [] })

describe('managed sculpted instance resources', () => {
  it('switches room response and restores the exact original cache key without restarting the eye or replacing materials', () => {
    const { source, clips } = fixture()
    const selected = makeAsset()
    const clones = vi.spyOn(source, 'clone')
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const { rerender, unmount } = render(<ManagedSculptedDieVisual scene={source} asset={selected} cel animations={clips} />)
    const owned = clones.mock.results[0].value as THREE.Group
    const material = (owned.getObjectByProperty('isMesh', true) as THREE.Mesh).material as THREE.MeshToonMaterial
    const key = material.customProgramCacheKey()
    act(() => host.frames.forEach(frame => frame({}, 0.05)))
    const eye = owned.getObjectByName('1_eye')!
    const phase = eye.quaternion.clone()
    rerender(<ManagedSculptedDieVisual scene={source} asset={selected} cel animations={clips} response="night" />)
    expect(clones).toHaveBeenCalledOnce()
    expect(eye.quaternion.equals(phase)).toBe(true)
    expect(material.defines.MANAGED_CEL_NIGHT_RESPONSE).toBe('')
    expect(material.customProgramCacheKey()).not.toBe(key)
    rerender(<ManagedSculptedDieVisual scene={source} asset={selected} cel animations={clips} />)
    expect(clones).toHaveBeenCalledOnce()
    expect(material.customProgramCacheKey()).toBe(key)
    expect(material.defines.MANAGED_CEL_NIGHT_RESPONSE).toBeUndefined()
    expect(eye.quaternion.equals(phase)).toBe(true)
    unmount()
  })

  it('retains native gel transmission and IOR when adapting the selected Dungeon D10 to cel lighting', () => {
    const source = new THREE.Group()
    const gel = new THREE.MeshPhysicalMaterial({ color: '#8dbb20', transmission: 0.8, ior: 1.38, roughness: 0.3 })
    source.add(new THREE.Mesh(new THREE.BoxGeometry(), gel))
    const owned = createManagedSculptedVisual(source, makeAsset('monster-dungeon-set', 'd10'), true)
    const material = (owned.scene.children[0] as THREE.Mesh).material as THREE.MeshPhysicalMaterial
    expect(material).toBeInstanceOf(THREE.MeshPhysicalMaterial)
    expect(material.transmission).toBe(gel.transmission)
    expect(material.ior).toBe(gel.ior)
    expect(material).not.toBe(gel)
    expect(gel.onBeforeCompile).toBe(THREE.Material.prototype.onBeforeCompile)
    owned.dispose()
  })

  it('bands physical diffuse illumination before native refraction without quantizing painted albedo or emissive', () => {
    const source = new THREE.Group()
    const original = new THREE.MeshPhysicalMaterial({ transmission: 0.8, ior: 1.38 })
    source.add(new THREE.Mesh(new THREE.BoxGeometry(), original))
    const chunks = { ...THREE.ShaderChunk }
    const owned = createManagedSculptedVisual(source, makeAsset('monster-dungeon-set', 'd10'), true)
    const material = (owned.scene.children[0] as THREE.Mesh).material as THREE.MeshPhysicalMaterial
    const shader = { vertexShader: THREE.ShaderLib.physical.vertexShader, fragmentShader: THREE.ShaderLib.physical.fragmentShader, uniforms: {} }
    material.onBeforeCompile(shader as Parameters<THREE.Material['onBeforeCompile']>[0], {} as THREE.WebGLRenderer)
    const fragment = shader.fragmentShader
    expect(fragment).toContain('vec3 woodlandCelAlbedo = material.diffuseColor;')
    expect(fragment).toContain('material.diffuseColor = vec3(1.0);')
    expect(fragment.indexOf('material.diffuseColor = vec3(1.0);')).toBeLessThan(fragment.indexOf('#include <lights_fragment_begin>'))
    expect(fragment).toContain('totalDiffuse = woodlandCelAlbedo * woodlandCelBands(totalDiffuse);')
    expect(fragment.indexOf('woodlandCelBands(totalDiffuse)')).toBeGreaterThan(fragment.indexOf('#include <aomap_fragment>'))
    expect(fragment.indexOf('woodlandCelBands(totalDiffuse)')).toBeLessThan(fragment.indexOf('#include <transmission_fragment>'))
    expect(fragment).toContain('material.diffuseColor = woodlandCelAlbedo;')
    expect(fragment).toContain('vec3 outgoingLight = totalDiffuse + totalSpecular + totalEmissiveRadiance;')
    expect(fragment).toContain('#include <normal_fragment_maps>')
    expect(THREE.ShaderChunk).toEqual(chunks)
    owned.dispose()
  })

  it('keeps physical light-band thresholds independent of dark or zero albedo', () => {
    const source = new THREE.Group()
    for (const color of ['#000000', '#06310d', '#c9eb63']) source.add(new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshPhysicalMaterial({ color, transmission: 0.8 })))
    const owned = createManagedSculptedVisual(source, makeAsset('monster-dungeon-set', 'd10'), true)
    const fragments = owned.scene.children.map(object => {
      const material = (object as THREE.Mesh).material as THREE.Material
      const shader = { vertexShader: THREE.ShaderLib.physical.vertexShader, fragmentShader: THREE.ShaderLib.physical.fragmentShader, uniforms: {} }
      material.onBeforeCompile(shader as Parameters<THREE.Material['onBeforeCompile']>[0], {} as THREE.WebGLRenderer)
      return shader.fragmentShader
    })
    expect(new Set(fragments).size).toBe(1)
    expect(fragments[0]).not.toContain('/ material.diffuseColor')
    expect(fragments[0]).not.toContain('/ diffuseColor')
    owned.dispose()
  })

  it('owns deduplicated physical clones while retaining every native map, optical and render setting', () => {
    const source = new THREE.Group()
    const geometry = new THREE.BoxGeometry()
    const maps = Array.from({ length: 8 }, () => new THREE.Texture())
    const gel = new THREE.MeshPhysicalMaterial({
      color: '#8dbb20', transmission: 0.8, ior: 1.38, thickness: 0.4, roughness: 0.3,
      map: maps[0], normalMap: maps[1], transmissionMap: maps[2], thicknessMap: maps[3],
      emissiveMap: maps[4], lightMap: maps[5], aoMap: maps[6], alphaMap: maps[7],
      transparent: true, opacity: 0.7, depthWrite: false, side: THREE.DoubleSide,
      attenuationColor: '#82c934', attenuationDistance: 2.5, emissive: '#112233', emissiveIntensity: 0.4,
    })
    const prior = vi.fn()
    gel.onBeforeCompile = prior
    gel.customProgramCacheKey = () => 'gel-source'
    source.add(new THREE.Mesh(geometry, [gel, gel]), new THREE.Mesh(geometry, gel))
    const sourceJSON = gel.toJSON()
    const materialDispose = vi.spyOn(gel, 'dispose')
    const geometryDispose = vi.spyOn(geometry, 'dispose')
    const mapDisposes = maps.map(map => vi.spyOn(map, 'dispose'))
    const owned = createManagedSculptedVisual(source, makeAsset('monster-dungeon-set', 'd10'), true)
    const material = ((owned.scene.children[0] as THREE.Mesh).material as THREE.MeshPhysicalMaterial[])[0]
    expect(material).toBeInstanceOf(THREE.MeshPhysicalMaterial)
    expect(((owned.scene.children[0] as THREE.Mesh).material as THREE.Material[])[1]).toBe(material)
    expect((owned.scene.children[1] as THREE.Mesh).material).toBe(material)
    for (const key of ['transmission', 'ior', 'thickness', 'roughness', 'map', 'normalMap', 'transmissionMap', 'thicknessMap', 'emissiveMap', 'lightMap', 'aoMap', 'alphaMap', 'transparent', 'opacity', 'depthWrite', 'side', 'attenuationColor', 'attenuationDistance', 'emissive', 'emissiveIntensity'] as const) {
      expect(material[key], key).toEqual(gel[key])
    }
    const shader = { vertexShader: THREE.ShaderLib.physical.vertexShader, fragmentShader: THREE.ShaderLib.physical.fragmentShader, uniforms: {} }
    material.onBeforeCompile(shader as Parameters<THREE.Material['onBeforeCompile']>[0], {} as THREE.WebGLRenderer)
    expect(prior).toHaveBeenCalledOnce()
    expect(material.customProgramCacheKey()).toBe('gel-source-managed-physical-cel-v1')
    expect(gel.toJSON()).toEqual(sourceJSON)
    expect(gel.onBeforeCompile).toBe(prior)
    const dispose = vi.spyOn(material, 'dispose')
    owned.dispose(); owned.dispose()
    expect(dispose).toHaveBeenCalledOnce()
    expect(materialDispose).not.toHaveBeenCalled()
    expect(geometryDispose).not.toHaveBeenCalled()
    mapDisposes.forEach(spy => expect(spy).not.toHaveBeenCalled())
  })

  it('plays only the verified ambient eye clip and freezes it without touching canonical transforms', () => {
    const { source, wrapper, eye, clips } = fixture()
    const originalClips = clips.map(clip => THREE.AnimationClip.toJSON(clip))
    const owned = createManagedSculptedVisual(source, makeAsset(), true, clips)
    const ownedEye = owned.scene.getObjectByName('1_eye')!
    const ownedWrapper = owned.scene.getObjectByName('canonical-wrapper')!
    const canonical = ownedWrapper.quaternion.clone()
    const start = ownedEye.quaternion.clone()
    owned.update(0.05, false)
    expect(ownedEye.quaternion.equals(start)).toBe(false)
    const frozen = ownedEye.quaternion.clone()
    owned.update(0.05, true)
    expect(ownedEye.quaternion.equals(frozen)).toBe(true)
    owned.update(0.05, false)
    expect(ownedEye.quaternion.equals(frozen)).toBe(false)
    expect(ownedWrapper.quaternion.equals(canonical)).toBe(true)
    expect(wrapper.quaternion.equals(canonical)).toBe(true)
    expect(source.quaternion.equals(new THREE.Quaternion())).toBe(true)
    expect(eye.quaternion.equals(start)).toBe(true)
    expect(owned.scene.animations).toHaveLength(22)
    expect(clips.map(clip => THREE.AnimationClip.toJSON(clip))).toEqual(originalClips)
    owned.dispose()
    const retired = ownedEye.quaternion.clone()
    owned.update(0.05, false)
    expect(ownedEye.quaternion.equals(retired)).toBe(true)
  })

  it.each(['woodland-sculpted-set', 'cyberpunk-cutline-set', 'devil-set'])('does not run the dungeon animation for %s', set => {
    const { source, clips } = fixture()
    const owned = createManagedSculptedVisual(source, makeAsset(set), false, clips)
    const eye = owned.scene.getObjectByName('1_eye')!
    owned.update(0.1, false)
    expect(eye.quaternion.equals(new THREE.Quaternion())).toBe(true)
    owned.dispose()
  })

  it('refuses clips that could move the canonical root even when the clip name matches', () => {
    const { source } = fixture()
    const clip = new THREE.AnimationClip('1_eyeAction', 1, [new THREE.VectorKeyframeTrack('canonical-wrapper.position', [0, 1], [0, 0, 0, 100, 0, 0])])
    const owned = createManagedSculptedVisual(source, makeAsset(), false, [clip])
    owned.update(0.1, false)
    expect(owned.scene.getObjectByName('canonical-wrapper')!.position.toArray()).toEqual([0, 0, 0])
    owned.dispose()
  })

  it('keeps unrelated assets PBR even if a caller mistakenly requests cel', () => {
    const { source, clips } = fixture()
    const owned = createManagedSculptedVisual(source, makeAsset('devil-set'), true, clips)
    const material = (owned.scene.getObjectByProperty('isMesh', true) as THREE.Mesh).material
    expect(material).toBeInstanceOf(THREE.MeshStandardMaterial)
    owned.dispose()
  })

  it('does not identify assets from filenames, loose prefixes or contradictory metadata', () => {
    expect(managedSculptedSetId(makeAsset())).toBe('monster-dungeon-set')
    expect(managedSculptedSetId({ ...makeAsset(), id: 'monster-dungeon-set-copy/item' })).toBeNull()
    expect(managedSculptedSetId({ ...makeAsset(), id: 'monster-dungeon-set/item/nested' })).toBeNull()
    expect(managedSculptedSetId({ ...makeAsset(), metadata: { ...makeAsset().metadata, setId: 'devil-set' } })).toBeNull()
    expect(managedSculptedSetId({ ...makeAsset('devil-set'), modelUrl: '/monster-dungeon-set/model.glb' })).toBeNull()
  })

  it('owns each clone and disposes no cached geometry or textures', () => {
    const { source, texture, clips } = fixture()
    const mesh = source.getObjectByProperty('isMesh', true) as THREE.Mesh
    const geometryDispose = vi.spyOn(mesh.geometry, 'dispose')
    const materialDispose = vi.spyOn(mesh.material as THREE.Material, 'dispose')
    const textureDispose = vi.spyOn(texture, 'dispose')
    const a = createManagedSculptedVisual(source, makeAsset(), true, clips)
    const b = createManagedSculptedVisual(source, makeAsset(), true, clips)
    const ownedMaterial = (a.scene.getObjectByProperty('isMesh', true) as THREE.Mesh).material as THREE.Material
    const ownedDispose = vi.spyOn(ownedMaterial, 'dispose')
    a.update(0.05, false)
    expect(a.scene.getObjectByName('1_eye')!.quaternion.equals(b.scene.getObjectByName('1_eye')!.quaternion)).toBe(false)
    a.dispose(); a.dispose()
    expect(ownedDispose).toHaveBeenCalledOnce()
    expect(geometryDispose).not.toHaveBeenCalled()
    expect(materialDispose).not.toHaveBeenCalled()
    expect(textureDispose).not.toHaveBeenCalled()
    b.update(0.1, false)
    expect(b.scene.getObjectByName('1_eye')!.quaternion.equals(new THREE.Quaternion())).toBe(false)
    b.dispose()
  })

  it('releases the mixer action/root cache permanently on teardown', () => {
    const { source, clips } = fixture()
    const stop = vi.spyOn(THREE.AnimationMixer.prototype, 'stopAllAction')
    const uncache = vi.spyOn(THREE.AnimationMixer.prototype, 'uncacheRoot')
    const owned = createManagedSculptedVisual(source, makeAsset(), false, clips)
    owned.update(0.05, false)
    owned.dispose()
    owned.dispose()
    expect(stop).toHaveBeenCalledOnce()
    expect(uncache).toHaveBeenCalledExactlyOnceWith(owned.scene)
  })

  it('bounds tab-resume deltas and ignores invalid deltas without advancing the eye', () => {
    const { source, clips } = fixture()
    const a = createManagedSculptedVisual(source, makeAsset(), false, clips)
    const b = createManagedSculptedVisual(source, makeAsset(), false, clips)
    a.update(120, false)
    b.update(0.1, false)
    const eye = a.scene.getObjectByName('1_eye')!
    expect(eye.quaternion.toArray()).toEqual(b.scene.getObjectByName('1_eye')!.quaternion.toArray())
    const before = eye.quaternion.clone()
    for (const delta of [NaN, Infinity, -1, 0]) a.update(delta, false)
    expect(eye.quaternion.equals(before)).toBe(true)
    a.dispose(); b.dispose()
  })

  it('retains source maps, alpha/depth state and emissive colors across cel adaptation', () => {
    const { source, clips } = fixture()
    const mesh = source.getObjectByProperty('isMesh', true) as THREE.Mesh
    const material = mesh.material as THREE.MeshStandardMaterial
    material.transparent = true
    material.opacity = 0.6
    material.alphaTest = 0.2
    material.depthWrite = false
    material.emissive.set('#1c9bfa')
    material.emissiveIntensity = 1.7
    const owned = createManagedSculptedVisual(source, makeAsset('cyberpunk-cutline-set'), true, clips)
    const replacement = (owned.scene.getObjectByProperty('isMesh', true) as THREE.Mesh).material as THREE.MeshToonMaterial
    expect(replacement.color.equals(material.color)).toBe(true)
    expect(replacement.emissive.equals(material.emissive)).toBe(true)
    expect(replacement.emissiveIntensity).toBe(1.7)
    expect(replacement.map).toBe(material.map)
    expect([replacement.transparent, replacement.opacity, replacement.alphaTest, replacement.depthWrite]).toEqual([true, 0.6, 0.2, false])
    const shader = { vertexShader: THREE.ShaderLib.toon.vertexShader, fragmentShader: THREE.ShaderLib.toon.fragmentShader, uniforms: {} }
    replacement.onBeforeCompile(shader as Parameters<THREE.MeshToonMaterial['onBeforeCompile']>[0], {} as THREE.WebGLRenderer)
    expect(shader.fragmentShader).toContain('woodlandCelIllumination = reflectedLight.directDiffuse + reflectedLight.indirectDiffuse')
    expect(shader.fragmentShader).toContain('diffuseColor.rgb * woodlandCelBands(woodlandCelIllumination)')
    expect(shader.fragmentShader).toContain('+ totalEmissiveRadiance')
    owned.dispose()
  })

  it('does not rebuild resources as the live reduced-motion preference changes', () => {
    const { source, clips } = fixture()
    let listener: ((event: { matches: boolean }) => void) | undefined
    const query = { matches: true, addEventListener: vi.fn((_type, callback) => { listener = callback }), removeEventListener: vi.fn() }
    vi.stubGlobal('matchMedia', vi.fn(() => query))
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const clones = vi.spyOn(source, 'clone')
    const selected = makeAsset()
    const { rerender, unmount } = render(<ManagedSculptedDieVisual scene={source} asset={selected} cel animations={clips} />)
    const owned = clones.mock.results[0].value as THREE.Group
    const eye = owned.getObjectByName('1_eye')!
    act(() => host.frames.forEach(frame => frame({}, 0.05)))
    expect(eye.quaternion.equals(new THREE.Quaternion())).toBe(true)
    act(() => { listener?.({ matches: false }); host.frames.forEach(frame => frame({}, 0.05)) })
    expect(eye.quaternion.equals(new THREE.Quaternion())).toBe(false)
    expect(clones).toHaveBeenCalledTimes(1)
    const material = (owned.getObjectByProperty('isMesh', true) as THREE.Mesh).material as THREE.Material
    const dispose = vi.spyOn(material, 'dispose')
    rerender(<ManagedSculptedDieVisual scene={source} asset={selected} cel={false} animations={clips} />)
    expect(dispose).toHaveBeenCalledOnce()
    expect(clones).toHaveBeenCalledTimes(2)
    const smooth = clones.mock.results[1].value as THREE.Group
    expect((smooth.getObjectByProperty('isMesh', true) as THREE.Mesh).material).toBeInstanceOf(THREE.MeshStandardMaterial)
    unmount()
  })

  it('uses R3F delta with a live reduced-motion listener and retires all StrictMode owners', async () => {
    const { source, clips } = fixture()
    let listener: ((event: { matches: boolean }) => void) | undefined
    const remove = vi.fn()
    const query = { matches: false, addEventListener: vi.fn((_type, callback) => { listener = callback }), removeEventListener: remove }
    vi.stubGlobal('matchMedia', vi.fn(() => query))
    const clones = vi.spyOn(source, 'clone')
    const dispose = vi.spyOn(THREE.MeshToonMaterial.prototype, 'dispose')
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const selected = makeAsset()
    const { unmount } = render(<StrictMode><ManagedSculptedDieVisual scene={source} asset={selected} cel animations={clips} /></StrictMode>)
    const liveScene = clones.mock.results[clones.mock.results.length - 1].value as THREE.Group
    const eye = liveScene.getObjectByName('1_eye')!
    act(() => { host.frames.forEach(frame => frame({}, 0.05)) })
    expect(eye.quaternion.equals(new THREE.Quaternion())).toBe(false)
    const frozen = eye.quaternion.clone()
    act(() => { listener?.({ matches: true }); host.frames.forEach(frame => frame({}, 0.05)) })
    expect(eye.quaternion.equals(frozen)).toBe(true)
    act(() => { listener?.({ matches: false }); host.frames.forEach(frame => frame({}, 0.05)) })
    expect(eye.quaternion.equals(frozen)).toBe(false)
    expect(clones).toHaveBeenCalledTimes(2)
    unmount()
    await act(async () => { await Promise.resolve() })
    expect(remove).toHaveBeenCalledTimes(2)
    expect(dispose).toHaveBeenCalledTimes(2)
    const retired = eye.quaternion.clone()
    host.frames.forEach(frame => frame({}, 0.05))
    expect(eye.quaternion.equals(retired)).toBe(true)
  })
})
