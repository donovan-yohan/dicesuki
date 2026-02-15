import * as THREE from 'three'
import {
  DiceShape,
  D4_FACE_NORMALS,
  D6_FACE_NORMALS,
  D8_FACE_NORMALS,
  D10_FACE_NORMALS,
  D12_FACE_NORMALS,
  D20_FACE_NORMALS,
  DiceFace,
} from './geometries'

/**
 * Face Material Mapping System
 *
 * This module provides deterministic mapping between dice face values and Three.js material indices.
 * It ensures that the face normal detection (physics) and material rendering (visuals) stay synchronized.
 *
 * ## Design Philosophy
 *
 * 1. **Y-Up Convention**: All face normal arrays start with bottom face (-Y) at index 0
 * 2. **Opposite Faces Sum**: Standard dice rules apply (e.g., 1+6=7 for D6)
 * 3. **Deterministic Ordering**: Face normals are always defined in the same order
 * 4. **Material Index Mapping**: Maps face values to Three.js geometry material indices
 *
 * ## How It Works
 *
 * Each dice shape has:
 * - Face normals array (defines physics detection order)
 * - Material index map (defines rendering order for Three.js)
 *
 * Example for D6:
 * - Face value 1 (bottom) → BoxGeometry materials[3]
 * - Face value 6 (top) → BoxGeometry materials[2]
 *
 * This ensures when physics detects "6", the top face actually shows "6".
 */

/**
 * Maps dice face values to Three.js material array indices
 *
 * For each dice shape, this defines which material index corresponds to each face value.
 * The array index represents the face value (1-based), and the value at that index
 * is the material array index for Three.js geometry.
 *
 * ## D6 Mapping Explanation
 *
 * BoxGeometry material order (Three.js):
 * - materials[0] → Right face  (+X axis)
 * - materials[1] → Left face   (-X axis)
 * - materials[2] → Top face    (+Y axis)
 * - materials[3] → Bottom face (-Y axis)
 * - materials[4] → Front face  (+Z axis)
 * - materials[5] → Back face   (-Z axis)
 *
 * D6_FACE_NORMALS order (our physics detection):
 * - index 0: value 1, normal (0,-1,0) = Bottom
 * - index 1: value 2, normal (0,0,1)  = Front
 * - index 2: value 3, normal (1,0,0)  = Right
 * - index 3: value 4, normal (-1,0,0) = Left
 * - index 4: value 5, normal (0,0,-1) = Back
 * - index 5: value 6, normal (0,1,0)  = Top
 *
 * Mapping array (index = face value, value = material index):
 * - [0]: placeholder (no face value 0)
 * - [1]: 3 (face 1/bottom → materials[3])
 * - [2]: 4 (face 2/front  → materials[4])
 * - [3]: 0 (face 3/right  → materials[0])
 * - [4]: 1 (face 4/left   → materials[1])
 * - [5]: 5 (face 5/back   → materials[5])
 * - [6]: 2 (face 6/top    → materials[2])
 */
export const FACE_MATERIAL_MAPS: Record<DiceShape, number[]> = {
  d6: [
    -1, // Placeholder (no face value 0)
    3,  // Face 1 (bottom, -Y) → materials[3] (BoxGeometry bottom)
    4,  // Face 2 (front,  +Z) → materials[4] (BoxGeometry front)
    0,  // Face 3 (right,  +X) → materials[0] (BoxGeometry right)
    1,  // Face 4 (left,   -X) → materials[1] (BoxGeometry left)
    5,  // Face 5 (back,   -Z) → materials[5] (BoxGeometry back)
    2,  // Face 6 (top,    +Y) → materials[2] (BoxGeometry top)
  ],

  // D4: 4 triangular faces (TetrahedronGeometry with detail=0)
  // 1:1 mapping - face normals extracted from geometry, values assigned sequentially
  d4: [
    -1, // Placeholder (no face value 0)
    0,  // Face 1 → materials[0] (triangle 0)
    1,  // Face 2 → materials[1] (triangle 1)
    2,  // Face 3 → materials[2] (triangle 2)
    3,  // Face 4 → materials[3] (triangle 3)
  ],

  // D8: 8 triangular faces (OctahedronGeometry with detail=0)
  // Face normals extracted from geometry, values assigned so opposite faces sum to 9
  // Triangle order: 0(+,+,+), 1(+,-,+), 2(+,-,-), 3(+,+,-), 4(-,+,-), 5(-,-,-), 6(-,-,+), 7(-,+,+)
  d8: [
    -1, // Placeholder (no face value 0)
    0,  // Face 1 → materials[0] (triangle 0)
    1,  // Face 2 → materials[1] (triangle 1)
    2,  // Face 3 → materials[2] (triangle 2)
    3,  // Face 4 → materials[3] (triangle 3)
    6,  // Face 5 → materials[6] (triangle 6, opposite of 4)
    7,  // Face 6 → materials[7] (triangle 7, opposite of 3)
    4,  // Face 7 → materials[4] (triangle 4, opposite of 2)
    5,  // Face 8 → materials[5] (triangle 5, opposite of 1)
  ],

  // D10: 10 kite-shaped faces (20 triangles total, 2 per kite)
  // Geometry groups pair both triangles of each kite to material index = kite index (0-9)
  // Upper kites (0-4) at top apex, lower kites (5-9) at bottom apex
  // Values: Kite 0→0, 1→2, 2→4, 3→6, 4→8, 5→3, 6→1, 7→9, 8→7, 9→5
  // Opposite pairs (sum to 9): (0,7), (1,8), (2,9), (3,5), (4,6)
  // Map: face value → kite index (material index)
  d10: [
    0,  // Face 0 → kite 0 (materials[0])
    6,  // Face 1 → kite 6 (materials[6])
    1,  // Face 2 → kite 1 (materials[1])
    5,  // Face 3 → kite 5 (materials[5])
    2,  // Face 4 → kite 2 (materials[2])
    9,  // Face 5 → kite 9 (materials[9])
    3,  // Face 6 → kite 3 (materials[3])
    8,  // Face 7 → kite 8 (materials[8])
    4,  // Face 8 → kite 4 (materials[4])
    7,  // Face 9 → kite 7 (materials[7])
  ],

  // D12: 12 pentagonal faces (36 triangles total = 3 triangles per face)
  // Face normals extracted from DodecahedronGeometry(1, 0)
  // Each group of 3 consecutive triangles = 1 pentagonal face
  // Material index = geometry face group index (0-11)
  // Values assigned so opposite faces sum to 13
  d12: [
    -1,  // Placeholder (no face value 0)
    0,   // Face 1  → materials[0]  (group 0, tris 0-2)
    1,   // Face 2  → materials[1]  (group 1, tris 3-5)
    2,   // Face 3  → materials[2]  (group 2, tris 6-8)
    3,   // Face 4  → materials[3]  (group 3, tris 9-11)
    5,   // Face 5  → materials[5]  (group 5, tris 15-17)
    6,   // Face 6  → materials[6]  (group 6, tris 18-20)
    10,  // Face 7  → materials[10] (group 10, tris 30-32)
    11,  // Face 8  → materials[11] (group 11, tris 33-35)
    9,   // Face 9  → materials[9]  (group 9, tris 27-29)
    7,   // Face 10 → materials[7]  (group 7, tris 21-23)
    4,   // Face 11 → materials[4]  (group 4, tris 12-14)
    8,   // Face 12 → materials[8]  (group 8, tris 24-26)
  ],

  // D20: 20 triangular faces (IcosahedronGeometry with detail=0)
  // Face normals extracted from geometry, values assigned so opposite faces sum to 21
  // Opposite pairs: (0,13)→(1,20), (1,12)→(2,19), (2,11)→(3,18), (3,10)→(4,17),
  //   (4,14)→(5,16), (5,17)→(6,15), (6,18)→(7,14), (7,19)→(8,13),
  //   (8,15)→(9,12), (9,16)→(10,11)
  d20: [
    -1, // Placeholder (no face value 0)
    0,  // Face 1  → materials[0]  (triangle 0)
    1,  // Face 2  → materials[1]  (triangle 1)
    2,  // Face 3  → materials[2]  (triangle 2)
    3,  // Face 4  → materials[3]  (triangle 3)
    4,  // Face 5  → materials[4]  (triangle 4)
    5,  // Face 6  → materials[5]  (triangle 5)
    6,  // Face 7  → materials[6]  (triangle 6)
    7,  // Face 8  → materials[7]  (triangle 7)
    8,  // Face 9  → materials[8]  (triangle 8)
    9,  // Face 10 → materials[9]  (triangle 9)
    16, // Face 11 → materials[16] (triangle 16, opposite of 10)
    15, // Face 12 → materials[15] (triangle 15, opposite of 9)
    19, // Face 13 → materials[19] (triangle 19, opposite of 8)
    18, // Face 14 → materials[18] (triangle 18, opposite of 7)
    17, // Face 15 → materials[17] (triangle 17, opposite of 6)
    14, // Face 16 → materials[14] (triangle 14, opposite of 5)
    10, // Face 17 → materials[10] (triangle 10, opposite of 4)
    11, // Face 18 → materials[11] (triangle 11, opposite of 3)
    12, // Face 19 → materials[12] (triangle 12, opposite of 2)
    13, // Face 20 → materials[13] (triangle 13, opposite of 1)
  ],
}

/**
 * Get face normals array for a given dice shape
 */
export function getFaceNormals(shape: DiceShape): DiceFace[] {
  switch (shape) {
    case 'd4':
      return D4_FACE_NORMALS
    case 'd6':
      return D6_FACE_NORMALS
    case 'd8':
      return D8_FACE_NORMALS
    case 'd10':
      return D10_FACE_NORMALS
    case 'd12':
      return D12_FACE_NORMALS
    case 'd20':
      return D20_FACE_NORMALS
    default:
      throw new Error(`Unknown dice shape: ${shape}`)
  }
}

/**
 * Creates a materials array in the correct order for Three.js geometry
 *
 * This is the primary function for creating dice materials. It ensures that:
 * 1. Materials are created for each face value
 * 2. Materials are placed in the correct index for Three.js rendering
 * 3. Face detection and visual rendering stay synchronized
 *
 * Special handling for D10:
 * - D10 has 10 face values (0-9) but 20 triangles (2 per kite face)
 * - Both triangles of a kite get the same material
 *
 * @param shape - Dice shape (d4, d6, d8, d10, d12, d20)
 * @param createMaterial - Function that creates a material for a given face value
 * @returns Array of materials in Three.js geometry order
 *
 * @example
 * ```typescript
 * const materials = createFaceMaterialsArray('d6', (faceValue) => {
 *   const texture = renderNumberToTexture(faceValue);
 *   return new THREE.MeshStandardMaterial({ map: texture });
 * });
 *
 * const mesh = new THREE.Mesh(
 *   new THREE.BoxGeometry(1, 1, 1),
 *   materials
 * );
 * ```
 */
export function createFaceMaterialsArray(
  shape: DiceShape,
  createMaterial: (faceValue: number) => THREE.Material
): THREE.Material[] {
  const faceNormals = getFaceNormals(shape)
  const mapping = FACE_MATERIAL_MAPS[shape]

  if (!mapping || mapping.length === 0) {
    throw new Error(
      `Material mapping not yet implemented for ${shape}. ` +
        `Use createDebugMaterials() to determine the correct mapping.`
    )
  }

  // Special case: D10 has 10 kite faces (2 triangles each, grouped in geometry)
  // Geometry groups reference material indices 0-9 (one per kite)
  if (shape === 'd10') {
    const materials: THREE.Material[] = new Array(10)

    for (let faceValue = 0; faceValue <= 9; faceValue++) {
      const kiteIndex = mapping[faceValue]
      materials[kiteIndex] = createMaterial(faceValue)
    }

    return materials
  }

  // Standard mapping for other dice types
  const materials: THREE.Material[] = new Array(faceNormals.length)

  // Fill materials array using mapping
  // Loop through each face value (1-indexed for d4,d6,d8,d12,d20; 0-indexed handled above for d10)
  for (let faceValue = 1; faceValue <= faceNormals.length; faceValue++) {
    const materialIndex = mapping[faceValue]

    if (materialIndex === undefined || materialIndex === -1) {
      throw new Error(
        `Invalid material index for face value ${faceValue} in ${shape}`
      )
    }

    materials[materialIndex] = createMaterial(faceValue)
  }

  return materials
}

/**
 * Creates debug materials with unique colors for each face
 *
 * **Development Tool**: Use this to visually identify which material index
 * corresponds to which face value. Roll the dice in the preview page and
 * note which color appears when a specific value is detected.
 *
 * For polyhedra (D4, D8, D20), this creates materials for each TRIANGLE,
 * allowing you to see the geometry triangle order.
 *
 * @param shape - Dice shape
 * @returns Array of colored materials
 *
 * @example
 * ```typescript
 * // In preview page:
 * const materials = createDebugMaterials('d20');
 * // Rotate dice, note: "material[0] = Red shows face value 5"
 * // Build mapping: face 5 → material index 0
 * ```
 */
export function createDebugMaterials(shape: DiceShape): THREE.Material[] {
  // High-contrast colors for easy visual identification
  const debugColors = [
    '#FF0000', // 0: Red
    '#00FF00', // 1: Green
    '#0000FF', // 2: Blue
    '#FFFF00', // 3: Yellow
    '#FF00FF', // 4: Magenta
    '#00FFFF', // 5: Cyan
    '#FF8800', // 6: Orange
    '#88FF00', // 7: Lime
    '#0088FF', // 8: Sky Blue
    '#FF0088', // 9: Hot Pink
    '#8800FF', // 10: Purple
    '#00FF88', // 11: Spring Green
    '#FF8888', // 12: Light Red
    '#88FF88', // 13: Light Green
    '#8888FF', // 14: Light Blue
    '#FFFF88', // 15: Light Yellow
    '#FF88FF', // 16: Light Magenta
    '#88FFFF', // 17: Light Cyan
    '#888888', // 18: Gray
    '#FFFFFF', // 19: White
  ]

  // For D10, create 10 materials (1 per kite face, geometry groups handle pairing)
  if (shape === 'd10') {
    return Array.from({ length: 10 }, (_, index) =>
      new THREE.MeshStandardMaterial({
        color: debugColors[index % debugColors.length],
        roughness: 0.7,
        metalness: 0.1,
        flatShading: true,
      })
    )
  }

  const faceNormals = getFaceNormals(shape)

  return faceNormals.map((_, index) =>
    new THREE.MeshStandardMaterial({
      color: debugColors[index % debugColors.length],
      roughness: 0.7,
      metalness: 0.1,
      flatShading: shape !== 'd6',
    })
  )
}

/**
 * Validates that face normals follow standard dice rules
 *
 * For dice with opposite faces (D6, D8, D12, D20), this checks that
 * opposite faces sum to the expected value (e.g., 7 for D6).
 *
 * @param shape - Dice shape to validate
 * @returns Validation result with details
 */
export function validateFaceNormalRules(shape: DiceShape): {
  valid: boolean
  errors: string[]
} {
  const faceNormals = getFaceNormals(shape)
  const errors: string[] = []

  // Only validate dice with opposite faces
  if (shape !== 'd6' && shape !== 'd8' && shape !== 'd10' && shape !== 'd12' && shape !== 'd20') {
    return { valid: true, errors: [] }
  }

  // Expected sum for opposite faces
  const expectedSum = shape === 'd6' ? 7 : shape === 'd8' ? 9 : shape === 'd10' ? 9 : shape === 'd12' ? 13 : 21

  // Check each pair of opposite normals
  for (let i = 0; i < faceNormals.length; i++) {
    const face = faceNormals[i]

    // Find the face with the opposite normal
    const oppositeFace = faceNormals.find((f) => {
      // Check if normals are opposite (dot product ≈ -1)
      const dot = f.normal.dot(face.normal)
      return Math.abs(dot + 1) < 0.01 // Allow small floating point error
    })

    if (!oppositeFace) {
      errors.push(`Face ${face.value} has no opposite face (normal: ${face.normal.toArray()})`)
      continue
    }

    // Check if values sum correctly
    const sum = face.value + oppositeFace.value
    if (sum !== expectedSum) {
      errors.push(
        `Face ${face.value} + opposite face ${oppositeFace.value} = ${sum}, expected ${expectedSum}`
      )
    }
  }

  return {
    valid: errors.length === 0,
    errors,
  }
}
