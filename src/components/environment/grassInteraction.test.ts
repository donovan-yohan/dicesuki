import { afterEach, describe, expect, it, vi } from 'vitest'
import * as THREE from 'three'
import { createGrassInteractionField, type GrassContactDie } from './grassInteraction'

function die(x = 0, z = 0, y = 0.55): GrassContactDie {
  return { id: 'die', diceType: 'd6', prevPosition: [x, y, z], targetPosition: [x, y, z], prevRotation: [0, 0, 0, 1], targetRotation: [0, 0, 0, 1] }
}
function contacts(value = die()) { return new Map([[value.id, value]]) }
function pixel(texture: THREE.DataTexture, x: number, z: number, halfX = 8, halfZ = 8) {
  const column = Math.max(0, Math.min(63, Math.floor((x + halfX) / (2 * halfX) * 64)))
  const row = Math.max(0, Math.min(63, Math.floor((z + halfZ) / (2 * halfZ) * 64)))
  return Array.from(texture.image.data.slice((row * 64 + column) * 4, (row * 64 + column) * 4 + 4))
}

const fields: ReturnType<typeof createGrassInteractionField>[] = []
function field(halfX = 8, halfZ = 8) {
  const value = createGrassInteractionField(halfX, halfZ)
  fields.push(value)
  return value
}

afterEach(() => {
  for (const value of fields) value.dispose()
  fields.length = 0
})

describe('grass interaction field', () => {
  it('keeps grounded stationary dice compressed with localized outward bend', () => {
    const value = field()
    const dice = contacts()
    value.update(1 / 60, dice, 1, 0)
    expect(pixel(value.texture, 0, 0)[2]).toBeGreaterThan(220)
    expect(pixel(value.texture, 0.5, 0)[0]).toBeGreaterThan(128)
    expect(pixel(value.texture, -0.5, 0)[0]).toBeLessThan(128)
    expect(pixel(value.texture, 0, 0).slice(0, 2)).not.toEqual([128, 128])
    expect(pixel(value.texture, 3, 3)).toEqual([128, 128, 0, 255])
    for (let frame = 0; frame < 120; frame++) value.update(1 / 60, dice, 1, 0)
    expect(pixel(value.texture, 0, 0)[2]).toBeGreaterThan(220)
  })

  it('only presses when the rendered die bottom enters the engine-relative blade ceiling', () => {
    const value = field()
    value.update(1 / 60, contacts(die(0, 0, 4)), 1, 0)
    expect(pixel(value.texture, 0, 0)).toEqual([128, 128, 0, 255])
    value.update(1 / 60, contacts(die(0, 0, 2.55)), 1, 2)
    expect(pixel(value.texture, 0, 0)[2]).toBeGreaterThan(220)
    const grazing = field()
    grazing.update(1 / 60, contacts(die(0, 0, 1.25)), 1, 0)
    expect(pixel(grazing.texture, 0, 0)[2]).toBeGreaterThan(0)
    expect(pixel(grazing.texture, 0, 0)[2]).toBeLessThan(100)
  })

  it('uses clamped rendered interpolation, including exact endpoints and midpoint', () => {
    const moving = die(-3, -2)
    moving.targetPosition = [3, 0.55, 2]
    for (const [t, x, z] of [[0, -3, -2], [1, 3, 2], [0.5, 0, 0], [-1, -3, -2], [2, 3, 2]]) {
      const value = field()
      value.update(1 / 60, contacts(moving), t, 0)
      expect(pixel(value.texture, x, z)[2]).toBeGreaterThan(220)
      expect(pixel(value.texture, -x || 3, -z || 2)[2]).toBe(0)
    }
  })

  it('slerps the canonical shape support instead of treating dice as identical upright cubes', () => {
    const rolling = die(0, 0, 1.5)
    rolling.targetRotation = [0, 0, Math.SQRT1_2, Math.SQRT1_2]
    for (const t of [0, 1]) {
      const value = field()
      value.update(1 / 60, contacts(rolling), t, 0)
      expect(pixel(value.texture, 0, 0)[2]).toBe(0)
    }
    const midpoint = field()
    midpoint.update(1 / 60, contacts(rolling), 0.5, 0)
    expect(pixel(midpoint.texture, 0, 0)[2]).toBeGreaterThan(0)
  })

  it('recovers removed contacts exponentially using full elapsed time without quantized sticking', () => {
    const oneStep = field()
    const manySteps = field()
    for (const value of [oneStep, manySteps]) value.update(1 / 60, contacts(), 1, 0)
    const original = pixel(oneStep.texture, 0, 0)[2]
    const empty = new Map<string, GrassContactDie>()
    oneStep.update(0.7, empty, 1, 0)
    for (let i = 0; i < 70; i++) manySteps.update(0.01, empty, 1, 0)
    expect(pixel(oneStep.texture, 0, 0)[2]).toBeGreaterThan(0)
    expect(pixel(oneStep.texture, 0, 0)[2]).toBeLessThan(original / 4)
    expect(oneStep.texture.image.data).toEqual(manySteps.texture.image.data)
    for (let i = 0; i < 780; i++) manySteps.update(1 / 600, empty, 1, 0)
    oneStep.update(1.3, empty, 1, 0)
    expect(oneStep.texture.image.data).toEqual(manySteps.texture.image.data)
    expect(pixel(manySteps.texture, 0, 0)).toEqual([128, 128, 0, 255])
  })

  it('bends grass toward signed rolling motion rather than only radially', () => {
    for (const [dx, dz, channel] of [[1, 0, 0], [-1, 0, 0], [0, 1, 1], [0, -1, 1]]) {
      const value = field()
      const moving = die(-dx, -dz)
      moving.targetPosition = [0, 0.55, 0]
      value.update(1 / 60, contacts(moving), 1, 0)
      const bend = pixel(value.texture, -dx * 0.25, -dz * 0.25)[channel] - 128
      expect(bend * (dx || dz)).toBeGreaterThan(40)
    }
  })

  it('sweeps between consecutive rendered grounded contacts without gaps', () => {
    const value = field()
    value.update(1 / 60, contacts(die(-1.25)), 1, 0)
    const rolling = die(-1.25)
    rolling.targetPosition = [1.25, 0.55, 0]
    value.update(1 / 60, contacts(rolling), 1, 0)
    expect(pixel(value.texture, 0, 0)[2]).toBeGreaterThan(200)
    expect(pixel(value.texture, 0, 0)[0]).toBeGreaterThan(180)
  })

  it.each(['teleport', 'stall', 'airborne', 'removed'] as const)('does not leave a bridge after a %s discontinuity', (reason) => {
    const value = field()
    const start = reason === 'teleport' ? -3 : -1.25
    const end = -start
    value.update(1 / 60, contacts(die(start)), 1, 0)
    if (reason === 'airborne') value.update(1 / 60, contacts(die(0, 0, 4)), 1, 0)
    if (reason === 'removed') value.update(0, new Map(), 1, 0)
    const moved = die(start)
    moved.targetPosition = [end, 0.55, 0]
    value.update(reason === 'stall' ? 0.3 : 1 / 60, contacts(moved), 1, 0)
    expect(pixel(value.texture, 0, 0)).toEqual([128, 128, 0, 255])
    expect(pixel(value.texture, end, 0)[2]).toBeGreaterThan(220)
  })

  it('caps visual admission at the first 128 map entries and releases truncated history', () => {
    const value = field()
    const many = new Map<string, GrassContactDie>()
    for (let index = 0; index < 128; index++) {
      const item = die(-5, 0, 4)
      item.id = `air-${index}`
      many.set(item.id, item)
    }
    const last = die(2)
    many.set(last.id, last)
    value.update(1 / 60, many, 1, 0)
    expect(pixel(value.texture, 2, 0)[2]).toBe(0)
    const first = die(-1.25)
    value.update(1 / 60, contacts(first), 1, 0)
    value.update(0, many, 1, 0)
    const moved = die(1.25)
    value.update(1 / 60, contacts(moved), 1, 0)
    expect(pixel(value.texture, 0, 0)[2]).toBe(0)
    expect(pixel(value.texture, 1.25, 0)[2]).toBeGreaterThan(220)
  })

  it('releases its single texture once and makes updates inert after disposal', () => {
    const value = field()
    const disposed = vi.fn()
    value.texture.addEventListener('dispose', disposed)
    const bytes = value.texture.image.data.slice()
    const version = value.texture.version
    value.dispose()
    value.dispose()
    value.update(1 / 60, contacts(), 1, 0)
    expect(disposed).toHaveBeenCalledOnce()
    expect(value.texture.image.data).toEqual(bytes)
    expect(value.texture.version).toBe(version)
  })

  it.each([[0, 8], [-1, 8], [8, 0], [8, NaN], [Infinity, 8]])('rejects invalid arena half extents %s / %s before allocating GPU resources', (halfX, halfZ) => {
    expect(() => createGrassInteractionField(halfX, halfZ)).toThrow(RangeError)
  })

  it('does not upload unchanged bytes or allocate replacement texture storage during updates', () => {
    const value = field()
    const texture = value.texture
    const storage = texture.image.data
    const empty = new Map<string, GrassContactDie>()
    const neutralVersion = texture.version
    value.update(0.016, empty, 1, 0)
    expect(texture.version).toBe(neutralVersion)
    const dice = contacts()
    value.update(0.016, dice, 1, 0)
    const stampedVersion = texture.version
    expect(stampedVersion).toBe(neutralVersion + 1)
    for (let frame = 0; frame < 20; frame++) value.update(1 / 60, dice, 1, 0)
    expect(texture.version).toBe(stampedVersion)
    value.update(0.00000001, empty, 1, 0)
    expect(texture.version).toBe(stampedVersion)
    value.update(2, empty, 1, 0)
    const recoveredVersion = texture.version
    value.update(2, empty, 1, 0)
    expect(texture.version).toBe(recoveredVersion)
    expect(value.texture).toBe(texture)
    expect(texture.image.data).toBe(storage)
  })

  it('clips non-square arena edge stamps without wrapping or writing outside storage', () => {
    const value = field(3, 5)
    value.update(0.016, contacts(die(3, 5)), 1, 0)
    expect(pixel(value.texture, 3, 5, 3, 5)[2]).toBeGreaterThan(220)
    expect(pixel(value.texture, -3, -5, 3, 5)).toEqual([128, 128, 0, 255])
    value.update(0, contacts(die(1e9, -1e9)), 1, 0)
    expect(value.texture.image.data).toHaveLength(64 * 64 * 4)
    expect(Object.keys(value.texture.image.data)).toHaveLength(64 * 64 * 4)
    for (let index = 3; index < value.texture.image.data.length; index += 4) expect(value.texture.image.data[index]).toBe(255)
  })

  it('pins an exactly centered stationary contact with a nonzero radial fallback', () => {
    const value = field()
    value.update(0.016, contacts(die(0.125, 0.125)), 1, 0)
    expect(pixel(value.texture, 0.125, 0.125)[0]).toBeGreaterThan(200)
    expect(pixel(value.texture, 0.125, 0.125)[2]).toBe(255)
  })

  it('does not sweep across an invalid frame duration', () => {
    const value = field()
    value.update(0.016, contacts(die(-1.25)), 1, 0)
    value.update(Infinity, contacts(die(1.25)), 1, 0)
    expect(pixel(value.texture, 0, 0)).toEqual([128, 128, 0, 255])
    expect(pixel(value.texture, 1.25, 0)[2]).toBeGreaterThan(220)
  })

  it('does not connect a landing snapshot to a stale grounded rendered contact', () => {
    const value = field()
    value.update(0.016, contacts(die(-1.25)), 1, 0)
    const landing = die(1.25, 0, 4)
    landing.targetPosition = [1.25, 0.55, 0]
    value.update(0.016, contacts(landing), 1, 0)
    expect(pixel(value.texture, 0, 0)).toEqual([128, 128, 0, 255])
    expect(pixel(value.texture, 1.25, 0)[2]).toBeGreaterThan(220)
  })

  it('tapers swept pressure from an existing light touch to a newly grounded contact', () => {
    const value = field()
    value.update(0.016, contacts(die(-1.25, 0, 1.25)), 1, 0)
    const landing = die(-1.25, 0, 1.25)
    landing.targetPosition = [1.25, 0.55, 0]
    value.update(0.016, contacts(landing), 1, 0)
    expect(pixel(value.texture, -0.75, 0)[2]).toBeGreaterThan(0)
    expect(pixel(value.texture, -0.75, 0)[2]).toBeLessThan(170)
    expect(pixel(value.texture, 1.25, 0)[2]).toBeGreaterThan(220)
  })

  it('ignores a teleport-sized snapshot segment even when this frame renders a short step', () => {
    const value = field()
    value.update(0.016, contacts(die(-1.25)), 1, 0)
    const moved = die(-1.25)
    moved.targetPosition = [3.75, 0.55, 0]
    value.update(0.016, contacts(moved), 0.5, 0)
    expect(pixel(value.texture, 0, 0)).toEqual([128, 128, 0, 255])
    expect(pixel(value.texture, 1.25, 0)[2]).toBeGreaterThan(220)
  })

  it('provides a fixed linear RGBA data texture with exact signed neutral bytes', () => {
    const { texture } = field()
    expect(texture).toBeInstanceOf(THREE.DataTexture)
    expect(texture.image.width).toBe(64)
    expect(texture.image.height).toBe(64)
    expect(texture.image.data).toBeInstanceOf(Uint8Array)
    expect(Array.from(texture.image.data)).toEqual(Array.from({ length: 4096 }, () => [128, 128, 0, 255]).flat())
    expect(texture.format).toBe(THREE.RGBAFormat)
    expect(texture.type).toBe(THREE.UnsignedByteType)
    expect(texture.colorSpace).toBe(THREE.NoColorSpace)
    expect(texture.minFilter).toBe(THREE.LinearFilter)
    expect(texture.magFilter).toBe(THREE.LinearFilter)
    expect(texture.wrapS).toBe(THREE.ClampToEdgeWrapping)
    expect(texture.wrapT).toBe(THREE.ClampToEdgeWrapping)
    expect(texture.generateMipmaps).toBe(false)
  })
})
