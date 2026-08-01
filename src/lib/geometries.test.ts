import { describe, it, expect } from 'vitest'
import {
  DiceShape,
  D4_FACE_NORMALS,
  D6_FACE_NORMALS,
  D8_FACE_NORMALS,
  D10_FACE_NORMALS,
  D10TENS_FACE_NORMALS,
  D12_FACE_NORMALS,
  D20_FACE_NORMALS,
} from './geometries'

/** All face normal arrays keyed by shape */
const FACE_NORMALS_BY_SHAPE: Record<DiceShape, typeof D4_FACE_NORMALS> = {
  d4: D4_FACE_NORMALS,
  d6: D6_FACE_NORMALS,
  d8: D8_FACE_NORMALS,
  d10: D10_FACE_NORMALS,
  d10tens: D10TENS_FACE_NORMALS,
  d12: D12_FACE_NORMALS,
  d20: D20_FACE_NORMALS,
}

const DICE_TYPES: DiceShape[] = ['d4', 'd6', 'd8', 'd10', 'd10tens', 'd12', 'd20']

describe('D6 Geometry', () => {
  describe('D6_FACE_NORMALS', () => {
    // Length and unit-length are asserted for *every* shape (d6 included) by
    // "Face normal arrays - structural validation" at the bottom of this file.

    it('should have correct normals for each face value', () => {
      // Face 1 (bottom): -Y
      expect(D6_FACE_NORMALS[0].value).toBe(1)
      expect(D6_FACE_NORMALS[0].normal.y).toBeCloseTo(-1, 5)

      // Face 6 (top): +Y
      expect(D6_FACE_NORMALS[5].value).toBe(6)
      expect(D6_FACE_NORMALS[5].normal.y).toBeCloseTo(1, 5)

      // Face 2 (front): +Z
      expect(D6_FACE_NORMALS[1].value).toBe(2)
      expect(D6_FACE_NORMALS[1].normal.z).toBeCloseTo(1, 5)

      // Face 5 (back): -Z
      expect(D6_FACE_NORMALS[4].value).toBe(5)
      expect(D6_FACE_NORMALS[4].normal.z).toBeCloseTo(-1, 5)

      // Face 3 (right): +X
      expect(D6_FACE_NORMALS[2].value).toBe(3)
      expect(D6_FACE_NORMALS[2].normal.x).toBeCloseTo(1, 5)

      // Face 4 (left): -X
      expect(D6_FACE_NORMALS[3].value).toBe(4)
      expect(D6_FACE_NORMALS[3].normal.x).toBeCloseTo(-1, 5)
    })
  })

})

/**
 * Face normal array validation for all dice types.
 * Ensures all normals are unit-length and all values are unique.
 */
describe('Face normal arrays - structural validation', () => {
  const expectedCounts: Record<DiceShape, number> = {
    d4: 4, d6: 6, d8: 8, d10: 10, d10tens: 10, d12: 12, d20: 20,
  }

  /**
   * Unit-length tolerance, in decimal places, per shape.
   *
   * D20 stores its normals rounded to 4 decimal components, so 3 places is the
   * most it can honestly claim. Every other shape is axis-aligned or exactly
   * derived and holds to 5 — the precision the d6-specific test asserted before
   * it was folded into this loop. A single loose tolerance for all shapes would
   * have silently downgraded d4/d6/d8/d10/d12 by two decimal places.
   */
  const unitLengthPrecision: Record<DiceShape, number> = {
    d4: 5, d6: 5, d8: 5, d10: 5, d10tens: 5, d12: 5, d20: 3,
  }

  for (const shape of DICE_TYPES) {
    const faceNormals = FACE_NORMALS_BY_SHAPE[shape]

    describe(shape, () => {
      it(`has ${expectedCounts[shape]} face normals`, () => {
        expect(faceNormals).toHaveLength(expectedCounts[shape])
      })

      it('all normals are unit-length', () => {
        for (const face of faceNormals) {
          expect(face.normal.length()).toBeCloseTo(1.0, unitLengthPrecision[shape])
        }
      })

      it('all face values are unique', () => {
        const values = faceNormals.map((f) => f.value)
        expect(new Set(values).size).toBe(values.length)
      })
    })
  }
})
