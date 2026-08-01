/**
 * The basic die must actually come out WHITE WITH BLACK NUMBERS.
 *
 * The default renderers paint white numerals with a black outline, which on a
 * white body would be an invisible die — so these tests pin the ink, not just
 * the plumbing: black fill, no outline, no shadow, for every shape, through the
 * same entry point the tray uses (`resolveDiceMaterial`).
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { BASIC_DIE_BASE_COLOR } from '../basicDice'
import { resolveDiceMaterial } from '../diceMaterial'
import { getFaceRendererForShape } from './index'
import { BASIC_GLYPH_STYLE, EMBOSSED_GLYPH_STYLE, drawFaceGlyph } from './glyphStyle'
import type { DiceShape } from '../geometries'

const ALL_SHAPES: DiceShape[] = ['d4', 'd6', 'd8', 'd10', 'd10tens', 'd12', 'd20']

interface RecordingContext {
  ctx: CanvasRenderingContext2D
  fills: string[]
  strokes: string[]
  shadows: string[]
  fonts: string[]
  strokeTextCalls: number
  backgroundFills: string[]
}

/**
 * A canvas stub that records the *state at the moment of each draw call*, which
 * is the only way to tell "black text" from "black stroke state left over from
 * something else".
 */
function createRecordingContext(): RecordingContext {
  const record: RecordingContext = {
    fills: [],
    strokes: [],
    shadows: [],
    fonts: [],
    strokeTextCalls: 0,
    backgroundFills: [],
    ctx: null as unknown as CanvasRenderingContext2D,
  }

  const ctx = {
    fillStyle: '',
    strokeStyle: '',
    font: '',
    lineWidth: 0,
    shadowColor: '',
    shadowBlur: 0,
    shadowOffsetX: 0,
    shadowOffsetY: 0,
    textAlign: '' as CanvasTextAlign,
    textBaseline: '' as CanvasTextBaseline,
    fillRect: vi.fn(() => { record.backgroundFills.push(String(ctx.fillStyle)) }),
    fillText: vi.fn(() => {
      record.fills.push(String(ctx.fillStyle))
      record.shadows.push(String(ctx.shadowColor))
      record.fonts.push(String(ctx.font))
    }),
    strokeText: vi.fn(() => {
      record.strokeTextCalls += 1
      record.strokes.push(String(ctx.strokeStyle))
    }),
    fill: vi.fn(),
    save: vi.fn(),
    restore: vi.fn(),
    beginPath: vi.fn(),
    moveTo: vi.fn(),
    lineTo: vi.fn(),
    closePath: vi.fn(),
    clip: vi.fn(),
    rect: vi.fn(),
  }

  record.ctx = ctx as unknown as CanvasRenderingContext2D
  return record
}

describe('basic face renderers', () => {
  let recorder: RecordingContext

  beforeEach(() => {
    vi.clearAllMocks()
    recorder = createRecordingContext()
  })

  it.each(ALL_SHAPES)('draws %s numerals in flat black on the white body', (shape) => {
    const renderer = getFaceRendererForShape(shape, 'basic')

    renderer(recorder.ctx, 1, 512, BASIC_DIE_BASE_COLOR)

    // The face background is the die's own white body colour…
    expect(recorder.backgroundFills[0]).toBe('#ffffff')
    // …and every numeral drawn on it is black.
    expect(recorder.fills.length).toBeGreaterThan(0)
    expect(new Set(recorder.fills)).toEqual(new Set(['#000000']))
    // Bare minimum: no outline, no shadow, regular weight.
    expect(recorder.strokeTextCalls).toBe(0)
    expect(new Set(recorder.shadows)).toEqual(new Set(['transparent']))
    for (const font of recorder.fonts) {
      expect(font).toMatch(/^normal /)
      expect(font).not.toMatch(/bold/)
    }
  })

  it.each(ALL_SHAPES)('leaves the %s collectible look untouched', (shape) => {
    const renderer = getFaceRendererForShape(shape)

    renderer(recorder.ctx, 1, 512, '#8b5cf6')

    expect(new Set(recorder.fills)).toEqual(new Set(['white']))
    expect(new Set(recorder.strokes)).toEqual(new Set(['black']))
    expect(recorder.strokeTextCalls).toBeGreaterThan(0)
    for (const font of recorder.fonts) expect(font).toMatch(/^bold /)
  })

  it.each(ALL_SHAPES)('resolves the basic renderer for %s through the material path', (shape) => {
    // `MultiplayerDie` goes through `resolveDiceMaterial`, so this is the seam
    // that actually decides what a spawned basic die looks like.
    expect(resolveDiceMaterial(shape, 'plastic', 'basic').faceRenderer)
      .toBe(getFaceRendererForShape(shape, 'basic'))
    expect(resolveDiceMaterial(shape, 'plastic').faceRenderer)
      .toBe(getFaceRendererForShape(shape))
  })

  it('ignores collectible material flair for a basic die', () => {
    // A rubber d20 is tie-dyed and a metal d20 gets a matte-number mask. Neither
    // belongs on a die the player does not own.
    const rubber = resolveDiceMaterial('d20', 'rubber', 'basic')
    const metal = resolveDiceMaterial('d20', 'metal', 'basic')

    expect(rubber.faceRenderer).toBe(getFaceRendererForShape('d20', 'basic'))
    expect(metal.materialMaskRenderer).toBeUndefined()
    // …while the collectible path keeps them.
    expect(resolveDiceMaterial('d20', 'rubber').faceRenderer)
      .not.toBe(getFaceRendererForShape('d20'))
    expect(resolveDiceMaterial('d20', 'metal').materialMaskRenderer).toBeDefined()
  })
})

describe('drawFaceGlyph', () => {
  it('clears the shadow before the fill so nothing after inherits it', () => {
    const recorder = createRecordingContext()

    drawFaceGlyph(recorder.ctx, '7', 10, 10, 100, EMBOSSED_GLYPH_STYLE)

    expect(recorder.shadows).toEqual(['transparent'])
    expect(recorder.ctx.shadowBlur).toBe(0)
    expect(recorder.ctx.shadowOffsetX).toBe(0)
  })

  it('never strokes when the style asks for no outline', () => {
    const recorder = createRecordingContext()

    drawFaceGlyph(recorder.ctx, '7', 10, 10, 100, BASIC_GLYPH_STYLE)

    expect(recorder.strokeTextCalls).toBe(0)
    expect(recorder.fills).toEqual(['#000000'])
  })
})
