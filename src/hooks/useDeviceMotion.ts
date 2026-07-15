import { useState, useEffect, useCallback, useRef } from 'react'
import {
  MOTION_ACCEL_SCALE,
  MOTION_DEADZONE,
  SHAKE_THRESHOLD,
  SHAKE_DURATION,
} from '../config/physicsConfig'
import { computeMotionField, type MotionField } from '../lib/motionField'

type PermissionState = 'prompt' | 'granted' | 'denied' | 'unsupported'

type DeviceMotionEventWithPermission = typeof DeviceMotionEvent & {
  requestPermission?: () => Promise<PermissionState>
}

export interface DeviceMotionState {
  isSupported: boolean
  permissionState: PermissionState
  isShaking: boolean
  /**
   * Real-time device-motion FIELD for physics (updated per sensor event, no React
   * re-renders): the "shake your dice box" pseudo-force in engine units (U/s²),
   * world space. `[0, 0, 0]` when the phone is still. Streamed to the room by
   * `MultiplayerMotionController` and applied to the local player's own dice
   * (Shared-ADR-010).
   */
  motionFieldRef: React.MutableRefObject<MotionField>
  /** Real-time shake flag for UI feedback (60fps). */
  isShakingRef: React.MutableRefObject<boolean>
  requestPermission: () => Promise<void>
}

/**
 * Hook for device-motion detection driving the continuous "dice box" field.
 *
 * Handles:
 * - iOS permission flow (requestPermission API) / Android auto-permission
 * - A continuous per-die motion field from the phone's LINEAR acceleration
 * - Shake detection for UI feedback only
 *
 * Physics model (Shared-ADR-010):
 * The phone is a non-inertial reference frame. When the phone accelerates, the dice
 * in the box experience a pseudo-force opposite to that acceleration ("dice sliding
 * in a shaking cup"). We map only that LINEAR acceleration to the field — never the
 * static tilt/gravity direction — so a still or statically-tilted phone yields a
 * zero field and the dice settle. The field is applied per-player to that player's
 * own dice by the room; world gravity is never changed.
 */
export function useDeviceMotion(): DeviceMotionState {
  const [isSupported] = useState(typeof DeviceMotionEvent !== 'undefined')
  const [permissionState, setPermissionState] = useState<PermissionState>(
    typeof DeviceMotionEvent !== 'undefined' ? 'prompt' : 'unsupported'
  )
  const [isShaking, setIsShaking] = useState(false)

  // Real-time refs read by physics/UI without triggering React re-renders.
  const motionFieldRef = useRef<MotionField>([0, 0, 0])
  const isShakingRef = useRef<boolean>(false)

  const shakeTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  /**
   * Request device motion permission.
   * iOS 13+ requires this from a user gesture; Android grants automatically.
   */
  const requestPermission = useCallback(async () => {
    if (!isSupported) {
      setPermissionState('unsupported')
      return
    }

    try {
      const motionEvent = DeviceMotionEvent as DeviceMotionEventWithPermission
      if (typeof motionEvent.requestPermission === 'function') {
        const response = await motionEvent.requestPermission()
        setPermissionState(response)
      } else {
        // Android or older iOS — permission granted automatically.
        setPermissionState('granted')
      }
    } catch (error) {
      console.error('Error requesting device motion permission:', error)
      setPermissionState('denied')
    }
  }, [isSupported])

  /**
   * Listen for device-motion events: derive the continuous field and detect shakes.
   */
  useEffect(() => {
    if (permissionState !== 'granted') return

    const handleMotion = (event: DeviceMotionEvent) => {
      // Linear acceleration (gravity removed) drives the "shake the box" field.
      // The pure mapping (negate + scale to engine units, with a deadzone) lives in
      // motionField.ts so it stays testable and free of the static tilt term.
      motionFieldRef.current = computeMotionField(
        event.acceleration,
        MOTION_ACCEL_SCALE,
        MOTION_DEADZONE
      )

      // Shake detection (UI feedback only) uses total acceleration magnitude.
      const accelTotal = event.accelerationIncludingGravity
      if (accelTotal && accelTotal.x !== null && accelTotal.y !== null && accelTotal.z !== null) {
        const magnitude = Math.sqrt(
          accelTotal.x * accelTotal.x +
          accelTotal.y * accelTotal.y +
          accelTotal.z * accelTotal.z
        )

        if (magnitude > SHAKE_THRESHOLD) {
          setIsShaking(true)
          isShakingRef.current = true

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
      window.removeEventListener('devicemotion', handleMotion)
      if (shakeTimeoutRef.current) {
        clearTimeout(shakeTimeoutRef.current)
      }
      // Drop any residual field so a re-grant doesn't resume a stale push.
      motionFieldRef.current = [0, 0, 0]
    }
  }, [permissionState])

  return {
    isSupported,
    permissionState,
    isShaking,
    motionFieldRef,
    isShakingRef,
    requestPermission,
  }
}
