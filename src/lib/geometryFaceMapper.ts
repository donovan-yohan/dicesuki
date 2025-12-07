import * as THREE from 'three'
import { DiceShape, DiceFace } from './geometries'

/**
 * Automatic Face-to-Triangle Mapping
 *
 * This module automatically determines which geometry triangles correspond to which
 * dice face values by comparing triangle normals to face normals.
 *
 * For non-indexed polyhedra, we compute each triangle's normal and find the closest
 * matching dice face normal.
 */

/**
 * Compute the normal vector for a triangle given its three vertices
 */
function computeTriangleNormal(v1: THREE.Vector3, v2: THREE.Vector3, v3: THREE.Vector3): THREE.Vector3 {
  const edge1 = new THREE.Vector3().subVectors(v2, v1)
  const edge2 = new THREE.Vector3().subVectors(v3, v1)
  const normal = new THREE.Vector3().crossVectors(edge1, edge2).normalize()
  return normal
}

/**
 * Find the closest matching face value for a given triangle normal
 */
function findClosestFace(triangleNormal: THREE.Vector3, faceNormals: DiceFace[]): number {
  let maxDot = -Infinity
  let closestFaceValue = 1

  for (const face of faceNormals) {
    const dot = triangleNormal.dot(face.normal)
    if (dot > maxDot) {
      maxDot = dot
      closestFaceValue = face.value
    }
  }

  return closestFaceValue
}

/**
 * Automatically generate material mapping for a geometry
 *
 * This analyzes the geometry's triangles and matches them to dice face values
 * based on normal vector alignment.
 *
 * @param geometry - The Three.js geometry (must have position attribute)
 * @param faceNormals - Array of dice face normals with values
 * @param shape - Dice shape (for special handling)
 * @returns Mapping array where index = material index, value = face value
 */
export function generateMaterialMapping(
  geometry: THREE.BufferGeometry,
  faceNormals: DiceFace[],
  shape: DiceShape
): number[] {
  const positionAttribute = geometry.getAttribute('position')
  const indexAttribute = geometry.getIndex()

  if (!positionAttribute) {
    throw new Error('Geometry missing position attribute')
  }

  const mapping: number[] = []
  let triangleCount: number

  // Determine triangle count
  if (indexAttribute) {
    triangleCount = indexAttribute.count / 3
  } else {
    triangleCount = positionAttribute.count / 3
  }

  console.log(`[geometryFaceMapper] Analyzing ${triangleCount} triangles for ${shape}`)

  // Process each triangle
  for (let i = 0; i < triangleCount; i++) {
    let v1: THREE.Vector3, v2: THREE.Vector3, v3: THREE.Vector3

    if (indexAttribute) {
      // Indexed geometry
      const idx1 = indexAttribute.getX(i * 3)
      const idx2 = indexAttribute.getX(i * 3 + 1)
      const idx3 = indexAttribute.getX(i * 3 + 2)

      v1 = new THREE.Vector3().fromBufferAttribute(positionAttribute, idx1)
      v2 = new THREE.Vector3().fromBufferAttribute(positionAttribute, idx2)
      v3 = new THREE.Vector3().fromBufferAttribute(positionAttribute, idx3)
    } else {
      // Non-indexed geometry
      v1 = new THREE.Vector3().fromBufferAttribute(positionAttribute, i * 3)
      v2 = new THREE.Vector3().fromBufferAttribute(positionAttribute, i * 3 + 1)
      v3 = new THREE.Vector3().fromBufferAttribute(positionAttribute, i * 3 + 2)
    }

    // Compute triangle normal
    const triangleNormal = computeTriangleNormal(v1, v2, v3)

    // Find closest matching face
    const faceValue = findClosestFace(triangleNormal, faceNormals)

    mapping.push(faceValue)
  }

  console.log(`[geometryFaceMapper] Generated mapping for ${shape}:`, mapping)

  return mapping
}

/**
 * Generate inverted material mapping (face value → material indices)
 *
 * This creates the FACE_MATERIAL_MAPS format from a triangle→face mapping
 *
 * @param triangleToFaceMapping - Array where index=triangle, value=faceValue
 * @param maxFaceValue - Maximum face value (e.g., 20 for d20)
 * @returns Mapping array where index=faceValue, value=material index
 */
export function invertMapping(triangleToFaceMapping: number[], maxFaceValue: number): number[] {
  const inverted: number[] = new Array(maxFaceValue + 1).fill(-1)

  // For each triangle, record which material index it uses
  triangleToFaceMapping.forEach((faceValue, materialIndex) => {
    if (inverted[faceValue] === -1) {
      // First triangle with this face value - record its material index
      inverted[faceValue] = materialIndex
    }
  })

  return inverted
}

/**
 * Log the mapping in a readable format for debugging
 */
export function logMapping(mapping: number[], shape: DiceShape) {
  console.log(`[geometryFaceMapper] Material mapping for ${shape}:`)
  console.log('  Triangle index → Face value:')
  mapping.forEach((faceValue, index) => {
    console.log(`    materials[${index}] → Face ${faceValue}`)
  })
}

/**
 * Extract actual triangle normals from geometry to use as face normals
 *
 * This generates face normals directly from the geometry, ensuring perfect alignment
 * between material indices and face detection.
 *
 * @param geometry - The geometry to extract normals from
 * @param shape - Dice shape (for face value assignment)
 * @returns Array of DiceFace with actual geometry normals
 */
export function extractGeometryFaceNormals(
  geometry: THREE.BufferGeometry,
  shape: DiceShape
): DiceFace[] {
  const positionAttribute = geometry.getAttribute('position')
  const indexAttribute = geometry.getIndex()

  if (!positionAttribute) {
    throw new Error('Geometry missing position attribute')
  }

  const faceNormals: DiceFace[] = []
  let triangleCount: number

  // Determine triangle count
  if (indexAttribute) {
    triangleCount = indexAttribute.count / 3
  } else {
    triangleCount = positionAttribute.count / 3
  }

  // Extract normal for each triangle
  for (let i = 0; i < triangleCount; i++) {
    let v1: THREE.Vector3, v2: THREE.Vector3, v3: THREE.Vector3

    if (indexAttribute) {
      const idx1 = indexAttribute.getX(i * 3)
      const idx2 = indexAttribute.getX(i * 3 + 1)
      const idx3 = indexAttribute.getX(i * 3 + 2)

      v1 = new THREE.Vector3().fromBufferAttribute(positionAttribute, idx1)
      v2 = new THREE.Vector3().fromBufferAttribute(positionAttribute, idx2)
      v3 = new THREE.Vector3().fromBufferAttribute(positionAttribute, idx3)
    } else {
      v1 = new THREE.Vector3().fromBufferAttribute(positionAttribute, i * 3)
      v2 = new THREE.Vector3().fromBufferAttribute(positionAttribute, i * 3 + 1)
      v3 = new THREE.Vector3().fromBufferAttribute(positionAttribute, i * 3 + 2)
    }

    // Compute triangle normal
    const normal = computeTriangleNormal(v1, v2, v3)

    // Assign face value (1-indexed for most dice, 0-indexed for D10)
    const faceValue = shape === 'd10' ? i : i + 1

    faceNormals.push({ value: faceValue, normal })
  }

  return faceNormals
}
