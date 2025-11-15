import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'

// Mock the haptics module before importing the hook
const vibrateMock = vi.fn()
const isHapticsSupportedMock = vi.fn(() => true)

vi.mock('../lib/haptics', () => ({
  isHapticsSupported: () => isHapticsSupportedMock(),
  vibrate: (pattern: number | number[]) => vibrateMock(pattern),
  HAPTIC_PATTERNS: {
    light: 10,
    medium: 30,
    strong: 50
  }
}))

import { useHapticFeedback } from './useHapticFeedback'

describe('useHapticFeedback', () => {
  beforeEach(() => {
    // Clear localStorage
    localStorage.clear()

    // Reset mocks
    vibrateMock.mockClear()
    isHapticsSupportedMock.mockReturnValue(true)

    // Mock performance.now for throttling
    vi.useFakeTimers({ toFake: ['performance'] })
  })

  afterEach(() => {
    vi.restoreAllMocks()
    vi.useRealTimers()
  })

  describe('initialization', () => {
    it('should start with haptics enabled by default', () => {
      const { result } = renderHook(() => useHapticFeedback())

      expect(result.current.isEnabled).toBe(true)
    })

    it('should restore enabled state from localStorage', () => {
      localStorage.setItem('hapticFeedbackEnabled', 'false')

      const { result } = renderHook(() => useHapticFeedback())

      expect(result.current.isEnabled).toBe(false)
    })

    it('should check if haptics are supported', () => {
      const { result } = renderHook(() => useHapticFeedback())

      expect(result.current.isSupported).toBe(true)
    })

    it('should return false for isSupported when navigator.vibrate is not available', () => {
      isHapticsSupportedMock.mockReturnValue(false)

      const { result } = renderHook(() => useHapticFeedback())

      expect(result.current.isSupported).toBe(false)
    })
  })

  describe('setEnabled', () => {
    it('should enable haptic feedback', () => {
      const { result } = renderHook(() => useHapticFeedback())

      act(() => {
        result.current.setEnabled(false)
      })

      expect(result.current.isEnabled).toBe(false)

      act(() => {
        result.current.setEnabled(true)
      })

      expect(result.current.isEnabled).toBe(true)
    })

    it('should persist enabled state to localStorage', () => {
      const { result } = renderHook(() => useHapticFeedback())

      act(() => {
        result.current.setEnabled(false)
      })

      expect(localStorage.getItem('hapticFeedbackEnabled')).toBe('false')

      act(() => {
        result.current.setEnabled(true)
      })

      expect(localStorage.getItem('hapticFeedbackEnabled')).toBe('true')
    })
  })

  describe('vibrateOnCollision', () => {
    it('should vibrate with light pattern', () => {
      const { result } = renderHook(() => useHapticFeedback())

      act(() => {
        result.current.vibrateOnCollision('light')
      })

      expect(vibrateMock).toHaveBeenCalledWith(10)
    })

    it('should vibrate with medium pattern', () => {
      const { result } = renderHook(() => useHapticFeedback())

      act(() => {
        result.current.vibrateOnCollision('medium')
      })

      expect(vibrateMock).toHaveBeenCalledWith(30)
    })

    it('should vibrate with strong pattern', () => {
      const { result } = renderHook(() => useHapticFeedback())

      act(() => {
        result.current.vibrateOnCollision('strong')
      })

      expect(vibrateMock).toHaveBeenCalledWith(50)
    })

    it('should not vibrate when disabled', () => {
      const { result } = renderHook(() => useHapticFeedback())

      act(() => {
        result.current.setEnabled(false)
      })

      act(() => {
        result.current.vibrateOnCollision('medium')
      })

      expect(vibrateMock).not.toHaveBeenCalled()
    })

    it('should throttle vibrations within 50ms', () => {
      const { result } = renderHook(() => useHapticFeedback())

      act(() => {
        result.current.vibrateOnCollision('light')
        result.current.vibrateOnCollision('medium')
        result.current.vibrateOnCollision('strong')
      })

      // Only first vibration should trigger
      expect(vibrateMock).toHaveBeenCalledTimes(1)
      expect(vibrateMock).toHaveBeenCalledWith(10)
    })

    it('should allow vibration after throttle period', () => {
      const { result } = renderHook(() => useHapticFeedback())

      act(() => {
        result.current.vibrateOnCollision('light')
      })

      expect(vibrateMock).toHaveBeenCalledTimes(1)

      // Advance time by 51ms (past throttle period)
      act(() => {
        vi.advanceTimersByTime(51)
      })

      act(() => {
        result.current.vibrateOnCollision('medium')
      })

      expect(vibrateMock).toHaveBeenCalledTimes(2)
      expect(vibrateMock).toHaveBeenLastCalledWith(30)
    })

    it('should not vibrate when haptics are not supported', () => {
      isHapticsSupportedMock.mockReturnValue(false)

      const { result } = renderHook(() => useHapticFeedback())

      act(() => {
        result.current.vibrateOnCollision('medium')
      })

      expect(vibrateMock).not.toHaveBeenCalled()
    })
  })
})
