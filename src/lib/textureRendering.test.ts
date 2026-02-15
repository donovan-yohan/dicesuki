import { describe, it, expect, vi, beforeEach } from 'vitest'
import {
  renderSimpleNumber,
  renderStyledNumber,
  renderBorderedNumber,
  preRenderDiceFaces,
  type FaceRenderer,
} from './textureRendering'

/**
 * Tests for texture rendering utilities
 *
 * Verifies that:
 * 1. renderSimpleNumber draws centered number on solid background
 * 2. renderStyledNumber draws number with outline and shadow
 * 3. preRenderDiceFaces creates correct face counts per dice type
 */

// Create a mock canvas context with all the methods we need
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
    quadraticCurveTo: vi.fn(),
    closePath: vi.fn(),
    fill: vi.fn(),
    rect: vi.fn(),
  } as unknown as CanvasRenderingContext2D
}

describe('textureRendering', () => {
  let mockCtx: CanvasRenderingContext2D

  beforeEach(() => {
    vi.clearAllMocks()
    mockCtx = createMockContext()
  })

  describe('renderSimpleNumber', () => {
    it('fills background with provided color', () => {
      renderSimpleNumber(mockCtx, 6, 256, '#ff6b35')
      expect(mockCtx.fillRect).toHaveBeenCalledWith(0, 0, 256, 256)
    })

    it('draws number centered on canvas', () => {
      renderSimpleNumber(mockCtx, 6, 256, '#ff6b35')
      expect(mockCtx.textAlign).toBe('center')
      expect(mockCtx.textBaseline).toBe('middle')
      expect(mockCtx.fillText).toHaveBeenCalledWith('6', 128, 128)
    })

    it('renders number as white text', () => {
      renderSimpleNumber(mockCtx, 3, 512, '#000000')
      expect(mockCtx.fillStyle).toBe('white')
      expect(mockCtx.fillText).toHaveBeenCalledWith('3', 256, 256)
    })

    it('scales font size relative to canvas size', () => {
      renderSimpleNumber(mockCtx, 1, 512, '#ff6b35')
      // Font should be 45% of canvas size = 230.4
      expect(mockCtx.font).toContain(`${512 * 0.45}`)
    })

    it('handles multi-digit numbers', () => {
      renderSimpleNumber(mockCtx, 20, 256, '#ff6b35')
      expect(mockCtx.fillText).toHaveBeenCalledWith('20', 128, 128)
    })

    it('handles zero (for d10)', () => {
      renderSimpleNumber(mockCtx, 0, 256, '#ff6b35')
      expect(mockCtx.fillText).toHaveBeenCalledWith('0', 128, 128)
    })
  })

  describe('renderStyledNumber', () => {
    it('fills background with provided color', () => {
      renderStyledNumber(mockCtx, 20, 256, '#ff6b35')
      expect(mockCtx.fillRect).toHaveBeenCalledWith(0, 0, 256, 256)
    })

    it('draws number with stroke outline', () => {
      renderStyledNumber(mockCtx, 20, 256, '#ff6b35')
      expect(mockCtx.strokeText).toHaveBeenCalledWith('20', 128, 128)
      expect(mockCtx.strokeStyle).toBe('black')
    })

    it('draws number with white fill', () => {
      renderStyledNumber(mockCtx, 20, 256, '#ff6b35')
      expect(mockCtx.fillText).toHaveBeenCalledWith('20', 128, 128)
      expect(mockCtx.fillStyle).toBe('white')
    })

    it('sets drop shadow before drawing', () => {
      renderStyledNumber(mockCtx, 1, 256, '#ff6b35')
      // After rendering, shadow should have been set (then cleared)
      // We verify the final state is transparent (shadow cleared after fill)
      expect(mockCtx.shadowColor).toBe('transparent')
    })

    it('sets line width for outline', () => {
      renderStyledNumber(mockCtx, 5, 512, '#ff6b35')
      const fontSize = 512 * 0.45
      expect(mockCtx.lineWidth).toBeCloseTo(fontSize * 0.08, 1)
    })
  })

  describe('renderBorderedNumber', () => {
    it('fills background', () => {
      renderBorderedNumber(mockCtx, 12, 256, '#4ecdc4')
      expect(mockCtx.fillRect).toHaveBeenCalledWith(0, 0, 256, 256)
    })

    it('draws centered number', () => {
      renderBorderedNumber(mockCtx, 12, 256, '#4ecdc4')
      expect(mockCtx.fillText).toHaveBeenCalledWith('12', 128, 128)
      expect(mockCtx.textAlign).toBe('center')
      expect(mockCtx.textBaseline).toBe('middle')
    })
  })

  describe('preRenderDiceFaces face count', () => {
    // Mock document.createElement to return a mock canvas
    beforeEach(() => {
      const mockCanvas = {
        width: 0,
        height: 0,
        getContext: vi.fn().mockReturnValue(createMockContext()),
      }
      vi.stubGlobal('document', {
        createElement: vi.fn().mockReturnValue(mockCanvas),
      })
    })

    it('creates 4 textures for d4 (values 1-4)', () => {
      const textures = preRenderDiceFaces('d4', '#ff6b35')
      const keys = Object.keys(textures).map(Number).sort((a, b) => a - b)
      expect(keys).toEqual([1, 2, 3, 4])
    })

    it('creates 6 textures for d6 (values 1-6)', () => {
      const textures = preRenderDiceFaces('d6', '#ff6b35')
      const keys = Object.keys(textures).map(Number).sort((a, b) => a - b)
      expect(keys).toEqual([1, 2, 3, 4, 5, 6])
    })

    it('creates 8 textures for d8 (values 1-8)', () => {
      const textures = preRenderDiceFaces('d8', '#ff6b35')
      const keys = Object.keys(textures).map(Number).sort((a, b) => a - b)
      expect(keys).toEqual([1, 2, 3, 4, 5, 6, 7, 8])
    })

    it('creates 10 textures for d10 (values 0-9)', () => {
      const textures = preRenderDiceFaces('d10', '#ff6b35')
      const keys = Object.keys(textures).map(Number).sort((a, b) => a - b)
      expect(keys).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9])
    })

    it('creates 12 textures for d12 (values 1-12)', () => {
      const textures = preRenderDiceFaces('d12', '#ff6b35')
      const keys = Object.keys(textures).map(Number).sort((a, b) => a - b)
      expect(keys).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12])
    })

    it('creates 20 textures for d20 (values 1-20)', () => {
      const textures = preRenderDiceFaces('d20', '#ff6b35')
      const keys = Object.keys(textures).map(Number).sort((a, b) => a - b)
      expect(keys).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20])
    })

    it('uses custom renderer when provided', () => {
      const customRenderer: FaceRenderer = vi.fn()
      preRenderDiceFaces('d6', '#ff6b35', customRenderer)
      expect(customRenderer).toHaveBeenCalledTimes(6)
    })
  })
})
