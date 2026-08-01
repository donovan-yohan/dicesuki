/**
 * D20 Face Renderers
 *
 * Renders equilateral triangle faces with numbers for D20 (icosahedron)
 */

import type { FaceRenderer } from '../textureRendering'
import { drawEquilateralTriangle } from './shapes'
import {
  BASIC_GLYPH_STYLE,
  EMBOSSED_GLYPH_STYLE,
  drawFaceGlyph,
  type FaceGlyphStyle,
} from './glyphStyle'

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
 * Styled D20/D8 renderer factory — triangle face with a centroid-anchored
 * numeral.
 *
 * The triangle inset and the centroid maths are the same for every die; only
 * `style` varies, so a basic d20 lands its numerals in exactly the same place as
 * a collectible one. The face-relief shadow is drawn only for styles that ask
 * for one, keeping the basic die genuinely flat.
 */
export function createD20StyledRenderer(style: FaceGlyphStyle): FaceRenderer {
  return (ctx, faceValue, canvasSize, backgroundColor) => {
    const centerX = canvasSize / 2
    const triangleSize = canvasSize * 0.85

    // The equilateral triangle UV maps centroid to canvas (size/2, size*2/3),
    // not (size/2, size/2). The triangle occupies the bottom 2/3 of the canvas
    // with the apex at the top center.
    const triangleCentroidY = canvasSize / 2 + canvasSize / 6

    // Fill canvas background
    ctx.fillStyle = backgroundColor
    ctx.fillRect(0, 0, canvasSize, canvasSize)

    // Draw triangle with subtle shadow. Same-colour fill on the same-colour
    // canvas, so the shadow IS the effect — skip it entirely for flat styles.
    if (style.shadow) {
      ctx.save()
      ctx.shadowColor = 'rgba(0, 0, 0, 0.3)'
      ctx.shadowBlur = canvasSize * 0.02
      ctx.shadowOffsetX = canvasSize * 0.01
      ctx.shadowOffsetY = canvasSize * 0.01

      drawEquilateralTriangle(ctx, centerX, triangleCentroidY, triangleSize)
      ctx.fillStyle = backgroundColor
      ctx.fill()
      ctx.restore()
    }

    drawFaceGlyph(
      ctx,
      faceValue.toString(),
      centerX,
      triangleCentroidY,
      canvasSize * 0.4,
      style,
    )
  }
}

/** Collectible-dice d20/d8: bold white numerals with a black outline. */
export const renderD20Styled: FaceRenderer = createD20StyledRenderer(EMBOSSED_GLYPH_STYLE)

/** Basic-die d20/d8: plain black numerals on a flat face. */
export const renderD20Basic: FaceRenderer = createD20StyledRenderer(BASIC_GLYPH_STYLE)

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
