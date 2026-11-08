import { describe, expect, it, vi } from 'vitest'
import { renderHook } from '@testing-library/react'
import { StrictMode } from 'react'
import { WoodlandEnvironment } from './WoodlandEnvironment'
import { useEngineConfig } from '../../config/engineConfig'

const { frame } = vi.hoisted(() => ({ frame: { current: null as null | ((state: unknown, delta: number) => void) } }))
vi.mock('@react-three/fiber', () => ({ useFrame: (callback: typeof frame.current) => { frame.current = callback } }))
vi.mock('../../config/engineConfig', () => ({ useEngineConfig: vi.fn() }))
import { AdditiveBlending, Box3, DataTexture, InstancedBufferGeometry, InstancedMesh, LinearFilter, Matrix4, Mesh, MeshLambertMaterial, MeshStandardMaterial, Points, RepeatWrapping, RGBAFormat, ShaderLib, ShaderMaterial, Vector3 } from 'three'
import { createWoodlandResources } from './woodlandGeometry'
import { sampleGrassField } from './grassField'
import { resolveEnvironmentQuality, type WoodlandRecipe } from '../../lib/environmentQuality'

const recipe: WoodlandRecipe = {
  kind: 'woodland', seed: 731,
  grass: { base: '#25452d', tip: '#9bbd58' }, sunlight: '#ffe4ac', pollen: '#ffe9ad',
}
const quality = resolveEnvironmentQuality({
  deviceTier: 'high', compactViewport: false, coarsePointer: false, reducedMotion: false,
})
const options = { recipe, quality, arenaHalfX: 4.5, arenaHalfZ: 8 }

describe('WoodlandEnvironment engine adapter', () => {
  it('rebuilds the environment when switching between smooth and cel recipes', async () => {
    vi.mocked(useEngineConfig).mockReturnValue({ arenaHalfX: 3, arenaHalfZ: 5 } as NonNullable<ReturnType<typeof useEngineConfig>>)
    const { result, rerender, unmount } = renderHook(
      ({ shading }: { shading?: 'cel' }) => WoodlandEnvironment({ recipe: { ...recipe, shading }, quality }),
      { initialProps: { shading: undefined } as { shading?: 'cel' } },
    )
    const before = result.current!.props.object
    rerender({ shading: 'cel' })
    expect(result.current!.props.object).not.toBe(before)
    unmount()
    await Promise.resolve()
  })

  it('releases the final GPU resources after React StrictMode replays effects', async () => {
    vi.mocked(useEngineConfig).mockReturnValue({ arenaHalfX: 3, arenaHalfZ: 5 } as NonNullable<ReturnType<typeof useEngineConfig>>)
    const { result, unmount } = renderHook(() => WoodlandEnvironment({ recipe, quality }), { wrapper: StrictMode })
    const ground = result.current!.props.object.getObjectByName('woodland-ground') as Mesh
    const disposed = vi.spyOn(ground.geometry, 'dispose')
    await Promise.resolve()
    expect(disposed).not.toHaveBeenCalled()
    unmount()
    await Promise.resolve()
    expect(disposed).toHaveBeenCalledOnce()
  })

  it('waits for engine bounds, rebuilds on resize, and freezes live motion without reallocating', async () => {
    const config = vi.mocked(useEngineConfig)
    config.mockReturnValue(null)
    const { result, rerender, unmount } = renderHook(
      ({ animate }) => WoodlandEnvironment({ recipe, quality: { ...quality, animate } }),
      { initialProps: { animate: true } },
    )
    expect(result.current).toBeNull()
    config.mockReturnValue({ arenaHalfX: 3, arenaHalfZ: 5 } as NonNullable<ReturnType<typeof useEngineConfig>>)
    rerender({ animate: true })
    expect(result.current).not.toBeNull()
    const root = result.current!.props.object
    const grass = root.getObjectByName('woodland-grass') as Mesh<InstancedBufferGeometry, ShaderMaterial>
    frame.current!({}, 0.1)
    expect(grass.material.uniforms.uTime.value).toBeCloseTo(0.1)
    rerender({ animate: false })
    expect(result.current!.props.object).toBe(root)
    frame.current!({}, 0.1)
    expect(grass.material.uniforms.uTime.value).toBeCloseTo(0.1)
    const ground = root.getObjectByName('woodland-ground') as Mesh
    const disposed = vi.spyOn(ground.geometry, 'dispose')
    config.mockReturnValue({ arenaHalfX: 6, arenaHalfZ: 4 } as NonNullable<ReturnType<typeof useEngineConfig>>)
    rerender({ animate: false })
    expect(result.current!.props.object).not.toBe(root)
    await Promise.resolve()
    expect(disposed).toHaveBeenCalledOnce()
    const resized = result.current!.props.object.getObjectByName('woodland-ground') as Mesh
    resized.geometry.computeBoundingBox()
    expect(resized.geometry.boundingBox!.max.x).toBeCloseTo(6.4)
    const finalDisposal = vi.spyOn(resized.geometry, 'dispose')
    unmount()
    await Promise.resolve()
    expect(finalDisposal).toHaveBeenCalledOnce()
  })
})

describe('woodland geometry', () => {
  it('matches opaque textured grass blades to a lush green ground texture', () => {
    const resources = createWoodlandResources(options)
    const grass = resources.root.getObjectByName('woodland-grass') as Mesh<InstancedBufferGeometry, MeshLambertMaterial>
    const texture = grass.material.map
    expect(texture).toBeInstanceOf(DataTexture)
    expect(texture!.image.width).toBeGreaterThanOrEqual(32)
    expect(grass.geometry.getAttribute('uv').count).toBe(grass.geometry.getAttribute('position').count)
    const ground = resources.root.getObjectByName('woodland-ground') as Mesh<never, MeshStandardMaterial>
    expect(ground.material.map).toBeInstanceOf(DataTexture)
    expect(ground.material.map!.wrapS).toBe(RepeatWrapping)
    expect(ground.material.map!.generateMipmaps).toBe(true)
    const shader = { uniforms: {}, vertexShader: ShaderLib.standard.vertexShader, fragmentShader: ShaderLib.standard.fragmentShader } as Parameters<MeshStandardMaterial['onBeforeCompile']>[0]
    ground.material.onBeforeCompile(shader, {} as never)
    expect(shader.fragmentShader).not.toContain('dryUndercoat')
    expect(grass.material.transparent).toBe(false)
    const disposed = vi.spyOn(texture!, 'dispose')
    const groundDisposed = vi.spyOn(ground.material.map!, 'dispose')
    resources.dispose()
    resources.dispose()
    expect(disposed).toHaveBeenCalledOnce()
    expect(groundDisposed).toHaveBeenCalledOnce()
  })

  it('samples the growing end of a partial grid row instead of leaving an empty edge rectangle', () => {
    const resources = createWoodlandResources({ ...options, recipe: { ...recipe, seed: 2718 }, quality: { ...quality, grassCount: 6000 } })
    const roots = (resources.root.getObjectByName('woodland-grass') as Mesh).geometry.getAttribute('aRoot')
    let edgeRoots = 0
    for (let i = 0; i < roots.count; i++) {
      if (roots.getX(i) > -3.0494 && roots.getZ(i) > 7.7256) edgeRoots++
    }
    expect(sampleGrassField(0, 7.9, 2718).density).toBeGreaterThan(0.5)
    expect(edgeRoots).toBeGreaterThan(0)
    resources.dispose()
  })

  it('owns a bounded dice-pressure texture, stamps real contact data and disposes it', () => {
    const resources = createWoodlandResources(options)
    const grass = resources.root.getObjectByName('woodland-grass') as Mesh<InstancedBufferGeometry, MeshStandardMaterial & { uniforms: Record<string, { value: DataTexture }> }>
    const texture = grass.material.uniforms.uInteraction?.value
    expect(texture).toBeInstanceOf(DataTexture)
    const disposed = vi.spyOn(texture, 'dispose')
    const die = { id: 'press', diceType: 'd6' as const, prevPosition: [0, 0.55, 0] as [number, number, number], targetPosition: [0, 0.55, 0] as [number, number, number], prevRotation: [0, 0, 0, 1] as [number, number, number, number], targetRotation: [0, 0, 0, 1] as [number, number, number, number] }
    resources.update(1 / 60, false, new Map([[die.id, die]]), 1, -0.5)
    const bytes = texture.image.data
    expect(Array.from(bytes).filter((_, i) => i % 4 === 2).some(value => value > 0)).toBe(true)
    resources.dispose()
    resources.dispose()
    expect(disposed).toHaveBeenCalledOnce()
  })

  it.each(['low', 'mid', 'high'] as const)('spends the conservative %s budget on distributed short two-leaf growth before taller clusters', (deviceTier) => {
    const budget = resolveEnvironmentQuality({ deviceTier, compactViewport: false, coarsePointer: false, reducedMotion: false })
    const resources = createWoodlandResources({ ...options, quality: budget })
    const grass = resources.root.getObjectByName('woodland-grass') as Mesh<InstancedBufferGeometry>
    const roots = grass.geometry.getAttribute('aRoot')
    const shapes = grass.geometry.getAttribute('aShape')
    const shortBins = Array<number>(144).fill(0)
    let short = 0, sparseShort = 0, tall = 0
    for (let i = 0; i < roots.count; i++) {
      const height = shapes.getY(i)
      if (height <= 0.27) {
        short++
        const x = Math.min(11, Math.floor((roots.getX(i) / options.arenaHalfX + 1) * 6))
        const z = Math.min(11, Math.floor((roots.getZ(i) / options.arenaHalfZ + 1) * 6))
        shortBins[z * 12 + x]++
        if (sampleGrassField(roots.getX(i), roots.getZ(i), recipe.seed).density < 0.25) sparseShort++
      }
      if (height >= 0.4) tall++
    }
    expect(short / roots.count).toBeGreaterThanOrEqual(0.66)
    expect(short / roots.count).toBeLessThanOrEqual(0.75)
    expect(shortBins.filter(count => count > 0).length).toBeGreaterThanOrEqual(130)
    expect(sparseShort).toBeGreaterThan(short * 0.05)
    expect(tall).toBeGreaterThan(0)
    expect(tall / roots.count).toBeLessThan(0.1)
    expect(roots.count).toBeLessThanOrEqual(Math.ceil(budget.grassCount * 0.42))
    resources.dispose()
  })

  it('keeps taller organic clusters coherent above the continuous short-grass baseline', () => {
    const resources = createWoodlandResources(options)
    const grass = resources.root.getObjectByName('woodland-grass') as Mesh
    const roots = grass.geometry.getAttribute('aRoot')
    const shapes = grass.geometry.getAttribute('aShape')
    const bins = Array<number>(144).fill(0)
    let tallGrowth = 0, tallCount = 0
    for (let i = 0; i < roots.count; i++) {
      if (shapes.getY(i) <= 0.27) continue
      const x = Math.min(11, Math.floor((roots.getX(i) / options.arenaHalfX + 1) * 6))
      const z = Math.min(11, Math.floor((roots.getZ(i) / options.arenaHalfZ + 1) * 6))
      bins[z * 12 + x]++
      tallGrowth += sampleGrassField(roots.getX(i), roots.getZ(i), recipe.seed).density
      tallCount++
    }
    const sorted = [...bins].sort((a, b) => a - b)
    expect(sorted[129]).toBeGreaterThan(sorted[36] * 2)
    let fieldGrowth = 0
    for (let z = 0; z < 32; z++) for (let x = 0; x < 32; x++) {
      fieldGrowth += sampleGrassField(((x + 0.5) / 32 * 2 - 1) * options.arenaHalfX, ((z + 0.5) / 32 * 2 - 1) * options.arenaHalfZ, recipe.seed).density
    }
    expect(tallGrowth / tallCount).toBeGreaterThan(fieldGrowth / 1024 + 0.06)
    expect(roots.count).toBeLessThanOrEqual(Math.ceil(quality.grassCount * 0.42))
    expect((grass as Mesh<InstancedBufferGeometry>).geometry.instanceCount).toBe(roots.count)
    resources.dispose()
  })

  it.each(['low', 'mid', 'high'].flatMap(deviceTier => [731, 732, 2718].map(seed => [deviceTier, seed] as const)))('covers the %s field deterministically at seed %s without a forced center fraction', (deviceTier, seed) => {
    const budget = resolveEnvironmentQuality({ deviceTier: deviceTier as 'low' | 'mid' | 'high', compactViewport: false, coarsePointer: false, reducedMotion: false })
    const field = { ...options, quality: budget, recipe: { ...recipe, seed } }
    const first = createWoodlandResources(field)
    const second = createWoodlandResources(field)
    const different = createWoodlandResources({ ...field, recipe: { ...recipe, seed: seed + 1 } })
    const offsets = (resources: typeof first) => (
      resources.root.getObjectByName('woodland-grass') as Mesh
    ).geometry.getAttribute('aRoot')
    expect(offsets(first)).toBeDefined()
    expect(offsets(first).array).toEqual(offsets(second).array)
    expect(offsets(first).array).not.toEqual(offsets(different).array)
    const bins = Array<number>(16).fill(0)
    let center = 0
    for (let i = 0; i < offsets(first).count; i++) {
      const x = offsets(first).getX(i)
      const z = offsets(first).getZ(i)
      expect(Math.abs(x)).toBeLessThan(options.arenaHalfX)
      expect(Math.abs(z)).toBeLessThan(options.arenaHalfZ)
      if (Math.abs(x) < options.arenaHalfX * 0.5 && Math.abs(z) < options.arenaHalfZ * 0.5) center++
      bins[Math.floor((z / options.arenaHalfZ + 1) * 2) * 4 + Math.floor((x / options.arenaHalfX + 1) * 2)]++
      expect(offsets(first).getY(i)).toBe(-0.5)
    }
    expect(offsets(first).count).toBeLessThanOrEqual(Math.ceil(budget.grassCount * 0.42))
    expect(offsets(first).count).toBeGreaterThan(budget.grassCount * 0.15)
    expect(center).toBeGreaterThan(0)
    expect(bins.filter(count => count > 0).length).toBeGreaterThanOrEqual(14)
    const geometry = (first.root.getObjectByName('woodland-grass') as Mesh).geometry
    const shapes = geometry.getAttribute('aShape')
    for (const name of ['aShape', 'aAppearance']) {
      expect(geometry.getAttribute(name).array).toEqual((second.root.getObjectByName('woodland-grass') as Mesh).geometry.getAttribute(name).array)
    }
    const shortBins = Array<number>(144).fill(0)
    let grouped = 0, short = 0, tallCount = 0, tallGrowth = 0
    for (let i = 0; i < offsets(first).count; i++) {
      const x = offsets(first).getX(i), z = offsets(first).getZ(i)
      if (shapes.getY(i) <= 0.27) {
        short++
        shortBins[Math.min(11, Math.floor((z / options.arenaHalfZ + 1) * 6)) * 12
          + Math.min(11, Math.floor((x / options.arenaHalfX + 1) * 6))]++
      } else {
        tallGrowth += sampleGrassField(x, z, seed).density
        tallCount++
      }
      // Wider-spread two-leaf and multi-leaf roots, not a single tiny plug.
      const neighbour = [i - 1, i + 1].some(j => j >= 0 && j < offsets(first).count
        && Math.hypot(x - offsets(first).getX(j), z - offsets(first).getZ(j)) < 0.17
        && shapes.getY(i) !== shapes.getY(j))
      if (neighbour) grouped++
    }
    expect(grouped / offsets(first).count).toBeGreaterThan(0.97)
    expect(short / offsets(first).count).toBeCloseTo(0.7, 2)
    expect(shortBins.filter(count => count > 0).length).toBeGreaterThanOrEqual(128)
    let fieldGrowth = 0
    for (let z = 0; z < 32; z++) for (let x = 0; x < 32; x++) {
      fieldGrowth += sampleGrassField(((x + 0.5) / 32 * 2 - 1) * options.arenaHalfX, ((z + 0.5) / 32 * 2 - 1) * options.arenaHalfZ, seed).density
    }
    expect(tallGrowth / tallCount).toBeGreaterThan(fieldGrowth / 1024 + 0.04)
    first.dispose()
    second.dispose()
    different.dispose()
  })

  it('gives individual leaves readable length and width while keeping tips below dice faces', () => {
    const resources = createWoodlandResources(options)
    const grass = resources.root.getObjectByName('woodland-grass') as Mesh
    const shapes = grass.geometry.getAttribute('aShape')
    const roots = grass.geometry.getAttribute('aRoot')
    for (let i = 0; i < shapes.count; i++) {
      expect(shapes.getX(i)).toBeGreaterThanOrEqual(0.08 - 1e-7)
      expect(shapes.getX(i)).toBeLessThanOrEqual(0.13)
      expect(shapes.getY(i)).toBeGreaterThanOrEqual(0.16 - 1e-7)
      expect(shapes.getY(i)).toBeLessThanOrEqual(0.55)
      if (Math.abs(roots.getX(i)) < options.arenaHalfX * 0.5 && Math.abs(roots.getZ(i)) < options.arenaHalfZ * 0.5) {
        expect(shapes.getY(i)).toBeLessThanOrEqual(0.55)
      }
    }
    resources.dispose()
  })

  it('projects broad low leaves from above without increasing the ribbon topology or actual budget', () => {
    const resources = createWoodlandResources(options)
    const grass = resources.root.getObjectByName('woodland-grass') as Mesh<InstancedBufferGeometry, MeshLambertMaterial>
    const positions = grass.geometry.getAttribute('position')
    const shapes = grass.geometry.getAttribute('aShape')
    const indices = grass.geometry.index!
    let area = 0, short = 0, mid = 0, tall = 0
    for (let i = 0; i < shapes.count; i++) {
      const height = shapes.getY(i)
      expect(height).toBeGreaterThanOrEqual(0.16 - 1e-7)
      expect(height).toBeLessThanOrEqual(0.55)
      expect(shapes.getX(i)).toBeGreaterThanOrEqual(0.08 - 1e-7)
      expect(shapes.getX(i)).toBeLessThanOrEqual(0.13)
      if (height <= 0.27) short++
      else if (height < 0.42) mid++
      else tall++
      // Rest silhouette, no wind/contact, summed triangle area before overlap.
      const reachScale = (0.24 + shapes.getW(i) * 0.16) / 0.4
      for (let j = 0; j < indices.count; j += 3) {
        const [a, b, c] = [indices.getX(j), indices.getX(j + 1), indices.getX(j + 2)]
        area += Math.abs((positions.getX(b) - positions.getX(a)) * (positions.getZ(c) - positions.getZ(a))
          - (positions.getX(c) - positions.getX(a)) * (positions.getZ(b) - positions.getZ(a)))
          * shapes.getX(i) * reachScale / 2
      }
    }
    expect(short / shapes.count).toBeCloseTo(0.7, 2)
    expect(mid / shapes.count).toBeCloseTo(0.25, 2)
    expect(tall / shapes.count).toBeCloseTo(0.05, 2)
    expect(area / shapes.count).toBeGreaterThan(0.018)
    expect(positions.count).toBe(5)
    expect(indices.count).toBe(9)
    const shader = { uniforms: {}, vertexShader: ShaderLib.lambert.vertexShader, fragmentShader: ShaderLib.lambert.fragmentShader } as Parameters<MeshLambertMaterial['onBeforeCompile']>[0]
    grass.material.onBeforeCompile(shader, {} as never)
    expect(shader.vertexShader).toContain('(0.24 + aShape.w * 0.16) / 0.4')
    resources.dispose()
  })

  it('varies resting leaf directions across the field instead of combing every blade diagonally', () => {
    const resources = createWoodlandResources(options)
    const shapes = (resources.root.getObjectByName('woodland-grass') as Mesh).geometry.getAttribute('aShape')
    const angles = Array.from({ length: shapes.count }, (_, i) => shapes.getZ(i))
    expect(Math.max(...angles) - Math.min(...angles)).toBeGreaterThan(6)
    const octants = new Set(angles.map(angle => Math.floor(((angle % (Math.PI * 2) + Math.PI * 2) % (Math.PI * 2)) / (Math.PI / 4))))
    expect(octants.size).toBe(8)
    const appearance = (resources.root.getObjectByName('woodland-grass') as Mesh).geometry.getAttribute('aAppearance')
    expect(appearance.count).toBe(shapes.count)
    for (let i = 0; i < shapes.count; i++) {
      expect(appearance.getZ(i)).toBeCloseTo(Math.cos(angles[i]), 5)
      expect(appearance.getW(i)).toBeCloseTo(Math.sin(angles[i]), 5)
      expect(appearance.getX(i)).toBeGreaterThanOrEqual(0)
      expect(appearance.getX(i)).toBeLessThanOrEqual(1)
      expect(appearance.getY(i)).toBeGreaterThanOrEqual(0.94)
      expect(appearance.getY(i)).toBeLessThanOrEqual(1.06)
    }
    resources.dispose()
  })

  it.each([731, 732, 2718])('does not reshuffle props or motes when the grass budget changes at seed %s', (seed) => {
    const field = { ...options, recipe: { ...recipe, seed } }
    const first = createWoodlandResources(field)
    const second = createWoodlandResources({ ...field, quality: { ...quality, grassCount: 2500 } })
    for (const name of ['woodland-rocks', 'woodland-mushroom-caps', 'woodland-mushroom-stems', 'woodland-ferns']) {
      const a = first.root.getObjectByName(name) as InstancedMesh
      const b = second.root.getObjectByName(name) as InstancedMesh
      expect(a.instanceMatrix.array).toEqual(b.instanceMatrix.array)
    }
    const a = first.root.getObjectByName('woodland-motes') as Points
    const b = second.root.getObjectByName('woodland-motes') as Points
    expect(a.geometry.getAttribute('position').array).toEqual(b.geometry.getAttribute('position').array)
    first.dispose()
    second.dispose()
  })

  it.each(['low', 'mid', 'high'].flatMap(deviceTier => [731, 732, 2718].map(seed => [deviceTier, seed] as const)))('keeps zero %s grass truly empty without changing props or motes at seed %s', (deviceTier, seed) => {
    const budget = resolveEnvironmentQuality({ deviceTier: deviceTier as 'low' | 'mid' | 'high', compactViewport: false, coarsePointer: false, reducedMotion: false })
    const field = { ...options, recipe: { ...recipe, seed }, quality: budget }
    const populated = createWoodlandResources(field)
    const empty = createWoodlandResources({ ...field, quality: { ...budget, grassCount: 0 } })
    const grass = empty.root.getObjectByName('woodland-grass') as Mesh<InstancedBufferGeometry>
    expect(grass.geometry.instanceCount).toBe(0)
    for (const name of ['aRoot', 'aShape', 'aAppearance']) expect(grass.geometry.getAttribute(name).count).toBe(0)
    for (const name of ['woodland-rocks', 'woodland-mushroom-caps', 'woodland-mushroom-stems', 'woodland-ferns']) {
      expect((empty.root.getObjectByName(name) as InstancedMesh).instanceMatrix.array)
        .toEqual((populated.root.getObjectByName(name) as InstancedMesh).instanceMatrix.array)
    }
    const emptyMotes = empty.root.getObjectByName('woodland-motes') as Points | undefined
    const populatedMotes = populated.root.getObjectByName('woodland-motes') as Points | undefined
    expect(emptyMotes?.geometry.getAttribute('position').array).toEqual(populatedMotes?.geometry.getAttribute('position').array)
    populated.dispose()
    empty.dispose()
  })

  it('uses one shadow-receiving ground with a batched forest edge instead of four planks', () => {
    const resources = createWoodlandResources(options)
    const ground = resources.root.getObjectByName('woodland-ground') as Mesh
    expect(ground).toBeDefined()
    expect(ground.receiveShadow).toBe(true)
    expect(ground.material).toBeInstanceOf(MeshStandardMaterial)
    expect(ground.position.y).toBe(-0.5)
    expect(resources.root.children.filter(object => object.name.startsWith('woodland-rim-'))).toHaveLength(0)
    const forest = resources.root.getObjectByName('woodland-forest')!
    expect(forest).toBeDefined()
    expect(forest.children).toHaveLength(3)
    for (const name of ['woodland-tree-line', 'woodland-understory', 'woodland-wildflowers']) {
      const mesh = forest.getObjectByName(name) as Mesh
      expect(mesh.geometry.getAttribute('position').count).toBeGreaterThan(0)
      expect(mesh.receiveShadow).toBe(true)
      expect(mesh.castShadow).toBe(false)
    }
    resources.dispose()
  })

  it('paints the static undercoat from the same world-space coherent density and palette as the tufts', () => {
    const resources = createWoodlandResources(options)
    const ground = resources.root.getObjectByName('woodland-ground') as Mesh<never, MeshStandardMaterial>
    const shader = { uniforms: {}, vertexShader: ShaderLib.standard.vertexShader, fragmentShader: ShaderLib.standard.fragmentShader } as Parameters<MeshStandardMaterial['onBeforeCompile']>[0]
    ground.material.onBeforeCompile(shader, {} as never)
    const texture = shader.uniforms.uMeadowField?.value as DataTexture
    expect(texture).toBeInstanceOf(DataTexture)
    expect(texture.image.width).toBe(128)
    expect(texture.image.height).toBe(128)
    expect(texture.format).toBe(RGBAFormat)
    expect(texture.image.data.length).toBe(128 * 128 * 4)
    const bytes = texture.image.data
    for (const [column, row] of [[0, 0], [37, 21], [64, 64], [127, 127]]) {
      const x = ((column + 0.5) / 128 * 2 - 1) * (options.arenaHalfX + 0.4)
      const z = ((row + 0.5) / 128 * 2 - 1) * (options.arenaHalfZ + 0.4)
      const field = sampleGrassField(x, z, recipe.seed)
      expect(bytes[(row * 128 + column) * 4]).toBe(Math.round(field.patch * 255))
      expect(bytes[(row * 128 + column) * 4 + 1]).toBe(Math.round(field.density * 255))
      expect(bytes[(row * 128 + column) * 4 + 3]).toBe(255)
    }
    expect(shader.vertexShader).toContain('vec2(position.x, -position.y)')
    expect(shader.fragmentShader).not.toMatch(/sin\(|cos\(|woodlandFbm/)
    expect(shader.fragmentShader).toContain('#include <lights_fragment_begin>')
    const dispose = vi.spyOn(texture, 'dispose')
    resources.update(0.1, true)
    resources.dispose()
    resources.dispose()
    expect(dispose).toHaveBeenCalledOnce()
  })

  it.each([undefined, 'cel'] as const)('shares the ground palette and root brush sample without an extra fragment texture lookup in %s shading', (shading) => {
    const resources = createWoodlandResources({ ...options, recipe: { ...recipe, shading } })
    const ground = resources.root.getObjectByName('woodland-ground') as Mesh<never, MeshStandardMaterial>
    const grass = resources.root.getObjectByName('woodland-grass') as Mesh<InstancedBufferGeometry, MeshLambertMaterial>
    const compile = (material: MeshStandardMaterial | MeshLambertMaterial) => {
      const source = shading ? ShaderLib.toon : material === ground.material ? ShaderLib.standard : ShaderLib.lambert
      const shader = { uniforms: {}, vertexShader: source.vertexShader, fragmentShader: source.fragmentShader } as Parameters<MeshStandardMaterial['onBeforeCompile']>[0]
      material.onBeforeCompile(shader, {} as never)
      return shader
    }
    const floorShader = compile(ground.material)
    const bladeShader = compile(grass.material)
    const sharedPalette = (source: string) => source.match(/vec3 woodlandGroundAlbedo\([\s\S]*?\n\}/)?.[0]
    expect(sharedPalette(floorShader.fragmentShader)).toBeDefined()
    expect(sharedPalette(bladeShader.fragmentShader)).toBe(sharedPalette(floorShader.fragmentShader))
    expect(floorShader.fragmentShader).toContain('woodlandGroundAlbedo(diffuseColor.rgb, uGroundBase, uMossTip, uSun, field.rg)')
    expect(bladeShader.fragmentShader).toContain('woodlandGroundAlbedo(diffuseColor.rgb, uBase, uTip, uWarm, vGrassField)')
    expect(bladeShader.fragmentShader).toContain('smoothstep(0.0, 0.20, vHeight)')
    expect(grass.material.map).toBe(ground.material.map)
    expect(grass.material.color).toEqual(ground.material.color)
    expect(bladeShader.fragmentShader).not.toContain('uBase * 0.63')
    expect(bladeShader.fragmentShader).toContain('field.y * 0.08')
    expect(bladeShader.vertexShader).toContain('smoothstep(0.36, 0.66, aAppearance.x)')
    expect(bladeShader.vertexShader).toContain('vec2(aRoot.x + uMeadowHalf.x, uMeadowHalf.y - aRoot.z) / 4.0')
    expect(bladeShader.fragmentShader.match(/#include <map_fragment>/g)).toHaveLength(1)
    expect(bladeShader.fragmentShader).not.toContain('texture2D( map,')
    expect(bladeShader.fragmentShader).not.toContain('texture2D(uMeadowField')
    resources.dispose()
  })

  it('bakes local root shade into the existing ground texture without another draw or frame upload', () => {
    const resources = createWoodlandResources(options)
    const empty = createWoodlandResources({ ...options, quality: { ...quality, grassCount: 0 } })
    const groundField = (value: typeof resources) => {
      const ground = value.root.getObjectByName('woodland-ground') as Mesh<never, MeshStandardMaterial>
      const shader = { uniforms: {}, vertexShader: ShaderLib.standard.vertexShader, fragmentShader: ShaderLib.standard.fragmentShader } as Parameters<MeshStandardMaterial['onBeforeCompile']>[0]
      ground.material.onBeforeCompile(shader, {} as never)
      return { texture: shader.uniforms.uMeadowField.value as DataTexture, shader }
    }
    const { texture, shader } = groundField(resources)
    const roots = (resources.root.getObjectByName('woodland-grass') as Mesh).geometry.getAttribute('aRoot')
    let shadedRoots = 0
    for (let i = 0; i < roots.count; i++) {
      const x = Math.floor((roots.getX(i) / (options.arenaHalfX + 0.4) + 1) * 64)
      const z = Math.floor((roots.getZ(i) / (options.arenaHalfZ + 0.4) + 1) * 64)
      if (texture.image.data[(z * 128 + x) * 4 + 2] > 0) shadedRoots++
    }
    expect(shadedRoots / roots.count).toBeGreaterThan(0.95)
    expect(Array.from(groundField(empty).texture.image.data).filter((_, i) => i % 4 === 2).every(value => value === 0)).toBe(true)
    expect(resources.root.children.length).toBe(empty.root.children.length)
    const version = texture.version
    resources.update(0.1, true)
    expect(texture.version).toBe(version)
    expect(shader.fragmentShader).toContain('field.b')
    resources.dispose()
    empty.dispose()
  })

  it('clusters instanced rocks, mushrooms and ferns at the perimeter without intercepting drags', () => {
    const resources = createWoodlandResources(options)
    const matrix = new Matrix4()
    const point = new Vector3()
    for (const name of ['woodland-rocks', 'woodland-mushroom-caps', 'woodland-mushroom-stems', 'woodland-ferns']) {
      const mesh = resources.root.getObjectByName(name) as InstancedMesh
      expect(mesh).toBeInstanceOf(InstancedMesh)
      expect(mesh.count).toBeGreaterThan(0)
      for (let i = 0; i < mesh.count; i++) {
        mesh.getMatrixAt(i, matrix)
        point.setFromMatrixPosition(matrix)
        expect(Math.abs(point.x) > options.arenaHalfX * 0.76 || Math.abs(point.z) > options.arenaHalfZ * 0.76).toBe(true)
        expect(Math.abs(point.x)).toBeLessThan(options.arenaHalfX)
        expect(Math.abs(point.z)).toBeLessThan(options.arenaHalfZ)
      }
    }
    resources.root.traverse((object) => {
      const hits: unknown[] = []
      object.raycast({} as never, hits as never[])
      expect(hits).toEqual([])
    })
    resources.dispose()
  })

  it.each(['low', 'mid', 'high'] as const)('bounds %s atmosphere to policy counts with depth-safe additive shafts', (deviceTier) => {
    const budget = resolveEnvironmentQuality({ deviceTier, compactViewport: false, coarsePointer: false, reducedMotion: false })
    const resources = createWoodlandResources({ ...options, quality: budget })
    const motes = resources.root.getObjectByName('woodland-motes') as Points | undefined
    expect(motes?.geometry.getAttribute('position').count ?? 0).toBe(budget.particleCount)
    const shafts = resources.root.children.filter((object) => object.name.startsWith('woodland-shaft-')) as Mesh[]
    expect(shafts).toHaveLength(budget.shaftCount)
    for (const shaft of shafts) {
      const mat = shaft.material as ShaderMaterial
      expect(mat.blending).toBe(AdditiveBlending)
      expect(mat.depthTest).toBe(true)
      expect(mat.depthWrite).toBe(false)
      const bounds = new Box3().setFromObject(shaft)
      expect(bounds.min.x >= options.arenaHalfX * 0.5 || bounds.max.x <= -options.arenaHalfX * 0.5).toBe(true)
      expect(bounds.min.z >= options.arenaHalfZ * 0.5 || bounds.max.z <= -options.arenaHalfZ * 0.5).toBe(true)
    }
    resources.dispose()
  })

  it('lights and shadows the meadow through the Lambert pipeline with one reused world-space bend sample', () => {
    const resources = createWoodlandResources(options)
    const grass = resources.root.getObjectByName('woodland-grass') as Mesh<InstancedBufferGeometry, MeshLambertMaterial & { uniforms: Record<string, { value: number }> }>
    expect(grass.material).toBeInstanceOf(MeshLambertMaterial)
    expect(grass.receiveShadow).toBe(true)
    expect(grass.material.uniforms.uWindStrength.value).toBeGreaterThanOrEqual(0.1)
    expect(grass.material.uniforms.uWindStrength.value).toBeLessThanOrEqual(0.2)
    const shader = { uniforms: {}, vertexShader: ShaderLib.lambert.vertexShader, fragmentShader: ShaderLib.lambert.fragmentShader } as Parameters<MeshLambertMaterial['onBeforeCompile']>[0]
    grass.material.onBeforeCompile(shader, {} as never)
    expect(shader.uniforms.uTime).toBe(grass.material.uniforms.uTime)
    expect(shader.vertexShader).toContain('#include <shadowmap_vertex>')
    expect(shader.fragmentShader).toContain('#include <lights_fragment_begin>')
    expect(shader.vertexShader).toContain('attribute vec3 aRoot')
    expect(shader.vertexShader.match(/texture2D\(uWindNoise/g)).toHaveLength(1)
    expect(shader.vertexShader.match(/texture2D\(uInteraction/g)).toHaveLength(1)
    expect(shader.vertexShader).not.toMatch(/sin\(|cos\(|woodlandFbm|woodlandValueNoise/)
    expect(shader.vertexShader).toContain('aRoot.xz - vec2(0.55, 0.28) * uTime')
    expect(shader.vertexShader).toContain('woodlandBend * position.y * position.y')
    expect(shader.vertexShader).toContain('dot(woodlandBend, objectNormal.xz)')
    expect(shader.vertexShader).toContain('aAppearance.zw')
    expect(shader.vertexShader.indexOf('vec2 woodlandBend =')).toBeLessThan(shader.vertexShader.indexOf('vec3 objectNormal ='))
    resources.dispose()
  })

  it('attaches root normals to the soil before returning to the corrected blade normal', () => {
    const resources = createWoodlandResources(options)
    const grass = resources.root.getObjectByName('woodland-grass') as Mesh<InstancedBufferGeometry, MeshLambertMaterial>
    const shader = { uniforms: {}, vertexShader: ShaderLib.lambert.vertexShader, fragmentShader: ShaderLib.lambert.fragmentShader } as Parameters<MeshLambertMaterial['onBeforeCompile']>[0]
    grass.material.onBeforeCompile(shader, {} as never)
    for (let i = 0; i < grass.geometry.getAttribute('normal').count; i++) {
      // The overhead face must be front-facing, or DoubleSide flips the shared
      // up normal down in the fragment shader and recreates the dark seam.
      expect(grass.geometry.getAttribute('normal').getY(i)).toBeGreaterThan(0)
    }
    expect(shader.vertexShader).toContain('mix(vec3(0.0, 1.0, 0.0), objectNormal, smoothstep(0.0, 0.45, position.y))')
    expect(shader.vertexShader.indexOf('dot(woodlandBend, objectNormal.xz)')).toBeLessThan(shader.vertexShader.indexOf('mix(vec3(0.0, 1.0, 0.0)'))
    resources.dispose()
  })

  it('owns repeat-filtered bandlimited RG wind that stays deterministic and allocation-free when frozen', () => {
    const first = createWoodlandResources(options)
    const second = createWoodlandResources(options)
    const getWind = (resources: typeof first) => (resources.root.getObjectByName('woodland-grass') as Mesh<InstancedBufferGeometry, ShaderMaterial>).material.uniforms.uWindNoise?.value as DataTexture
    const texture = getWind(first)
    expect(texture).toBeInstanceOf(DataTexture)
    expect(texture.format).toBe(RGBAFormat)
    expect(texture.image.data.length).toBe(64 * 64 * 4)
    expect(texture.image.width).toBe(64)
    expect(texture.image.height).toBe(64)
    expect(texture.wrapS).toBe(RepeatWrapping)
    expect(texture.wrapT).toBe(RepeatWrapping)
    expect(texture.minFilter).toBe(LinearFilter)
    expect(texture.magFilter).toBe(LinearFilter)
    expect(texture.generateMipmaps).toBe(false)
    expect(texture.image.data).toEqual(getWind(second).image.data)
    const bytes = texture.image.data
    let maxStep = 0
    for (let y = 0; y < 64; y++) for (let x = 0; x < 64; x++) for (let channel = 0; channel < 2; channel++) {
      const value = bytes[(y * 64 + x) * 4 + channel]
      maxStep = Math.max(maxStep, Math.abs(value - bytes[(y * 64 + (x + 1) % 64) * 4 + channel]), Math.abs(value - bytes[(((y + 1) % 64) * 64 + x) * 4 + channel]))
    }
    expect(maxStep).toBeLessThan(35)
    expect(Math.max(...bytes) - Math.min(...bytes)).toBeGreaterThan(100)
    const version = texture.version
    first.update(0.1, true)
    first.update(0.1, false)
    expect(getWind(first)).toBe(texture)
    expect(texture.version).toBe(version)
    const dispose = vi.spyOn(texture, 'dispose')
    first.dispose()
    first.dispose()
    second.dispose()
    expect(dispose).toHaveBeenCalledOnce()
  })

  it('advances shader time only while animation is enabled, freezing immediately on preference changes', () => {
    const resources = createWoodlandResources(options)
    const grass = resources.root.getObjectByName('woodland-grass') as Mesh<InstancedBufferGeometry, ShaderMaterial>
    const motes = resources.root.getObjectByName('woodland-motes') as Points<never, ShaderMaterial>
    resources.update(0.1, true)
    expect(grass.material.uniforms.uTime.value).toBeCloseTo(0.1)
    expect(motes.material.uniforms.uTime.value).toBeCloseTo(0.1)
    resources.update(0.1, false)
    expect(grass.material.uniforms.uTime.value).toBeCloseTo(0.1)
    expect(motes.material.uniforms.uTime.value).toBeCloseTo(0.1)
    resources.update(0.1, true)
    expect(grass.material.uniforms.uTime.value).toBeCloseTo(0.2)
    resources.dispose()
  })

  it('disposes every unique GPU resource once, including shared materials, Points and instance buffers', () => {
    const resources = createWoodlandResources(options)
    const owned = new Set<{ dispose: () => void }>()
    resources.root.traverse((object) => {
      if (object instanceof Mesh || object instanceof Points) {
        owned.add(object.geometry)
        const materials = Array.isArray(object.material) ? object.material : [object.material]
        materials.forEach((material) => owned.add(material))
      }
      if (object instanceof InstancedMesh) owned.add(object)
    })
    const spies = [...owned].map((object) => vi.spyOn(object, 'dispose'))
    resources.dispose()
    resources.dispose()
    spies.forEach((spy) => expect(spy).toHaveBeenCalledTimes(1))
  })

  it('allocates at most the cap as opaque curved, tapered three-triangle ribbons', () => {
    const resources = createWoodlandResources(options)
    const grass = resources.root.getObjectByName('woodland-grass') as Mesh<InstancedBufferGeometry>
    expect(grass.geometry).toBeInstanceOf(InstancedBufferGeometry)
    expect(grass.geometry.instanceCount).toBeLessThanOrEqual(quality.grassCount)
    const positions = grass.geometry.getAttribute('position')
    expect(positions.count).toBe(5)
    const indices = grass.geometry.index!
    expect(indices?.count).toBe(9)
    expect(positions.getX(1) - positions.getX(0)).toBeGreaterThan(positions.getX(3) - positions.getX(2))
    expect(positions.getZ(4) / positions.getY(4)).toBeGreaterThanOrEqual(0.3)
    expect(positions.getZ(4) / positions.getY(4)).toBeLessThanOrEqual(0.5)
    expect(positions.getZ(2)).not.toBeCloseTo(positions.getY(2) * positions.getZ(4))
    for (let i = 0; i < indices.count; i += 3) {
      const a = new Vector3().fromBufferAttribute(positions, indices.getX(i))
      const b = new Vector3().fromBufferAttribute(positions, indices.getX(i + 1))
      const c = new Vector3().fromBufferAttribute(positions, indices.getX(i + 2))
      expect(b.sub(a).cross(c.sub(a)).length()).toBeGreaterThan(0.001)
    }
    const normals = grass.geometry.getAttribute('normal')
    expect(normals?.count).toBe(positions.count)
    for (let i = 0; i < normals.count; i++) expect(new Vector3().fromBufferAttribute(normals, i).length()).toBeCloseTo(1)
    expect(grass.castShadow).toBe(false)
    expect(Array.isArray(grass.material)).toBe(false)
    expect((grass.material as { transparent: boolean }).transparent).toBe(false)
    expect((grass.material as { depthWrite: boolean }).depthWrite).toBe(true)
    resources.dispose()
  })
})
