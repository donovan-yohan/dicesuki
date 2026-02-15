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
 * Normals computed dynamically from the actual geometry to ensure
 * perfect alignment between face detection and material rendering.
 *
 * With proper trapezohedron topology:
 *   Upper kites (0-4): normals point outward + upward (positive y)
 *   Lower kites (5-9): normals point outward + downward (negative y)
 *
 * Opposite pairs: (0,7), (1,8), (2,9), (3,5), (4,6) — each sums to 9.
 *
 * Face value assignment (D10_KITE_VALUES):
 *   Upper kites (0-4): even values (0,2,4,6,8)
 *   Lower kites (5-9): odd values (3,1,9,7,5)
 *   Opposite pairs: kite 0↔7, 1↔8, 2↔9, 3↔5, 4↔6
 */
const D10_KITE_VALUES = [0, 2, 4, 6, 8, 3, 1, 9, 7, 5] as const

// Computed at module load from createD10Geometry — normals extracted from
// the first triangle of each kite via cross product.
export const D10_FACE_NORMALS: DiceFace[] = (() => {
  const tempGeo = createD10Geometry(1)
  const indexAttr = tempGeo.getIndex()!
  const posAttr = tempGeo.getAttribute('position')

  const normals: DiceFace[] = []
  for (let k = 0; k < 10; k++) {
    // Each kite = 2 triangles = 6 indices; first triangle starts at k * 6
    const triStart = k * 6
    const i0 = indexAttr.getX(triStart)
    const i1 = indexAttr.getX(triStart + 1)
    const i2 = indexAttr.getX(triStart + 2)

    const v0 = new THREE.Vector3().fromBufferAttribute(posAttr, i0)
    const v1 = new THREE.Vector3().fromBufferAttribute(posAttr, i1)
    const v2 = new THREE.Vector3().fromBufferAttribute(posAttr, i2)

    const edge1 = new THREE.Vector3().subVectors(v1, v0)
    const edge2 = new THREE.Vector3().subVectors(v2, v0)
    const normal = new THREE.Vector3().crossVectors(edge1, edge2).normalize()

    normals.push({ value: D10_KITE_VALUES[k], normal })
  }

  return normals
})()

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
  // Proper pentagonal trapezohedron topology:
  //   5 upper kites (kites 0-4) meet at top apex (vertex 0)
  //   5 lower kites (kites 5-9) meet at bottom apex (vertex 1)
  // Each kite = 2 consecutive triangles spanning 3 ring vertices + 1 apex
  // Ring vertices are indexed 2-11 (ring index r → vertex index r+2)
  const indices = new Uint16Array([
    // Upper kites (top apex = vertex 0, kites 0-4)
    // Kite k covers ring vertices {2k, 2k+1, 2k+2} (mod 10)
    0, 3, 2,   0, 4, 3,     // Kite 0: ring {0,1,2}
    0, 5, 4,   0, 6, 5,     // Kite 1: ring {2,3,4}
    0, 7, 6,   0, 8, 7,     // Kite 2: ring {4,5,6}
    0, 9, 8,   0, 10, 9,    // Kite 3: ring {6,7,8}
    0, 11, 10, 0, 2, 11,    // Kite 4: ring {8,9,0}

    // Lower kites (bottom apex = vertex 1, kites 5-9)
    // Kite k+5 covers ring vertices {2k+1, 2k+2, 2k+3} (mod 10)
    1, 3, 4,   1, 4, 5,     // Kite 5: ring {1,2,3}
    1, 5, 6,   1, 6, 7,     // Kite 6: ring {3,4,5}
    1, 7, 8,   1, 8, 9,     // Kite 7: ring {5,6,7}
    1, 9, 10,  1, 10, 11,   // Kite 8: ring {7,8,9}
    1, 11, 2,  1, 2, 3,     // Kite 9: ring {9,0,1}
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

/**
 * Creates a dice geometry based on shape type.
 * Unified factory function for use by components that need geometry
 * without the full Dice component (e.g., MultiplayerDie).
 */
export function createDiceGeometry(shape: DiceShape, size: number = 1): THREE.BufferGeometry {
  switch (shape) {
    case 'd4':
      return createD4Geometry(size)
    case 'd6':
      return createD6Geometry(size)
    case 'd8':
      return createD8Geometry(size)
    case 'd10':
      return createD10Geometry(size)
    case 'd12':
      return createD12Geometry(size)
    case 'd20':
      return createD20Geometry(size)
  }
}
