import { describe, it, expect } from 'vitest'

import {
  computeMotionField,
  dynamicAccelFromTotal,
  initialGravityEstimate,
  motionFieldMagnitude,
} from './motionField'

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

describe('dynamicAccelFromTotal (accelerationIncludingGravity fallback)', () => {
  const ALPHA = 0.8

  it('seeds the gravity estimate from the first sample (no startup transient)', () => {
    const { linear, gravity } = dynamicAccelFromTotal(
      { x: 0, y: 0, z: 9.81 },
      initialGravityEstimate(),
      ALPHA,
    )
    // First sample seeds gravity directly, so movement is ~zero.
    expect(linear.x).toBeCloseTo(0, 10)
    expect(linear.y).toBeCloseTo(0, 10)
    expect(linear.z).toBeCloseTo(0, 10)
    expect(gravity.initialized).toBe(true)
  })

  it('absorbs a sustained static tilt into gravity (movement decays to ~0)', () => {
    // A phone held at a constant tilt: after enough samples the estimate tracks it
    // and the movement output converges to zero — static tilt does not push dice.
    let g = initialGravityEstimate()
    const total = { x: 3, y: 0, z: 9.3 } // constant (tilted, still)
    let last = { x: 0, y: 0, z: 0 }
    for (let i = 0; i < 50; i++) {
      const r = dynamicAccelFromTotal(total, g, ALPHA)
      g = r.gravity
      last = { x: r.linear.x ?? 0, y: r.linear.y ?? 0, z: r.linear.z ?? 0 }
    }
    expect(Math.abs(last.x)).toBeLessThan(0.05)
    expect(Math.abs(last.z)).toBeLessThan(0.05)
  })

  it('passes a sudden movement through as dynamic acceleration', () => {
    // Settle the estimate on gravity, then a sharp jerk shows up as movement.
    let g = initialGravityEstimate()
    for (let i = 0; i < 20; i++) g = dynamicAccelFromTotal({ x: 0, y: 0, z: 9.81 }, g, ALPHA).gravity
    const { linear } = dynamicAccelFromTotal({ x: 6, y: 0, z: 9.81 }, g, ALPHA)
    // (1 - alpha) of the new lateral accel survives the estimate immediately.
    expect(linear.x ?? 0).toBeGreaterThan(1)
  })
})
