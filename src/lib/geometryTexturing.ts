/**
 * Geometry Texturing Utilities
 *
 * Prepares dice geometries for per-face material array texturing.
 * Adds material groups and generates appropriate UV coordinates.
 *
 * ## Material Group Requirements
 * Three.js needs `groups` on BufferGeometry to know which triangles use
 * which material from a material array. Without groups, only materials[0] is used.
 *
 * ## UV Requirements
 * Default polyhedron UVs use a shared atlas, which doesn't work for per-face texturing.
 * Each face needs UVs that span the full [0,1] range of its own texture.
 *
 * ## Dice Type Summary
 * - d4, d8, d20: 1 triangle per face, non-indexed. Simple equilateral triangle UVs.
 * - d6: BoxGeometry already has groups and per-face UVs. No changes needed.
 * - d10: Indexed geometry, 20 triangles, 10 kite faces. Convert to non-indexed.
 * - d12: 36 triangles, 12 pentagonal faces (3 triangles each). Projected UVs.
 */

import * as THREE from 'three'
import type { DiceShape } from './geometries'

/**
 * Prepares a dice geometry for per-face material array texturing.
 *
 * This function:
 * 1. Converts indexed geometries to non-indexed (required for per-face UVs)
 * 2. Adds material groups so each face uses a different material
 * 3. Generates UV coordinates for per-face texturing
 *
 * @param geometry - The source geometry (will NOT be modified)
 * @param shape - The dice shape type
 * @returns A new geometry ready for material array texturing
 */
export function prepareGeometryForTexturing(
  geometry: THREE.BufferGeometry,
  shape: DiceShape,
): THREE.BufferGeometry {
  // d6 already has groups and correct UVs from BoxGeometry
  if (shape === 'd6') {
    return geometry
  }

  // d10 is indexed - convert to non-indexed for per-face UVs
  if (shape === 'd10') {
    return prepareD10Geometry(geometry)
  }

  // d12 has 3 triangles per face - needs projected UVs
  if (shape === 'd12') {
    return prepareD12Geometry(geometry)
  }

  // d4, d8, d20: simple 1 triangle per face
  return prepareSimplePolyhedronGeometry(geometry)
}

/**
 * Prepare simple polyhedron geometry (d4, d8, d20).
 * Each triangle = 1 face, non-indexed.
 * Adds 1 group per triangle and equilateral triangle UVs.
 */
function prepareSimplePolyhedronGeometry(
  geometry: THREE.BufferGeometry,
): THREE.BufferGeometry {
  const geo = geometry.clone()
  const posAttr = geo.getAttribute('position')
  const triangleCount = posAttr.count / 3

  // Add one group per triangle
  geo.clearGroups()
  for (let i = 0; i < triangleCount; i++) {
    geo.addGroup(i * 3, 3, i)
  }

  // Set equilateral triangle UVs for each face
  // v0 → (0.5, 1.0) = top center of canvas
  // v1 → (0.0, 0.0) = bottom-left of canvas
  // v2 → (1.0, 0.0) = bottom-right of canvas
  //
  // With CanvasTexture flipY=true (default):
  // UV (u, v) → canvas (u * size, (1 - v) * size)
  // So UV (0.5, 1) → canvas top center, UV (0, 0) → canvas bottom-left
  const uvs = new Float32Array(posAttr.count * 2)
  for (let i = 0; i < triangleCount; i++) {
    const base = i * 6
    uvs[base + 0] = 0.5; uvs[base + 1] = 1.0  // v0 = top
    uvs[base + 2] = 0.0; uvs[base + 3] = 0.0  // v1 = bottom-left
    uvs[base + 4] = 1.0; uvs[base + 5] = 0.0  // v2 = bottom-right
  }
  geo.setAttribute('uv', new THREE.BufferAttribute(uvs, 2))

  return geo
}

/**
 * Prepare d10 geometry (pentagonal trapezohedron).
 * 20 indexed triangles forming 10 kite faces.
 * Converts to non-indexed, adds groups, and sets per-triangle UVs.
 */
function prepareD10Geometry(
  geometry: THREE.BufferGeometry,
): THREE.BufferGeometry {
  // Convert to non-indexed so each triangle gets independent UVs
  const geo = geometry.toNonIndexed()

  // Recompute normals for the non-indexed geometry
  geo.computeVertexNormals()

  const posAttr = geo.getAttribute('position')
  const triangleCount = posAttr.count / 3 // 20 triangles

  // Add one group per triangle (20 groups, 20 materials)
  geo.clearGroups()
  for (let i = 0; i < triangleCount; i++) {
    geo.addGroup(i * 3, 3, i)
  }

  // Set UVs: each triangle gets its own full-canvas mapping
  // Using equilateral triangle UVs for each triangle independently
  const uvs = new Float32Array(posAttr.count * 2)
  for (let i = 0; i < triangleCount; i++) {
    const base = i * 6
    uvs[base + 0] = 0.5; uvs[base + 1] = 1.0  // v0 = top
    uvs[base + 2] = 0.0; uvs[base + 3] = 0.0  // v1 = bottom-left
    uvs[base + 4] = 1.0; uvs[base + 5] = 0.0  // v2 = bottom-right
  }
  geo.setAttribute('uv', new THREE.BufferAttribute(uvs, 2))

  return geo
}

/**
 * Prepare d12 geometry (dodecahedron).
 * 36 non-indexed triangles forming 12 pentagonal faces (3 triangles each).
 * Adds groups per pentagon and projected UVs.
 */
function prepareD12Geometry(
  geometry: THREE.BufferGeometry,
): THREE.BufferGeometry {
  const geo = geometry.clone()
  const posAttr = geo.getAttribute('position')
  const faceCount = 12
  const trianglesPerFace = 3

  // Add one group per pentagonal face (3 triangles each)
  geo.clearGroups()
  for (let i = 0; i < faceCount; i++) {
    geo.addGroup(i * trianglesPerFace * 3, trianglesPerFace * 3, i)
  }

  // Generate projected UVs for each pentagonal face
  const uvs = new Float32Array(posAttr.count * 2)

  for (let face = 0; face < faceCount; face++) {
    const startVertex = face * trianglesPerFace * 3 // 9 vertices per face
    const vertexCount = trianglesPerFace * 3

    // Compute face normal from first triangle
    const v1 = new THREE.Vector3().fromBufferAttribute(posAttr, startVertex)
    const v2 = new THREE.Vector3().fromBufferAttribute(posAttr, startVertex + 1)
    const v3 = new THREE.Vector3().fromBufferAttribute(posAttr, startVertex + 2)
    const edge1 = new THREE.Vector3().subVectors(v2, v1)
    const edge2 = new THREE.Vector3().subVectors(v3, v1)
    const normal = new THREE.Vector3().crossVectors(edge1, edge2).normalize()

    // Create tangent/bitangent basis for 2D projection
    const tangent = new THREE.Vector3()
    if (Math.abs(normal.y) < 0.99) {
      tangent.crossVectors(new THREE.Vector3(0, 1, 0), normal).normalize()
    } else {
      tangent.crossVectors(new THREE.Vector3(1, 0, 0), normal).normalize()
    }
    const bitangent = new THREE.Vector3().crossVectors(normal, tangent).normalize()

    // Compute centroid
    const centroid = new THREE.Vector3()
    for (let i = 0; i < vertexCount; i++) {
      centroid.add(new THREE.Vector3().fromBufferAttribute(posAttr, startVertex + i))
    }
    centroid.divideScalar(vertexCount)

    // Project vertices onto 2D plane and find bounds
    const projected: { u: number; v: number }[] = []
    let minU = Infinity, maxU = -Infinity, minV = Infinity, maxV = -Infinity

    for (let i = 0; i < vertexCount; i++) {
      const pos = new THREE.Vector3().fromBufferAttribute(posAttr, startVertex + i)
      const d = pos.clone().sub(centroid)
      const u = d.dot(tangent)
      const v = d.dot(bitangent)
      projected.push({ u, v })

      minU = Math.min(minU, u)
      maxU = Math.max(maxU, u)
      minV = Math.min(minV, v)
      maxV = Math.max(maxV, v)
    }

    // Normalize to [0,1] centered at (0.5, 0.5)
    const rangeU = maxU - minU
    const rangeV = maxV - minV
    const maxRange = Math.max(rangeU, rangeV)
    const padding = 0.1 // Keep away from texture edges
    const scale = (1 - 2 * padding) / maxRange
    const centerU = (minU + maxU) / 2
    const centerV = (minV + maxV) / 2

    for (let i = 0; i < vertexCount; i++) {
      const idx = (startVertex + i) * 2
      uvs[idx] = 0.5 + (projected[i].u - centerU) * scale
      uvs[idx + 1] = 0.5 + (projected[i].v - centerV) * scale
    }
  }

  geo.setAttribute('uv', new THREE.BufferAttribute(uvs, 2))

  return geo
}
