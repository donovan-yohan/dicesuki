import { useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import { useDeviceMotionRef } from '../../contexts/DeviceMotionContext'
import { useUIStore } from '../../store/useUIStore'
import { useMultiplayerStore } from '../../store/useMultiplayerStore'
import { shakeImpulseForFrame } from '../../lib/motionImpulse'
import { rotateXZ } from '../../lib/viewRotation'

/**
 * Bridges DeviceMotion shake detection into a room.
 *
 * Runs inside the Canvas so it can read the shake/gravity refs every frame
 * without re-rendering (Frontend-ADR-001: physics state via refs; ADR-004:
 * store reads via `getState()` inside `useFrame`, never subscriptions). On the
 * rising edge of a shake — and only while the local motion opt-in
 * (`useUIStore.motionMode`) is enabled — it forwards a world-space toss impulse
 * to the server via `sendMotionImpulse`.
 *
 * The room's `motionControl` policy (`off`) and the shared send rate-limit are
 * enforced by `sendMotionImpulse`; per-die ownership (`own_dice` vs `room`) is
 * enforced server-side. This component never sends when motion is disabled and
 * never spams disallowed dice — it just reports the local player's shake.
 *
 * Renders nothing. Mounted only in the multiplayer branch of the Scene.
 */
export function MultiplayerMotionController() {
  const { isShakingRef, gravityRef } = useDeviceMotionRef()
  const wasShakingRef = useRef(false)

  useFrame(() => {
    const gravity = gravityRef.current
    const impulse = shakeImpulseForFrame({
      isShaking: isShakingRef.current,
      wasShaking: wasShakingRef.current,
      motionEnabled: useUIStore.getState().motionMode,
      gravity: [gravity.x, gravity.y, gravity.z],
    })
    wasShakingRef.current = isShakingRef.current
    if (impulse) {
      // Align the world-space toss with this client's view rotation so a tilt
      // tosses dice toward where the player sees "that way" (ADR 009). Drag/throw
      // ride the actual camera, so only this sensor-derived vector needs rotating.
      const viewRotation = useUIStore.getState().viewRotation
      const aligned = viewRotation === 0 ? impulse : rotateXZ(impulse, viewRotation)
      useMultiplayerStore.getState().sendMotionImpulse(aligned)
    }
  })

  return null
}
