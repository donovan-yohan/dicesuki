import { useState, useRef, useCallback } from 'react'
import * as THREE from 'three'
import { getDiceFaceValue, DiceShape } from '../lib/geometries'

/**
 * Thresholds for detecting when a dice is at rest
 * More conservative thresholds to prevent false positives
 */
const VELOCITY_THRESHOLD = 0.01  // Linear velocity threshold (reduced from 0.1)
const ANGULAR_VELOCITY_THRESHOLD = 0.01  // Angular velocity threshold (reduced from 0.1)
const REST_DURATION_MS = 1000  // Time in milliseconds dice must be still (reduced from 2000 for better UX)

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
 * Usage:
 * const { isAtRest, faceValue, updateMotion, readFaceValue, reset } = useFaceDetection()
 *
 * // In physics loop:
 * updateMotion(rigidBody.linvel(), rigidBody.angvel())
 *
 * // When dice comes to rest:
 * if (isAtRest) {
 *   readFaceValue(rigidBody.rotation(), 'd6')
 * }
 */
export function useFaceDetection(): FaceDetectionState {
  const [isAtRest, setIsAtRest] = useState(false)
  const [faceValue, setFaceValue] = useState<number | null>(null)

  const restStartTimeRef = useRef<number | null>(null)
  const lastVelocityRef = useRef<THREE.Vector3>(new THREE.Vector3())
  const lastAngularVelocityRef = useRef<THREE.Vector3>(new THREE.Vector3())

  /**
   * Update motion state and check if dice is at rest
   */
  const updateMotion = useCallback((velocity: THREE.Vector3, angularVelocity: THREE.Vector3) => {
    lastVelocityRef.current.copy(velocity)
    lastAngularVelocityRef.current.copy(angularVelocity)

    const velocityMagnitude = velocity.length()
    const angularVelocityMagnitude = angularVelocity.length()

    const isStill =
      velocityMagnitude < VELOCITY_THRESHOLD &&
      angularVelocityMagnitude < ANGULAR_VELOCITY_THRESHOLD

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
      if (restStartTimeRef.current !== null) {
        restStartTimeRef.current = null
      }
      setIsAtRest(false)
    }
  }, [])

  /**
   * Read the face value when dice is at rest
   */
  const readFaceValue = useCallback(
    (quaternion: THREE.Quaternion, shape: DiceShape) => {
      if (!isAtRest) {
        return
      }

      const value = getDiceFaceValue(quaternion, shape)
      setFaceValue(value)
    },
    [isAtRest]
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
    reset
  }
}
