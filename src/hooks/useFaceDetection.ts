import { useCallback, useEffect, useRef, useState } from 'react'
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
 * @param customFaceNormals - Optional custom face normals for custom dice models
 *
 * Usage:
 * const { isAtRest, faceValue, updateMotion, readFaceValue, reset } = useFaceDetection()
 *
 * // For custom dice with custom face normals:
 * const customNormals = [{ value: 1, normal: new THREE.Vector3(...) }, ...]
 * const { isAtRest, faceValue, ... } = useFaceDetection(customNormals)
 *
 * // In physics loop:
 * updateMotion(rigidBody.linvel(), rigidBody.angvel())
 *
 * // When dice comes to rest:
 * if (isAtRest) {
 *   readFaceValue(rigidBody.rotation(), 'd6')
 * }
 */
export function useFaceDetection(customFaceNormals?: DiceFace[]): FaceDetectionState {
  const [isAtRest, setIsAtRest] = useState(false)
  const [faceValue, setFaceValue] = useState<number | null>(null)

  const restStartTimeRef = useRef<number | null>(null)
  const lastVelocityRef = useRef<THREE.Vector3>(new THREE.Vector3())
  const lastAngularVelocityRef = useRef<THREE.Vector3>(new THREE.Vector3())

  // Store custom face normals in a ref to avoid re-creating the readFaceValue callback
  const customNormalsRef = useRef<DiceFace[] | undefined>(customFaceNormals)

  // Update ref when custom normals change
  useEffect(() => {
    customNormalsRef.current = customFaceNormals
  }, [customFaceNormals])

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
            setIsAtRest(true)
          }
        }
      } else {
        // Reset if motion detected
        if (restStartTimeRef.current !== null || isAtRest) {
          restStartTimeRef.current = null
          setIsAtRest(false)
        }
      }
    },
    [],
  )

  /**
   * Read the face value when dice is at rest
   * Uses custom face normals if provided, otherwise uses default normals for the shape
   */
  const readFaceValue = useCallback(
    (quaternion: THREE.Quaternion, shape: DiceShape) => {
      if (!isAtRest) {
        return
      }

      const value = getDiceFaceValue(quaternion, shape, customNormalsRef.current)

      setFaceValue(value)
    },
    [isAtRest],
  )

  /**
   * Reset the detection state
   */
  const reset = useCallback(() => {
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
