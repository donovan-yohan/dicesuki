import { describe, it, expect } from 'vitest'
import { arenaFitCameraHeight } from './renderScale'

const FOV = 40
const FILL = 0.9
const halfFovV = ((FOV * Math.PI) / 180) / 2

describe('arenaFitCameraHeight', () => {
  it('is the fixed point when arena aspect equals viewport aspect (9:16)', () => {
    // 9:16 arena (4.5 x 8) in a 9:16 viewport (900 x 1600).
    const h = arenaFitCameraHeight(4.5, 8, 900, 1600, FOV, FILL)
    // Fixed-scale framing: worldHeightVisible = 2·halfZ / fill.
    const expected = (2 * 8) / FILL / (2 * Math.tan(halfFovV))
    expect(h).toBeCloseTo(expected, 5)
  })

  it('letterboxes: a landscape arena on a portrait viewport is fit by width', () => {
    // 16:9 arena (8 x 4.5) on a portrait 9:16 viewport → width is the tight axis,
    // forcing a taller camera than a depth-only fit would give.
    const fit = arenaFitCameraHeight(8, 4.5, 900, 1600, FOV, FILL)
    const depthOnly = (2 * 4.5) / FILL / (2 * Math.tan(halfFovV))
    expect(fit).toBeGreaterThan(depthOnly)
  })

  it('shows more world as the arena grows', () => {
    const small = arenaFitCameraHeight(4.5, 8, 900, 1600, FOV, FILL)
    const big = arenaFitCameraHeight(9, 16, 900, 1600, FOV, FILL)
    expect(big).toBeGreaterThan(small)
  })

  it('contains both arena axes within the fill margin', () => {
    const w = 1200
    const h = 800
    const camH = arenaFitCameraHeight(6, 6, w, h, FOV, FILL)
    // Visible world span at the floor from this camera height.
    const visibleH = 2 * camH * Math.tan(halfFovV)
    const visibleW = visibleH * (w / h)
    // The arena (12 x 12) plus the fill margin must fit inside the visible span.
    expect(visibleH).toBeGreaterThanOrEqual((2 * 6) / FILL - 1e-6)
    expect(visibleW).toBeGreaterThanOrEqual((2 * 6) / FILL - 1e-6)
  })
})
