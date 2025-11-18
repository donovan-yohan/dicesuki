import * as THREE from 'three'
import { POLYHEDRON_DETAIL_LEVEL } from '../config/physicsConfig'

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
 * D10 (pentagonal trapezohedron) face normals in world space
 * Pentagonal trapezohedron: 10 faces, numbered 0-9 or 1-10
 * Using 0-9 numbering (common for D10)
 */
export const D10_FACE_NORMALS: DiceFace[] = [
  { value: 0, normal: new THREE.Vector3(0, -1, 0).normalize() },
  { value: 1, normal: new THREE.Vector3(0.951, -0.309, 0).normalize() },
  { value: 2, normal: new THREE.Vector3(0.588, -0.309, 0.749).normalize() },
  { value: 3, normal: new THREE.Vector3(-0.588, -0.309, 0.749).normalize() },
  { value: 4, normal: new THREE.Vector3(-0.951, -0.309, 0).normalize() },
  { value: 5, normal: new THREE.Vector3(-0.588, -0.309, -0.749).normalize() },
  { value: 6, normal: new THREE.Vector3(0.588, -0.309, -0.749).normalize() },
  { value: 7, normal: new THREE.Vector3(0.951, 0.309, 0).normalize() },
  { value: 8, normal: new THREE.Vector3(0, 0.309, 0.951).normalize() },
  { value: 9, normal: new THREE.Vector3(0, 1, 0).normalize() },
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
 * @param customFaceNormals - Optional custom face normals for custom dice models
 * @returns The value of the face that is facing up
 */
export function getDiceFaceValue(
  quaternion: THREE.Quaternion,
  shape: DiceShape = 'd6',
  customFaceNormals?: DiceFace[]
): number {
  // Use custom face normals if provided, otherwise use defaults based on shape
  let faceNormals: DiceFace[]

  if (customFaceNormals) {
    faceNormals = customFaceNormals
  } else {
    // Select default face normals based on shape
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
        faceNormals = D10_FACE_NORMALS
        break
      case 'd12':
        faceNormals = D12_FACE_NORMALS
        break
      case 'd20':
        faceNormals = D20_FACE_NORMALS
        break
      default:
        throw new Error(`Unknown shape: ${shape}`)
    }
  }

  // D4 dice work differently - the value is determined by the face touching the ground
  // (pointing down), not the face pointing up like other dice
  const targetVector = shape === 'd4'
    ? new THREE.Vector3(0, -1, 0)  // Down vector for D4
    : new THREE.Vector3(0, 1, 0)   // Up vector for all other dice

  let maxDot = -Infinity
  let faceValue = 1

  // Find which face normal is most aligned with the target vector
  for (const face of faceNormals) {
    // Rotate the face normal by the dice's quaternion
    const rotatedNormal = face.normal.clone().applyQuaternion(quaternion)

    // Calculate dot product with target vector
    const dot = rotatedNormal.dot(targetVector)

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
 * Adds subdivision for slightly rounded edges
 * @param size - The size of the tetrahedron (default: 1)
 * @returns TetrahedronGeometry for the D4
 */
export function createD4Geometry(size: number = 1): THREE.TetrahedronGeometry {
  // detail level adds subdivision for smoother, more rounded edges
  return new THREE.TetrahedronGeometry(size, POLYHEDRON_DETAIL_LEVEL)
}


/**
 * Create a single solid color material for dice
 *
 * This material is used for all dice types.
 * Numbers are displayed only in the UI after face detection.
 *
 * @param color - Dice body color
 * @param roughness - Material roughness (0 = smooth, 1 = rough)
 * @param metalness - Material metalness (0 = non-metal, 1 = metallic)
 * @param emissiveIntensity - Optional glow effect
 * @returns Single material for all faces
 */
export function createDiceMaterial(
  color: string = 'orange',
  roughness: number = 0.7,
  metalness: number = 0.1,
  emissiveIntensity?: number
): THREE.MeshStandardMaterial {
  const material = new THREE.MeshStandardMaterial({
    color: color,
    roughness: roughness,
    metalness: metalness
  })

  // Add emissive glow if specified
  if (emissiveIntensity !== undefined && emissiveIntensity > 0) {
    material.emissive = new THREE.Color(color)
    material.emissiveIntensity = emissiveIntensity
  }

  return material
}

/**
 * Create a single solid color material for D6 dice
 * @deprecated Use createDiceMaterial instead
 */
export function createD6Material(
  color: string = 'orange'
): THREE.MeshStandardMaterial {
  return createDiceMaterial(color)
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
 * Adds subdivision for slightly rounded edges
 * @param size - The size of the octahedron (default: 1)
 * @returns OctahedronGeometry for the D8
 */
export function createD8Geometry(size: number = 1): THREE.OctahedronGeometry {
  // detail level adds subdivision for smoother, more rounded edges
  return new THREE.OctahedronGeometry(size, POLYHEDRON_DETAIL_LEVEL)
}

/**
 * Creates a D10 (pentagonal trapezohedron) geometry with appropriate size
 * Custom geometry since Three.js doesn't provide it natively
 * @param size - The size of the d10 (default: 1)
 * @returns BufferGeometry for the D10
 */
export function createD10Geometry(size: number = 1): THREE.BufferGeometry {
  // Pentagonal trapezohedron - 10 kite-shaped faces
  // 12 vertices total: top apex, bottom apex, and 10 middle vertices in zigzag pattern
  // Reference: https://aqandrew.com/blog/10-sided-die-react/

  const vertices: number[] = [
    // Vertex 0: Top apex
    0, size, 0,
    // Vertex 1: Bottom apex
    0, -size, 0,
  ]

  // Generate 10 middle vertices in a zigzag pattern (alternating heights)
  // 0.105 ≈ tan(6°) - the altitude offset from equator
  const sides = 10
  const altitude = 0.105 * size

  for (let i = 0; i < sides; i++) {
    const angle = (i * Math.PI * 2) / sides
    const x = -Math.cos(angle) * size
    const z = -Math.sin(angle) * size
    const y = altitude * (i % 2 ? 1 : -1) // Alternate up/down
    vertices.push(x, y, z)
  }

  // 20 triangular faces forming 10 kite-shaped faces
  // Vertices wind counter-clockwise when viewed from outside
  const indices = new Uint16Array([
    // Top 10 triangles (connecting top apex to middle ring)
    // Winding: apex -> vertex(i) -> vertex(i+1) for outward normals
    0, 3, 2,   0, 4, 3,   0, 5, 4,   0, 6, 5,   0, 7, 6,
    0, 8, 7,   0, 9, 8,   0, 10, 9,  0, 11, 10, 0, 2, 11,

    // Bottom 10 triangles (connecting bottom apex to middle ring)
    // Winding: apex -> vertex(i+1) -> vertex(i) for outward normals (reversed from top)
    1, 2, 3,   1, 3, 4,   1, 4, 5,   1, 5, 6,   1, 6, 7,
    1, 7, 8,   1, 8, 9,   1, 9, 10,  1, 10, 11, 1, 11, 2,
  ])

  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(vertices), 3))
  geometry.setIndex(new THREE.BufferAttribute(indices, 1))

  // Compute face normals for flat shading (sharp edges between faces)
  // This gives each face its own normal rather than smooth-blending across vertices
  geometry.computeVertexNormals()

  return geometry
}

/**
 * Creates a D12 (dodecahedron) geometry with appropriate size
 * Adds subdivision for slightly rounded edges
 * @param size - The size of the dodecahedron (default: 1)
 * @returns DodecahedronGeometry for the D12
 */
export function createD12Geometry(size: number = 1): THREE.DodecahedronGeometry {
  // detail level adds subdivision for smoother, more rounded edges
  return new THREE.DodecahedronGeometry(size, POLYHEDRON_DETAIL_LEVEL)
}

/**
 * Creates a D20 (icosahedron) geometry with appropriate size
 * Adds subdivision for slightly rounded edges
 * @param size - The size of the icosahedron (default: 1)
 * @returns IcosahedronGeometry for the D20
 */
export function createD20Geometry(size: number = 1): THREE.IcosahedronGeometry {
  // detail level adds subdivision for smoother, more rounded edges
  return new THREE.IcosahedronGeometry(size, POLYHEDRON_DETAIL_LEVEL)
}
