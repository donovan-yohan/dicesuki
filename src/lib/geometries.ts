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
 *
 * Normals extracted from Three.js TetrahedronGeometry(1, 0) to ensure
 * perfect alignment between face detection and material rendering.
 * Values assigned sequentially by triangle order.
 *
 * s = 1/√3 ≈ 0.5774
 */
const _s = 1 / Math.sqrt(3)
export const D4_FACE_NORMALS: DiceFace[] = [
  { value: 1, normal: new THREE.Vector3(-_s, _s, _s) },   // Triangle 0
  { value: 2, normal: new THREE.Vector3(_s, _s, -_s) },    // Triangle 1
  { value: 3, normal: new THREE.Vector3(_s, -_s, _s) },    // Triangle 2
  { value: 4, normal: new THREE.Vector3(-_s, -_s, -_s) },  // Triangle 3
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
 *
 * Normals extracted from Three.js OctahedronGeometry(1, 0) to ensure
 * perfect alignment between face detection and material rendering.
 * Values assigned so opposite faces sum to 9.
 *
 * Geometry normals are (±1,±1,±1)/√3.
 * Opposite pairs: (0,5)→(1,8), (1,4)→(2,7), (2,7)→(3,6), (3,6)→(4,5)
 */
export const D8_FACE_NORMALS: DiceFace[] = [
  { value: 1, normal: new THREE.Vector3(_s, _s, _s) },     // Triangle 0
  { value: 2, normal: new THREE.Vector3(_s, -_s, _s) },    // Triangle 1
  { value: 3, normal: new THREE.Vector3(_s, -_s, -_s) },   // Triangle 2
  { value: 4, normal: new THREE.Vector3(_s, _s, -_s) },    // Triangle 3
  { value: 7, normal: new THREE.Vector3(-_s, _s, -_s) },   // Triangle 4 (opposite of 2)
  { value: 8, normal: new THREE.Vector3(-_s, -_s, -_s) },  // Triangle 5 (opposite of 1)
  { value: 5, normal: new THREE.Vector3(-_s, -_s, _s) },   // Triangle 6 (opposite of 4)
  { value: 6, normal: new THREE.Vector3(-_s, _s, _s) },    // Triangle 7 (opposite of 3)
]

/**
 * D10 (pentagonal trapezohedron) face normals in world space
 * Pentagonal trapezohedron: 10 kite-shaped faces, numbered 0-9
 *
 * Normals computed from the midpoint of each kite's equatorial edge.
 * Each kite face i consists of top triangle i and bottom triangle i+10
 * in createD10Geometry. All normals lie in the xz-plane (y=0) because
 * the d10 is symmetric about the equator.
 *
 * When the die lands on a face, it tilts so that face's xz-direction
 * aligns with the detection axis.
 */
export const D10_FACE_NORMALS: DiceFace[] = Array.from({ length: 10 }, (_, i) => {
  // Midpoint angle between ring vertices i and i+1 (each at i*36°)
  const angle = ((i + 0.5) * Math.PI * 2) / 10
  return {
    value: i,
    normal: new THREE.Vector3(-Math.cos(angle), 0, -Math.sin(angle)),
  }
})

/**
 * D12 (dodecahedron) face normals in world space
 * Dodecahedron: 12 pentagonal faces (36 triangles, 3 per face)
 *
 * Normals extracted from Three.js DodecahedronGeometry(1, 0) to ensure
 * perfect alignment between face detection and material rendering.
 * Values assigned so opposite faces sum to 13.
 *
 * Dodecahedron normals use components 0, ±a, ±b where:
 *   a = 1/√(1+φ²) ≈ 0.5257, b = φ/√(1+φ²) ≈ 0.8507, φ = (1+√5)/2
 *
 * Geometry face groups (3 consecutive triangles each):
 *   Group 0: tris [0,1,2],   Group 1: tris [3,4,5],   etc.
 *
 * Opposite pairs → value sums to 13:
 *   (group 0, group 8)→(1,12), (group 1, group 4)→(2,11),
 *   (group 2, group 7)→(3,10), (group 3, group 9)→(4,9),
 *   (group 5, group 11)→(5,8), (group 6, group 10)→(6,7)
 */
const _phi = (1 + Math.sqrt(5)) / 2
const _a = 1 / Math.sqrt(1 + _phi * _phi) // ≈ 0.5257
const _b = _phi * _a                       // ≈ 0.8507
export const D12_FACE_NORMALS: DiceFace[] = [
  { value: 1,  normal: new THREE.Vector3(0, _b, _a) },     // Group 0
  { value: 2,  normal: new THREE.Vector3(_b, _a, 0) },     // Group 1
  { value: 3,  normal: new THREE.Vector3(_a, 0, -_b) },    // Group 2
  { value: 4,  normal: new THREE.Vector3(-_a, 0, -_b) },   // Group 3
  { value: 11, normal: new THREE.Vector3(-_b, -_a, 0) },   // Group 4 (opposite of 2)
  { value: 5,  normal: new THREE.Vector3(0, _b, -_a) },    // Group 5
  { value: 6,  normal: new THREE.Vector3(-_b, _a, 0) },    // Group 6
  { value: 10, normal: new THREE.Vector3(-_a, 0, _b) },    // Group 7 (opposite of 3)
  { value: 12, normal: new THREE.Vector3(0, -_b, -_a) },   // Group 8 (opposite of 1)
  { value: 9,  normal: new THREE.Vector3(_a, 0, _b) },     // Group 9 (opposite of 4)
  { value: 7,  normal: new THREE.Vector3(_b, -_a, 0) },    // Group 10 (opposite of 6)
  { value: 8,  normal: new THREE.Vector3(0, -_b, _a) },    // Group 11 (opposite of 5)
]

/**
 * D20 (icosahedron) face normals in world space
 * Icosahedron: 20 triangular faces
 *
 * These normals are extracted directly from Three.js IcosahedronGeometry
 * to ensure perfect alignment between physics detection and material rendering.
 * Values assigned so opposite faces sum to 21.
 *
 * Opposite pairs (by triangle index):
 *   (0,13)→(1,20), (1,12)→(2,19), (2,11)→(3,18), (3,10)→(4,17),
 *   (4,14)→(5,16), (5,17)→(6,15), (6,18)→(7,14), (7,19)→(8,13),
 *   (8,15)→(9,12), (9,16)→(10,11)
 */
export const D20_FACE_NORMALS: DiceFace[] = [
  { value: 1,  normal: new THREE.Vector3(-0.5774, 0.5774, 0.5774) },    // Triangle 0
  { value: 2,  normal: new THREE.Vector3(0.0000, 0.9342, 0.3568) },     // Triangle 1
  { value: 3,  normal: new THREE.Vector3(0.0000, 0.9342, -0.3568) },    // Triangle 2
  { value: 4,  normal: new THREE.Vector3(-0.5774, 0.5774, -0.5774) },   // Triangle 3
  { value: 5,  normal: new THREE.Vector3(-0.9342, 0.3568, 0.0000) },    // Triangle 4
  { value: 6,  normal: new THREE.Vector3(0.5774, 0.5774, 0.5774) },     // Triangle 5
  { value: 7,  normal: new THREE.Vector3(-0.3568, 0.0000, 0.9342) },    // Triangle 6
  { value: 8,  normal: new THREE.Vector3(-0.9342, -0.3568, 0.0000) },   // Triangle 7
  { value: 9,  normal: new THREE.Vector3(-0.3568, 0.0000, -0.9342) },   // Triangle 8
  { value: 10, normal: new THREE.Vector3(0.5774, 0.5774, -0.5774) },    // Triangle 9
  { value: 17, normal: new THREE.Vector3(0.5774, -0.5774, 0.5774) },    // Triangle 10 (opposite of 3→4)
  { value: 18, normal: new THREE.Vector3(0.0000, -0.9342, 0.3568) },    // Triangle 11 (opposite of 2→3)
  { value: 19, normal: new THREE.Vector3(0.0000, -0.9342, -0.3568) },   // Triangle 12 (opposite of 1→2)
  { value: 20, normal: new THREE.Vector3(0.5774, -0.5774, -0.5774) },   // Triangle 13 (opposite of 0→1)
  { value: 16, normal: new THREE.Vector3(0.9342, -0.3568, 0.0000) },    // Triangle 14 (opposite of 4→5)
  { value: 12, normal: new THREE.Vector3(0.3568, 0.0000, 0.9342) },     // Triangle 15 (opposite of 8→9)
  { value: 11, normal: new THREE.Vector3(-0.5774, -0.5774, 0.5774) },   // Triangle 16 (opposite of 9→10)
  { value: 15, normal: new THREE.Vector3(-0.5774, -0.5774, -0.5774) },  // Triangle 17 (opposite of 5→6)
  { value: 14, normal: new THREE.Vector3(0.3568, 0.0000, -0.9342) },    // Triangle 18 (opposite of 6→7)
  { value: 13, normal: new THREE.Vector3(0.9342, 0.3568, 0.0000) },     // Triangle 19 (opposite of 7→8)
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
