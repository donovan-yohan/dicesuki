import { afterEach, describe, expect, it, vi } from 'vitest'
import { ClampToEdgeWrapping, LinearMipmapLinearFilter, Mesh, MeshToonMaterial, NoColorSpace, RepeatWrapping, SRGBColorSpace, Texture, TextureLoader } from 'three'
import { createReviewedCanopy } from './reviewedCanopy'

afterEach(() => vi.restoreAllMocks())

describe('reviewed fuller woodland canopy', () => {
  it.each(['pending', 'rejected'] as const)('keeps wood and leaves readable with %s decorative decodes', async state => {
    vi.spyOn(TextureLoader.prototype, 'loadAsync').mockImplementation(() => state === 'pending'
      ? new Promise(() => {})
      : Promise.reject(new Error('decode rejected')))
    const canopy = createReviewedCanopy({ halfX: 4, halfZ: 7, groundY: -.5, time: { value: 0 } })
    try {
      await Promise.resolve()
      await Promise.resolve()
      const wood = canopy.woodMesh.material as MeshToonMaterial
      const leaves = canopy.leafMesh.material as MeshToonMaterial
      expect(wood.map).toBeNull()
      expect(wood.normalMap).toBeNull()
      expect(leaves.map).toBeNull()
      expect(leaves.vertexColors).toBe(true)
    } finally { canopy.dispose() }
  })
  it('retains eight mature trees, three variants and 3600 connected opaque leaves in two batches', () => {
    vi.spyOn(TextureLoader.prototype, 'loadAsync').mockImplementation(() => new Promise(() => {}))
    const canopy = createReviewedCanopy({ halfX: 4, halfZ: 7, groundY: -.5, time: { value: 0 } })
    expect(canopy.leafCount).toBe(3600)
    expect(new Set(canopy.variants)).toEqual(new Set([0, 1, 2]))
    expect(canopy.root.children).toHaveLength(2)
    const leaves = canopy.root.getObjectByName('woodland-canopy') as Mesh
    expect(leaves.castShadow).toBe(true)
    expect(leaves.customDepthMaterial).toBeDefined()
    expect(leaves.geometry.getAttribute('aWeight').count).toBe(leaves.geometry.getAttribute('position').count)
    const geometryDispose = vi.spyOn(leaves.geometry, 'dispose')
    const depthDispose = vi.spyOn(leaves.customDepthMaterial!, 'dispose')
    canopy.dispose()
    canopy.dispose()
    expect(geometryDispose).toHaveBeenCalledTimes(1)
    expect(depthDispose).toHaveBeenCalledTimes(1)
    vi.restoreAllMocks()
  })
  it('publishes channels separately without changing decoded image bytes or reviewed sampling', async () => {
    const completions: ((texture: Texture) => void)[] = []
    vi.spyOn(TextureLoader.prototype, 'loadAsync').mockImplementation(() => new Promise(resolve => completions.push(resolve)))
    const canopy = createReviewedCanopy({ halfX: 4, halfZ: 7, groundY: -.5, time: { value: 0 } })
    const wood = canopy.woodMesh.material as MeshToonMaterial
    const leaves = canopy.leafMesh.material as MeshToonMaterial
    const decoded = completions.map(() => new Texture(document.createElement('img')))
    const disposals = decoded.map(texture => vi.spyOn(texture, 'dispose'))
    try {
      const version = wood.version
      completions[1](decoded[1])
      await Promise.resolve()
      expect(wood.normalMap?.image).toBe(decoded[1].image)
      expect(wood.map).toBeNull()
      expect(leaves.map).toBeNull()
      expect(wood.version).toBeGreaterThan(version)
      completions[0](decoded[0]); completions[2](decoded[2])
      await Promise.resolve()
      expect(wood.map?.image).toBe(decoded[0].image)
      expect(leaves.map?.image).toBe(decoded[2].image)
      for (const [texture, colorSpace, wrap, anisotropy] of [
        [wood.map!, SRGBColorSpace, RepeatWrapping, 4],
        [wood.normalMap!, NoColorSpace, RepeatWrapping, 4],
        [leaves.map!, SRGBColorSpace, ClampToEdgeWrapping, 1],
      ] as const) {
        expect(texture).not.toHaveProperty('isDataTexture')
        expect(texture.colorSpace).toBe(colorSpace)
        expect(texture.wrapS).toBe(wrap)
        expect(texture.wrapT).toBe(wrap)
        expect(texture.anisotropy).toBe(anisotropy)
        expect(texture.minFilter).toBe(LinearMipmapLinearFilter)
        expect(texture.version).toBeGreaterThan(0)
      }
      const owned = [wood.map!, wood.normalMap!, leaves.map!].map(texture => vi.spyOn(texture, 'dispose'))
      canopy.dispose(); canopy.dispose()
      expect([...owned, ...disposals].every(dispose => dispose.mock.calls.length === 1)).toBe(true)
    } finally { canopy.dispose() }
  })
  it.each([false, true])('permanently refuses late decode after retirement (earlier rejection: %s) and permits fresh return', async rejected => {
    const requests: { resolve: (texture: Texture) => void; reject: (error: Error) => void }[] = []
    vi.spyOn(TextureLoader.prototype, 'loadAsync').mockImplementation(() => new Promise((resolve, reject) => requests.push({ resolve, reject })))
    const old = createReviewedCanopy({ halfX: 4, halfZ: 7, groundY: -.5, time: { value: 0 } })
    const wood = old.woodMesh.material as MeshToonMaterial
    const leaves = old.leafMesh.material as MeshToonMaterial
    if (rejected) requests[0].reject(new Error('bark albedo rejected'))
    await Promise.resolve(); await Promise.resolve()
    old.dispose(); old.dispose()
    const versions = [wood.version, leaves.version]
    const fresh = createReviewedCanopy({ halfX: 4, halfZ: 7, groundY: -.5, time: { value: 0 } })
    const oldRequests = requests.slice(rejected ? 1 : 0, 3)
    const late = oldRequests.map(() => new Texture(document.createElement('img')))
    const disposals = late.map(texture => vi.spyOn(texture, 'dispose'))
    try {
      oldRequests.forEach((request, i) => request.resolve(late[i]))
      const current = new Texture(document.createElement('img'))
      const currentDispose = vi.spyOn(current, 'dispose')
      requests[3].resolve(current)
      await Promise.resolve()
      expect(wood.map).toBeNull()
      expect(wood.normalMap).toBeNull()
      expect(leaves.map).toBeNull()
      expect([wood.version, leaves.version]).toEqual(versions)
      expect(disposals.every(dispose => dispose.mock.calls.length === 1)).toBe(true)
      expect((fresh.woodMesh.material as MeshToonMaterial).map?.image).toBe(current.image)
      expect(currentDispose).not.toHaveBeenCalled()
      fresh.dispose(); fresh.dispose()
      expect(currentDispose).toHaveBeenCalledTimes(1)
    } finally { fresh.dispose() }
  })
})
