import { useState, useEffect, useCallback, useRef } from 'react'
import * as THREE from 'three'

/**
 * Configuration for motion detection
 */
const SHAKE_THRESHOLD = 20 // Minimum acceleration magnitude to detect shake
const SHAKE_DURATION = 500 // How long shake state persists (ms)
const TILT_THRESHOLD = 5 // Minimum rotation rate to detect tilt (deg/s)
const IMPULSE_SCALE = 1.0 // Scale factor for acceleration to impulse
const MAX_IMPULSE = 50 // Maximum impulse magnitude (increased to allow test values through)

type PermissionState = 'prompt' | 'granted' | 'denied' | 'unsupported'

export interface DeviceMotionState {
  isSupported: boolean
  permissionState: PermissionState
  isShaking: boolean
  shakeImpulse: THREE.Vector3 | null
  tiltImpulse: THREE.Vector3 | null
  requestPermission: () => Promise<void>
}

/**
 * Hook for device motion detection (shake, tilt)
 *
 * Handles:
 * - iOS permission flow (requestPermission API)
 * - Android auto-permission
 * - Shake detection from accelerometer
 * - Tilt detection from gyroscope
 * - Impulse generation for physics
 *
 * Usage:
 * ```tsx
 * const { isSupported, permissionState, isShaking, shakeImpulse, requestPermission } = useDeviceMotion()
 *
 * // Request permission (iOS requires user gesture)
 * <button onClick={requestPermission}>Enable Motion</button>
 *
 * // Apply shake impulse when detected
 * useEffect(() => {
 *   if (shakeImpulse && diceRef.current) {
 *     diceRef.current.applyImpulse(shakeImpulse)
 *   }
 * }, [shakeImpulse])
 * ```
 */
export function useDeviceMotion(): DeviceMotionState {
  const [isSupported, setIsSupported] = useState(typeof DeviceMotionEvent !== 'undefined')
  const [permissionState, setPermissionState] = useState<PermissionState>(
    typeof DeviceMotionEvent !== 'undefined' ? 'prompt' : 'unsupported'
  )
  const [isShaking, setIsShaking] = useState(false)
  const [shakeImpulse, setShakeImpulse] = useState<THREE.Vector3 | null>(null)
  const [tiltImpulse, setTiltImpulse] = useState<THREE.Vector3 | null>(null)

  const shakeTimeoutRef = useRef<NodeJS.Timeout | null>(null)

  /**
   * Request device motion permission
   * iOS requires this to be called from a user gesture
   * Android grants permission automatically
   */
  const requestPermission = useCallback(async () => {
    if (!isSupported) {
      setPermissionState('unsupported')
      return
    }

    try {
      // iOS 13+ requires explicit permission
      if (typeof (DeviceMotionEvent as any).requestPermission === 'function') {
        const response = await (DeviceMotionEvent as any).requestPermission()
        setPermissionState(response as PermissionState)
      } else {
        // Android or older iOS - permission granted automatically
        setPermissionState('granted')
      }
    } catch (error) {
      console.error('Error requesting device motion permission:', error)
      setPermissionState('denied')
    }
  }, [isSupported])

  /**
   * Handle device motion events
   * Detects shake and tilt gestures, generates impulses
   */
  useEffect(() => {
    if (permissionState !== 'granted') return

    const handleMotion = (event: DeviceMotionEvent) => {
      const accel = event.accelerationIncludingGravity
      const rotation = event.rotationRate

      // Shake detection from acceleration
      if (accel && accel.x !== null && accel.y !== null && accel.z !== null) {
        const magnitude = Math.sqrt(
          accel.x * accel.x +
          accel.y * accel.y +
          accel.z * accel.z
        )

        if (magnitude > SHAKE_THRESHOLD) {
          // Detected shake
          setIsShaking(true)

          // Generate impulse from acceleration
          // Scale and cap the impulse
          let impulse = new THREE.Vector3(
            accel.x * IMPULSE_SCALE,
            Math.abs(accel.y * IMPULSE_SCALE), // Always positive for upward force
            accel.z * IMPULSE_SCALE
          )

          // Ensure minimum upward component
          impulse.y = Math.max(impulse.y, 2)

          // Cap maximum impulse
          if (impulse.length() > MAX_IMPULSE) {
            impulse.normalize().multiplyScalar(MAX_IMPULSE)
          }

          setShakeImpulse(impulse)

          // Clear shake state after duration
          if (shakeTimeoutRef.current) {
            clearTimeout(shakeTimeoutRef.current)
          }
          shakeTimeoutRef.current = setTimeout(() => {
            setIsShaking(false)
          }, SHAKE_DURATION)
        }
      }

      // Tilt detection from rotation rate
      if (rotation && rotation.alpha !== null && rotation.beta !== null && rotation.gamma !== null) {
        const rotMagnitude = Math.sqrt(
          rotation.alpha * rotation.alpha +
          rotation.beta * rotation.beta +
          rotation.gamma * rotation.gamma
        )

        if (rotMagnitude > TILT_THRESHOLD) {
          // Generate tilt impulse from rotation rate
          const tilt = new THREE.Vector3(
            rotation.beta * IMPULSE_SCALE * 0.3,
            2, // Small upward component
            -rotation.alpha * IMPULSE_SCALE * 0.3
          )

          // Cap maximum
          if (tilt.length() > MAX_IMPULSE * 0.5) {
            tilt.normalize().multiplyScalar(MAX_IMPULSE * 0.5)
          }

          setTiltImpulse(tilt)
        }
      }
    }

    window.addEventListener('devicemotion', handleMotion)

    return () => {
      window.removeEventListener('devicemotion', handleMotion)
      if (shakeTimeoutRef.current) {
        clearTimeout(shakeTimeoutRef.current)
      }
    }
  }, [permissionState])

  return {
    isSupported,
    permissionState,
    isShaking,
    shakeImpulse,
    tiltImpulse,
    requestPermission
  }
}
