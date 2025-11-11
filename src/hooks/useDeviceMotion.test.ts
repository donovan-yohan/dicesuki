import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, act, waitFor } from '@testing-library/react'
import { useDeviceMotion } from './useDeviceMotion'

describe('useDeviceMotion', () => {
  let mockDeviceMotionEvent: DeviceMotionEvent
  let deviceMotionListener: ((event: DeviceMotionEvent) => void) | null = null

  beforeEach(() => {
    vi.clearAllMocks()
    deviceMotionListener = null

    // Mock window.addEventListener for devicemotion
    vi.spyOn(window, 'addEventListener').mockImplementation((event, listener) => {
      if (event === 'devicemotion') {
        deviceMotionListener = listener as (event: DeviceMotionEvent) => void
      }
    })

    vi.spyOn(window, 'removeEventListener')

    // Create mock DeviceMotionEvent
    mockDeviceMotionEvent = new Event('devicemotion') as DeviceMotionEvent
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  describe('initial state', () => {
    it('should start with permission state as "prompt"', () => {
      const { result } = renderHook(() => useDeviceMotion())
      expect(result.current.permissionState).toBe('prompt')
    })

    it('should start with isSupported based on API availability', () => {
      const { result } = renderHook(() => useDeviceMotion())
      expect(typeof result.current.isSupported).toBe('boolean')
    })

    it('should start with no shake detected', () => {
      const { result } = renderHook(() => useDeviceMotion())
      expect(result.current.isShaking).toBe(false)
    })

    it('should start with null impulse', () => {
      const { result } = renderHook(() => useDeviceMotion())
      expect(result.current.shakeImpulse).toBeNull()
    })
  })

  describe('permission handling', () => {
    it('should provide requestPermission function', () => {
      const { result } = renderHook(() => useDeviceMotion())
      expect(typeof result.current.requestPermission).toBe('function')
    })

    it('should handle iOS permission request', async () => {
      // Mock iOS DeviceMotionEvent.requestPermission
      const mockRequestPermission = vi.fn().mockResolvedValue('granted')
      ;(DeviceMotionEvent as any).requestPermission = mockRequestPermission

      const { result } = renderHook(() => useDeviceMotion())

      await act(async () => {
        await result.current.requestPermission()
      })

      expect(mockRequestPermission).toHaveBeenCalled()
      await waitFor(() => {
        expect(result.current.permissionState).toBe('granted')
      })
    })

    it('should handle permission denied', async () => {
      const mockRequestPermission = vi.fn().mockResolvedValue('denied')
      ;(DeviceMotionEvent as any).requestPermission = mockRequestPermission

      const { result } = renderHook(() => useDeviceMotion())

      await act(async () => {
        await result.current.requestPermission()
      })

      await waitFor(() => {
        expect(result.current.permissionState).toBe('denied')
      })
    })

    it('should auto-grant permission on non-iOS devices', async () => {
      // No requestPermission method = non-iOS
      ;(DeviceMotionEvent as any).requestPermission = undefined

      const { result } = renderHook(() => useDeviceMotion())

      await act(async () => {
        await result.current.requestPermission()
      })

      await waitFor(() => {
        expect(result.current.permissionState).toBe('granted')
      })
    })
  })

  describe('shake detection', () => {
    beforeEach(() => {
      // Mock granted permission
      ;(DeviceMotionEvent as any).requestPermission = undefined
    })

    it('should detect shake from high acceleration', async () => {
      const { result } = renderHook(() => useDeviceMotion())

      await act(async () => {
        await result.current.requestPermission()
      })

      // Simulate high acceleration event
      const highAccelEvent = {
        ...mockDeviceMotionEvent,
        accelerationIncludingGravity: { x: 25, y: 25, z: 25 }
      }

      act(() => {
        deviceMotionListener?.(highAccelEvent as DeviceMotionEvent)
      })

      await waitFor(() => {
        expect(result.current.isShaking).toBe(true)
      })
    })

    it('should not detect shake from low acceleration', async () => {
      const { result } = renderHook(() => useDeviceMotion())

      await act(async () => {
        await result.current.requestPermission()
      })

      const lowAccelEvent = {
        ...mockDeviceMotionEvent,
        accelerationIncludingGravity: { x: 2, y: 2, z: 2 }
      }

      act(() => {
        deviceMotionListener?.(lowAccelEvent as DeviceMotionEvent)
      })

      expect(result.current.isShaking).toBe(false)
    })

    it('should generate shake impulse from acceleration', async () => {
      const { result } = renderHook(() => useDeviceMotion())

      await act(async () => {
        await result.current.requestPermission()
      })

      const shakeEvent = {
        ...mockDeviceMotionEvent,
        accelerationIncludingGravity: { x: 20, y: 15, z: 18 }
      }

      act(() => {
        deviceMotionListener?.(shakeEvent as DeviceMotionEvent)
      })

      await waitFor(() => {
        expect(result.current.shakeImpulse).not.toBeNull()
        expect(result.current.shakeImpulse?.x).toBeCloseTo(20, 1)
        expect(result.current.shakeImpulse?.y).toBeGreaterThan(0)
        expect(result.current.shakeImpulse?.z).toBeCloseTo(18, 1)
      })
    })

    it('should clear shake state after duration', async () => {
      const { result } = renderHook(() => useDeviceMotion())

      await act(async () => {
        await result.current.requestPermission()
      })

      const shakeEvent = {
        ...mockDeviceMotionEvent,
        accelerationIncludingGravity: { x: 25, y: 25, z: 25 }
      }

      act(() => {
        deviceMotionListener?.(shakeEvent as DeviceMotionEvent)
      })

      await waitFor(() => {
        expect(result.current.isShaking).toBe(true)
      })

      // Wait for shake to clear (SHAKE_DURATION is 500ms)
      await new Promise(resolve => setTimeout(resolve, 600))

      expect(result.current.isShaking).toBe(false)
    })
  })

  describe('tilt detection', () => {
    beforeEach(() => {
      // Mock granted permission
      ;(DeviceMotionEvent as any).requestPermission = undefined
    })

    it('should track device orientation', async () => {
      const { result } = renderHook(() => useDeviceMotion())

      await act(async () => {
        await result.current.requestPermission()
      })

      const tiltEvent = {
        ...mockDeviceMotionEvent,
        accelerationIncludingGravity: null,
        rotationRate: { alpha: 10, beta: 15, gamma: 20 }
      }

      await act(async () => {
        deviceMotionListener?.(tiltEvent as DeviceMotionEvent)
      })

      await waitFor(() => {
        expect(result.current.tiltImpulse).not.toBeNull()
      }, { timeout: 1000 })
    })

    it('should generate tilt impulse from rotation rate', async () => {
      const { result } = renderHook(() => useDeviceMotion())

      await act(async () => {
        await result.current.requestPermission()
      })

      const tiltEvent = {
        ...mockDeviceMotionEvent,
        accelerationIncludingGravity: null,
        rotationRate: { alpha: 30, beta: 40, gamma: 50 }
      }

      await act(async () => {
        deviceMotionListener?.(tiltEvent as DeviceMotionEvent)
      })

      await waitFor(() => {
        expect(result.current.tiltImpulse).not.toBeNull()
        expect(result.current.tiltImpulse?.length()).toBeGreaterThan(0)
      }, { timeout: 1000 })
    })
  })

  describe('cleanup', () => {
    it('should remove event listener on unmount', async () => {
      // Mock granted permission so event listener is added
      ;(DeviceMotionEvent as any).requestPermission = undefined

      const { result, unmount } = renderHook(() => useDeviceMotion())

      // Request permission to trigger event listener setup
      await act(async () => {
        await result.current.requestPermission()
      })

      unmount()

      expect(window.removeEventListener).toHaveBeenCalledWith(
        'devicemotion',
        expect.any(Function)
      )
    })
  })

  describe('error handling', () => {
    it('should handle unsupported devices gracefully', () => {
      // Mock unsupported device
      const originalDeviceMotionEvent = global.DeviceMotionEvent
      ;(global as any).DeviceMotionEvent = undefined

      const { result } = renderHook(() => useDeviceMotion())

      expect(result.current.isSupported).toBe(false)
      expect(result.current.permissionState).toBe('unsupported')

      ;(global as any).DeviceMotionEvent = originalDeviceMotionEvent
    })

    it('should handle null acceleration data', async () => {
      const { result } = renderHook(() => useDeviceMotion())

      await act(async () => {
        await result.current.requestPermission()
      })

      const nullDataEvent = {
        ...mockDeviceMotionEvent,
        accelerationIncludingGravity: null
      }

      act(() => {
        deviceMotionListener?.(nullDataEvent as DeviceMotionEvent)
      })

      expect(result.current.isShaking).toBe(false)
      expect(result.current.shakeImpulse).toBeNull()
    })
  })
})
