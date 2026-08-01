import type { FaceRenderer } from '../textureRendering'
import { formatDieFaceLabel, PERCENTILE_TENS_SHAPE } from '../percentileRolls'
import { drawKite } from './shapes'
import {
  BASIC_GLYPH_STYLE,
  EMBOSSED_GLYPH_STYLE,
  drawFaceGlyph,
  type FaceGlyphStyle,
} from './glyphStyle'

const SINGLE_DIGIT_FONT_SCALE = 0.36
const DOUBLE_DIGIT_FONT_SCALE = 0.28

/** The kite is narrow, so the shadow sits tighter than the shared default. */
const D10_EMBOSSED_GLYPH_STYLE: FaceGlyphStyle = {
  ...EMBOSSED_GLYPH_STYLE,
  shadow: { color: 'rgba(0, 0, 0, 0.5)', blurScale: 0.1, offsetScale: 0.04 },
}

/**
 * Draw one kite face carrying `text`. Shared by the ones d10 (`0`–`9`) and the
 * percentile tens die (`00`–`90`) so both look like the same die family; the
 * two-digit tens labels drop to a smaller font so they stay inside the kite.
 */
function renderKiteLabel(
  ctx: CanvasRenderingContext2D,
  text: string,
  canvasSize: number,
  backgroundColor: string,
  style: FaceGlyphStyle,
): void {
  const centerX = canvasSize / 2
  const centerY = canvasSize / 2
  const fontScale = text.length > 1 ? DOUBLE_DIGIT_FONT_SCALE : SINGLE_DIGIT_FONT_SCALE
  const fontSize = canvasSize * fontScale
  const textY = centerY + canvasSize * 0.02

  ctx.fillStyle = backgroundColor
  ctx.fillRect(0, 0, canvasSize, canvasSize)

  ctx.save()
  drawKite(ctx, centerX, centerY, canvasSize * 0.76, canvasSize * 0.92)
  ctx.clip()

  drawFaceGlyph(ctx, text, centerX, textY, fontSize, style)

  ctx.restore()
}

/** Ones d10 (`0`–`9`) in the given glyph style. */
export function createD10KiteRenderer(style: FaceGlyphStyle): FaceRenderer {
  return (ctx, faceValue, canvasSize, backgroundColor) => {
    renderKiteLabel(ctx, faceValue.toString(), canvasSize, backgroundColor, style)
  }
}

/**
 * Percentile TENS die face renderer. Same kite art as the d10, but the face
 * value is drawn zero-padded — `00`, `10`, … `90` — which is what makes the die
 * readable as the tens half of a d100 pair.
 */
export function createD10TensKiteRenderer(style: FaceGlyphStyle): FaceRenderer {
  return (ctx, faceValue, canvasSize, backgroundColor) => {
    renderKiteLabel(
      ctx,
      formatDieFaceLabel(PERCENTILE_TENS_SHAPE, faceValue),
      canvasSize,
      backgroundColor,
      style,
    )
  }
}

export const renderD10Kite: FaceRenderer = createD10KiteRenderer(D10_EMBOSSED_GLYPH_STYLE)
export const renderD10TensKite: FaceRenderer = createD10TensKiteRenderer(D10_EMBOSSED_GLYPH_STYLE)

/** Basic-die variants: plain black numerals, no outline or shadow. */
export const renderD10KiteBasic: FaceRenderer = createD10KiteRenderer(BASIC_GLYPH_STYLE)
export const renderD10TensKiteBasic: FaceRenderer = createD10TensKiteRenderer(BASIC_GLYPH_STYLE)
