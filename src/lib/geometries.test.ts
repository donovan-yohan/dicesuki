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
    it('should have 6 face normals', () => {
      expect(D6_FACE_NORMALS).toHaveLength(6)
    })

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

    it('should have unit-length normals', () => {
      D6_FACE_NORMALS.forEach(({ normal }) => {
        const length = Math.sqrt(normal.x ** 2 + normal.y ** 2 + normal.z ** 2)
        expect(length).toBeCloseTo(1, 5)
      })
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

  for (const shape of DICE_TYPES) {
    const faceNormals = FACE_NORMALS_BY_SHAPE[shape]

    describe(shape, () => {
      it(`has ${expectedCounts[shape]} face normals`, () => {
        expect(faceNormals).toHaveLength(expectedCounts[shape])
      })

      it('all normals are unit-length', () => {
        for (const face of faceNormals) {
          // D20 uses rounded 4-decimal normal components, so allow 3-decimal precision
          expect(face.normal.length()).toBeCloseTo(1.0, 3)
        }
      })

      it('all face values are unique', () => {
        const values = faceNormals.map((f) => f.value)
        expect(new Set(values).size).toBe(values.length)
      })
    })
  }
})
