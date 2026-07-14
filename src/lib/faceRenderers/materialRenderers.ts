/**
 * Material-specific face renderers for the "materials lab" dice.
 *
 * - `renderTieDyeD20`: a pastel tie-dye triangle face with a dark, high-contrast
 *   number (legible on the light swirl) — the rubber bouncy-ball look.
 * - `renderMetalMaskD20`: a per-texel material MASK (not albedo) aligned with the
 *   styled d20 number, used by `useDiceMaterials` to build a metalness/roughness map
 *   so a metal die's number reads as MATTE PAINT (non-metallic) while the faces stay
 *   metallic. Green channel → roughness, blue channel → metalness (see
 *   `useDiceMaterials`).
 */

import type { FaceRenderer } from '../textureRendering'
import { drawEquilateralTriangle } from './shapes'

/** Deterministic 0..1 from a face value + salt (stable pattern per face). */
function hash01(value: number, salt: number): number {
  const x = Math.sin(value * 12.9898 + salt * 78.233) * 43758.5453
  return x - Math.floor(x)
}

/** Soft pastel from a hue (HSL, high lightness/low-ish saturation). */
function pastel(hue: number): string {
  return `hsl(${Math.round(hue)}, 70%, 82%)`
}

/**
 * Rubber d20: pastel tie-dye triangle + legible dark number.
 */
export const renderTieDyeD20: FaceRenderer = (ctx, faceValue, canvasSize) => {
  const centerX = canvasSize / 2
  const triangleCentroidY = canvasSize / 2 + canvasSize / 6

  // Base pastel wash over the whole canvas (the triangular face samples this region).
  const baseHue = hash01(faceValue, 1) * 360
  ctx.fillStyle = pastel(baseHue)
  ctx.fillRect(0, 0, canvasSize, canvasSize)

  // A handful of pastel radial blobs at varied hues for the tie-dye swirl.
  for (let i = 0; i < 5; i++) {
    const hue = (baseHue + 60 * (i + 1) + hash01(faceValue, i + 2) * 40) % 360
    const cx = canvasSize * (0.2 + 0.6 * hash01(faceValue, i + 10))
    const cy = canvasSize * (0.2 + 0.6 * hash01(faceValue, i + 20))
    const r = canvasSize * (0.18 + 0.22 * hash01(faceValue, i + 30))
    const grad = ctx.createRadialGradient(cx, cy, 0, cx, cy, r)
    grad.addColorStop(0, pastel(hue))
    grad.addColorStop(1, 'rgba(255,255,255,0)')
    ctx.fillStyle = grad
    ctx.fillRect(0, 0, canvasSize, canvasSize)
  }

  // Legible number: dark fill with a white halo so it reads on any pastel.
  const fontSize = canvasSize * 0.4
  ctx.font = `bold ${fontSize}px Arial`
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.lineJoin = 'round'
  ctx.strokeStyle = 'rgba(255,255,255,0.9)'
  ctx.lineWidth = fontSize * 0.14
  ctx.strokeText(faceValue.toString(), centerX, triangleCentroidY)
  ctx.fillStyle = '#241a33'
  ctx.fillText(faceValue.toString(), centerX, triangleCentroidY)
}

/**
 * Metal d20 material mask (aligned with `renderD20Styled`): green = roughness,
 * blue = metalness. Face region: shiny + metallic; number region: matte + non-metal
 * (so it reads as painted-on numbers). Red is unused.
 */
export const renderMetalMaskD20: FaceRenderer = (ctx, faceValue, canvasSize) => {
  const centerX = canvasSize / 2
  const triangleSize = canvasSize * 0.85
  const triangleCentroidY = canvasSize / 2 + canvasSize / 6

  // Default everywhere: non-metal, mid roughness (outside the triangle never shows).
  ctx.fillStyle = 'rgb(0, 120, 0)'
  ctx.fillRect(0, 0, canvasSize, canvasSize)

  // Face: low roughness (shiny) + full metalness.
  drawEquilateralTriangle(ctx, centerX, triangleCentroidY, triangleSize)
  ctx.fillStyle = 'rgb(0, 70, 255)' // G≈0.27 roughness, B=1 metalness
  ctx.fill()

  // Number: matte (high roughness) + non-metal. Same geometry as renderD20Styled.
  const fontSize = canvasSize * 0.4
  ctx.font = `bold ${fontSize}px Arial`
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.lineJoin = 'round'
  // Slightly fatten via stroke so the matte covers the number's antialiased edge.
  ctx.strokeStyle = 'rgb(0, 235, 0)' // G≈0.92 roughness, B=0 metalness
  ctx.lineWidth = fontSize * 0.16
  ctx.strokeText(faceValue.toString(), centerX, triangleCentroidY)
  ctx.fillStyle = 'rgb(0, 235, 0)'
  ctx.fillText(faceValue.toString(), centerX, triangleCentroidY)
}
