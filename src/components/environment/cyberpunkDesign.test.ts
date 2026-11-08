import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createHash } from 'node:crypto'
import * as THREE from 'three'
import { createCyberpunkEnvironment } from './cyberpunkEnvironment'
import { quality as cyberpunkQuality, surfacePixels } from './cyberpunkSurfaces'
import { resolveEnvironmentQuality } from '../../lib/environmentQuality'

const quality = resolveEnvironmentQuality({ deviceTier: 'low', compactViewport: false, coarsePointer: false, reducedMotion: false })
const options = { quality, arenaHalfX: 4, arenaHalfZ: 7, groundY: -.5, seed: 41 }

beforeEach(() => {
  // The enamel artwork uses native canvas paths absent from the shared 2D facade.
  const context = document.createElement('canvas').getContext('2d')!
  Object.assign(context, { strokeRect: vi.fn(), arc: vi.fn(), stroke: vi.fn() })
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(context)
})
afterEach(() => vi.restoreAllMocks())

describe('Cyberpunk authored materials and ownership', () => {
  it('reuses bounded shipping-tier pixel work without sharing mutable texture arrays', () => {
    const first = surfacePixels(256, 'metal')
    const albedo = first.albedo.slice()
    const normal = first.normal.slice()
    first.albedo.fill(0)
    first.normal.fill(0)
    const sine = Math.sin
    let sineCalls = 0
    vi.spyOn(Math, 'sin').mockImplementation(value => { sineCalls++; return sine(value) })
    const second = surfacePixels(256, 'metal')
    expect(sineCalls).toBe(0)
    expect(second.albedo).not.toBe(first.albedo)
    expect(second.normal).not.toBe(first.normal)
    expect(second.albedo).toEqual(albedo)
    expect(second.normal).toEqual(normal)
  })

  it('bounds inclusion intersection work to small raster footprints instead of every chip per pixel', () => {
    const absolute = Math.abs
    let intersections = 0
    vi.spyOn(Math, 'abs').mockImplementation(value => { intersections++; return absolute(value) })
    surfacePixels(64, 'paving')
    expect(intersections).toBeLessThan(64 * 64 * 4)
  })

  it('preserves frozen LAST BOWL albedo and normals byte-for-byte at boundary samples and shipping tiers', () => {
    // SHA-256(albedo || normal), generated from Hotate's released surface module
    // 6e13f68ada119e3f454f79641758effe511b9630cd058e8274a80412f20f6abc.
    // These guard exact first-match chips, floating-point heights and RNG order
    // while the bounded raster implementation replaces its expensive scan.
    const expected = {
      63: [
        'f11d8cfd95b673203ee60d418dfd909180e6bb2c2c591c272890369fac5d44b9',
        '2fc3995f9a3e547b6d0291214a8b7e9ce50acd794d4471d486c456a901fe3228',
        '360bec4fdd02b6d860003a4c641599063adf9f60ee0e720a51f32124faf6ffd0',
        '8c946d1325eca9a4a6f011635acb5f3438212ee7796751d366c9a848aac1891a',
        'bc1f41ce10d599123658ed732393e1af5dca57aca872c771e047490c1fa40a45',
      ],
      64: [
        '66dff382eeb4dfbf1baf356db585b9a498ed3864a2b707b3faab353ab5dde3c7',
        'e5e84a17c60f00952248aa253a925545cc3ff07739eeed623f29f9c323167d10',
        '599498a525e0f715f43c7fcc7ed7879fef5b73b1bea9eabadbb71efc722f0501',
        'c0efa89248c33f48f04bed8a97db40dca7d0a61b50099eb32aba3949d3a2fc9e',
        '192ac23c61a9bee581911c1f424cb96d7d6fa971de5fe5b13125b7a5b3785137',
      ],
      65: [
        '3bada5b7f362e8dfec8341180f8bcf7a696bedf8d30df7af7d2dbe3b82671b3e',
        'bd400ad3e8ff619e74854cd291ef8a14cba030e00850ac8eabac270a8e7461e3',
        '99dbe57ffa438244db471210849e56bc81207ac1373bf02a9fa3fbe963e0f6bb',
        '7252529c61f8c692022694675eac56d0401f8da1b62391857ee553ee3350357a',
        '04ea889708fd7b036078ca9353e075f9ec238a43acfc785814a6467d50c2c657',
      ],
      256: [
        'd77126f49d1cd497ddb51fad5443cc3b7cda8d882004a7a0db885f070c781500',
        'c0ccbf9dcebd15e51135ed19732a3d8f9f12b56f3ab54215c75c0badf537bf0c',
        'd093f22ef536d43aaf2fde5f3eb91a97bea1ebf528864125ec255850bc7c3d4b',
        'df36ee9b9298db6b54c60b59266d2b6642ecbb3eb78c8babd1fa40b58377fb95',
        '6ac258ec9d2cb8c4996a6e39717ff1ce6c9215b2478ef0059685792280ae2aa5',
      ],
      512: [
        '24e2f0e56b26946d1d4379c8303847fe10a1ee1d534f79a0f073cd298d9684fc',
        '12dbdb0567d16e062f9910876c8a8ddb2556614194329c3130822d1b3a99b206',
        '0732a0efd91ab527d8da277b885323d1d59c3e9731e4b976eb220665aadbc55c',
        '2d9d5bb872c53170675151292aa697136bc838870aad1175bec403c99433b202',
        '1476f3d301b195251cba0656def9d0d3ee7785963c9d142925d3aa64cbceaec7',
      ],
    }
    const kinds = ['paving', 'wall', 'enamel', 'metal', 'rubber'] as const
    for (const [size, hashes] of Object.entries(expected)) {
      for (let i = 0; i < kinds.length; i++) {
        const pixels = surfacePixels(Number(size), kinds[i])
        expect(createHash('sha256').update(pixels.albedo).update(pixels.normal).digest('hex')).toBe(hashes[i])
      }
    }
  })

  it('owns exactly two native lights and excludes gameplay from the reflection camera', () => {
    const world = createCyberpunkEnvironment(options)
    try {
      const lights: THREE.PointLight[] = []
      world.root.traverse(object => { if (object instanceof THREE.PointLight) lights.push(object) })
      expect(lights).toHaveLength(2)
      expect(world.reflectionSurface.camera.layers.mask).toBe(2)
      expect(cyberpunkQuality('low')).toMatchObject({ reflectionSize: 256, reflectionHz: 12 })
      expect(cyberpunkQuality('high')).toMatchObject({ reflectionSize: 512, reflectionHz: 20 })
    } finally { world.dispose() }
  })

  it('retires geometry, materials and authored textures once without reviving the owner', () => {
    const world = createCyberpunkEnvironment(options)
    const resources = new Set<THREE.BufferGeometry | THREE.Material | THREE.Texture>()
    world.root.traverse(object => {
      if (!(object instanceof THREE.Mesh)) return
      resources.add(object.geometry)
      for (const material of Array.isArray(object.material) ? object.material : [object.material]) {
        resources.add(material)
        for (const value of Object.values(material)) {
          if (value instanceof THREE.Texture) resources.add(value)
        }
      }
    })
    const disposals = [...resources].map(resource => vi.spyOn(resource, 'dispose'))
    const targetDisposal = vi.spyOn(world.reflectionSurface.getRenderTarget(), 'dispose')
    try {
      expect(resources.size).toBeGreaterThan(0)
      world.dispose()
      world.dispose()
      world.update(1, true)
      expect(world.root.children).toHaveLength(0)
      expect(world.stats()).toMatchObject({ disposed: true, time: 0 })
      expect(disposals.every(dispose => dispose.mock.calls.length === 1)).toBe(true)
      expect(targetDisposal).toHaveBeenCalledTimes(1)
    } finally { world.dispose() }
  })

  it('keeps painted sign stock on the native combined night-light shader', () => {
    const world = createCyberpunkEnvironment(options)
    try {
      const signs: THREE.Mesh[] = []
      world.root.traverse(object => {
        if (object instanceof THREE.Mesh && object.name.startsWith('physical-sign-')) signs.push(object)
      })
      expect(signs.length).toBeGreaterThan(0)
      // Assert material behavior before artwork identity so predecessor failure is
      // the unlit substrate, not merely the absence of the successor's name.
      for (const sign of signs) {
        expect(sign.material).toBeInstanceOf(THREE.MeshToonMaterial)
        const material = sign.material as THREE.MeshToonMaterial
        const shader = { uniforms: {}, vertexShader: THREE.ShaderLib.toon.vertexShader, fragmentShader: THREE.ShaderLib.toon.fragmentShader } as Parameters<THREE.MeshToonMaterial['onBeforeCompile']>[0]
        material.onBeforeCompile(shader, {} as THREE.WebGLRenderer)
        expect(shader.fragmentShader).toContain('dungeonBands(reflectedLight.directDiffuse + reflectedLight.indirectDiffuse)')
      }
      expect(world.root.getObjectByName('physical-sign-LAST BOWL')).toBeInstanceOf(THREE.Mesh)
    } finally { world.dispose() }
  })

  it('keeps five deterministic distinct material fields with valid albedo and normal buffers', () => {
    const fields = ['paving', 'wall', 'enamel', 'metal', 'rubber'] as const
    const pixels = fields.map(kind => surfacePixels(64, kind))
    for (let i = 0; i < fields.length; i++) {
      expect(pixels[i].albedo).toHaveLength(64 * 64 * 4)
      expect(pixels[i].normal).toHaveLength(64 * 64 * 4)
      expect(pixels[i]).toEqual(surfacePixels(64, fields[i]))
    }
    for (let i = 0; i < pixels.length; i++) {
      for (let j = i + 1; j < pixels.length; j++) {
        expect(pixels[i].albedo).not.toEqual(pixels[j].albedo)
      }
    }
  })
})
