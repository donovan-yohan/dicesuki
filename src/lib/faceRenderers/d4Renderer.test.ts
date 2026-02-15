import { describe, it, expect, vi, beforeEach } from 'vitest'
import { D4_FACE_NUMBERS, renderD4Classic } from './d4Renderer'

/**
 * Tests for D4 Classic Renderer
 *
 * Verifies:
 * 1. D4_FACE_NUMBERS data structure is correct for classic d4 convention
 * 2. renderD4Classic draws 3 numbers per face with correct positioning
 * 3. Classic d4 convention: when face N is down, all visible faces show N at top vertex
 */

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
  } as unknown as CanvasRenderingContext2D
}

describe('D4 Classic Renderer', () => {
  describe('D4_FACE_NUMBERS data structure', () => {
    it('has 4 face entries', () => {
      expect(D4_FACE_NUMBERS.length).toBe(4)
    })

    it('each face has exactly 3 numbers', () => {
      for (const nums of D4_FACE_NUMBERS) {
        expect(nums.length).toBe(3)
      }
    })

    it('each face shows only numbers 1-4', () => {
      for (const nums of D4_FACE_NUMBERS) {
        for (const n of nums) {
          expect(n).toBeGreaterThanOrEqual(1)
          expect(n).toBeLessThanOrEqual(4)
        }
      }
    })

    it('no face shows its own value among its numbers', () => {
      // Face 0 has value 1, so shouldn't show "1"
      // Face 1 has value 2, so shouldn't show "2"
      // etc.
      for (let faceIndex = 0; faceIndex < 4; faceIndex++) {
        const faceValue = faceIndex + 1
        const numbers = D4_FACE_NUMBERS[faceIndex]
        expect(numbers).not.toContain(faceValue)
      }
    })

    it('each face shows the values of the other 3 faces', () => {
      for (let faceIndex = 0; faceIndex < 4; faceIndex++) {
        const faceValue = faceIndex + 1
        const numbers = [...D4_FACE_NUMBERS[faceIndex]].sort()
        const expectedNumbers = [1, 2, 3, 4].filter(v => v !== faceValue).sort()
        expect(numbers).toEqual(expectedNumbers)
      }
    })

    /**
     * Classic d4 convention verification:
     * When face N is on the ground, all 3 visible faces show N at the top vertex.
     *
     * This is verified by checking that the vertex-to-face mapping is consistent:
     * - Base vertex V0 is opposite to face 1 (value 2) → appears in faces 0, 2, 3
     * - Base vertex V1 is opposite to face 3 (value 4) → appears in faces 0, 1, 2
     * - Base vertex V2 is opposite to face 2 (value 3) → appears in faces 0, 1, 3
     * - Base vertex V3 is opposite to face 0 (value 1) → appears in faces 1, 2, 3
     *
     * For each vertex, the same number should appear on all 3 faces that share it.
     */
    it('vertex shared by 3 faces shows same number at that position', () => {
      // TetrahedronGeometry(1, 0) vertex-to-face assignments:
      // Face 0: V0, V1, V2 (pos indices: 0, 1, 2)
      // Face 1: V3, V2, V1 (pos indices: 0, 1, 2)
      // Face 2: V3, V1, V0 (pos indices: 0, 1, 2)
      // Face 3: V3, V0, V2 (pos indices: 0, 1, 2)
      //
      // Base vertex V3 appears at position 0 (top) on faces 1, 2, 3
      // The number at V3 = value of opposite face = face 0 value = 1
      expect(D4_FACE_NUMBERS[1][0]).toBe(1) // Face 1, pos 0 (V3)
      expect(D4_FACE_NUMBERS[2][0]).toBe(1) // Face 2, pos 0 (V3)
      expect(D4_FACE_NUMBERS[3][0]).toBe(1) // Face 3, pos 0 (V3)

      // Base vertex V0 appears at position 0 on face 0, pos 2 on face 2, pos 1 on face 3
      // The number at V0 = value of opposite face = face 1 value = 2
      expect(D4_FACE_NUMBERS[0][0]).toBe(2) // Face 0, pos 0 (V0)
      expect(D4_FACE_NUMBERS[2][2]).toBe(2) // Face 2, pos 2 (V0)
      expect(D4_FACE_NUMBERS[3][1]).toBe(2) // Face 3, pos 1 (V0)

      // Base vertex V1 appears at position 1 on face 0, pos 2 on face 1, pos 1 on face 2
      // The number at V1 = value of opposite face = face 3 value = 4
      expect(D4_FACE_NUMBERS[0][1]).toBe(4) // Face 0, pos 1 (V1)
      expect(D4_FACE_NUMBERS[1][2]).toBe(4) // Face 1, pos 2 (V1)
      expect(D4_FACE_NUMBERS[2][1]).toBe(4) // Face 2, pos 1 (V1)

      // Base vertex V2 appears at position 2 on face 0, pos 1 on face 1, pos 2 on face 3
      // The number at V2 = value of opposite face = face 2 value = 3
      expect(D4_FACE_NUMBERS[0][2]).toBe(3) // Face 0, pos 2 (V2)
      expect(D4_FACE_NUMBERS[1][1]).toBe(3) // Face 1, pos 1 (V2)
      expect(D4_FACE_NUMBERS[3][2]).toBe(3) // Face 3, pos 2 (V2)
    })
  })

  describe('renderD4Classic', () => {
    let mockCtx: CanvasRenderingContext2D

    beforeEach(() => {
      vi.clearAllMocks()
      mockCtx = createMockContext()
    })

    it('fills background', () => {
      renderD4Classic(mockCtx, 1, 256, '#ff6b35')
      expect(mockCtx.fillRect).toHaveBeenCalledWith(0, 0, 256, 256)
    })

    it('draws exactly 3 numbers for each face', () => {
      renderD4Classic(mockCtx, 1, 256, '#ff6b35')
      // fillText is called 3 times (once per vertex number)
      expect(mockCtx.fillText).toHaveBeenCalledTimes(3)
    })

    it('draws the correct 3 numbers for face value 1', () => {
      renderD4Classic(mockCtx, 1, 256, '#ff6b35')
      const calls = (mockCtx.fillText as ReturnType<typeof vi.fn>).mock.calls
      const drawnNumbers = calls.map(c => c[0])
      expect(drawnNumbers.sort()).toEqual(['2', '3', '4'])
    })

    it('draws the correct 3 numbers for face value 2', () => {
      renderD4Classic(mockCtx, 2, 256, '#ff6b35')
      const calls = (mockCtx.fillText as ReturnType<typeof vi.fn>).mock.calls
      const drawnNumbers = calls.map(c => c[0])
      expect(drawnNumbers.sort()).toEqual(['1', '3', '4'])
    })

    it('draws the correct 3 numbers for face value 3', () => {
      renderD4Classic(mockCtx, 3, 256, '#ff6b35')
      const calls = (mockCtx.fillText as ReturnType<typeof vi.fn>).mock.calls
      const drawnNumbers = calls.map(c => c[0])
      expect(drawnNumbers.sort()).toEqual(['1', '2', '4'])
    })

    it('draws the correct 3 numbers for face value 4', () => {
      renderD4Classic(mockCtx, 4, 256, '#ff6b35')
      const calls = (mockCtx.fillText as ReturnType<typeof vi.fn>).mock.calls
      const drawnNumbers = calls.map(c => c[0])
      expect(drawnNumbers.sort()).toEqual(['1', '2', '3'])
    })

    it('draws outlines for all 3 numbers', () => {
      renderD4Classic(mockCtx, 1, 256, '#ff6b35')
      expect(mockCtx.strokeText).toHaveBeenCalledTimes(3)
    })

    it('uses white fill for numbers', () => {
      renderD4Classic(mockCtx, 1, 256, '#ff6b35')
      // After each number draw, fillStyle should be white
      expect(mockCtx.fillStyle).toBe('white')
    })

    it('uses black outline for numbers', () => {
      renderD4Classic(mockCtx, 1, 256, '#ff6b35')
      expect(mockCtx.strokeStyle).toBe('black')
    })

    it('positions 3 numbers at different locations on canvas', () => {
      renderD4Classic(mockCtx, 1, 512, '#ff6b35')
      const calls = (mockCtx.fillText as ReturnType<typeof vi.fn>).mock.calls

      // All 3 positions should be different
      const positions = calls.map(c => `${c[1]},${c[2]}`)
      const uniquePositions = new Set(positions)
      expect(uniquePositions.size).toBe(3)
    })
  })
})
