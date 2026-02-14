/**
 * D4 Classic-Style Face Renderer
 *
 * Renders triangular faces with 3 numbers per face for classic d4 numbering.
 *
 * ## Classic D4 Convention
 * - Each triangular face has 3 numbers, one near each vertex
 * - At each vertex, the number shown is the value of the OPPOSITE face
 *   (the face that doesn't touch that vertex)
 * - When face N is on the ground, the value N appears at the TOP vertex
 *   of all 3 visible faces
 *
 * ## UV Mapping Convention
 * Each face's 3 vertices are UV-mapped as:
 * - Vertex 0 (pos[face*3+0]) → UV (0.5, 1.0) = top center of canvas
 * - Vertex 1 (pos[face*3+1]) → UV (0.0, 0.0) = bottom-left of canvas
 * - Vertex 2 (pos[face*3+2]) → UV (1.0, 0.0) = bottom-right of canvas
 *
 * ## Geometry Analysis (TetrahedronGeometry(1, 0))
 *
 * Base vertices and their opposite faces:
 * - V0 (-s,-s,+s) → opposite face 1 (value 2) → shows "2"
 * - V1 (+s,+s,+s) → opposite face 3 (value 4) → shows "4"
 * - V2 (-s,+s,-s) → opposite face 2 (value 3) → shows "3"
 * - V3 (+s,-s,-s) → opposite face 0 (value 1) → shows "1"
 *
 * Face vertex assignments:
 * - Face 0: V0, V1, V2 → shows [2, 4, 3] at [top, bottomLeft, bottomRight]
 * - Face 1: V3, V2, V1 → shows [1, 3, 4]
 * - Face 2: V3, V1, V0 → shows [1, 4, 2]
 * - Face 3: V3, V0, V2 → shows [1, 2, 3]
 */

import type { FaceRenderer } from '../textureRendering'

/**
 * Numbers displayed at each vertex of each face.
 *
 * D4_FACE_NUMBERS[faceIndex] = [topNumber, bottomLeftNumber, bottomRightNumber]
 *
 * Derived from TetrahedronGeometry(1, 0) vertex layout analysis.
 * Each number is the value of the face opposite to that vertex.
 */
export const D4_FACE_NUMBERS: readonly [number, number, number][] = [
  [2, 4, 3],  // Face 0 (value 1): V0→2, V1→4, V2→3
  [1, 3, 4],  // Face 1 (value 2): V3→1, V2→3, V1→4
  [1, 4, 2],  // Face 2 (value 3): V3→1, V1→4, V0→2
  [1, 2, 3],  // Face 3 (value 4): V3→1, V0→2, V2→3
]

/**
 * Classic D4 renderer - three numbers per triangular face
 *
 * Draws 3 numbers on each face, positioned near each vertex of the triangle.
 * The UV mapping places vertex 0 at top, vertex 1 at bottom-left,
 * vertex 2 at bottom-right.
 *
 * Numbers are drawn with white fill and black outline for legibility.
 */
export const renderD4Classic: FaceRenderer = (
  ctx,
  faceValue,
  canvasSize,
  backgroundColor,
) => {
  const faceIndex = faceValue - 1 // Convert 1-based value to 0-based index
  const numbers = D4_FACE_NUMBERS[faceIndex]

  // Fill background
  ctx.fillStyle = backgroundColor
  ctx.fillRect(0, 0, canvasSize, canvasSize)

  const fontSize = canvasSize * 0.28
  ctx.font = `bold ${fontSize}px Arial`
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'

  // Position numbers near each vertex of the equilateral triangle
  // UV coordinates: top=(0.5, 1.0), bottomLeft=(0.0, 0.0), bottomRight=(1.0, 0.0)
  // Push numbers inward from vertices for better visibility
  const inset = 0.22 // How far from vertex toward center (0=vertex, 1=center)
  const centerX = canvasSize / 2
  const centerY = canvasSize * 2 / 3 // Triangle centroid is at 2/3 height

  // Vertex positions on canvas (matching UV layout)
  const topX = canvasSize / 2
  const topY = canvasSize * 0.05
  const bottomLeftX = canvasSize * 0.05
  const bottomLeftY = canvasSize * 0.95
  const bottomRightX = canvasSize * 0.95
  const bottomRightY = canvasSize * 0.95

  // Lerp each vertex position toward centroid for better positioning
  const numTopX = topX + (centerX - topX) * inset
  const numTopY = topY + (centerY - topY) * inset
  const numBLX = bottomLeftX + (centerX - bottomLeftX) * inset
  const numBLY = bottomLeftY + (centerY - bottomLeftY) * inset
  const numBRX = bottomRightX + (centerX - bottomRightX) * inset
  const numBRY = bottomRightY + (centerY - bottomRightY) * inset

  // Draw each number with outline for legibility
  const drawNumber = (num: number, x: number, y: number) => {
    // Shadow
    ctx.shadowColor = 'rgba(0, 0, 0, 0.5)'
    ctx.shadowBlur = fontSize * 0.1
    ctx.shadowOffsetX = fontSize * 0.04
    ctx.shadowOffsetY = fontSize * 0.04

    // Outline
    ctx.strokeStyle = 'black'
    ctx.lineWidth = fontSize * 0.1
    ctx.strokeText(num.toString(), x, y)

    // Fill
    ctx.shadowColor = 'transparent'
    ctx.fillStyle = 'white'
    ctx.fillText(num.toString(), x, y)
  }

  drawNumber(numbers[0], numTopX, numTopY)     // Top vertex
  drawNumber(numbers[1], numBLX, numBLY)       // Bottom-left vertex
  drawNumber(numbers[2], numBRX, numBRY)       // Bottom-right vertex
}
