/**
 * D20 Face Renderers
 *
 * Renders equilateral triangle faces with numbers for D20 (icosahedron)
 */

import type { FaceRenderer } from '../textureRendering'
import { drawEquilateralTriangle } from './shapes'

/**
 * Simple D20 renderer - triangle background with centered number
 */
export const renderD20Simple: FaceRenderer = (
  ctx,
  faceValue,
  canvasSize,
  backgroundColor,
) => {
  const centerX = canvasSize / 2
  const centerY = canvasSize / 2
  const triangleSize = canvasSize

  // Fill canvas background (this will be outside the triangle)
  ctx.fillStyle = backgroundColor
  ctx.fillRect(0, 0, canvasSize, canvasSize)

  const triangleCentroidY = centerY + canvasSize / 6

  // Draw triangle
  drawEquilateralTriangle(ctx, centerX, triangleCentroidY, triangleSize)
  ctx.fillStyle = backgroundColor
  ctx.fill()

  // Draw number centered at triangle centroid
  ctx.fillStyle = 'white'
  ctx.font = `bold ${canvasSize * 0.4}px Arial`
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.fillText(faceValue.toString(), centerX, triangleCentroidY)
}

/**
 * Styled D20 renderer - triangle with shadow and outline
 */
export const renderD20Styled: FaceRenderer = (
  ctx,
  faceValue,
  canvasSize,
  backgroundColor,
) => {
  const centerX = canvasSize / 2
  const centerY = canvasSize / 2
  const triangleSize = canvasSize * 0.85

  // Fill canvas background
  ctx.fillStyle = backgroundColor
  ctx.fillRect(0, 0, canvasSize, canvasSize)

  // Draw triangle with subtle shadow
  ctx.save()
  ctx.shadowColor = 'rgba(0, 0, 0, 0.3)'
  ctx.shadowBlur = canvasSize * 0.02
  ctx.shadowOffsetX = canvasSize * 0.01
  ctx.shadowOffsetY = canvasSize * 0.01

  drawEquilateralTriangle(ctx, centerX, centerY, triangleSize)
  ctx.fillStyle = backgroundColor
  ctx.fill()
  ctx.restore()

  // Draw number with outline and shadow at triangle centroid
  const fontSize = canvasSize * 0.4
  ctx.font = `bold ${fontSize}px Arial`
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'

  // Shadow
  ctx.shadowColor = 'rgba(0, 0, 0, 0.5)'
  ctx.shadowBlur = fontSize * 0.1
  ctx.shadowOffsetX = fontSize * 0.05
  ctx.shadowOffsetY = fontSize * 0.05

  // Outline
  ctx.strokeStyle = 'black'
  ctx.lineWidth = fontSize * 0.08
  ctx.strokeText(faceValue.toString(), centerX, centerY)

  // Fill
  ctx.shadowColor = 'transparent'
  ctx.fillStyle = 'white'
  ctx.fillText(faceValue.toString(), centerX, centerY)
}

/**
 * Bordered D20 renderer - triangle with border
 */
export const renderD20Bordered: FaceRenderer = (
  ctx,
  faceValue,
  canvasSize,
  backgroundColor,
) => {
  const centerX = canvasSize / 2
  const centerY = canvasSize / 2
  const outerSize = canvasSize * 0.85
  const innerSize = canvasSize * 0.75 // Smaller for inner triangle

  // Calculate centroid to center the triangle vertically in the canvas
  // Centroid is 1/3 up from base. To center vertically, we need centroid at 0.5 + height/6
  const triangleCentroidY = centerY + canvasSize / 6

  // Fill canvas background
  ctx.fillStyle = backgroundColor
  ctx.fillRect(0, 0, canvasSize, canvasSize)

  // Draw outer triangle (border)
  drawEquilateralTriangle(ctx, centerX, triangleCentroidY, outerSize, 0.85)
  ctx.fillStyle = '#333'
  ctx.fill()

  // Draw inner triangle (background)
  drawEquilateralTriangle(ctx, centerX, triangleCentroidY, innerSize, 0.85)
  ctx.fillStyle = backgroundColor
  ctx.fill()

  // Draw number at triangle centroid
  // Adjust vertical position to be visually centered (centroid is too low visually)
  // Centroid is at 0.5, inner triangle top is at 0, bottom at 0.75.
  // Bounding box center is 0.375. We split the difference.
  const textY = centerY + canvasSize / 6

  ctx.fillStyle = 'white'
  ctx.font = `bold ${canvasSize * 0.35}px Arial`
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.fillText(faceValue.toString(), centerX, textY)
}
