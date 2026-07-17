import { useState, useEffect, useCallback, useRef } from 'react'
import {
  MOTION_ACCEL_SCALE,
  MOTION_DEADZONE,
  MOTION_GRAVITY_LOWPASS,
  MOTION_TILT_DEADZONE_DEG,
  SHAKE_THRESHOLD,
  SHAKE_DURATION,
} from '../config/physicsConfig'
import { getEngineConfig } from '../config/engineConfig'
import {
  combineMotionFields,
  computeMotionField,
  computeTiltGravityCorrection,
  dynamicAccelFromTotal,
  initialGravityEstimate,
  type GravityEstimate,
  type MotionField,
  type SensorAcceleration,
} from '../lib/motionField'

type PermissionState = 'prompt' | 'granted' | 'denied' | 'unsupported'

type DeviceMotionEventWithPermission = typeof DeviceMotionEvent & {
  requestPermission?: () => Promise<PermissionState>
}

type DeviceOrientationEventWithPermission = typeof DeviceOrientationEvent & {
  requestPermission?: () => Promise<PermissionState>
}

export interface DeviceMotionState {
  isSupported: boolean
  permissionState: PermissionState
  orientationPermissionState: PermissionState
  isShaking: boolean
  /**
   * Real-time device-motion FIELD for physics (updated per sensor event, no React
   * re-renders): the per-player gravity correction plus shake pseudo-force in engine units (U/s²),
   * world space. It combines fused-orientation tilt with linear acceleration and
   * is `[0, 0, 0]` when the phone is flat and still. Streamed to the room by
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
 * - A continuous per-die motion field from fused orientation and linear acceleration
 * - Shake detection for UI feedback only
 *
 * Physics model (Shared-ADR-010):
 * The phone is a non-inertial reference frame. When the phone accelerates, the dice
 * in the box experience a pseudo-force opposite to that acceleration ("dice sliding
 * in a shaking cup"). Fused orientation redirects gravity for the sender's dice while
 * linear acceleration adds the opposite pseudo-force. The field is applied per-player
 * to that player's own dice by the room; shared world gravity is never changed.
 */
export function useDeviceMotion(): DeviceMotionState {
  const [isSupported] = useState(
    typeof DeviceMotionEvent !== 'undefined' || typeof DeviceOrientationEvent !== 'undefined'
  )
  const [permissionState, setPermissionState] = useState<PermissionState>(
    typeof DeviceMotionEvent !== 'undefined' || typeof DeviceOrientationEvent !== 'undefined'
      ? 'prompt'
      : 'unsupported'
  )
  const [orientationPermissionState, setOrientationPermissionState] = useState<PermissionState>(
    typeof DeviceOrientationEvent !== 'undefined' ? 'prompt' : 'unsupported'
  )
  const [isShaking, setIsShaking] = useState(false)

  // Real-time refs read by physics/UI without triggering React re-renders.
  const motionFieldRef = useRef<MotionField>([0, 0, 0])
  const accelerationFieldRef = useRef<MotionField>([0, 0, 0])
  const tiltFieldRef = useRef<MotionField>([0, 0, 0])
  const isShakingRef = useRef<boolean>(false)
  // Gravity low-pass state for the accelerationIncludingGravity fallback (used only
  // when the device leaves the gravity-removed linear channel null).
  const gravityEstimateRef = useRef<GravityEstimate>(initialGravityEstimate())

  const shakeTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  /**
   * Request motion and fused-orientation permission from the same user gesture.
   * Either channel may remain unavailable; the granted channel still works.
   */
  const requestPermission = useCallback(async () => {
    if (!isSupported) {
      setPermissionState('unsupported')
      return
    }

    try {
      let motionRequest: Promise<PermissionState> | undefined
      let orientationRequest: Promise<PermissionState> | undefined

      if (typeof DeviceMotionEvent !== 'undefined') {
        const motionEvent = DeviceMotionEvent as DeviceMotionEventWithPermission
        motionRequest = typeof motionEvent.requestPermission === 'function'
          ? motionEvent.requestPermission().catch(() => 'denied')
          : Promise.resolve('granted')
      }

      if (typeof DeviceOrientationEvent !== 'undefined') {
        const orientationEvent = DeviceOrientationEvent as DeviceOrientationEventWithPermission
        orientationRequest = typeof orientationEvent.requestPermission === 'function'
          ? orientationEvent.requestPermission().catch(() => 'denied')
          : Promise.resolve('granted')
      }

      const [motionResponse, orientationResponse] = await Promise.all([
        motionRequest ?? Promise.resolve<PermissionState>('unsupported'),
        orientationRequest ?? Promise.resolve<PermissionState>('unsupported'),
      ])
      setOrientationPermissionState(orientationResponse)
      const responses = [motionResponse, orientationResponse]
      setPermissionState(responses.includes('granted') ? 'granted' : 'denied')
    } catch (error) {
      console.error('Error requesting device motion and orientation permissions:', error)
      setPermissionState('denied')
      setOrientationPermissionState('denied')
    }
  }, [isSupported])

  /**
   * Listen for motion and orientation events and compose their continuous field.
   */
  useEffect(() => {
    if (permissionState !== 'granted') return

    const publishCombinedField = () => {
      motionFieldRef.current = combineMotionFields(
        accelerationFieldRef.current,
        tiltFieldRef.current
      )
    }

    const handleOrientation = (event: DeviceOrientationEvent) => {
      const gravity = getEngineConfig()?.gravity
      tiltFieldRef.current = gravity === undefined
        ? [0, 0, 0]
        : computeTiltGravityCorrection(event, gravity, MOTION_TILT_DEADZONE_DEG)
      publishCombinedField()
    }

    const handleMotion = (event: DeviceMotionEvent) => {
      // Linear acceleration (gravity removed) drives the movement term.
      // Prefer the sensor's gravity-removed channel; when a device leaves it null
      // (common on Android), recover the movement acceleration by high-passing
      // accelerationIncludingGravity (a running gravity estimate absorbs the static
      // tilt). The pure mapping/derivation lives in motionField.ts so it stays
      // testable and independent from the fused-orientation tilt term.
      let linear: SensorAcceleration | null | undefined = event.acceleration
      const hasLinear =
        !!linear && (linear.x !== null || linear.y !== null || linear.z !== null)
      if (!hasLinear && event.accelerationIncludingGravity) {
        const derived = dynamicAccelFromTotal(
          event.accelerationIncludingGravity,
          gravityEstimateRef.current,
          MOTION_GRAVITY_LOWPASS
        )
        gravityEstimateRef.current = derived.gravity
        linear = derived.linear
      }
      accelerationFieldRef.current = computeMotionField(
        linear,
        MOTION_ACCEL_SCALE,
        MOTION_DEADZONE
      )
      publishCombinedField()

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
    window.addEventListener('deviceorientation', handleOrientation)

    return () => {
      window.removeEventListener('devicemotion', handleMotion)
      window.removeEventListener('deviceorientation', handleOrientation)
      if (shakeTimeoutRef.current) {
        clearTimeout(shakeTimeoutRef.current)
      }
      // Drop any residual field (and gravity estimate) so a re-grant doesn't
      // resume a stale push or a stale gravity baseline.
      motionFieldRef.current = [0, 0, 0]
      accelerationFieldRef.current = [0, 0, 0]
      tiltFieldRef.current = [0, 0, 0]
      gravityEstimateRef.current = initialGravityEstimate()
    }
  }, [permissionState])

  return {
    isSupported,
    permissionState,
    orientationPermissionState,
    isShaking,
    motionFieldRef,
    isShakingRef,
    requestPermission,
  }
}
