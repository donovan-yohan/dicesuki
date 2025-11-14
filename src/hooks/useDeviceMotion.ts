import { useState, useEffect, useCallback, useRef } from 'react'
import * as THREE from 'three'

/**
 * Configuration for motion detection
 */
const GRAVITY_SCALE = 15 // Scale factor for converting device tilt to gravity force
const ACCELERATION_SCALE = 15 // Scale factor for linear acceleration (pseudo-force when phone moves)
const SHAKE_THRESHOLD = 20 // Minimum acceleration magnitude to detect shake
const SHAKE_DURATION = 500 // How long shake state persists (ms)
const TILT_DEADZONE = 2.0 // Minimum tilt (in m/s²) to register as actual tilt (filters sensor noise)
const ACCELERATION_DEADZONE = 1.0 // Minimum linear acceleration (in m/s²) to register (filters hand tremors)
const UI_UPDATE_THROTTLE = 100 // Throttle UI updates to 10fps (100ms)

type PermissionState = 'prompt' | 'granted' | 'denied' | 'unsupported'

export interface DeviceMotionState {
  isSupported: boolean
  permissionState: PermissionState
  isShaking: boolean
  gravityVector: THREE.Vector3 // Throttled gravity for UI display only
  gravityRef: React.MutableRefObject<THREE.Vector3> // Real-time gravity for physics (60fps)
  isShakingRef: React.MutableRefObject<boolean> // Real-time shake detection for physics (60fps)
  requestPermission: () => Promise<void>
}

/**
 * Hook for device motion detection with continuous gravity simulation
 *
 * Handles:
 * - iOS permission flow (requestPermission API)
 * - Android auto-permission
 * - Continuous gravity vector based on device orientation (tilt)
 * - Linear acceleration for "dice in shaking cup" effect
 * - Shake detection for visual feedback
 *
 * Physics Model:
 * The phone is a non-inertial reference frame. When the phone accelerates in space,
 * dice experience pseudo-forces (inertial forces) opposite to the phone's acceleration.
 * This creates the "dice sliding in a shaking cup" effect where rapid phone movement
 * causes dice to lag behind due to insufficient friction.
 *
 * Effective Gravity = Tilt Gravity - Linear Acceleration (pseudo-force)
 *
 * The gravity vector is updated in real-time based on:
 * 1. Device tilt (from gravity direction)
 * 2. Linear acceleration (from phone movement in space)
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

  // Real-time gravity for physics (updated every frame, no React re-renders)
  const gravityRef = useRef<THREE.Vector3>(new THREE.Vector3(0, -9.81, 0))
  const isShakingRef = useRef<boolean>(false)

  // Throttle mechanism for UI updates
  const lastUIUpdateRef = useRef<number>(0)
  const shakeTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Debug: Track if motion events are being received
  const lastMotionEventRef = useRef<number>(0)
  const motionEventCountRef = useRef<number>(0)

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
    if (permissionState !== 'granted') {
      if (import.meta.env.DEV) {
        console.log('🎯 DeviceMotion: Event listener NOT added - permission:', permissionState)
      }
      return
    }

    if (import.meta.env.DEV) {
      console.log('🎯 DeviceMotion: Adding event listener - permission:', permissionState)
    }

    const handleMotion = (event: DeviceMotionEvent) => {
      // Debug: Track motion events
      motionEventCountRef.current++
      const now = performance.now()

      // Log every 2 seconds to verify events are firing
      if (import.meta.env.DEV && now - lastMotionEventRef.current > 2000) {
        console.log(`🎯 DeviceMotion: Still receiving events (${motionEventCountRef.current} total)`)
        lastMotionEventRef.current = now
      }

      const accelTotal = event.accelerationIncludingGravity
      const accelLinear = event.acceleration // Linear acceleration WITHOUT gravity (may be null on some devices)

      // Calculate gravity vector from device orientation
      // accelerationIncludingGravity gives us the direction of "down" relative to the device
      // acceleration gives us linear acceleration of the phone in space
      if (accelTotal && accelTotal.x !== null && accelTotal.y !== null && accelTotal.z !== null) {
        // For top-down view (camera looking down at XZ plane):
        // - Device flat on table: gravity = (0, -9.81, 0) - normal downward
        // - Device tilted forward: gravity has positive Z component - dice rolls "forward"
        // - Device tilted right: gravity has positive X component - dice rolls "right"
        // - Device tilted back: gravity has negative Z component - dice rolls "back"
        // - Device tilted left: gravity has negative X component - dice rolls "left"

        // Device coordinate system when phone is upright (portrait):
        // - accel.x: left(-) / right(+)
        // - accel.y: up(-) / down(+)
        // - accel.z: away from screen(-) / toward screen(+)
        //
        // When phone is flat on table (screen up):
        // - accel.x ≈ 0
        // - accel.y ≈ 0
        // - accel.z ≈ -9.81 (gravity pointing into the table)
        //
        // World space (top-down view):
        // - Y axis is vertical (up is positive, down is negative)
        // - X axis is horizontal left/right
        // - Z axis is horizontal forward/back

        // Separate tilt gravity from linear acceleration
        // If linear acceleration available, subtract it to get pure gravity direction
        // Otherwise fall back to using accelerationIncludingGravity as-is (tilt only)
        let gravityVec = { x: accelTotal.x, y: accelTotal.y, z: accelTotal.z }

        if (accelLinear && accelLinear.x !== null && accelLinear.y !== null && accelLinear.z !== null) {
          // Separate pure gravity (tilt) from total acceleration
          gravityVec = {
            x: accelTotal.x - accelLinear.x,
            y: accelTotal.y - accelLinear.y,
            z: accelTotal.z - accelLinear.z
          }
        }

        // Apply deadzone to filter sensor noise on TILT
        const tiltX = Math.abs(gravityVec.x) > TILT_DEADZONE ? gravityVec.x : 0
        const tiltY = Math.abs(gravityVec.y) > TILT_DEADZONE ? gravityVec.y : 0

        // Calculate total tilt magnitude to detect "nearly flat" state
        const totalTilt = Math.sqrt(tiltX * tiltX + tiltY * tiltY)

        // Calculate tilt gravity component
        let tiltGravity: THREE.Vector3

        if (totalTilt < TILT_DEADZONE) {
          // Device is nearly flat - snap to pure downward gravity
          // This simulates static friction and prevents perpetual micro-movements
          tiltGravity = new THREE.Vector3(0, -9.81, 0)
        } else {
          // Device is deliberately tilted - apply tilted gravity
          tiltGravity = new THREE.Vector3(
            -tiltX * GRAVITY_SCALE / 9.81,   // Horizontal tilt (left/right) - inverted
            -gravityVec.z,                    // Vertical (device Z becomes world Y, inverted)
            tiltY * GRAVITY_SCALE / 9.81      // Horizontal tilt (forward/back) - inverted
          )
        }

        // Calculate pseudo-force from linear acceleration (if available)
        // When phone accelerates, dice experience force in opposite direction
        let pseudoForce = new THREE.Vector3(0, 0, 0)

        if (accelLinear && accelLinear.x !== null && accelLinear.y !== null && accelLinear.z !== null) {
          // Calculate magnitude for deadzone filtering
          const accelMagnitude = Math.sqrt(
            accelLinear.x * accelLinear.x +
            accelLinear.y * accelLinear.y +
            accelLinear.z * accelLinear.z
          )

          // Apply deadzone to filter hand tremors and small movements
          if (accelMagnitude > ACCELERATION_DEADZONE) {
            // Pseudo-force is opposite to phone's acceleration (Newton's laws in non-inertial frame)
            // When phone moves right (+X), dice experience force to the left (-X)
            // When phone moves up (+Y), dice experience force down (-Y)
            // When phone moves toward you (+Z), dice experience force away (-Z)
            pseudoForce = new THREE.Vector3(
              -accelLinear.x * ACCELERATION_SCALE,  // Device accel +X (right) → dice force -X (left)
              -accelLinear.z * ACCELERATION_SCALE,  // Device accel +Z (toward) → dice force -Y (down)
              accelLinear.y * ACCELERATION_SCALE    // Device accel +Y (up) → dice force +Z (forward in world)
            )
          }
        }

        // Combine tilt gravity and pseudo-force
        // Effective gravity in phone's reference frame = tilt gravity + pseudo-force
        const gravity = tiltGravity.clone().add(pseudoForce)

        // ALWAYS update ref immediately (no React re-renders, physics reads this directly)
        gravityRef.current = gravity

        // Throttle UI state updates to 10fps (every 100ms)
        const now = performance.now()
        if (now - lastUIUpdateRef.current >= UI_UPDATE_THROTTLE) {
          setGravityVector(gravity.clone()) // Clone to avoid mutation issues
          lastUIUpdateRef.current = now
        }

        // Shake detection (for visual feedback only)
        const magnitude = Math.sqrt(
          accelTotal.x * accelTotal.x +
          accelTotal.y * accelTotal.y +
          accelTotal.z * accelTotal.z
        )

        if (magnitude > SHAKE_THRESHOLD) {
          setIsShaking(true)
          isShakingRef.current = true

          // Clear shake state after duration
          if (shakeTimeoutRef.current) {
            clearTimeout(shakeTimeoutRef.current)
          }
          shakeTimeoutRef.current = setTimeout(() => {
            setIsShaking(false)
            isShakingRef.current = false
          }, SHAKE_DURATION)
        }
      }
    }

    window.addEventListener('devicemotion', handleMotion)

    return () => {
      if (import.meta.env.DEV) {
        console.log('🎯 DeviceMotion: Removing event listener (cleanup)')
      }
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
    gravityRef,
    isShakingRef,
    requestPermission
  }
}
