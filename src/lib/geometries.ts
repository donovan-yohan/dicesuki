import * as THREE from 'three'

/**
 * Dice shape types
 */
export type DiceShape = 'd4' | 'd6' | 'd8' | 'd10' | 'd12' | 'd20'

/**
 * Face definition with normal vector and value
 */
export interface DiceFace {
  value: number
  normal: THREE.Vector3
}

/**
 * D6 (cube) face normals in world space
 * Standard die numbering: opposite faces sum to 7
 * 1-bottom, 2-front, 3-right, 4-left, 5-back, 6-top
 */
export const D6_FACE_NORMALS: DiceFace[] = [
  { value: 1, normal: new THREE.Vector3(0, -1, 0) },  // Bottom
  { value: 2, normal: new THREE.Vector3(0, 0, 1) },   // Front
  { value: 3, normal: new THREE.Vector3(1, 0, 0) },   // Right
  { value: 4, normal: new THREE.Vector3(-1, 0, 0) },  // Left
  { value: 5, normal: new THREE.Vector3(0, 0, -1) },  // Back
  { value: 6, normal: new THREE.Vector3(0, 1, 0) },   // Top
]

/**
 * Determines which face of a dice is facing up based on its rotation
 * @param quaternion - The rotation quaternion of the dice
 * @param shape - The dice shape (currently only d6 supported)
 * @returns The value of the face that is facing up (1-6 for d6)
 */
export function getDiceFaceValue(
  quaternion: THREE.Quaternion,
  shape: DiceShape = 'd6'
): number {
  if (shape !== 'd6') {
    throw new Error(`Shape ${shape} not yet implemented`)
  }

  const upVector = new THREE.Vector3(0, 1, 0)
  let maxDot = -Infinity
  let faceValue = 1

  // Find which face normal is most aligned with the up vector
  for (const face of D6_FACE_NORMALS) {
    // Rotate the face normal by the dice's quaternion
    const rotatedNormal = face.normal.clone().applyQuaternion(quaternion)

    // Calculate dot product with up vector
    const dot = rotatedNormal.dot(upVector)

    // Track the face with maximum alignment
    if (dot > maxDot) {
      maxDot = dot
      faceValue = face.value
    }
  }

  return faceValue
}

/**
 * Creates a D6 (cube) geometry with appropriate size
 * @param size - The size of the cube (default: 1)
 * @returns BoxGeometry for the D6
 */
export function createD6Geometry(size: number = 1): THREE.BoxGeometry {
  return new THREE.BoxGeometry(size, size, size)
}
