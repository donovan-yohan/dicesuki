import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { Mesh, MeshBasicMaterial, MeshToonMaterial, PointLight, ShaderLib, TextureLoader } from 'three'
import { createCyberpunkEnvironment } from './cyberpunkEnvironment'
import { monsterDungeonTheme, cyberpunkCutlineTheme } from '../../themes/worlds'
import { createDungeonEnvironment } from './dungeonEnvironment'
import { attachWorldCel } from './environmentCel'
import { resolveEnvironmentQuality } from '../../lib/environmentQuality'

const quality = resolveEnvironmentQuality({ deviceTier: 'low', compactViewport: false, coarsePointer: false, reducedMotion: false })
beforeEach(() => {
  // Native canvas paths used by the synchronous painted-enamel artwork.
  const context = document.createElement('canvas').getContext('2d')!
  Object.assign(context, { strokeRect: vi.fn(), arc: vi.fn(), stroke: vi.fn() })
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(context)
})
afterEach(() => vi.restoreAllMocks())

it('keeps painted LAST BOWL signs lit separately from HDR source bars and local spill', () => {
  const world = createCyberpunkEnvironment({ quality, arenaHalfX: 4, arenaHalfZ: 10, groundY: -.5, seed: 41 })
  try {
    // RELAY's HDR ink was retired: enamel receives native light; source bars
    // remain the separately HDR-selectable bloom contributors.
    const sign = world.root.getObjectByName('physical-sign-LAST BOWL') as Mesh
    expect(sign).toBeInstanceOf(Mesh)
    const material = sign.material as MeshToonMaterial
    expect(material).toBeInstanceOf(MeshToonMaterial)
    expect(material.map).not.toBeNull()
    expect(Math.max(...material.color.toArray())).toBeLessThanOrEqual(1)
    const shader = { uniforms: {}, vertexShader: ShaderLib.toon.vertexShader, fragmentShader: ShaderLib.toon.fragmentShader } as Parameters<MeshToonMaterial['onBeforeCompile']>[0]
    material.onBeforeCompile(shader, {} as never)
    expect(shader.fragmentShader).toContain('dungeonBands(reflectedLight.directDiffuse + reflectedLight.indirectDiffuse)')
    expect(shader.fragmentShader).not.toContain('cyberSignInk')
    const lights: PointLight[] = []
    const hdrBars: MeshBasicMaterial[] = []
    world.root.traverse(object => {
      if (object instanceof PointLight) lights.push(object)
      if (object instanceof Mesh && object.material instanceof MeshBasicMaterial && Math.max(...object.material.color.toArray()) > 1) hdrBars.push(object.material)
    })
    expect(hdrBars.length).toBeGreaterThanOrEqual(2)
    const litColors = hdrBars.map(bar => bar.color.clone())
    expect(lights).toHaveLength(2)
    expect(lights.every(light => light.distance > 15 && light.intensity >= 45)).toBe(true)
    expect(lights.every(light => light.distance > light.position.length() + 3)).toBe(true)
    world.setNeon(false)
    expect(lights.every(light => !light.visible)).toBe(true)
    expect(hdrBars.every(bar => Math.max(...bar.color.toArray()) <= 1)).toBe(true)
    world.setNeon(true)
    expect(lights.every(light => light.visible)).toBe(true)
    expect(hdrBars.every((bar, i) => bar.color.equals(litColors[i]))).toBe(true)
  } finally { world.dispose() }
})

it('keeps directional night light restrained without capping dungeon readability fill', () => {
  expect(cyberpunkCutlineTheme.environment.lighting.ambient.intensity).toBeLessThanOrEqual(.15)
  for (const theme of [monsterDungeonTheme, cyberpunkCutlineTheme]) {
    expect(theme.environment.lighting.directional.intensity).toBeLessThanOrEqual(.35)
  }
})

it('keeps warm candle spill reaching the middle of a long arena at both quality tiers', () => {
  vi.spyOn(TextureLoader.prototype, 'loadAsync').mockImplementation(() => new Promise(() => {}))
  for (const tier of ['low', 'high'] as const) {
    const world = createDungeonEnvironment({ quality: { ...quality, tier }, arenaHalfX: 4, arenaHalfZ: 10, groundY: -.5, seed: 41 })
    try {
      const lights = world.controls.warmLights
      expect(lights).toHaveLength(4)
      expect(lights.every(light => light.distance > light.position.length() + 3)).toBe(true)
      expect(lights.every(light => light.color.r > light.color.g && light.color.g > light.color.b)).toBe(true)
      expect(lights.every(light => light.intensity >= 30)).toBe(true)
      world.update(.05)
      expect(lights.every(light => light.intensity >= 30)).toBe(true)
    } finally { world.dispose() }
  }
})

it('allows night surfaces to go dark without changing the original caller response', () => {
  const classic = attachWorldCel(new MeshToonMaterial())
  const night = attachWorldCel(new MeshToonMaterial(), 'night')
  try {
    const compile = (material: MeshToonMaterial) => {
      const shader = { uniforms: {}, vertexShader: ShaderLib.toon.vertexShader, fragmentShader: ShaderLib.toon.fragmentShader } as Parameters<MeshToonMaterial['onBeforeCompile']>[0]
      material.onBeforeCompile(shader, {} as never)
      return shader.fragmentShader
    }
    expect(compile(classic)).toContain('float band = .26;')
    const nightShader = compile(night)
    expect(nightShader).toContain('float band = .045;')
    expect(nightShader).toContain('mix(band, .12,')
    expect(nightShader).toContain('mix(band, .38,')
    expect(nightShader).toContain('mix(band, .85,')
    expect(nightShader).not.toContain('vec3(.80,.87,1.0)')
    expect(classic.customProgramCacheKey()).not.toBe(night.customProgramCacheKey())
  } finally { classic.dispose(); night.dispose() }
})
