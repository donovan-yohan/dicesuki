import { afterEach, describe, expect, it, vi } from 'vitest'
import { LinearMipmapLinearFilter, Mesh, MeshToonMaterial, NoColorSpace, RepeatWrapping, ShaderLib, SRGBColorSpace, Texture, TextureLoader } from 'three'
import { createDungeonEnvironment } from './dungeonEnvironment'
import { attachWorldCel } from './environmentCel'
import { resolveEnvironmentQuality } from '../../lib/environmentQuality'

const quality = resolveEnvironmentQuality({ deviceTier: 'low', compactViewport: false, coarsePointer: false, reducedMotion: false })

afterEach(() => vi.restoreAllMocks())

describe('reviewed production dungeon', () => {
  it.each(['pending', 'rejected'] as const)('keeps the actual floor readable with %s decorative decodes', async state => {
    vi.spyOn(TextureLoader.prototype, 'loadAsync').mockImplementation(() => state === 'pending'
      ? new Promise(() => {})
      : Promise.reject(new Error('decode rejected')))
    const world = createDungeonEnvironment({ quality, arenaHalfX: 4, arenaHalfZ: 7, groundY: -.5, seed: 391 })
    try {
      await Promise.resolve()
      await Promise.resolve()
      const floor = world.root.getObjectByName('2565 continuous worn flagstones') as Mesh
      const material = floor.material as MeshToonMaterial
      // An attached image-less Texture is sampled black, not as untextured albedo.
      expect(material.map).toBeNull()
      expect(material.normalMap).toBeNull()
      expect(material.color.getHex()).toBe(0xc4c6b4)
    } finally { world.dispose() }
  })
  it('rejects actual late decoder completions after the world is retired', async () => {
    const completions: ((texture: Texture) => void)[] = []
    vi.spyOn(TextureLoader.prototype, 'loadAsync').mockImplementation(() => new Promise(resolve => completions.push(resolve)))
    const world = createDungeonEnvironment({ quality, arenaHalfX: 4, arenaHalfZ: 7, groundY: -.5, seed: 391 })
    world.dispose()
    const late = completions.map(() => new Texture())
    const disposals = late.map(texture => vi.spyOn(texture, 'dispose'))
    completions.forEach((resolve, i) => resolve(late[i]))
    await Promise.resolve()
    expect(completions).toHaveLength(14)
    expect(disposals.every(dispose => dispose.mock.calls.length === 1)).toBe(true)
    expect(world.controls.maps.stone.map.image).toBeNull()
    vi.restoreAllMocks()
  })
  it('publishes albedo and normal independently with the exact decoded images and reviewed sampling', async () => {
    const completions = new Map<string, (texture: Texture) => void>()
    vi.spyOn(TextureLoader.prototype, 'loadAsync').mockImplementation(url => new Promise(resolve => completions.set(url, resolve)))
    const world = createDungeonEnvironment({ quality: { ...quality, tier: 'high' }, arenaHalfX: 4, arenaHalfZ: 7, groundY: -.5, seed: 391 })
    const floor = world.root.getObjectByName('2565 continuous worn flagstones') as Mesh
    const material = floor.material as MeshToonMaterial
    const decoded = [new Texture(document.createElement('img')), new Texture(document.createElement('img'))]
    const decodedDisposals = decoded.map(texture => vi.spyOn(texture, 'dispose'))
    const placeholders = Object.values(world.controls.maps).flatMap(pair => [pair.map, pair.normalMap])
    const placeholderDisposals = placeholders.map(texture => vi.spyOn(texture, 'dispose'))
    try {
      const initialVersion = material.version
      completions.get('/environments/monster-dungeon/stone-albedo.png')!(decoded[0])
      await Promise.resolve()
      expect(material.map?.image).toBe(decoded[0].image)
      expect(material.normalMap).toBeNull()
      expect(material.version).toBeGreaterThan(initialVersion)
      world.controls.setNormals(false)
      completions.get('/environments/monster-dungeon/stone-normal.png')!(decoded[1])
      await Promise.resolve()
      expect(material.normalMap).toBeNull()
      world.controls.setNormals(true)
      expect(material.normalMap?.image).toBe(decoded[1].image)
      for (const [texture, colorSpace] of [[material.map!, SRGBColorSpace], [material.normalMap!, NoColorSpace]] as const) {
        expect(texture).not.toHaveProperty('isDataTexture')
        expect(texture.wrapS).toBe(RepeatWrapping)
        expect(texture.wrapT).toBe(RepeatWrapping)
        expect(texture.minFilter).toBe(LinearMipmapLinearFilter)
        expect(texture.anisotropy).toBe(4)
        expect(texture.colorSpace).toBe(colorSpace)
        expect(texture.version).toBeGreaterThan(0)
      }
    } finally { world.dispose(); world.dispose() }
    expect([...decodedDisposals, ...placeholderDisposals].every(dispose => dispose.mock.calls.length === 1)).toBe(true)
  })
  it('keeps a failed retired world permanently detached while a fresh world accepts its own decode', async () => {
    const requests: { resolve: (texture: Texture) => void; reject: (error: Error) => void }[] = []
    vi.spyOn(TextureLoader.prototype, 'loadAsync').mockImplementation(() => new Promise((resolve, reject) => requests.push({ resolve, reject })))
    const old = createDungeonEnvironment({ quality, arenaHalfX: 4, arenaHalfZ: 7, groundY: -.5, seed: 391 })
    const material = (old.root.getObjectByName('2565 continuous worn flagstones') as Mesh).material as MeshToonMaterial
    requests[2].reject(new Error('stone albedo rejected'))
    await Promise.resolve(); await Promise.resolve()
    old.dispose(); old.dispose()
    const version = material.version
    const fresh = createDungeonEnvironment({ quality, arenaHalfX: 4, arenaHalfZ: 7, groundY: -.5, seed: 391 })
    const late = requests.slice(0, 14).filter((_, i) => i !== 2).map(() => new Texture(document.createElement('img')))
    const disposals = late.map(texture => vi.spyOn(texture, 'dispose'))
    try {
      requests.slice(0, 14).filter((_, i) => i !== 2).forEach((request, i) => request.resolve(late[i]))
      const current = new Texture(document.createElement('img'))
      const currentDispose = vi.spyOn(current, 'dispose')
      requests[16].resolve(current)
      await Promise.resolve()
      expect(material.map).toBeNull()
      expect(material.normalMap).toBeNull()
      expect(material.version).toBe(version)
      expect(old.controls.maps.stone.normalMap.image).toBeNull()
      expect(disposals.every(dispose => dispose.mock.calls.length === 1)).toBe(true)
      const freshMaterial = (fresh.root.getObjectByName('2565 continuous worn flagstones') as Mesh).material as MeshToonMaterial
      expect(freshMaterial.map?.image).toBe(current.image)
      expect(currentDispose).not.toHaveBeenCalled()
      fresh.dispose(); fresh.dispose()
      expect(currentDispose).toHaveBeenCalledTimes(1)
    } finally { fresh.dispose() }
  })
  it('uses the reviewed architecture without another global sun or raycast surface', () => {
    vi.spyOn(TextureLoader.prototype, 'loadAsync').mockImplementation(() => new Promise(() => {}))
    const world = createDungeonEnvironment({ quality, arenaHalfX: 4, arenaHalfZ: 7, groundY: -.5, seed: 391 })
    expect(world.stats.chainLinks).toBe(92)
    expect(world.stats.textureCount).toBe(14)
    const links = world.root.getObjectByName('92 individually closed alternating iron chain links') as Mesh
    expect(links.castShadow).toBe(true)
    const lights: string[] = []
    world.root.traverse(o => { if (o.type.endsWith('Light')) lights.push(o.type) })
    expect(lights).toEqual(['PointLight', 'PointLight', 'PointLight', 'PointLight'])
    const material = links.material as MeshToonMaterial
    expect(material.userData.dungeonCel).toBe(true)
    world.update(1, true)
    expect(world.controls.time).toBe(.05)
    world.update(1, false)
    expect(world.controls.time).toBe(.05)
    world.dispose()
    world.update(1, true)
    expect(world.controls.time).toBe(.05)
    expect(world.root.children).toHaveLength(0)
    vi.restoreAllMocks()
  })

  it('bands combined actual shadowed light instead of analytic-only illumination', () => {
    const material = attachWorldCel(new MeshToonMaterial())
    const shader = { uniforms: {}, vertexShader: ShaderLib.toon.vertexShader, fragmentShader: ShaderLib.toon.fragmentShader } as Parameters<MeshToonMaterial['onBeforeCompile']>[0]
    material.onBeforeCompile(shader, {} as never)
    expect(shader.fragmentShader).toContain('#include <lights_fragment_begin>')
    expect(shader.fragmentShader).toContain('dungeonBands(reflectedLight.directDiffuse + reflectedLight.indirectDiffuse)')
    material.dispose()
  })
})
