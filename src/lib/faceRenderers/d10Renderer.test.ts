import { beforeEach, describe, expect, it, vi } from 'vitest'

import { renderD10Kite } from './d10Renderer'
import { getFaceRendererForShape } from './index'

function createMockContext(): CanvasRenderingContext2D {
  return {
    fillStyle: '',
    font: '',
    textAlign: '' as CanvasTextAlign,
    textBaseline: '' as CanvasTextBaseline,
    fillRect: vi.fn(),
    fillText: vi.fn(),
    strokeStyle: '',
    lineWidth: 0,
    strokeText: vi.fn(),
    shadowColor: '',
    shadowBlur: 0,
    shadowOffsetX: 0,
    shadowOffsetY: 0,
    save: vi.fn(),
    restore: vi.fn(),
    beginPath: vi.fn(),
    moveTo: vi.fn(),
    lineTo: vi.fn(),
    closePath: vi.fn(),
    clip: vi.fn(),
  } as unknown as CanvasRenderingContext2D
}

describe('D10 kite renderer', () => {
  let mockCtx: CanvasRenderingContext2D

  beforeEach(() => {
    vi.clearAllMocks()
    mockCtx = createMockContext()
  })

  it('is selected for d10 dice', () => {
    expect(getFaceRendererForShape('d10')).toBe(renderD10Kite)
  })

  it('clips text to a kite-shaped safe area', () => {
    renderD10Kite(mockCtx, 9, 512, '#60a5fa')
    const moveToCalls = vi.mocked(mockCtx.moveTo).mock.calls
    const lineToCalls = vi.mocked(mockCtx.lineTo).mock.calls

    expect(mockCtx.fillRect).toHaveBeenCalledWith(0, 0, 512, 512)
    expect(moveToCalls[0][0]).toBeCloseTo(256)
    expect(moveToCalls[0][1]).toBeCloseTo(20.48)
    expect(lineToCalls[0][0]).toBeCloseTo(450.56)
    expect(lineToCalls[0][1]).toBeCloseTo(256)
    expect(lineToCalls[1][0]).toBeCloseTo(256)
    expect(lineToCalls[1][1]).toBeCloseTo(491.52)
    expect(lineToCalls[2][0]).toBeCloseTo(61.44)
    expect(lineToCalls[2][1]).toBeCloseTo(256)
    expect(mockCtx.clip).toHaveBeenCalledTimes(1)
  })

  it('uses smaller glyphs for two-digit d10 labels', () => {
    renderD10Kite(mockCtx, 10, 512, '#60a5fa')

    expect(mockCtx.font).toContain(`${512 * 0.28}`)
    expect(mockCtx.strokeText).toHaveBeenCalledWith('10', 256, 266.24)
    expect(mockCtx.fillText).toHaveBeenCalledWith('10', 256, 266.24)
  })
})
