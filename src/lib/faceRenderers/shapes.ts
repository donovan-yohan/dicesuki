/**
 * Shape Drawing Utilities
 *
 * Functions for drawing geometric shapes on canvas that match dice face geometries.
 * Used by face renderers to create shape-aware textures.
 */

/**
 * Draws an equilateral triangle centered on the canvas
 * Used for D4, D8, D20 faces
 *
 * @param ctx - Canvas 2D context
 * @param centerX - X coordinate of triangle center
 * @param centerY - Y coordinate of triangle center
 * @param size - Height of the triangle
 */
export function drawEquilateralTriangle(
  ctx: CanvasRenderingContext2D,
  centerX: number,
  centerY: number,
  size: number,
  widthScale: number = 1.0,
): void {
  // Calculate vertices of equilateral triangle
  // Triangle points upward with apex at top (matches UV coordinate orientation)
  // The centerX, centerY represents the CENTROID (center of mass) of the triangle

  const height = size
  const width = height * (2 / Math.sqrt(3)) * widthScale // Width for equilateral triangle

  // For an equilateral triangle, the centroid divides the altitude in ratio 2:1
  // (2/3 from apex to centroid, 1/3 from centroid to base)
  // So if centroid is at centerY:
  //   - Apex is 2h/3 ABOVE centroid: centerY - (2 × height / 3)
  //   - Base is h/3 BELOW centroid: centerY + (height / 3)

  // Top vertex (apex)
  const x1 = centerX
  const y1 = centerY - (height * 2) / 3

  // Bottom-left vertex
  const x2 = centerX - width / 2
  const y2 = centerY + height / 3

  // Bottom-right vertex
  const x3 = centerX + width / 2
  const y3 = centerY + height / 3

  ctx.beginPath()
  ctx.moveTo(x1, y1)
  ctx.lineTo(x2, y2)
  ctx.lineTo(x3, y3)
  ctx.closePath()
}

/**
 * Draws a square centered on the canvas
 * Used for D6 faces
 *
 * @param ctx - Canvas 2D context
 * @param centerX - X coordinate of square center
 * @param centerY - Y coordinate of square center
 * @param size - Side length of the square
 */
export function drawSquare(
  ctx: CanvasRenderingContext2D,
  centerX: number,
  centerY: number,
  size: number,
): void {
  const halfSize = size / 2

  ctx.beginPath()
  ctx.rect(centerX - halfSize, centerY - halfSize, size, size)
  ctx.closePath()
}

/**
 * Draws a regular pentagon centered on the canvas
 * Used for D12 faces
 *
 * @param ctx - Canvas 2D context
 * @param centerX - X coordinate of pentagon center
 * @param centerY - Y coordinate of pentagon center
 * @param radius - Radius from center to vertices
 */
export function drawPentagon(
  ctx: CanvasRenderingContext2D,
  centerX: number,
  centerY: number,
  radius: number,
): void {
  const sides = 5
  const angleOffset = -Math.PI / 2 // Start from top vertex

  ctx.beginPath()

  for (let i = 0; i <= sides; i++) {
    const angle = angleOffset + (i * 2 * Math.PI) / sides
    const x = centerX + radius * Math.cos(angle)
    const y = centerY + radius * Math.sin(angle)

    if (i === 0) {
      ctx.moveTo(x, y)
    } else {
      ctx.lineTo(x, y)
    }
  }

  ctx.closePath()
}

/**
 * Draws a kite shape centered on the canvas
 * Used for D10 faces
 *
 * @param ctx - Canvas 2D context
 * @param centerX - X coordinate of kite center
 * @param centerY - Y coordinate of kite center
 * @param width - Width of the kite
 * @param height - Height of the kite
 */
export function drawKite(
  ctx: CanvasRenderingContext2D,
  centerX: number,
  centerY: number,
  width: number,
  height: number,
): void {
  const halfWidth = width / 2
  const halfHeight = height / 2

  // Top vertex
  const x1 = centerX
  const y1 = centerY - halfHeight

  // Right vertex
  const x2 = centerX + halfWidth
  const y2 = centerY

  // Bottom vertex
  const x3 = centerX
  const y3 = centerY + halfHeight

  // Left vertex
  const x4 = centerX - halfWidth
  const y4 = centerY

  ctx.beginPath()
  ctx.moveTo(x1, y1)
  ctx.lineTo(x2, y2)
  ctx.lineTo(x3, y3)
  ctx.lineTo(x4, y4)
  ctx.closePath()
}
