import { useCallback, useRef, useState } from 'react'
import * as THREE from 'three'
import {
  ANGULAR_VELOCITY_THRESHOLD,
  REST_DURATION_MS,
} from '../config/physicsConfig'
import { DiceShape, DiceFace, getDiceFaceValue } from '../lib/geometries'

interface FaceDetectionState {
  isAtRest: boolean
  faceValue: number | null
  updateMotion: (velocity: THREE.Vector3, angularVelocity: THREE.Vector3) => void
  readFaceValue: (quaternion: THREE.Quaternion, shape: DiceShape) => void
  reset: () => void
}

/**
 * Hook to detect when a dice is at rest and read its face value
 *
 * Uses ref-based guards for isAtRest to prevent stale closure issues
 * in useFrame callbacks (which run before React re-renders).
 *
 * @param customFaceNormals - Optional custom face normals for custom dice models
 */
export function useFaceDetection(customFaceNormals?: DiceFace[]): FaceDetectionState {
  const [isAtRest, setIsAtRest] = useState(false)
  const [faceValue, setFaceValue] = useState<number | null>(null)

  // Ref-based guard for isAtRest — updated synchronously so useFrame
  // closures always see the latest value, even before React re-renders.
  // This prevents the stale closure bug where readFaceValue re-sets the
  // old face value after reset() tries to clear it.
  const isAtRestRef = useRef(false)

  const restStartTimeRef = useRef<number | null>(null)
  const lastVelocityRef = useRef<THREE.Vector3>(new THREE.Vector3())
  const lastAngularVelocityRef = useRef<THREE.Vector3>(new THREE.Vector3())

  // Store custom face normals in a ref to avoid re-creating the readFaceValue callback
  const customNormalsRef = useRef<DiceFace[] | undefined>(customFaceNormals)
  customNormalsRef.current = customFaceNormals

  /**
   * Update motion state and check if dice is at rest
   *
   * Only tracks angular velocity to detect rotation/tumbling.
   * Ignores linear velocity to avoid false positives from sliding.
   */
  const updateMotion = useCallback(
    (velocity: THREE.Vector3, angularVelocity: THREE.Vector3) => {
      lastVelocityRef.current.copy(velocity)
      lastAngularVelocityRef.current.copy(angularVelocity)

      const angularVelocityMagnitude = angularVelocity.length()

      // Only check angular velocity - dice is "at rest" when not rotating
      // This allows detecting re-rolls even if dice lands on same face
      const isStill = angularVelocityMagnitude < ANGULAR_VELOCITY_THRESHOLD

      if (isStill) {
        if (restStartTimeRef.current === null) {
          restStartTimeRef.current = performance.now()
        } else {
          const restDuration = performance.now() - restStartTimeRef.current
          if (restDuration >= REST_DURATION_MS) {
            isAtRestRef.current = true
            setIsAtRest(true)
          }
        }
      } else {
        // Reset if motion detected — use ref for accurate check
        if (restStartTimeRef.current !== null || isAtRestRef.current) {
          restStartTimeRef.current = null
          isAtRestRef.current = false
          setIsAtRest(false)
        }
      }
    },
    [],
  )

  /**
   * Read the face value when dice is at rest
   * Uses ref-based isAtRest check to prevent stale closure reads
   */
  const readFaceValue = useCallback(
    (quaternion: THREE.Quaternion, shape: DiceShape) => {
      // Use ref for immediate check — prevents stale closure from
      // reading face value after reset() was called but before React re-renders
      if (!isAtRestRef.current) {
        return
      }

      const value = getDiceFaceValue(quaternion, shape, customNormalsRef.current)
      setFaceValue(value)
    },
    [],
  )

  /**
   * Reset the detection state
   * Updates ref synchronously so useFrame sees the change immediately
   */
  const reset = useCallback(() => {
    isAtRestRef.current = false // Immediate — prevents stale useFrame reads
    setIsAtRest(false)
    setFaceValue(null)
    restStartTimeRef.current = null
  }, [])

  return {
    isAtRest,
    faceValue,
    updateMotion,
    readFaceValue,
    reset,
  }
}
