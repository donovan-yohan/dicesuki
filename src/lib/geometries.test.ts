import { describe, it, expect } from 'vitest'
import { D6_FACE_NORMALS, getDiceFaceValue } from './geometries'
import * as THREE from 'three'

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
      D6_FACE_NORMALS.forEach(({ normal, value }) => {
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
