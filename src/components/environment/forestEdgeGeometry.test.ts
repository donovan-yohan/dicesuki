import { describe, expect, it } from 'vitest'
import { BufferGeometry, DoubleSide, Mesh, MeshLambertMaterial, Raycaster, ShaderLib, Texture } from 'three'
import { createForestDecor, type ForestDecorOptions } from './forestEdgeGeometry'

const options: ForestDecorOptions = { halfX: 3, halfZ: 5, groundY: -0.5, tier: 'mid', seed: 731, time: { value: 0 } }
const names = ['woodland-tree-line', 'woodland-understory', 'woodland-wildflowers']
const meshes = (config = options) => createForestDecor(config).children as Mesh<BufferGeometry, MeshLambertMaterial>[]

describe('forest clearing decoration', () => {
  it('lifts only cel forest colors into a pastel daytime range without changing shapes', () => {
    const gradientMap = new Texture()
    const smooth = meshes()
    const cel = meshes({ ...options, gradientMap })
    for (let batch = 0; batch < cel.length; batch++) {
      expect(cel[batch].geometry.getAttribute('position').array).toEqual(smooth[batch].geometry.getAttribute('position').array)
      const colors = cel[batch].geometry.getAttribute('color')
      let minimum = 1
      for (let i = 0; i < colors.count; i++) minimum = Math.min(minimum, colors.getX(i) * 0.2126 + colors.getY(i) * 0.7152 + colors.getZ(i) * 0.0722)
      expect(minimum).toBeGreaterThan(0.22)
      for (const mesh of [smooth[batch], cel[batch]]) {
        mesh.geometry.dispose()
        mesh.material.dispose()
      }
    }
    gradientMap.dispose()
  })

  it.each(['low', 'mid', 'high'] as const)('builds seeded nonempty %s border geometry with finite unit normals and bounded triangles', tier => {
    const config = { ...options, tier }
    const a = meshes(config), b = meshes(config), c = meshes({ ...config, seed: 732 })
    let triangles = 0
    for (let batch = 0; batch < 2; batch++) {
      const geometry = a[batch].geometry
      const position = geometry.getAttribute('position'), normal = geometry.getAttribute('normal'), color = geometry.getAttribute('color')
      expect(position?.count).toBeGreaterThan(100)
      expect(normal.count).toBe(position.count)
      expect(color.count).toBe(position.count)
      expect(position.array).toEqual(b[batch].geometry.getAttribute('position').array)
      expect(position.array).not.toEqual(c[batch].geometry.getAttribute('position').array)
      const palette = new Set<string>()
      for (let i = 0; i < position.count; i++) {
        expect(Math.hypot(normal.getX(i), normal.getY(i), normal.getZ(i))).toBeCloseTo(1, 4)
        palette.add([color.getX(i), color.getY(i), color.getZ(i)].join(','))
      }
      expect(palette.size).toBeGreaterThanOrEqual(4)
      triangles += position.count / 3
    }
    expect(triangles).toBeLessThan({ low: 4000, mid: 6500, high: 8500 }[tier])
  })

  it.each([[3, 5], [8, 4.5], [1.5, 2]])('keeps every structural vertex in the safe edge band for %s × %s', (halfX, halfZ) => {
    const [wood, leaves] = meshes({ ...options, halfX, halfZ })
    const scale = Math.min(1, Math.min(halfX, halfZ) / 3)
    for (const [mesh, inward, outward] of [[wood, 0.25, 0.38], [leaves, 0.65, 0.4]] as const) {
      const p = mesh.geometry.getAttribute('position')
      expect(p?.count).toBeGreaterThan(0)
      for (let i = 0; i < p.count; i++) {
        const x = Math.abs(p.getX(i)), z = Math.abs(p.getZ(i))
        expect(x).toBeLessThanOrEqual(halfX + outward * scale + 0.00001)
        expect(z).toBeLessThanOrEqual(halfZ + outward * scale + 0.00001)
        expect(x >= halfX - inward * scale - 0.00001 || z >= halfZ - inward * scale - 0.00001).toBe(true)
        expect(p.getY(i)).toBeGreaterThanOrEqual(options.groundY - 0.00001)
        expect(p.getY(i)).toBeLessThanOrEqual(options.groundY + 1.7)
      }
    }
  })

  it.each(['low', 'mid', 'high'] as const)('scatters %s small grounded flowers across the full clearing with independent randomness', tier => {
    const flower = meshes({ ...options, tier })[2]
    const geometry = flower.geometry, p = geometry.getAttribute('position'), roots = geometry.getAttribute('aPlant'), weights = geometry.getAttribute('aSway')
    expect(p?.count).toBeGreaterThan(300)
    expect(roots.count).toBe(p.count)
    expect(weights.count).toBe(p.count)
    const plants = new Set<string>(), quadrants = new Set<string>()
    let center = 0, pinned = 0
    const normals = geometry.getAttribute('normal'), colors = geometry.getAttribute('color')
    const palette = new Set<string>()
    for (let i = 0; i < p.count; i++) {
      const x = roots.getX(i), z = roots.getZ(i)
      const key = `${x},${z}`
      if (!plants.has(key)) {
        quadrants.add(`${x > 0},${z > 0}`)
        if (Math.abs(x) < options.halfX * 0.6 && Math.abs(z) < options.halfZ * 0.6) center++
      }
      plants.add(key)
      expect(Math.abs(p.getX(i) - x)).toBeLessThanOrEqual(0.12)
      expect(Math.abs(p.getZ(i) - z)).toBeLessThanOrEqual(0.12)
      expect(p.getY(i)).toBeGreaterThanOrEqual(options.groundY - 0.00001)
      expect(p.getY(i)).toBeLessThanOrEqual(options.groundY + 0.75)
      expect(Math.hypot(normals.getX(i), normals.getY(i), normals.getZ(i))).toBeCloseTo(1, 4)
      palette.add([colors.getX(i), colors.getY(i), colors.getZ(i)].join(','))
      if (Math.abs(p.getY(i) - options.groundY) < 0.00001) {
        expect(weights.getX(i)).toBe(0)
        pinned++
      }
    }
    expect(plants.size).toBe({ low: 28, mid: 48, high: 80 }[tier])
    expect(quadrants.size).toBe(4)
    expect(center).toBeGreaterThan(2)
    expect(pinned).toBeGreaterThanOrEqual(plants.size)
    expect(palette.size).toBeGreaterThan(8)
    const otherTier = tier === 'high' ? 'low' : 'high'
    expect(Array.from(roots.array).slice(0, 100)).toEqual(Array.from(meshes({ ...options, tier: otherTier })[2].geometry.getAttribute('aPlant').array).slice(0, 100))
    expect(p.array).toEqual(meshes({ ...options, tier })[2].geometry.getAttribute('position').array)
    expect(p.array).not.toEqual(meshes({ ...options, tier, seed: 732 })[2].geometry.getAttribute('position').array)
    const triangles = meshes({ ...options, tier }).reduce((sum, mesh) => sum + mesh.geometry.getAttribute('position').count / 3, 0)
    expect(triangles).toBeLessThan({ low: 6000, mid: 10000, high: 14000 }[tier])
  })

  it('uses the caller clock for pinned-root flower sway while preserving Lambert lighting and shadow chunks', () => {
    const time = { value: 2 }
    const root = createForestDecor({ ...options, time })
    const flower = root.children[2] as Mesh<BufferGeometry, MeshLambertMaterial>
    const before = Array.from(flower.geometry.getAttribute('position').array)
    const shader = { uniforms: {}, vertexShader: ShaderLib.lambert.vertexShader, fragmentShader: ShaderLib.lambert.fragmentShader } as Parameters<MeshLambertMaterial['onBeforeCompile']>[0]
    flower.material.onBeforeCompile(shader, {} as never)
    expect(shader.uniforms.uForestTime).toBe(time)
    expect(shader.vertexShader).toContain('attribute vec3 aPlant')
    expect(shader.vertexShader).toContain('attribute float aSway')
    expect(shader.vertexShader).toContain('transformed.xz +=')
    expect(shader.vertexShader).toContain('aSway *')
    expect(shader.vertexShader).toContain('aPlant.y')
    expect(shader.vertexShader).toContain('#include <worldpos_vertex>')
    expect(shader.fragmentShader).toContain('#include <lights_lambert_fragment>')
    expect(shader.fragmentShader).toContain('#include <shadowmap_pars_fragment>')
    expect(root).not.toHaveProperty('update')
    // Reduced motion is the parent's frozen clock, never another timer or callback.
    expect(shader.uniforms.uForestTime.value).toBe(2)
    expect(shader.uniforms.uForestTime.value).toBe(2)
    time.value = 4
    expect(shader.uniforms.uForestTime.value).toBe(4)
    expect(Array.from(flower.geometry.getAttribute('position').array)).toEqual(before)
  })

  it('returns exactly three opaque lit batches with parent-owned resources and no ray hits', () => {
    const root = createForestDecor(options)
    expect(root.name).toBe('woodland-forest')
    expect(root.children.map(child => child.name)).toEqual(names)
    expect(root.userData.update).toBeUndefined()
    for (const child of root.children as Mesh<BufferGeometry, MeshLambertMaterial>[]) {
      expect(child).toBeInstanceOf(Mesh)
      expect(child.material).toBeInstanceOf(MeshLambertMaterial)
      expect(child.material.vertexColors).toBe(true)
      expect(child.material.transparent).toBe(false)
      expect(child.material.depthWrite).toBe(true)
      expect(child.material.map).toBeNull()
      expect(child.material.side).toBe(DoubleSide)
      expect(child.receiveShadow).toBe(true)
      expect(child.castShadow).toBe(false)
      expect(child.geometry.groups).toEqual([])
      const hits: never[] = []
      child.raycast(new Raycaster(), hits)
      expect(hits).toEqual([])
    }
  })
})
