import type { FaceRenderer } from '../textureRendering'
import { drawKite } from './shapes'

const SINGLE_DIGIT_FONT_SCALE = 0.36
const DOUBLE_DIGIT_FONT_SCALE = 0.28

export const renderD10Kite: FaceRenderer = (
  ctx,
  faceValue,
  canvasSize,
  backgroundColor,
) => {
  const centerX = canvasSize / 2
  const centerY = canvasSize / 2
  const text = faceValue.toString()
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

