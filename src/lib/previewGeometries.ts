import * as THREE from 'three'
import { DiceShape } from './geometries'

/**
 * Preview Geometry Functions
 *
 * These functions create dice geometries optimized for the preview utility.
 * They use NO subdivision (detail=0) to ensure each dice face maps to a single
 * material index, enabling number texture rendering.
 *
 * Key differences from production geometries:
 * - detail=0 (flat faces, no rounding)
 * - Each logical dice face = 1 material index (or predictable triangle group)
 * - Optimized for material mapping, not visual smoothness
 */

/**
 * D4 Preview Geometry (Tetrahedron)
 * 4 triangular faces → 4 materials (indices 0-3)
 *
 * Note: TetrahedronGeometry creates non-indexed geometry (12 vertices for 4 triangles)
 * We need to add groups so each triangle can have its own material
 */
export function createD4PreviewGeometry(size: number = 1): THREE.TetrahedronGeometry {
  const geometry = new THREE.TetrahedronGeometry(size, 0) // detail=0 for flat faces

  // Add material groups - each triangle (3 vertices) gets its own material index
  // Non-indexed geometry: 12 vertices = 4 triangles × 3 vertices/triangle
  geometry.clearGroups()
  for (let i = 0; i < 4; i++) {
    geometry.addGroup(i * 3, 3, i) // (start, count, materialIndex)
  }

  // ✅ Add proper UV coordinates for triangle faces
  const uvs = new Float32Array(12 * 2) // 12 vertices × 2 UV coords

  // UV coordinates with flipped V to correct upside-down rendering
  for (let i = 0; i < 4; i++) {
    const uvIndex = i * 6

    uvs[uvIndex + 0] = 0.5   // v0.u (top center)
    uvs[uvIndex + 1] = 1.0   // v0.v (FLIPPED: bottom edge)

    uvs[uvIndex + 2] = 0.0   // v1.u (left edge)
    uvs[uvIndex + 3] = 0.0   // v1.v (FLIPPED: top edge)

    uvs[uvIndex + 4] = 1.0   // v2.u (right edge)
    uvs[uvIndex + 5] = 0.0   // v2.v (FLIPPED: top edge)
  }

  geometry.setAttribute('uv', new THREE.BufferAttribute(uvs, 2))

  return geometry
}

/**
 * D6 Preview Geometry (Cube)
 * 6 square faces → 6 materials (indices 0-5)
 */
export function createD6PreviewGeometry(size: number = 1): THREE.BoxGeometry {
  return new THREE.BoxGeometry(size, size, size)
}

/**
 * D8 Preview Geometry (Octahedron)
 * 8 triangular faces → 8 materials (indices 0-7)
 *
 * Note: OctahedronGeometry creates non-indexed geometry (24 vertices for 8 triangles)
 * We need to add groups so each triangle can have its own material
 */
export function createD8PreviewGeometry(size: number = 1): THREE.OctahedronGeometry {
  const geometry = new THREE.OctahedronGeometry(size, 0) // detail=0 for flat faces

  // Add material groups - each triangle (3 vertices) gets its own material index
  // Non-indexed geometry: 24 vertices = 8 triangles × 3 vertices/triangle
  geometry.clearGroups()
  for (let i = 0; i < 8; i++) {
    // Each triangle starts at vertex index i*3 and has 3 vertices
    geometry.addGroup(i * 3, 3, i) // (start, count, materialIndex)
  }

  // ✅ Add proper UV coordinates for triangle faces
  const uvs = new Float32Array(24 * 2) // 24 vertices × 2 UV coords

  // UV coordinates with flipped V to correct upside-down rendering
  for (let i = 0; i < 8; i++) {
    const uvIndex = i * 6

    uvs[uvIndex + 0] = 0.5   // v0.u (top center)
    uvs[uvIndex + 1] = 1.0   // v0.v (FLIPPED: bottom edge)

    uvs[uvIndex + 2] = 0.0   // v1.u (left edge)
    uvs[uvIndex + 3] = 0.0   // v1.v (FLIPPED: top edge)

    uvs[uvIndex + 4] = 1.0   // v2.u (right edge)
    uvs[uvIndex + 5] = 0.0   // v2.v (FLIPPED: top edge)
  }

  geometry.setAttribute('uv', new THREE.BufferAttribute(uvs, 2))

  return geometry
}

/**
 * D10 Preview Geometry (Pentagonal Trapezohedron)
 * 10 kite-shaped faces (20 triangles) → needs grouping
 * Each kite = 2 triangles, so we need to identify which triangles belong to which face
 */
export function createD10PreviewGeometry(size: number = 1): THREE.BufferGeometry {
  // Pentagonal trapezohedron - 10 kite-shaped faces
  // 12 vertices total: top apex, bottom apex, and 10 middle vertices in zigzag pattern
  const vertices: number[] = [
    // Vertex 0: Top apex
    0, size, 0,
    // Vertex 1: Bottom apex
    0, -size, 0,
  ]

  // Generate 10 middle vertices in a zigzag pattern (alternating heights)
  const sides = 10
  const altitude = 0.105 * size

  for (let i = 0; i < sides; i++) {
    const angle = (i * Math.PI * 2) / sides
    const x = -Math.cos(angle) * size
    const z = -Math.sin(angle) * size
    const y = altitude * (i % 2 ? 1 : -1)
    vertices.push(x, y, z)
  }

  // 20 triangular faces forming 10 kite-shaped faces
  const indices = new Uint16Array([
    // Top 10 triangles
    0, 3, 2,   0, 4, 3,   0, 5, 4,   0, 6, 5,   0, 7, 6,
    0, 8, 7,   0, 9, 8,   0, 10, 9,  0, 11, 10, 0, 2, 11,

    // Bottom 10 triangles
    1, 2, 3,   1, 3, 4,   1, 4, 5,   1, 5, 6,   1, 6, 7,
    1, 7, 8,   1, 8, 9,   1, 9, 10,  1, 10, 11, 1, 11, 2,
  ])

  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(vertices), 3))
  geometry.setIndex(new THREE.BufferAttribute(indices, 1))

  // Use flat shading (compute face normals, not vertex normals)
  // This gives each triangle its own normal for sharp edges
  geometry.computeVertexNormals()

  // Add material groups - 20 triangles, each gets its own material
  // Material mapping handles pairing top/bottom triangles of same kite
  geometry.clearGroups()
  for (let i = 0; i < 20; i++) {
    geometry.addGroup(i * 3, 3, i) // (start, count, materialIndex)
  }

  return geometry
}

/**
 * D12 Preview Geometry (Dodecahedron)
 * 12 pentagonal faces → BUT each pentagon is triangulated into 3 triangles
 * Total: 36 triangles → We need to group them by original pentagon face
 */
export function createD12PreviewGeometry(size: number = 1): THREE.DodecahedronGeometry {
  return new THREE.DodecahedronGeometry(size, 0) // detail=0 for flat faces
}

/**
 * D20 Preview Geometry (Icosahedron)
 * 20 triangular faces → 20 materials (indices 0-19)
 *
 * Note: IcosahedronGeometry creates non-indexed geometry (60 vertices for 20 triangles)
 * We need to add groups so each triangle can have its own material
 */
export function createD20PreviewGeometry(size: number = 1): THREE.IcosahedronGeometry {
  const geometry = new THREE.IcosahedronGeometry(size, 0) // detail=0 for flat faces

  // Add material groups - each triangle (3 vertices) gets its own material index
  // Non-indexed geometry: 60 vertices = 20 triangles × 3 vertices/triangle
  geometry.clearGroups()
  for (let i = 0; i < 20; i++) {
    geometry.addGroup(i * 3, 3, i) // (start, count, materialIndex)
  }

  // ✅ Add proper UV coordinates for triangle faces
  // Default UVs from IcosahedronGeometry are designed for wrapping a single texture
  // We need each triangle to map the full texture for individual face textures
  const uvs = new Float32Array(60 * 2) // 60 vertices × 2 UV coords (u,v)

  // UV coordinates with flipped V to correct upside-down rendering
  for (let i = 0; i < 20; i++) {
    const uvIndex = i * 6 // Each triangle has 3 vertices × 2 UV coords

    uvs[uvIndex + 0] = 0.5   // v0.u (top center)
    uvs[uvIndex + 1] = 1.0   // v0.v (FLIPPED: bottom edge)

    uvs[uvIndex + 2] = 0.0   // v1.u (left edge)
    uvs[uvIndex + 3] = 0.0   // v1.v (FLIPPED: top edge)

    uvs[uvIndex + 4] = 1.0   // v2.u (right edge)
    uvs[uvIndex + 5] = 0.0   // v2.v (FLIPPED: top edge)
  }

  geometry.setAttribute('uv', new THREE.BufferAttribute(uvs, 2))

  return geometry
}

/**
 * Get preview geometry for any dice shape
 */
export function getPreviewGeometry(shape: DiceShape, size: number = 1): THREE.BufferGeometry {
  switch (shape) {
    case 'd4':
      return createD4PreviewGeometry(size)
    case 'd6':
      return createD6PreviewGeometry(size)
    case 'd8':
      return createD8PreviewGeometry(size)
    case 'd10':
      return createD10PreviewGeometry(size)
    case 'd12':
      return createD12PreviewGeometry(size)
    case 'd20':
      return createD20PreviewGeometry(size)
    default:
      return createD6PreviewGeometry(size)
  }
}

/**
 * Analyze geometry to count faces/triangles
 * Useful for understanding material array size requirements
 */
export function analyzeGeometry(geometry: THREE.BufferGeometry): {
  triangleCount: number
  vertexCount: number
  hasIndex: boolean
} {
  const position = geometry.getAttribute('position')
  const index = geometry.getIndex()

  const triangleCount = index
    ? index.count / 3
    : position.count / 3

  return {
    triangleCount,
    vertexCount: position.count,
    hasIndex: !!index
  }
}
