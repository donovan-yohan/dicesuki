import type { FaceRenderer } from '../textureRendering'
import { formatDieFaceLabel, PERCENTILE_TENS_SHAPE } from '../percentileRolls'
import { drawKite } from './shapes'

const SINGLE_DIGIT_FONT_SCALE = 0.36
const DOUBLE_DIGIT_FONT_SCALE = 0.28

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

  ctx.font = `bold ${fontSize}px Arial`
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'

  ctx.shadowColor = 'rgba(0, 0, 0, 0.5)'
  ctx.shadowBlur = fontSize * 0.1
  ctx.shadowOffsetX = fontSize * 0.04
  ctx.shadowOffsetY = fontSize * 0.04

  ctx.strokeStyle = 'black'
  ctx.lineWidth = fontSize * 0.08
  ctx.strokeText(text, centerX, textY)

  ctx.shadowColor = 'transparent'
  ctx.fillStyle = 'white'
  ctx.fillText(text, centerX, textY)

  ctx.restore()
}

export const renderD10Kite: FaceRenderer = (
  ctx,
  faceValue,
  canvasSize,
  backgroundColor,
) => {
  renderKiteLabel(ctx, faceValue.toString(), canvasSize, backgroundColor)
}

/**
 * Percentile TENS die face renderer. Same kite art as the d10, but the face
 * value is drawn zero-padded — `00`, `10`, … `90` — which is what makes the die
 * readable as the tens half of a d100 pair.
 */
export const renderD10TensKite: FaceRenderer = (
  ctx,
  faceValue,
  canvasSize,
  backgroundColor,
) => {
  renderKiteLabel(
    ctx,
    formatDieFaceLabel(PERCENTILE_TENS_SHAPE, faceValue),
    canvasSize,
    backgroundColor,
  )
}
