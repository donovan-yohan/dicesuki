import { describe, it, expect } from 'vitest'
import {
  rotateXZ,
  normalizeViewRotation,
  rotateCW,
  rotateCCW,
  swapsAxes,
} from './viewRotation'

describe('viewRotation', () => {
  it('rotateCW / rotateCCW cycle through the four rotations', () => {
    expect(rotateCW(0)).toBe(90)
    expect(rotateCW(90)).toBe(180)
    expect(rotateCW(270)).toBe(0)
    expect(rotateCCW(0)).toBe(270)
    expect(rotateCCW(90)).toBe(0)
  })

  it('normalizeViewRotation coerces junk to 0 and keeps valid values', () => {
    expect(normalizeViewRotation('90')).toBe(90)
    expect(normalizeViewRotation(180)).toBe(180)
    expect(normalizeViewRotation('nope')).toBe(0)
    expect(normalizeViewRotation(45)).toBe(0)
    expect(normalizeViewRotation(null)).toBe(0)
  })

  it('swapsAxes only for 90 and 270', () => {
    expect(swapsAxes(0)).toBe(false)
    expect(swapsAxes(90)).toBe(true)
    expect(swapsAxes(180)).toBe(false)
    expect(swapsAxes(270)).toBe(true)
  })

  it('rotateXZ rotates the XZ plane about +Y (matching the camera spin), Y fixed', () => {
    const near = (got: number[], want: number[]) =>
      got.forEach((v, i) => expect(v).toBeCloseTo(want[i], 5))
    // +X → -Z at 90° (screen-right at a 90° view), the camera-spin convention.
    near(rotateXZ([1, 5, 0], 90), [0, 5, -1])
    near(rotateXZ([1, 5, 0], 180), [-1, 5, 0])
    near(rotateXZ([1, 5, 0], 270), [0, 5, 1])
    near(rotateXZ([1, 2, 3], 0), [1, 2, 3])
    // Y is never touched.
    expect(rotateXZ([1, 7, 2], 90)[1]).toBe(7)
  })
})
