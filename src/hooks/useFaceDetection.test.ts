import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, act, waitFor } from '@testing-library/react'
import { useFaceDetection } from './useFaceDetection'
import * as THREE from 'three'

describe('useFaceDetection', () => {
  beforeEach(() => {
    vi.useFakeTimers({
      toFake: ['performance']
    })
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  describe('isAtRest', () => {
    it('should return false initially', () => {
      const { result } = renderHook(() => useFaceDetection())
      expect(result.current.isAtRest).toBe(false)
    })

    it('should detect at-rest when velocity and angular velocity are below threshold', async () => {
      const { result } = renderHook(() => useFaceDetection())

      // Start with very low velocity (below 0.01 threshold)
      act(() => {
        const lowVelocity = new THREE.Vector3(0.005, 0, 0)
        const lowAngularVelocity = new THREE.Vector3(0, 0.005, 0)
        result.current.updateMotion(lowVelocity, lowAngularVelocity)
      })

      // Advance time by 1 second (updated from 2s)
      act(() => {
        vi.advanceTimersByTime(1000)
      })

      // Update again after 1 second
      act(() => {
        const lowVelocity = new THREE.Vector3(0.005, 0, 0)
        const lowAngularVelocity = new THREE.Vector3(0, 0.005, 0)
        result.current.updateMotion(lowVelocity, lowAngularVelocity)
      })

      await waitFor(() => {
        expect(result.current.isAtRest).toBe(true)
      })
    })

    it('should not detect at-rest with high velocity', () => {
      const { result } = renderHook(() => useFaceDetection())

      act(() => {
        const highVelocity = new THREE.Vector3(5, 0, 0)
        const lowAngularVelocity = new THREE.Vector3(0, 0, 0)

        for (let i = 0; i < 120; i++) {
          result.current.updateMotion(highVelocity, lowAngularVelocity)
          vi.advanceTimersByTime(16.67)
        }
      })

      expect(result.current.isAtRest).toBe(false)
    })

    it('should not detect at-rest with high angular velocity', () => {
      const { result } = renderHook(() => useFaceDetection())

      act(() => {
        const lowVelocity = new THREE.Vector3(0, 0, 0)
        const highAngularVelocity = new THREE.Vector3(5, 0, 0)

        for (let i = 0; i < 120; i++) {
          result.current.updateMotion(lowVelocity, highAngularVelocity)
          vi.advanceTimersByTime(16.67)
        }
      })

      expect(result.current.isAtRest).toBe(false)
    })

    it('should reset at-rest when motion resumes', async () => {
      const { result } = renderHook(() => useFaceDetection())

      // First get to rest state
      act(() => {
        const lowVelocity = new THREE.Vector3(0, 0, 0)
        result.current.updateMotion(lowVelocity, lowVelocity)
      })

      act(() => {
        vi.advanceTimersByTime(1000)
      })

      act(() => {
        const lowVelocity = new THREE.Vector3(0, 0, 0)
        result.current.updateMotion(lowVelocity, lowVelocity)
      })

      await waitFor(() => {
        expect(result.current.isAtRest).toBe(true)
      })

      // Now add motion
      act(() => {
        const highVelocity = new THREE.Vector3(5, 0, 0)
        result.current.updateMotion(highVelocity, new THREE.Vector3(0, 0, 0))
      })

      expect(result.current.isAtRest).toBe(false)
    })
  })

  describe('readFaceValue', () => {
    it('should return null initially', () => {
      const { result } = renderHook(() => useFaceDetection())
      expect(result.current.faceValue).toBeNull()
    })

    it('should return face value when at rest', async () => {
      const { result} = renderHook(() => useFaceDetection())

      // Get to rest state
      act(() => {
        const lowVelocity = new THREE.Vector3(0, 0, 0)
        result.current.updateMotion(lowVelocity, lowVelocity)
      })

      act(() => {
        vi.advanceTimersByTime(1000)
      })

      act(() => {
        const lowVelocity = new THREE.Vector3(0, 0, 0)
        result.current.updateMotion(lowVelocity, lowVelocity)
      })

      await waitFor(() => {
        expect(result.current.isAtRest).toBe(true)
      })

      // Read face value with upright quaternion (should be 6)
      act(() => {
        const quaternion = new THREE.Quaternion(0, 0, 0, 1)
        result.current.readFaceValue(quaternion, 'd6')
      })

      expect(result.current.faceValue).toBe(6)
    })

    it('should not update face value when not at rest', () => {
      const { result } = renderHook(() => useFaceDetection())

      act(() => {
        const quaternion = new THREE.Quaternion(0, 0, 0, 1)
        result.current.readFaceValue(quaternion, 'd6')
      })

      expect(result.current.faceValue).toBeNull()
    })
  })

  describe('reset', () => {
    it('should reset all state', async () => {
      const { result } = renderHook(() => useFaceDetection())

      // Get to a known state
      act(() => {
        const lowVelocity = new THREE.Vector3(0, 0, 0)
        result.current.updateMotion(lowVelocity, lowVelocity)
      })

      act(() => {
        vi.advanceTimersByTime(1000)
      })

      act(() => {
        const lowVelocity = new THREE.Vector3(0, 0, 0)
        result.current.updateMotion(lowVelocity, lowVelocity)
      })

      await waitFor(() => {
        expect(result.current.isAtRest).toBe(true)
      })

      act(() => {
        const quaternion = new THREE.Quaternion(0, 0, 0, 1)
        result.current.readFaceValue(quaternion, 'd6')
      })

      expect(result.current.faceValue).toBe(6)

      // Reset
      act(() => {
        result.current.reset()
      })

      expect(result.current.isAtRest).toBe(false)
      expect(result.current.faceValue).toBeNull()
    })
  })
})
