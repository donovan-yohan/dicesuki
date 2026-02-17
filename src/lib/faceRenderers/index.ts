/**
 * Face Renderer barrel export and utilities
 */

import type { DiceShape } from '../geometries'
import type { FaceRenderer } from '../textureRendering'
import { renderStyledNumber } from '../textureRendering'
import { renderD4Classic } from './d4Renderer'
import { renderD20Styled } from './d20Renderer'

/**
 * Returns the appropriate face renderer for a given dice shape.
 *
 * - d4 uses the classic three-numbers-per-face style
 * - d8 and d20 use a styled equilateral triangle renderer
 * - all other shapes use the default styled number renderer
 */
export function getFaceRendererForShape(shape: DiceShape): FaceRenderer {
  switch (shape) {
    case 'd4':
      return renderD4Classic
    case 'd8':
    case 'd20':
      return renderD20Styled
    default:
      return renderStyledNumber
  }
}
