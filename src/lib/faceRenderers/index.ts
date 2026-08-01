/**
 * Face Renderer barrel export and utilities
 */

import type { DiceShape } from '../geometries'
import type { FaceRenderer } from '../textureRendering'
import { renderBasicNumber, renderStyledNumber } from '../textureRendering'
import { renderD4Basic, renderD4Classic } from './d4Renderer'
import {
  renderD10Kite,
  renderD10KiteBasic,
  renderD10TensKite,
  renderD10TensKiteBasic,
} from './d10Renderer'
import { renderD20Basic, renderD20Styled } from './d20Renderer'

/**
 * Which glyph style a die's faces are drawn in.
 *
 * - `default` — the collectible look: bold white numerals, black outline, shadow.
 * - `basic` — the infinite fallback die: plain black numerals, no outline or
 *   shadow, meant for the white body defined in `src/lib/basicDice.ts`.
 *
 * The two share every layout decision (see `./glyphStyle.ts`), so a basic die is
 * the same die with different ink — never a second geometry or a second UV map.
 */
export type DiceFaceStyle = 'default' | 'basic'

const DEFAULT_RENDERERS: Partial<Record<DiceShape, FaceRenderer>> = {
  d4: renderD4Classic,
  d10: renderD10Kite,
  d10tens: renderD10TensKite,
  d8: renderD20Styled,
  d20: renderD20Styled,
}

const BASIC_RENDERERS: Partial<Record<DiceShape, FaceRenderer>> = {
  d4: renderD4Basic,
  d10: renderD10KiteBasic,
  d10tens: renderD10TensKiteBasic,
  d8: renderD20Basic,
  d20: renderD20Basic,
}

/**
 * Returns the appropriate face renderer for a given dice shape and style.
 *
 * - d4 uses the classic three-numbers-per-face style
 * - d10 uses a narrow kite-safe renderer
 * - d10tens uses the same kite renderer with zero-padded 00–90 labels
 * - d8 and d20 use a styled equilateral triangle renderer
 * - all other shapes use the default centred number renderer
 *
 * Every shape resolves in BOTH styles, so a basic die can never fall back to the
 * collectible look (white numerals on a white body would be invisible).
 */
export function getFaceRendererForShape(
  shape: DiceShape,
  style: DiceFaceStyle = 'default',
): FaceRenderer {
  const table = style === 'basic' ? BASIC_RENDERERS : DEFAULT_RENDERERS
  return table[shape] ?? (style === 'basic' ? renderBasicNumber : renderStyledNumber)
}
