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
 * D4 (tetrahedron) face normals in world space
 * Tetrahedron: 4 triangular faces
 */
export const D4_FACE_NORMALS: DiceFace[] = [
  { value: 1, normal: new THREE.Vector3(0, -1, 0).normalize() },
  { value: 2, normal: new THREE.Vector3(0.8165, 0.3333, 0.4714).normalize() },
  { value: 3, normal: new THREE.Vector3(-0.8165, 0.3333, 0.4714).normalize() },
  { value: 4, normal: new THREE.Vector3(0, 0.3333, -0.9428).normalize() },
]

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
 * D8 (octahedron) face normals in world space
 * Octahedron: 8 triangular faces
 */
export const D8_FACE_NORMALS: DiceFace[] = [
  { value: 1, normal: new THREE.Vector3(0, -1, 0).normalize() },
  { value: 2, normal: new THREE.Vector3(1, 0, 1).normalize() },
  { value: 3, normal: new THREE.Vector3(-1, 0, 1).normalize() },
  { value: 4, normal: new THREE.Vector3(-1, 0, -1).normalize() },
  { value: 5, normal: new THREE.Vector3(1, 0, -1).normalize() },
  { value: 6, normal: new THREE.Vector3(0, 1, 1).normalize() },
  { value: 7, normal: new THREE.Vector3(0, 1, -1).normalize() },
  { value: 8, normal: new THREE.Vector3(0, 1, 0).normalize() },
]

/**
 * D12 (dodecahedron) face normals in world space
 * Dodecahedron: 12 pentagonal faces
 */
const phi = (1 + Math.sqrt(5)) / 2 // Golden ratio
export const D12_FACE_NORMALS: DiceFace[] = [
  { value: 1, normal: new THREE.Vector3(0, -1, 0).normalize() },
  { value: 2, normal: new THREE.Vector3(1, 1, 1).normalize() },
  { value: 3, normal: new THREE.Vector3(-1, 1, 1).normalize() },
  { value: 4, normal: new THREE.Vector3(-1, -1, 1).normalize() },
  { value: 5, normal: new THREE.Vector3(1, -1, 1).normalize() },
  { value: 6, normal: new THREE.Vector3(0, phi, 1/phi).normalize() },
  { value: 7, normal: new THREE.Vector3(0, phi, -1/phi).normalize() },
  { value: 8, normal: new THREE.Vector3(1, 1, -1).normalize() },
  { value: 9, normal: new THREE.Vector3(-1, 1, -1).normalize() },
  { value: 10, normal: new THREE.Vector3(-1, -1, -1).normalize() },
  { value: 11, normal: new THREE.Vector3(1, -1, -1).normalize() },
  { value: 12, normal: new THREE.Vector3(0, 1, 0).normalize() },
]

/**
 * D20 (icosahedron) face normals in world space
 * Icosahedron: 20 triangular faces
 */
export const D20_FACE_NORMALS: DiceFace[] = [
  { value: 1, normal: new THREE.Vector3(0, -1, 0).normalize() },
  { value: 2, normal: new THREE.Vector3(0.8944, -0.4472, 0).normalize() },
  { value: 3, normal: new THREE.Vector3(0.2764, -0.4472, 0.8507).normalize() },
  { value: 4, normal: new THREE.Vector3(-0.7236, -0.4472, 0.5257).normalize() },
  { value: 5, normal: new THREE.Vector3(-0.7236, -0.4472, -0.5257).normalize() },
  { value: 6, normal: new THREE.Vector3(0.2764, -0.4472, -0.8507).normalize() },
  { value: 7, normal: new THREE.Vector3(0.7236, 0.4472, 0.5257).normalize() },
  { value: 8, normal: new THREE.Vector3(-0.2764, 0.4472, 0.8507).normalize() },
  { value: 9, normal: new THREE.Vector3(-0.8944, 0.4472, 0).normalize() },
  { value: 10, normal: new THREE.Vector3(-0.2764, 0.4472, -0.8507).normalize() },
  { value: 11, normal: new THREE.Vector3(0.7236, 0.4472, -0.5257).normalize() },
  { value: 12, normal: new THREE.Vector3(0, 1, 0).normalize() },
  { value: 13, normal: new THREE.Vector3(0.8507, 0, 0.5257).normalize() },
  { value: 14, normal: new THREE.Vector3(0, 0, 1).normalize() },
  { value: 15, normal: new THREE.Vector3(-0.8507, 0, 0.5257).normalize() },
  { value: 16, normal: new THREE.Vector3(-0.8507, 0, -0.5257).normalize() },
  { value: 17, normal: new THREE.Vector3(0, 0, -1).normalize() },
  { value: 18, normal: new THREE.Vector3(0.8507, 0, -0.5257).normalize() },
  { value: 19, normal: new THREE.Vector3(0.5257, 0.8507, 0).normalize() },
  { value: 20, normal: new THREE.Vector3(-0.5257, 0.8507, 0).normalize() },
]

/**
 * Determines which face of a dice is facing up based on its rotation
 * @param quaternion - The rotation quaternion of the dice
 * @param shape - The dice shape
 * @returns The value of the face that is facing up
 */
export function getDiceFaceValue(
  quaternion: THREE.Quaternion,
  shape: DiceShape = 'd6'
): number {
  // Select face normals based on shape
  let faceNormals: DiceFace[]
  switch (shape) {
    case 'd4':
      faceNormals = D4_FACE_NORMALS
      break
    case 'd6':
      faceNormals = D6_FACE_NORMALS
      break
    case 'd8':
      faceNormals = D8_FACE_NORMALS
      break
    case 'd10':
      throw new Error('D10 not yet implemented')
    case 'd12':
      faceNormals = D12_FACE_NORMALS
      break
    case 'd20':
      faceNormals = D20_FACE_NORMALS
      break
    default:
      throw new Error(`Unknown shape: ${shape}`)
  }

  const upVector = new THREE.Vector3(0, 1, 0)
  let maxDot = -Infinity
  let faceValue = 1

  // Find which face normal is most aligned with the up vector
  for (const face of faceNormals) {
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
 * Creates a D4 (tetrahedron) geometry with appropriate size
 * @param size - The size of the tetrahedron (default: 1)
 * @returns TetrahedronGeometry for the D4
 */
export function createD4Geometry(size: number = 1): THREE.TetrahedronGeometry {
  return new THREE.TetrahedronGeometry(size, 0)
}


/**
 * Create a single solid color material for D6 dice
 *
 * This replaces the old multi-material approach that rendered numbers on faces.
 * Numbers are now displayed only in the UI after face detection.
 *
 * @param color - Dice body color
 * @returns Single material for all faces
 */
export function createD6Material(
  color: string = 'orange'
): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({
    color: color,
    roughness: 0.7,
    metalness: 0.1
  })
}

/**
 * Creates a D6 (cube) geometry with appropriate size
 * @param size - The size of the cube (default: 1)
 * @returns BoxGeometry for the D6
 */
export function createD6Geometry(size: number = 1): THREE.BoxGeometry {
  return new THREE.BoxGeometry(size, size, size)
}

/**
 * Creates a D8 (octahedron) geometry with appropriate size
 * @param size - The size of the octahedron (default: 1)
 * @returns OctahedronGeometry for the D8
 */
export function createD8Geometry(size: number = 1): THREE.OctahedronGeometry {
  return new THREE.OctahedronGeometry(size, 0)
}

/**
 * Creates a D12 (dodecahedron) geometry with appropriate size
 * @param size - The size of the dodecahedron (default: 1)
 * @returns DodecahedronGeometry for the D12
 */
export function createD12Geometry(size: number = 1): THREE.DodecahedronGeometry {
  return new THREE.DodecahedronGeometry(size, 0)
}

/**
 * Creates a D20 (icosahedron) geometry with appropriate size
 * @param size - The size of the icosahedron (default: 1)
 * @returns IcosahedronGeometry for the D20
 */
export function createD20Geometry(size: number = 1): THREE.IcosahedronGeometry {
  return new THREE.IcosahedronGeometry(size, 0)
}
