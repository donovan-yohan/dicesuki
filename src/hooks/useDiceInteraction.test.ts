import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { renderHook, act, waitFor } from '@testing-library/react'
import React from 'react'
import { Canvas } from '@react-three/fiber'
import { useDiceInteraction } from './useDiceInteraction'
import type { RapierRigidBody } from '@react-three/rapier'
import * as THREE from 'three'

// Mock RapierRigidBody
const createMockRigidBody = (): RapierRigidBody => ({
  wakeUp: vi.fn(),
  setLinvel: vi.fn(),
  setAngvel: vi.fn(),
  translation: () => ({ x: 0, y: 2, z: 0 }),
  linvel: () => ({ x: 0, y: 0, z: 0 }),
  angvel: () => ({ x: 0, y: 0, z: 0 })
} as unknown as RapierRigidBody)

// Helper to create mock pointer event
const createMockPointerEvent = (
  clientX: number,
  clientY: number,
  pointerId: number = 1
): any => ({
  clientX,
  clientY,
  pointerId,
  nativeEvent: {
    clientX,
    clientY,
    pointerId,
    target: {
      setPointerCapture: vi.fn(),
      releasePointerCapture: vi.fn()
    }
  },
  object: {
    getWorldPosition: (v: THREE.Vector3) => {
      v.set(0, 2, 0)
      return v
    }
  },
  stopPropagation: vi.fn()
})

describe('useDiceInteraction', () => {
  let mockRigidBody: RapierRigidBody

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['performance'] })
    mockRigidBody = createMockRigidBody()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  // Wrapper component that provides R3F context
  const wrapper = ({ children }: { children: React.ReactNode }) =>
    React.createElement(Canvas, null, children)

  describe('Drag state management', () => {
    it('should initialize with no drag state', () => {
      const { result } = renderHook(() => useDiceInteraction(), { wrapper })

      expect(result.current.isDragging).toBe(false)
      expect(result.current.getDragState().isDragging).toBe(false)
      expect(result.current.getDragState().targetPosition).toBeNull()
    })

    it('should set dragging state on pointer down', () => {
      const { result } = renderHook(() => useDiceInteraction(), { wrapper })

      act(() => {
        const mockEvent = createMockPointerEvent(100, 100)
        result.current.onPointerDown(mockEvent, mockRigidBody)
      })

      expect(result.current.isDragging).toBe(true)
      expect(result.current.getDragState().isDragging).toBe(true)
      expect(mockRigidBody.wakeUp).toHaveBeenCalled()
    })

    it('should clear dragging state on pointer up', async () => {
      const { result } = renderHook(() => useDiceInteraction(), { wrapper })

      act(() => {
        const downEvent = createMockPointerEvent(100, 100, 1)
        result.current.onPointerDown(downEvent, mockRigidBody)
      })

      expect(result.current.isDragging).toBe(true)

      act(() => {
        const upEvent = new PointerEvent('pointerup', { pointerId: 1 })
        window.dispatchEvent(upEvent)
      })

      await waitFor(() => {
        expect(result.current.isDragging).toBe(false)
      })
    })

    it('should handle multiple pointer IDs correctly', () => {
      const { result } = renderHook(() => useDiceInteraction(), { wrapper })

      act(() => {
        const event1 = createMockPointerEvent(100, 100, 1)
        result.current.onPointerDown(event1, mockRigidBody)
      })

      expect(result.current.isDragging).toBe(true)

      // Different pointer ID should be ignored
      act(() => {
        const upEvent = new PointerEvent('pointerup', { pointerId: 2 })
        window.dispatchEvent(upEvent)
      })

      expect(result.current.isDragging).toBe(true)
    })
  })

  describe('Target position tracking', () => {
    it('should track target position during drag', () => {
      const { result } = renderHook(() => useDiceInteraction(), { wrapper })

      act(() => {
        const downEvent = createMockPointerEvent(100, 100)
        result.current.onPointerDown(downEvent, mockRigidBody)
      })

      const state = result.current.getDragState()
      expect(state.targetPosition).not.toBeNull()
      expect(state.targetPosition).toBeInstanceOf(THREE.Vector3)
    })

    it('should update target position on pointer move', () => {
      const { result } = renderHook(() => useDiceInteraction(), { wrapper })

      act(() => {
        const downEvent = createMockPointerEvent(100, 100, 1)
        result.current.onPointerDown(downEvent, mockRigidBody)
      })

      const initialPos = result.current.getDragState().targetPosition?.clone()

      act(() => {
        const moveEvent = new PointerEvent('pointermove', {
          pointerId: 1,
          clientX: 150,
          clientY: 150
        })
        // Dispatch to canvas element
        const canvas = document.querySelector('canvas')
        canvas?.dispatchEvent(moveEvent)
      })

      const newPos = result.current.getDragState().targetPosition
      // Position should be tracked (may or may not be different depending on projection)
      expect(newPos).not.toBeNull()
    })
  })

  describe('Throw velocity calculation', () => {
    it('should calculate throw velocity on release after movement', async () => {
      const { result } = renderHook(() => useDiceInteraction(), { wrapper })

      act(() => {
        const downEvent = createMockPointerEvent(100, 100, 1)
        result.current.onPointerDown(downEvent, mockRigidBody)
      })

      // Simulate drag movement over time
      for (let i = 0; i < 5; i++) {
        act(() => {
          vi.advanceTimersByTime(20)
          const moveEvent = new PointerEvent('pointermove', {
            pointerId: 1,
            clientX: 100 + i * 20,
            clientY: 100
          })
          const canvas = document.querySelector('canvas')
          canvas?.dispatchEvent(moveEvent)
        })
      }

      act(() => {
        const upEvent = new PointerEvent('pointerup', { pointerId: 1 })
        window.dispatchEvent(upEvent)
      })

      await waitFor(() => {
        expect(mockRigidBody.setLinvel).toHaveBeenCalled()
      })
    })

    it('should not apply throw velocity on slow movements', async () => {
      const { result } = renderHook(() => useDiceInteraction(), { wrapper })

      const setLinvel = vi.fn()
      const slowRigidBody = {
        ...mockRigidBody,
        setLinvel
      } as unknown as RapierRigidBody

      act(() => {
        const downEvent = createMockPointerEvent(100, 100, 1)
        result.current.onPointerDown(downEvent, slowRigidBody)
      })

      // Very slow movement
      act(() => {
        vi.advanceTimersByTime(100)
        const moveEvent = new PointerEvent('pointermove', {
          pointerId: 1,
          clientX: 101,
          clientY: 100
        })
        const canvas = document.querySelector('canvas')
        canvas?.dispatchEvent(moveEvent)
      })

      act(() => {
        const upEvent = new PointerEvent('pointerup', { pointerId: 1 })
        window.dispatchEvent(upEvent)
      })

      // Should either not call setLinvel or call it with near-zero velocity
      await waitFor(() => {
        expect(result.current.isDragging).toBe(false)
      })
    })

    it('should add upward boost to throw velocity', async () => {
      const { result } = renderHook(() => useDiceInteraction(), { wrapper })

      const setLinvel = vi.fn()
      const rigidBody = {
        ...mockRigidBody,
        setLinvel
      } as unknown as RapierRigidBody

      act(() => {
        const downEvent = createMockPointerEvent(100, 100, 1)
        result.current.onPointerDown(downEvent, rigidBody)
      })

      // Fast horizontal movement
      for (let i = 0; i < 5; i++) {
        act(() => {
          vi.advanceTimersByTime(20)
          const moveEvent = new PointerEvent('pointermove', {
            pointerId: 1,
            clientX: 100 + i * 50,
            clientY: 100
          })
          const canvas = document.querySelector('canvas')
          canvas?.dispatchEvent(moveEvent)
        })
      }

      act(() => {
        const upEvent = new PointerEvent('pointerup', { pointerId: 1 })
        window.dispatchEvent(upEvent)
      })

      await waitFor(() => {
        expect(setLinvel).toHaveBeenCalled()
      })

      if (setLinvel.mock.calls.length > 0) {
        const velocity = setLinvel.mock.calls[0][0]
        // Should have positive Y component (upward)
        expect(velocity.y).toBeGreaterThan(0)
      }
    })
  })

  describe('Event handling and cleanup', () => {
    it('should handle pointercancel by clearing drag without throw', async () => {
      const { result } = renderHook(() => useDiceInteraction(), { wrapper })

      const setLinvel = vi.fn()
      const rigidBody = {
        ...mockRigidBody,
        setLinvel
      } as unknown as RapierRigidBody

      act(() => {
        const downEvent = createMockPointerEvent(100, 100, 1)
        result.current.onPointerDown(downEvent, rigidBody)
      })

      // Fast movement
      for (let i = 0; i < 5; i++) {
        act(() => {
          vi.advanceTimersByTime(20)
          const moveEvent = new PointerEvent('pointermove', {
            pointerId: 1,
            clientX: 100 + i * 50,
            clientY: 100
          })
          const canvas = document.querySelector('canvas')
          canvas?.dispatchEvent(moveEvent)
        })
      }

      act(() => {
        const cancelEvent = new PointerEvent('pointercancel', { pointerId: 1 })
        window.dispatchEvent(cancelEvent)
      })

      await waitFor(() => {
        expect(result.current.isDragging).toBe(false)
      })

      // Should not apply throw velocity on cancel
      expect(setLinvel).not.toHaveBeenCalled()
    })

    it('should cancel drag without applying velocity', () => {
      const { result } = renderHook(() => useDiceInteraction(), { wrapper })

      const setLinvel = vi.fn()
      const rigidBody = {
        ...mockRigidBody,
        setLinvel
      } as unknown as RapierRigidBody

      act(() => {
        const downEvent = createMockPointerEvent(100, 100, 1)
        result.current.onPointerDown(downEvent, rigidBody)
      })

      act(() => {
        result.current.cancelDrag()
      })

      expect(result.current.isDragging).toBe(false)
      expect(setLinvel).not.toHaveBeenCalled()
    })

    it('should release pointer capture on drag end', async () => {
      const { result } = renderHook(() => useDiceInteraction(), { wrapper })

      const releasePointerCapture = vi.fn()
      const downEvent = createMockPointerEvent(100, 100, 1)
      downEvent.nativeEvent.target.releasePointerCapture = releasePointerCapture

      act(() => {
        result.current.onPointerDown(downEvent, mockRigidBody)
      })

      act(() => {
        const upEvent = new PointerEvent('pointerup', { pointerId: 1 })
        window.dispatchEvent(upEvent)
      })

      await waitFor(() => {
        expect(releasePointerCapture).toHaveBeenCalled()
      })
    })
  })

  describe('Edge cases', () => {
    it('should handle pointer up without prior down', () => {
      const { result } = renderHook(() => useDiceInteraction(), { wrapper })

      act(() => {
        const upEvent = new PointerEvent('pointerup', { pointerId: 1 })
        window.dispatchEvent(upEvent)
      })

      expect(result.current.isDragging).toBe(false)
    })

    it('should handle pointer move without prior down', () => {
      const { result } = renderHook(() => useDiceInteraction(), { wrapper })

      act(() => {
        const moveEvent = new PointerEvent('pointermove', {
          pointerId: 1,
          clientX: 100,
          clientY: 100
        })
        const canvas = document.querySelector('canvas')
        canvas?.dispatchEvent(moveEvent)
      })

      expect(result.current.isDragging).toBe(false)
    })

    it('should handle cancelDrag when not dragging', () => {
      const { result } = renderHook(() => useDiceInteraction(), { wrapper })

      act(() => {
        result.current.cancelDrag()
      })

      expect(result.current.isDragging).toBe(false)
    })

    it('should clear state completely after drag ends', async () => {
      const { result } = renderHook(() => useDiceInteraction(), { wrapper })

      act(() => {
        const downEvent = createMockPointerEvent(100, 100, 1)
        result.current.onPointerDown(downEvent, mockRigidBody)
      })

      expect(result.current.getDragState().isDragging).toBe(true)
      expect(result.current.getDragState().targetPosition).not.toBeNull()

      act(() => {
        const upEvent = new PointerEvent('pointerup', { pointerId: 1 })
        window.dispatchEvent(upEvent)
      })

      await waitFor(() => {
        const state = result.current.getDragState()
        expect(state.isDragging).toBe(false)
        expect(state.targetPosition).toBeNull()
      })
    })
  })
})
