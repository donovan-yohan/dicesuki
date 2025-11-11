import { describe, it, expect, beforeEach, vi } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useDiceInteraction } from './useDiceInteraction'
import * as THREE from 'three'

// Helper to create mock pointer event
const createMockPointerEvent = (point: THREE.Vector3, timeStamp: number) => ({
  point,
  nativeEvent: { timeStamp }
} as any)

describe('useDiceInteraction', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  describe('Pointer tracking', () => {
    it('should initialize with no drag state', () => {
      const { result } = renderHook(() => useDiceInteraction())

      expect(result.current.isDragging).toBe(false)
      expect(result.current.getFlickImpulse()).toBeNull()
    })

    it('should set dragging state on pointer down', () => {
      const { result } = renderHook(() => useDiceInteraction())

      act(() => {
        const mockEvent = createMockPointerEvent(new THREE.Vector3(1, 2, 3), 1000)
        result.current.onPointerDown(mockEvent)
      })

      expect(result.current.isDragging).toBe(true)
    })

    it('should clear dragging state on pointer up', () => {
      const { result } = renderHook(() => useDiceInteraction())

      act(() => {
        const downEvent = createMockPointerEvent(new THREE.Vector3(1, 2, 3), 1000)
        result.current.onPointerDown(downEvent)
      })

      expect(result.current.isDragging).toBe(true)

      act(() => {
        const upEvent = createMockPointerEvent(new THREE.Vector3(2, 3, 4), 1100)
        result.current.onPointerUp(upEvent)
      })

      expect(result.current.isDragging).toBe(false)
    })
  })

  describe('Velocity calculation', () => {
    it('should track pointer movement and calculate velocity', () => {
      const { result } = renderHook(() => useDiceInteraction())

      act(() => {
        result.current.onPointerDown(createMockPointerEvent(new THREE.Vector3(0, 0, 0), 1000))
      })

      act(() => {
        result.current.onPointerMove(createMockPointerEvent(new THREE.Vector3(1, 0, 0), 1100))
      })

      act(() => {
        result.current.onPointerUp(createMockPointerEvent(new THREE.Vector3(2, 0, 0), 1200))
      })

      const impulse = result.current.getFlickImpulse()
      expect(impulse).not.toBeNull()
      expect(impulse!.x).toBeGreaterThan(0)
    })

    it('should calculate velocity from position delta and time delta', () => {
      const { result } = renderHook(() => useDiceInteraction())

      act(() => {
        result.current.onPointerDown(createMockPointerEvent(new THREE.Vector3(0, 0, 0), 1000))
        result.current.onPointerMove(createMockPointerEvent(new THREE.Vector3(5, 0, 0), 1050))
        result.current.onPointerUp(createMockPointerEvent(new THREE.Vector3(5, 0, 0), 1050))
      })

      const impulse = result.current.getFlickImpulse()
      expect(impulse).not.toBeNull()
      expect(impulse!.length()).toBeGreaterThan(0)
    })

    it('should return null impulse for slow movements', () => {
      const { result } = renderHook(() => useDiceInteraction())

      act(() => {
        result.current.onPointerDown(createMockPointerEvent(new THREE.Vector3(0, 0, 0), 1000))
        result.current.onPointerMove(createMockPointerEvent(new THREE.Vector3(0.01, 0, 0), 1100))
        result.current.onPointerUp(createMockPointerEvent(new THREE.Vector3(0.01, 0, 0), 1100))
      })

      const impulse = result.current.getFlickImpulse()
      expect(impulse).toBeNull()
    })
  })

  describe('Flick impulse generation', () => {
    it('should generate impulse with upward component', () => {
      const { result } = renderHook(() => useDiceInteraction())

      act(() => {
        result.current.onPointerDown(createMockPointerEvent(new THREE.Vector3(0, 0, 0), 1000))
        result.current.onPointerMove(createMockPointerEvent(new THREE.Vector3(3, 0, 0), 1100))
        result.current.onPointerUp(createMockPointerEvent(new THREE.Vector3(3, 0, 0), 1100))
      })

      const impulse = result.current.getFlickImpulse()
      expect(impulse).not.toBeNull()
      expect(impulse!.y).toBeGreaterThan(0)
    })

    it('should scale impulse with drag velocity', () => {
      const { result: slowDrag } = renderHook(() => useDiceInteraction())
      const { result: fastDrag } = renderHook(() => useDiceInteraction())

      act(() => {
        slowDrag.current.onPointerDown(createMockPointerEvent(new THREE.Vector3(0, 0, 0), 1000))
        slowDrag.current.onPointerMove(createMockPointerEvent(new THREE.Vector3(1, 0, 0), 1100))
        slowDrag.current.onPointerUp(createMockPointerEvent(new THREE.Vector3(1, 0, 0), 1100))
      })

      act(() => {
        fastDrag.current.onPointerDown(createMockPointerEvent(new THREE.Vector3(0, 0, 0), 2000))
        fastDrag.current.onPointerMove(createMockPointerEvent(new THREE.Vector3(5, 0, 0), 2050))
        fastDrag.current.onPointerUp(createMockPointerEvent(new THREE.Vector3(5, 0, 0), 2050))
      })

      const slowImpulse = slowDrag.current.getFlickImpulse()
      const fastImpulse = fastDrag.current.getFlickImpulse()

      expect(fastImpulse).not.toBeNull()
      expect(slowImpulse).not.toBeNull()
      expect(fastImpulse!.length()).toBeGreaterThan(slowImpulse!.length())
    })

    it('should cap maximum impulse magnitude', () => {
      const { result } = renderHook(() => useDiceInteraction())

      act(() => {
        result.current.onPointerDown(createMockPointerEvent(new THREE.Vector3(0, 0, 0), 1000))
        result.current.onPointerMove(createMockPointerEvent(new THREE.Vector3(100, 0, 0), 1010))
        result.current.onPointerUp(createMockPointerEvent(new THREE.Vector3(100, 0, 0), 1010))
      })

      const impulse = result.current.getFlickImpulse()
      expect(impulse).not.toBeNull()
      expect(impulse!.length()).toBeLessThanOrEqual(50)
    })
  })

  describe('Edge cases', () => {
    it('should handle pointer up without prior down', () => {
      const { result } = renderHook(() => useDiceInteraction())

      act(() => {
        result.current.onPointerUp(createMockPointerEvent(new THREE.Vector3(1, 2, 3), 1000))
      })

      expect(result.current.isDragging).toBe(false)
      expect(result.current.getFlickImpulse()).toBeNull()
    })

    it('should handle pointer move without prior down', () => {
      const { result } = renderHook(() => useDiceInteraction())

      act(() => {
        result.current.onPointerMove(createMockPointerEvent(new THREE.Vector3(1, 2, 3), 1000))
      })

      expect(result.current.isDragging).toBe(false)
    })

    it('should reset impulse after retrieval', () => {
      const { result } = renderHook(() => useDiceInteraction())

      act(() => {
        result.current.onPointerDown(createMockPointerEvent(new THREE.Vector3(0, 0, 0), 1000))
        result.current.onPointerMove(createMockPointerEvent(new THREE.Vector3(3, 0, 0), 1100))
        result.current.onPointerUp(createMockPointerEvent(new THREE.Vector3(3, 0, 0), 1100))
      })

      const impulse1 = result.current.getFlickImpulse()
      const impulse2 = result.current.getFlickImpulse()

      expect(impulse1).not.toBeNull()
      expect(impulse2).toBeNull()
    })
  })
})
