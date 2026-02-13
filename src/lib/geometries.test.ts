import { describe, it, expect } from 'vitest'
import {
  DiceShape,
  D4_FACE_NORMALS,
  D6_FACE_NORMALS,
  D8_FACE_NORMALS,
  D10_FACE_NORMALS,
  D12_FACE_NORMALS,
  D20_FACE_NORMALS,
  getDiceFaceValue,
} from './geometries'
import * as THREE from 'three'

/** All face normal arrays keyed by shape */
const FACE_NORMALS_BY_SHAPE: Record<DiceShape, typeof D4_FACE_NORMALS> = {
  d4: D4_FACE_NORMALS,
  d6: D6_FACE_NORMALS,
  d8: D8_FACE_NORMALS,
  d10: D10_FACE_NORMALS,
  d12: D12_FACE_NORMALS,
  d20: D20_FACE_NORMALS,
}

const DICE_TYPES: DiceShape[] = ['d4', 'd6', 'd8', 'd10', 'd12', 'd20']

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

  describe('getDiceFaceValue', () => {
    it('should return 6 when dice is upright (top face up)', () => {
      const quaternion = new THREE.Quaternion(0, 0, 0, 1) // Identity rotation
      const result = getDiceFaceValue(quaternion, 'd6')
      expect(result).toBe(6)
    })

    it('should match BoxGeometry material indices to face normals', () => {
      // This test verifies that the visual numbers on the dice
      // match what getDiceFaceValue returns for each orientation

      // BoxGeometry material order: [right(+X), left(-X), top(+Y), bottom(-Y), front(+Z), back(-Z)]
      // createD6Materials faceMapping: [3, 4, 6, 1, 2, 5]

      // Test 1: Identity rotation - top (+Y) face should be up → value 6
      const identityQuat = new THREE.Quaternion(0, 0, 0, 1)
      expect(getDiceFaceValue(identityQuat, 'd6')).toBe(6)

      // Test 2: Rotate 90° around Z axis - right (+X) face should be up → value 3
      const rightUpQuat = new THREE.Quaternion()
      rightUpQuat.setFromAxisAngle(new THREE.Vector3(0, 0, 1), Math.PI / 2)
      expect(getDiceFaceValue(rightUpQuat, 'd6')).toBe(3)

      // Test 3: Rotate -90° around Z axis - left (-X) face should be up → value 4
      const leftUpQuat = new THREE.Quaternion()
      leftUpQuat.setFromAxisAngle(new THREE.Vector3(0, 0, 1), -Math.PI / 2)
      expect(getDiceFaceValue(leftUpQuat, 'd6')).toBe(4)

      // Test 4: Rotate 180° around X axis - bottom (-Y) face should be up → value 1
      const bottomUpQuat = new THREE.Quaternion()
      bottomUpQuat.setFromAxisAngle(new THREE.Vector3(1, 0, 0), Math.PI)
      expect(getDiceFaceValue(bottomUpQuat, 'd6')).toBe(1)

      // Test 5: Rotate -90° around X axis - front (+Z) face should be up → value 2
      const frontUpQuat = new THREE.Quaternion()
      frontUpQuat.setFromAxisAngle(new THREE.Vector3(1, 0, 0), -Math.PI / 2)
      expect(getDiceFaceValue(frontUpQuat, 'd6')).toBe(2)

      // Test 6: Rotate 90° around X axis - back (-Z) face should be up → value 5
      const backUpQuat = new THREE.Quaternion()
      backUpQuat.setFromAxisAngle(new THREE.Vector3(1, 0, 0), Math.PI / 2)
      expect(getDiceFaceValue(backUpQuat, 'd6')).toBe(5)
    })

    it('should return 1 when dice is upside down (bottom face up)', () => {
      // Rotate 180° around X axis
      const quaternion = new THREE.Quaternion()
      quaternion.setFromAxisAngle(new THREE.Vector3(1, 0, 0), Math.PI)
      const result = getDiceFaceValue(quaternion, 'd6')
      expect(result).toBe(1)
    })

    it('should return 2 when front face is up', () => {
      // Rotate -90° around X axis (front face becomes top)
      const quaternion = new THREE.Quaternion()
      quaternion.setFromAxisAngle(new THREE.Vector3(1, 0, 0), -Math.PI / 2)
      const result = getDiceFaceValue(quaternion, 'd6')
      expect(result).toBe(2)
    })

    it('should return 5 when back face is up', () => {
      // Rotate 90° around X axis (back face becomes top)
      const quaternion = new THREE.Quaternion()
      quaternion.setFromAxisAngle(new THREE.Vector3(1, 0, 0), Math.PI / 2)
      const result = getDiceFaceValue(quaternion, 'd6')
      expect(result).toBe(5)
    })

    it('should return 3 when right face is up', () => {
      // Rotate 90° around Z axis (right face becomes top)
      const quaternion = new THREE.Quaternion()
      quaternion.setFromAxisAngle(new THREE.Vector3(0, 0, 1), Math.PI / 2)
      const result = getDiceFaceValue(quaternion, 'd6')
      expect(result).toBe(3)
    })

    it('should return 4 when left face is up', () => {
      // Rotate -90° around Z axis (left face becomes top)
      const quaternion = new THREE.Quaternion()
      quaternion.setFromAxisAngle(new THREE.Vector3(0, 0, 1), -Math.PI / 2)
      const result = getDiceFaceValue(quaternion, 'd6')
      expect(result).toBe(4)
    })

    it('should return the face most aligned with up vector for arbitrary rotations', () => {
      // Random rotation - should still return a valid face (1-6)
      const quaternion = new THREE.Quaternion()
      quaternion.setFromAxisAngle(
        new THREE.Vector3(1, 1, 1).normalize(),
        Math.PI / 3
      )
      const result = getDiceFaceValue(quaternion, 'd6')
      expect(result).toBeGreaterThanOrEqual(1)
      expect(result).toBeLessThanOrEqual(6)
    })
  })
})

/**
 * getDiceFaceValue: comprehensive tests for ALL dice types and ALL orientations.
 *
 * For each dice shape, for each face, we create a quaternion that rotates
 * the face normal to align with the detection axis:
 *   - D4: face normal → (0, -1, 0) (down, since D4 reads the bottom face)
 *   - All others: face normal → (0, 1, 0) (up)
 *
 * Then we verify getDiceFaceValue returns the correct value.
 * Total: 4 + 6 + 8 + 10 + 12 + 20 = 60 orientation tests.
 */
describe('getDiceFaceValue - all dice types, all orientations', () => {
  for (const shape of DICE_TYPES) {
    const faceNormals = FACE_NORMALS_BY_SHAPE[shape]
    const target = shape === 'd4'
      ? new THREE.Vector3(0, -1, 0)
      : new THREE.Vector3(0, 1, 0)

    describe(`${shape} (${faceNormals.length} faces)`, () => {
      for (const face of faceNormals) {
        it(`detects face ${face.value} when aligned with ${shape === 'd4' ? 'down' : 'up'} vector`, () => {
          // Create quaternion that rotates face.normal → target
          const quaternion = new THREE.Quaternion()
          quaternion.setFromUnitVectors(face.normal.clone().normalize(), target)

          const detected = getDiceFaceValue(quaternion, shape)
          expect(detected).toBe(face.value)
        })
      }
    })
  }
})

/**
 * Face normal array validation for all dice types.
 * Ensures all normals are unit-length and all values are unique.
 */
describe('Face normal arrays - structural validation', () => {
  const expectedCounts: Record<DiceShape, number> = {
    d4: 4, d6: 6, d8: 8, d10: 10, d12: 12, d20: 20,
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
