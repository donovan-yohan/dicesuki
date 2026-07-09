import { describe, expect, it } from 'vitest'
import { DICE_ESCAPE_BOUNDS, isDiceOutsideEscapeBounds } from './diceEscapeBounds'

describe('isDiceOutsideEscapeBounds', () => {
  it('keeps dice inside generous table bounds', () => {
    expect(isDiceOutsideEscapeBounds({ x: 0, y: 2, z: 0 })).toBe(false)
    expect(isDiceOutsideEscapeBounds({
      x: DICE_ESCAPE_BOUNDS.maxAbsX,
      y: DICE_ESCAPE_BOUNDS.maxY,
      z: -DICE_ESCAPE_BOUNDS.maxAbsZ,
    })).toBe(false)
  })

  it('flags dice that have escaped far beyond the table volume', () => {
    expect(isDiceOutsideEscapeBounds({ x: DICE_ESCAPE_BOUNDS.maxAbsX + 0.01, y: 2, z: 0 })).toBe(true)
    expect(isDiceOutsideEscapeBounds({ x: 0, y: DICE_ESCAPE_BOUNDS.minY - 0.01, z: 0 })).toBe(true)
    expect(isDiceOutsideEscapeBounds({ x: 0, y: DICE_ESCAPE_BOUNDS.maxY + 0.01, z: 0 })).toBe(true)
    expect(isDiceOutsideEscapeBounds({ x: 0, y: 2, z: -DICE_ESCAPE_BOUNDS.maxAbsZ - 0.01 })).toBe(true)
  })
})
