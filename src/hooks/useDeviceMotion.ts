import { useState, useEffect, useCallback, useRef } from 'react'
import * as THREE from 'three'

/**
 * Configuration for motion detection
 */
const GRAVITY_SCALE = 15 // Scale factor for converting device tilt to gravity force
const SHAKE_THRESHOLD = 20 // Minimum acceleration magnitude to detect shake
const SHAKE_DURATION = 500 // How long shake state persists (ms)

type PermissionState = 'prompt' | 'granted' | 'denied' | 'unsupported'

export interface DeviceMotionState {
  isSupported: boolean
  permissionState: PermissionState
  isShaking: boolean
  gravityVector: THREE.Vector3 // Continuous gravity based on device orientation
  requestPermission: () => Promise<void>
}

/**
 * Hook for device motion detection with continuous gravity simulation
 *
 * Handles:
 * - iOS permission flow (requestPermission API)
 * - Android auto-permission
 * - Continuous gravity vector based on device orientation
 * - Shake detection for visual feedback
 *
 * The gravity vector is updated in real-time based on device tilt,
 * allowing the physics simulation to respond naturally as if the phone
 * is a physical dice tray being tilted in 3D space.
 *
 * Usage:
 * ```tsx
 * const { isSupported, permissionState, gravityVector, requestPermission } = useDeviceMotion()
 *
 * // Request permission (iOS requires user gesture)
 * <button onClick={requestPermission}>Enable Motion</button>
 *
 * // Apply gravity to physics world
 * <Physics gravity={[gravityVector.x, gravityVector.y, gravityVector.z]}>
 * ```
 */
export function useDeviceMotion(): DeviceMotionState {
  const [isSupported] = useState(typeof DeviceMotionEvent !== 'undefined')
  const [permissionState, setPermissionState] = useState<PermissionState>(
    typeof DeviceMotionEvent !== 'undefined' ? 'prompt' : 'unsupported'
  )
  const [isShaking, setIsShaking] = useState(false)
  const [gravityVector, setGravityVector] = useState<THREE.Vector3>(new THREE.Vector3(0, -9.81, 0))

  const shakeTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)

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

      // Calculate gravity vector from device orientation
      // accelerationIncludingGravity gives us the direction of "down" relative to the device
      if (accel && accel.x !== null && accel.y !== null && accel.z !== null) {
        // For top-down view (camera looking down at XZ plane):
        // - Device flat on table: gravity = (0, -9.81, 0) - normal downward
        // - Device tilted forward: gravity has positive Z component - dice rolls "forward"
        // - Device tilted right: gravity has positive X component - dice rolls "right"
        // - Device tilted back: gravity has negative Z component - dice rolls "back"
        // - Device tilted left: gravity has negative X component - dice rolls "left"

        // Invert Y to convert from device space to world space
        // Scale XZ to make tilt more responsive
        const gravity = new THREE.Vector3(
          -accel.x * GRAVITY_SCALE / 9.81, // Horizontal tilt (left/right)
          -accel.y, // Vertical (always downward when device flat)
          -accel.z * GRAVITY_SCALE / 9.81  // Horizontal tilt (forward/back)
        )

        setGravityVector(gravity)

        // Shake detection (for visual feedback only)
        const magnitude = Math.sqrt(
          accel.x * accel.x +
          accel.y * accel.y +
          accel.z * accel.z
        )

        if (magnitude > SHAKE_THRESHOLD) {
          setIsShaking(true)

          // Clear shake state after duration
          if (shakeTimeoutRef.current) {
            clearTimeout(shakeTimeoutRef.current)
          }
          shakeTimeoutRef.current = setTimeout(() => {
            setIsShaking(false)
          }, SHAKE_DURATION)
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
    gravityVector,
    requestPermission
  }
}
