import { describe, expect, it } from 'vitest'
import { RepeatWrapping, RGBAFormat, SRGBColorSpace } from 'three'
import { createGrassAlbedoTextures } from './woodlandTextures'

describe('original painted forest grass textures', () => {
  it('provides deterministic opaque mipmapped blade and ground maps with gentle variation', () => {
    const first = createGrassAlbedoTextures()
    const second = createGrassAlbedoTextures()
    for (const key of ['ground', 'blade'] as const) {
      const texture = first[key]
      expect(texture.image.width).toBeGreaterThanOrEqual(32)
      expect(texture.format).toBe(RGBAFormat)
      expect(texture.colorSpace).toBe(SRGBColorSpace)
      expect(texture.generateMipmaps).toBe(true)
      expect(texture.image.data).toEqual(second[key].image.data)
      const bytes = texture.image.data
      const greens = new Set<number>()
      let opaque = true, greenDominant = true, maximumGreenDifference = 0
      for (let i = 0; i < bytes.length; i += 4) {
        opaque &&= bytes[i + 3] === 255
        greenDominant &&= bytes[i + 1] >= bytes[i]
        maximumGreenDifference = Math.max(maximumGreenDifference, bytes[i + 1] - bytes[i])
        greens.add(bytes[i + 1])
      }
      expect(opaque).toBe(true)
      expect(greenDominant).toBe(true)
      expect(maximumGreenDifference).toBeLessThan(25)
      expect(greens.size).toBeGreaterThan(15)
      texture.dispose()
      second[key].dispose()
    }
    expect(first.ground.wrapS).toBe(RepeatWrapping)
    expect(first.ground.wrapT).toBe(RepeatWrapping)
  })
})
