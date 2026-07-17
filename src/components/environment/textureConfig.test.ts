import { describe, expect, it } from 'vitest'
import * as THREE from 'three'
import {
  configureEnvironmentTexture,
  resolveEnvironmentTextureConfig,
  resolveEnvironmentTextureRepeat,
} from './textureConfig'

describe('environment texture config', () => {
  it('prefers explicit albedo maps while preserving the legacy texture field', () => {
    expect(resolveEnvironmentTextureConfig({ texture: '/legacy.jpg' }).colorUrl).toBe('/legacy.jpg')
    expect(resolveEnvironmentTextureConfig({
      texture: '/legacy.jpg',
      colorTexture: '/color.jpg',
      albedoTexture: '/albedo.jpg',
    }).colorUrl).toBe('/albedo.jpg')
  })

  it('normalizes repeat and normal scale to independent vector pairs', () => {
    expect(resolveEnvironmentTextureConfig({ repeat: [3, 2], normalScale: 0.4 })).toMatchObject({
      repeat: [3, 2],
      normalScale: [0.4, 0.4],
    })
  })

  it.each([
    ['floor and ceiling width/depth', [12, 8], [6, 4]],
    ['front and back wall width/height', [12, 6], [6, 3]],
    ['side wall depth/height', [8, 6], [4, 3]],
    ['multiplayer floor and ceiling', [11, 18], [5.5, 9]],
    ['multiplayer front and back walls', [10, 6], [5, 3]],
    ['multiplayer side walls', [17, 6], [8.5, 3]],
  ] as const)('computes world-space repeat for %s', (_label, surfaceSize, expected) => {
    expect(resolveEnvironmentTextureRepeat({ tileSize: 2 }, [...surfaceSize])).toEqual([...expected])
  })

  it('supports rectangular world-unit tiles', () => {
    expect(resolveEnvironmentTextureRepeat({ tileSize: [4, 2] }, [12, 8])).toEqual([3, 4])
  })

  it('falls back to legacy fixed repeat without a complete world-space contract', () => {
    expect(resolveEnvironmentTextureRepeat({ repeat: [3, 2] }, [12, 8])).toEqual([3, 2])
    expect(resolveEnvironmentTextureRepeat({ tileSize: 2, repeat: [3, 2] })).toEqual([3, 2])
    expect(resolveEnvironmentTextureRepeat({ tileSize: 0, repeat: [3, 2] }, [12, 8])).toEqual([3, 2])
  })

  it('configures color and normal maps with an identical computed repeat', () => {
    const repeat = resolveEnvironmentTextureConfig({ tileSize: 2 }, [12, 8]).repeat
    const colorMap = configureEnvironmentTexture(new THREE.Texture(), 'color', repeat)
    const normalMap = configureEnvironmentTexture(new THREE.Texture(), 'normal', repeat)

    expect(colorMap).toMatchObject({ wrapS: THREE.RepeatWrapping, wrapT: THREE.RepeatWrapping, colorSpace: THREE.SRGBColorSpace })
    expect(colorMap.repeat.toArray()).toEqual([6, 4])
    expect(normalMap.colorSpace).toBe(THREE.NoColorSpace)
    expect(normalMap.repeat.toArray()).toEqual(colorMap.repeat.toArray())
  })
})
