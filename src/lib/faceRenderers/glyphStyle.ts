/**
 * Face glyph styling — the LOOK of the numerals, separated from their LAYOUT.
 *
 * Every per-shape renderer owns where a numeral goes (the d4's three
 * vertex-anchored numbers, the d10's kite, the d20's triangle centroid). None of
 * them should also own how a numeral is painted, because that is exactly what
 * varies between a collectible die and the infinite {@link BASIC_GLYPH_STYLE}
 * fallback die.
 *
 * Keeping the two apart is what lets a basic die reuse the real layout maths:
 * if the d10 kite is resized, the basic d10 moves with it instead of drifting.
 * See `src/lib/basicDice.ts` for the die itself.
 */

/** How a numeral is painted onto a face. */
export interface FaceGlyphStyle {
  /** Fill colour of the numeral. */
  fill: string
  /** CSS font weight, e.g. `'bold'` or `'normal'`. */
  weight: string
  /** CSS font family stack. */
  family: string
  /** Outline drawn behind the fill. Omit for a flat, printed look. */
  stroke?: {
    color: string
    /** Line width as a fraction of the font size. */
    widthScale: number
  }
  /** Drop shadow drawn behind the outline. Omit for a flat, printed look. */
  shadow?: {
    color: string
    /** Blur radius as a fraction of the font size. */
    blurScale: number
    /** Offset (x and y) as a fraction of the font size. */
    offsetScale: number
  }
}

/**
 * The collectible-dice look: bold white numerals lifted off the face by a black
 * outline and a soft drop shadow. This is what every die shipped before basic
 * dice existed, so it stays the default for owned/inventory dice.
 */
export const EMBOSSED_GLYPH_STYLE: FaceGlyphStyle = {
  fill: 'white',
  weight: 'bold',
  family: 'Arial',
  stroke: { color: 'black', widthScale: 0.08 },
  shadow: { color: 'rgba(0, 0, 0, 0.5)', blurScale: 0.1, offsetScale: 0.05 },
}

/**
 * The basic-die look: plain black numerals, regular weight, no outline and no
 * shadow — the most bare-minimum die legible on a white body. Deliberately
 * *unflattering* next to a collectible die; a basic die should read as the
 * stand-in it is.
 */
export const BASIC_GLYPH_STYLE: FaceGlyphStyle = {
  fill: '#000000',
  weight: 'normal',
  family: 'Helvetica, Arial, sans-serif',
}

/**
 * Paint one numeral at `(x, y)`.
 *
 * Sets the font itself so a caller only has to decide the size, and always
 * leaves `ctx.shadowColor` cleared so a later draw on the same context does not
 * inherit this glyph's shadow.
 */
export function drawFaceGlyph(
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  fontSize: number,
  style: FaceGlyphStyle,
): void {
  ctx.font = `${style.weight} ${fontSize}px ${style.family}`
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'

  if (style.shadow) {
    ctx.shadowColor = style.shadow.color
    ctx.shadowBlur = fontSize * style.shadow.blurScale
    ctx.shadowOffsetX = fontSize * style.shadow.offsetScale
    ctx.shadowOffsetY = fontSize * style.shadow.offsetScale
  }

  if (style.stroke) {
    ctx.strokeStyle = style.stroke.color
    ctx.lineWidth = fontSize * style.stroke.widthScale
    ctx.strokeText(text, x, y)
  }

  // Cleared before the fill so the shadow sits behind the outline only, and so
  // nothing drawn after this glyph inherits it.
  ctx.shadowColor = 'transparent'
  ctx.shadowBlur = 0
  ctx.shadowOffsetX = 0
  ctx.shadowOffsetY = 0

  ctx.fillStyle = style.fill
  ctx.fillText(text, x, y)
}
