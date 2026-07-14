import { describe, expect, it } from 'vitest'

import { getDiceShapeSize } from './diceShapeScale'
import { createDiceGeometry } from './geometries'

describe('dice shape scale', () => {
  it('keeps most stock dice at the base size, d6 10% larger by default', () => {
    expect(getDiceShapeSize('d4', 1)).toBe(1)
    expect(getDiceShapeSize('d6', 1)).toBeCloseTo(1.1, 5) // everyday die rendered 10% larger
    expect(getDiceShapeSize('d8', 1)).toBe(1)
    expect(getDiceShapeSize('d10', 1)).toBe(1)
    expect(getDiceShapeSize('d20', 1)).toBe(1)
  })

  it('renders d12 slightly smaller than d20', () => {
    expect(getDiceShapeSize('d12', 1)).toBe(0.9)

    const d12 = createDiceGeometry('d12', 1)
    const d20 = createDiceGeometry('d20', 1)
    d12.computeBoundingSphere()
    d20.computeBoundingSphere()

    expect(d12.boundingSphere?.radius ?? 0).toBeLessThan((d20.boundingSphere?.radius ?? 0) * 0.95)
  })
})

