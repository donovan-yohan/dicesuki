import {
  DiceShape,
  D4_FACE_NORMALS,
  D6_FACE_NORMALS,
  D8_FACE_NORMALS,
  D10_FACE_NORMALS,
  D12_FACE_NORMALS,
  D20_FACE_NORMALS,
  DiceFace
} from './geometries'
import { ColliderConfig } from '../types/customDice'

/**
 * Dice Collider Configuration
 *
 * Maps each dice shape to its optimal physics collider configuration.
 * Colliders are chosen based on geometry accuracy vs performance trade-offs.
 */

/**
 * Get the optimal collider configuration for a dice shape
 *
 * @param shape - The dice shape (d4, d6, d8, d10, d12, d20)
 * @param size - The size/scale of the dice (default: 1)
 * @returns Collider configuration with type and arguments
 *
 * ## Collider Selection Strategy
 *
 * - **D4 (Tetrahedron)**: Convex hull - complex geometry requires hull for accuracy
 * - **D6 (Cube)**: Cuboid - perfect match for box geometry
 * - **D8 (Octahedron)**: Convex hull - 8 triangular faces, hull more accurate than ball
 * - **D10 (Pentagonal Trapezohedron)**: Convex hull - custom geometry requires hull
 * - **D12 (Dodecahedron)**: Convex hull - 12 pentagonal faces, hull for stability
 * - **D20 (Icosahedron)**: Convex hull - 20 triangular faces, hull for proper rolling
 */
export function getDiceColliderConfig(shape: DiceShape, size: number = 1): ColliderConfig {
  switch (shape) {
    case 'd4':
      // Tetrahedron: Use convex hull for accurate collision
      return {
        type: 'hull',
        args: {}
      }

    case 'd6':
      // Cube: Perfect fit for cuboid collider
      return {
        type: 'cuboid',
        args: {
          halfExtents: [size / 2, size / 2, size / 2]
        }
      }

    case 'd8':
      // Octahedron: Convex hull for 8 triangular faces
      return {
        type: 'hull',
        args: {}
      }

    case 'd10':
      // Pentagonal Trapezohedron: Convex hull for custom geometry
      return {
        type: 'hull',
        args: {}
      }

    case 'd12':
      // Dodecahedron: Convex hull for 12 pentagonal faces
      return {
        type: 'hull',
        args: {}
      }

    case 'd20':
      // Icosahedron: Convex hull for 20 triangular faces
      return {
        type: 'hull',
        args: {}
      }

    default:
      // Fallback to cuboid for unknown shapes
      console.warn(`Unknown dice shape: ${shape}, using cuboid collider`)
      return {
        type: 'cuboid',
        args: {
          halfExtents: [size / 2, size / 2, size / 2]
        }
      }
  }
}

/**
 * Get face normals in serializable format for metadata
 *
 * @param shape - The dice shape
 * @returns Array of face normals with { value, normal } structure
 */
export function getDiceFaceNormalsForMetadata(shape: DiceShape): Array<{ value: number; normal: { x: number; y: number; z: number } }> {
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
      faceNormals = D10_FACE_NORMALS
      break
    case 'd12':
      faceNormals = D12_FACE_NORMALS
      break
    case 'd20':
      faceNormals = D20_FACE_NORMALS
      break
    default:
      faceNormals = D6_FACE_NORMALS
  }

  // Convert THREE.Vector3 to plain object format
  return faceNormals.map((face) => ({
    value: face.value,
    normal: {
      x: face.normal.x,
      y: face.normal.y,
      z: face.normal.z
    }
  }))
}
