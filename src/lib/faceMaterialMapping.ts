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

  // TODO: These mappings need to be determined empirically through testing
  // Use createDebugMaterials() to visually identify the correct mapping
  d4: [],
  d8: [],
  d10: [],
  d12: [],
  d20: [],
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

  // Create materials array sized for geometry
  const materials: THREE.Material[] = new Array(faceNormals.length)

  // Fill materials array using mapping
  // Loop through each face value (1-indexed)
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
 * @param shape - Dice shape
 * @returns Array of colored materials with numbers
 *
 * @example
 * ```typescript
 * // In preview page:
 * const materials = createDebugMaterials('d20');
 * // Roll dice, note: "Red face up → detected value 1"
 * // Build mapping: face 1 → material index for red
 * ```
 */
export function createDebugMaterials(shape: DiceShape): THREE.Material[] {
  // High-contrast colors for easy visual identification
  const debugColors = [
    '#FF0000', // Red
    '#00FF00', // Green
    '#0000FF', // Blue
    '#FFFF00', // Yellow
    '#FF00FF', // Magenta
    '#00FFFF', // Cyan
    '#FF8800', // Orange
    '#88FF00', // Lime
    '#0088FF', // Sky Blue
    '#FF0088', // Hot Pink
    '#8800FF', // Purple
    '#00FF88', // Spring Green
    '#FF8888', // Light Red
    '#88FF88', // Light Green
    '#8888FF', // Light Blue
    '#FFFF88', // Light Yellow
    '#FF88FF', // Light Magenta
    '#88FFFF', // Light Cyan
    '#888888', // Gray
    '#FFFFFF', // White
  ]

  const faceNormals = getFaceNormals(shape)

  return faceNormals.map((_, index) =>
    new THREE.MeshStandardMaterial({
      color: debugColors[index % debugColors.length],
      roughness: 0.7,
      metalness: 0.1,
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
  if (shape !== 'd6' && shape !== 'd8' && shape !== 'd12' && shape !== 'd20') {
    return { valid: true, errors: [] }
  }

  // Expected sum for opposite faces
  const expectedSum = shape === 'd6' ? 7 : shape === 'd8' ? 9 : shape === 'd12' ? 13 : 21

  // Check each pair of opposite normals
  for (let i = 0; i < faceNormals.length; i++) {
    const face = faceNormals[i]
    const oppositeNormal = face.normal.clone().negate()

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
