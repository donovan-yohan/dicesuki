import { describe, it, expect, beforeEach, vi } from 'vitest'
import {
  isHapticsSupported,
  vibrate,
  HAPTIC_PATTERNS
} from './haptics'

describe('haptics', () => {
  beforeEach(() => {
    // Reset navigator mock
    vi.unstubAllGlobals()
  })

  describe('isHapticsSupported', () => {
    it('should return true when navigator.vibrate is available', () => {
      vi.stubGlobal('navigator', {
        vibrate: vi.fn()
      })

      expect(isHapticsSupported()).toBe(true)
    })

    it('should return false when navigator.vibrate is not available', () => {
      vi.stubGlobal('navigator', {})

      expect(isHapticsSupported()).toBe(false)
    })

    it('should return false when navigator is not available', () => {
      vi.stubGlobal('navigator', undefined)

      expect(isHapticsSupported()).toBe(false)
    })
  })

  describe('vibrate', () => {
    it('should call navigator.vibrate with the pattern when supported', () => {
      const vibrateMock = vi.fn()
      vi.stubGlobal('navigator', {
        vibrate: vibrateMock
      })

      vibrate(100)

      expect(vibrateMock).toHaveBeenCalledWith(100)
    })

    it('should not throw when navigator.vibrate is not available', () => {
      vi.stubGlobal('navigator', {})

      expect(() => vibrate(100)).not.toThrow()
    })

    it('should accept number patterns', () => {
      const vibrateMock = vi.fn()
      vi.stubGlobal('navigator', {
        vibrate: vibrateMock
      })

      vibrate(50)

      expect(vibrateMock).toHaveBeenCalledWith(50)
    })

    it('should accept array patterns', () => {
      const vibrateMock = vi.fn()
      vi.stubGlobal('navigator', {
        vibrate: vibrateMock
      })

      vibrate([100, 50, 100])

      expect(vibrateMock).toHaveBeenCalledWith([100, 50, 100])
    })
  })

  describe('HAPTIC_PATTERNS', () => {
    it('should have light pattern', () => {
      expect(HAPTIC_PATTERNS.light).toBeDefined()
      expect(typeof HAPTIC_PATTERNS.light).toBe('number')
      expect(HAPTIC_PATTERNS.light).toBeGreaterThan(0)
      expect(HAPTIC_PATTERNS.light).toBeLessThanOrEqual(20)
    })

    it('should have medium pattern', () => {
      expect(HAPTIC_PATTERNS.medium).toBeDefined()
      expect(typeof HAPTIC_PATTERNS.medium).toBe('number')
      expect(HAPTIC_PATTERNS.medium).toBeGreaterThan(HAPTIC_PATTERNS.light)
      expect(HAPTIC_PATTERNS.medium).toBeLessThanOrEqual(50)
    })

    it('should have strong pattern', () => {
      expect(HAPTIC_PATTERNS.strong).toBeDefined()
      expect(typeof HAPTIC_PATTERNS.strong).toBe('number')
      expect(HAPTIC_PATTERNS.strong).toBeGreaterThan(HAPTIC_PATTERNS.medium)
      expect(HAPTIC_PATTERNS.strong).toBeLessThanOrEqual(100)
    })

    it('should have patterns in ascending order', () => {
      expect(HAPTIC_PATTERNS.light).toBeLessThan(HAPTIC_PATTERNS.medium)
      expect(HAPTIC_PATTERNS.medium).toBeLessThan(HAPTIC_PATTERNS.strong)
    })
  })
})
