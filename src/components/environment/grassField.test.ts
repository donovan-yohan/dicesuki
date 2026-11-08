import { describe, expect, it } from 'vitest'
import { sampleGrassField } from './grassField'

describe('world-space grass density', () => {
  it.each([731, 732, 2718])('continuously spans bare, sparse and dense growth for seed %s', (seed) => {
    const values: number[] = []
    let maxStep = 0
    for (let z = -8; z <= 8; z += 0.12) {
      for (let x = -4.5; x <= 4.5; x += 0.12) {
        const sample = sampleGrassField(x, z, seed)
        values.push(sample.density)
        expect(sample).toEqual(sampleGrassField(x, z, seed))
        expect(sample.patch).toBeGreaterThanOrEqual(0)
        expect(sample.patch).toBeLessThanOrEqual(1)
        maxStep = Math.max(maxStep, Math.abs(sample.density - sampleGrassField(x + 0.01, z, seed).density))
      }
    }
    expect(values.every(value => Number.isFinite(value) && value >= 0 && value <= 1)).toBe(true)
    expect(values.filter(value => value === 0).length / values.length).toBeGreaterThan(0.015)
    expect(values.filter(value => value > 0.1 && value < 0.5).length / values.length).toBeGreaterThan(0.1)
    expect(values.filter(value => value > 0.75).length / values.length).toBeGreaterThan(0.04)
    expect(maxStep).toBeLessThan(0.03)
    const mean = values.reduce((sum, value) => sum + value, 0) / values.length
    expect(values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / values.length).toBeGreaterThan(0.055)
    expect(sampleGrassField(0.7, -1.3, seed)).not.toEqual(sampleGrassField(0.7, -1.3, seed + 1))
  })
})
