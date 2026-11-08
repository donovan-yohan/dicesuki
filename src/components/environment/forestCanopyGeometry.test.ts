import { describe, expect, it } from 'vitest'
import { DoubleSide, MeshLambertMaterial, MeshToonMaterial, Raycaster, Texture, Vector3 } from 'three'
import { createForestCanopy } from './forestCanopyGeometry'

const options = { halfX: 5, halfZ: 4, groundY: -0.5, tier: 'low' as const, seed: 71, time: { value: 0 } }

describe('createForestCanopy', () => {
  it('uses lifted cel crown colors without changing its shadow geometry', () => {
    const gradientMap = new Texture()
    const smooth = createForestCanopy(options)
    const cel = createForestCanopy({ ...options, gradientMap })
    expect(cel.geometry.getAttribute('position').array).toEqual(smooth.geometry.getAttribute('position').array)
    const colors = cel.geometry.getAttribute('color')
    let minimum = 1
    for (let i = 0; i < colors.count; i++) minimum = Math.min(minimum, colors.getX(i) * 0.2126 + colors.getY(i) * 0.7152 + colors.getZ(i) * 0.0722)
    expect(minimum).toBeGreaterThan(0.28)
    for (const mesh of [smooth, cel]) {
      mesh.geometry.dispose()
      mesh.material.dispose()
    }
    gradientMap.dispose()
  })

  it('returns one opaque static shadow-casting batch with disabled picking', () => {
    const mesh = createForestCanopy(options)
    expect(mesh.name).toBe('woodland-canopy')
    expect(mesh.children).toHaveLength(0)
    expect(mesh.geometry.getAttribute('position').count).toBeGreaterThan(0)
    expect(mesh.geometry.groups).toHaveLength(0)
    expect(mesh.material).toBeInstanceOf(MeshLambertMaterial)
    expect(mesh.material.transparent).toBe(false)
    expect(mesh.material.opacity).toBe(1)
    expect(mesh.material.depthWrite).toBe(true)
    expect(mesh.castShadow).toBe(true)
    expect(mesh.receiveShadow).toBe(true)
    expect(mesh.customDepthMaterial).toBeUndefined()
    expect(new Raycaster(new Vector3(5, 20, 0), new Vector3(0, -1, 0)).intersectObject(mesh)).toEqual([])
    expect(mesh.geometry.boundingBox).not.toBeNull()
    expect(mesh.geometry.boundingSphere!.radius).toBeGreaterThan(0)
    mesh.geometry.dispose()
    mesh.material.dispose()
  })

  it('uses an independent deterministic seed stream, not the shared clock or global random', () => {
    const first = createForestCanopy(options)
    const next = createForestCanopy({ ...options, seed: options.seed + 1 })
    const repeat = createForestCanopy({ ...options, time: { value: 390 } })
    const values = (mesh: typeof first) => Array.from(mesh.geometry.getAttribute('position').array)
    expect(values(first)).not.toEqual(values(next))
    expect(values(first)).toEqual(values(repeat))
    for (const mesh of [first, next, repeat]) {
      mesh.geometry.dispose()
      mesh.material.dispose()
    }
  })

  it('paints discrete flat facet tones rather than interpolating colors across leaves', () => {
    const mesh = createForestCanopy(options)
    const color = mesh.geometry.getAttribute('color')
    expect(color).toBeDefined()
    const palette = new Set<string>()
    let flat = true
    for (let i = 0; i < color.count; i += 3) {
      const tone = [color.getX(i), color.getY(i), color.getZ(i)].join(',')
      palette.add(tone)
      for (let j = 1; j < 3; j++) flat &&= tone === [color.getX(i + j), color.getY(i + j), color.getZ(i + j)].join(',')
    }
    expect(flat).toBe(true)
    expect(palette.size).toBeGreaterThanOrEqual(5)
    expect(palette.size).toBeLessThanOrEqual(10)
    expect(mesh.material.vertexColors).toBe(true)
    mesh.geometry.dispose()
    mesh.material.dispose()
  })

  it('places most projected crown area beyond the arena with seed-varying cluster populations', () => {
    const populations = new Set<number>()
    for (const seed of [0, 71, 1993, 412]) {
      const mesh = createForestCanopy({ ...options, seed })
      const p = mesh.geometry.getAttribute('position')
      populations.add(p.count)
      let outside = 0, total = 0, largest = 0
      for (let i = 0; i < p.count; i += 3) {
        const a = new Vector3().fromBufferAttribute(p, i)
        const b = new Vector3().fromBufferAttribute(p, i + 1)
        const c = new Vector3().fromBufferAttribute(p, i + 2)
        const area = Math.abs(b.clone().sub(a).cross(c.clone().sub(a)).y) * 0.5
        const x = (a.x + b.x + c.x) / 3, z = (a.z + b.z + c.z) / 3
        if (Math.abs(x) > options.halfX || Math.abs(z) > options.halfZ) outside += area
        total += area
        largest = Math.max(largest, area)
      }
      expect(outside / total).toBeGreaterThan(0.5)
      expect(largest).toBeGreaterThan(0.1)
      mesh.geometry.dispose()
      mesh.material.dispose()
    }
    expect(populations.size).toBeGreaterThan(1)
  })

  it('renders thin leaves from both sides in the native shadow pass', () => {
    for (const gradientMap of [undefined, new Texture()]) {
      const mesh = createForestCanopy({ ...options, gradientMap })
      // Native FrontSide defaults to BackSide for PCF shadows, losing upward sheets.
      expect(mesh.material.shadowSide).toBe(DoubleSide)
      mesh.geometry.dispose()
      mesh.material.dispose()
      gradientMap?.dispose()
    }
  })

  it('uses native Toon only for a supplied externally-owned gradient map', () => {
    const gradientMap = new Texture()
    let disposals = 0
    gradientMap.addEventListener('dispose', () => { disposals++ })
    const mesh = createForestCanopy({ ...options, gradientMap })
    expect(mesh.material).toBeInstanceOf(MeshToonMaterial)
    expect((mesh.material as MeshToonMaterial).gradientMap).toBe(gradientMap)
    expect(mesh.material.map).toBeNull()
    const shader = { vertexShader: '#include <begin_vertex>', fragmentShader: '', uniforms: {} }
    mesh.material.onBeforeCompile(shader as never, {} as never)
    expect(shader.vertexShader).toBe('#include <begin_vertex>')
    expect(shader.uniforms).toEqual({})
    mesh.geometry.dispose()
    mesh.material.dispose()
    expect(disposals).toBe(0)
    gradientMap.dispose()
  })

  it('keeps every tier in elevated four-edge bands with valid upward facets and bounded budgets', () => {
    const limits = { low: 2000, mid: 3500, high: 5000 }
    for (const tier of ['low', 'mid', 'high'] as const) {
      for (const [halfX, halfZ] of [[5, 4], [1, 0.7], [9, 2], [0.35, 0.5]]) {
        for (const seed of [0, 71, 1993]) {
          const groundY = -1.25
          const mesh = createForestCanopy({ ...options, halfX, halfZ, groundY, tier, seed })
          const p = mesh.geometry.getAttribute('position'), n = mesh.geometry.getAttribute('normal')
          const scale = Math.min(1, Math.min(halfX, halfZ) / 3)
          const inward = 0.9 * scale, outward = 0.8 * scale, eps = 1e-5
          const sides = [0, 0, 0, 0]
          let valid = true, minArea = Infinity, maxNormalError = 0
          for (let i = 0; i < p.count; i += 3) {
            const a = new Vector3().fromBufferAttribute(p, i)
            const b = new Vector3().fromBufferAttribute(p, i + 1)
            const c = new Vector3().fromBufferAttribute(p, i + 2)
            const cross = b.clone().sub(a).cross(c.clone().sub(a))
            minArea = Math.min(minArea, cross.length())
            valid &&= cross.y > 0
            // A whole triangle belongs to an edge half-plane, not just its vertices.
            const common = [true, true, true, true]
            for (let j = i; j < i + 3; j++) {
              const x = p.getX(j), y = p.getY(j), z = p.getZ(j)
              valid &&= Number.isFinite(x + y + z)
                && Math.abs(x) <= halfX + outward + eps && Math.abs(z) <= halfZ + outward + eps
                && y >= groundY + 1.9 - eps && y <= groundY + 3 + eps
              common[0] &&= x <= -halfX + inward + eps
              common[1] &&= x >= halfX - inward - eps
              common[2] &&= z <= -halfZ + inward + eps
              common[3] &&= z >= halfZ - inward - eps
              const normal = new Vector3().fromBufferAttribute(n, j)
              maxNormalError = Math.max(maxNormalError, Math.abs(normal.length() - 1))
              valid &&= Number.isFinite(normal.length())
            }
            valid &&= common.some(Boolean)
            common.forEach((belongs, side) => { if (belongs) sides[side]++ })
          }
          const box = mesh.geometry.boundingBox!
          valid &&= box.min.x < -halfX && box.max.x > halfX && box.min.z < -halfZ && box.max.z > halfZ
          expect({ valid, allEdges: sides.every(count => count > 0), normals: maxNormalError < 1e-5, nondegenerate: minArea > 1e-10 }).toEqual({ valid: true, allEdges: true, normals: true, nondegenerate: true })
          expect(p.count / 3).toBeGreaterThan(100)
          expect(p.count / 3).toBeLessThan(limits[tier])
          // The complete edge half-planes lie outside the closed central 60% rectangle.
          expect(Math.max(inward / halfX, inward / halfZ)).toBeLessThan(0.4)
          mesh.geometry.dispose()
          mesh.material.dispose()
        }
      }
    }
  })
})
