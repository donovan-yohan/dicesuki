import { describe, it, expect } from 'vitest'

import { computeMotionField, motionFieldMagnitude } from './motionField'

describe('computeMotionField', () => {
  it('returns a zero field when there is no linear acceleration channel', () => {
    expect(computeMotionField(null, 25, 1)).toEqual([0, 0, 0])
    expect(computeMotionField(undefined, 25, 1)).toEqual([0, 0, 0])
  })

  it('returns a zero field below the deadzone (still / statically tilted phone)', () => {
    // Magnitude 0.9 m/s² < 1.0 deadzone → no push.
    expect(computeMotionField({ x: 0.5, y: 0.5, z: 0.5 }, 25, 1)).toEqual([0, 0, 0])
  })

  it('negates and scales the hand acceleration into engine units above the deadzone', () => {
    // world X = -x, world Y = -z, world Z = y — the pseudo-force axis map.
    const field = computeMotionField({ x: 10, y: 4, z: -6 }, 25, 1)
    expect(field[0]).toBeCloseTo(-10 * 25, 5) // -x
    expect(field[1]).toBeCloseTo(6 * 25, 5) //  -z
    expect(field[2]).toBeCloseTo(4 * 25, 5) //   y
  })

  it('treats null sensor components as zero', () => {
    const field = computeMotionField({ x: 8, y: null, z: null }, 25, 1)
    expect(field[0]).toBe(-8 * 25)
    expect(field[1]).toBeCloseTo(0, 10)
    expect(field[2]).toBeCloseTo(0, 10)
  })

  it('scale is the tunable feel knob (linear in magnitude)', () => {
    const a = computeMotionField({ x: 3, y: 0, z: 0 }, 10, 1)
    const b = computeMotionField({ x: 3, y: 0, z: 0 }, 20, 1)
    expect(b[0]).toBeCloseTo(a[0] * 2, 5)
  })
})

describe('motionFieldMagnitude', () => {
  it('is the Euclidean length', () => {
    expect(motionFieldMagnitude([3, 0, 4])).toBe(5)
    expect(motionFieldMagnitude([0, 0, 0])).toBe(0)
  })
})
