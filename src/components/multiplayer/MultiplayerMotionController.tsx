import { useEffect, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import { useDeviceMotionRef } from '../../contexts/DeviceMotionContext'
import { useUIStore } from '../../store/useUIStore'
import { useMultiplayerStore } from '../../store/useMultiplayerStore'
import { rotateXZ } from '../../lib/viewRotation'

const ZERO_FIELD: [number, number, number] = [0, 0, 0]

/**
 * Streams this client's continuous device-motion field into the room
 * (Shared-ADR-010): fused-orientation tilt plus the "shake your dice box"
 * pseudo-force, applied server-side to the local player's own dice by default. A
 * policy-controlled delegated roller may affect room-wide dice; shared world
 * gravity is never touched.
 *
 * Runs inside the Canvas so it can read the motion-field ref every frame without
 * re-rendering (Frontend-ADR-001: physics via refs; ADR-004: store reads via
 * `getState()` inside `useFrame`, never subscriptions). It only sends while the
 * local motion opt-in (`useUIStore.motionMode`) is enabled; on the disable edge and
 * on unmount it sends a single zero field so the dice stop promptly. The room's
 * `motionControl` policy and per-die ownership are enforced server-side, and
 * `sendMotionField` gates on the policy and throttles the stream.
 *
 * Renders nothing. Mounted in the unified room Scene used by solo and multiplayer.
 */
export function MultiplayerMotionController() {
  const { motionFieldRef } = useDeviceMotionRef()
  const wasEnabledRef = useRef(false)

  useFrame(() => {
    const motionEnabled = useUIStore.getState().motionMode

    if (!motionEnabled) {
      // Falling edge: stop the dice with a single zero field.
      if (wasEnabledRef.current) {
        useMultiplayerStore.getState().sendMotionField(ZERO_FIELD)
        wasEnabledRef.current = false
      }
      return
    }
    wasEnabledRef.current = true

    // Align the field's horizontal (XZ) component with this client's view rotation
    // so "shake toward there" matches what the player sees (ADR 009). Drag/throw
    // ride the actual camera, so only this sensor-derived vector needs rotating.
    const field = motionFieldRef.current
    const viewRotation = useUIStore.getState().viewRotation
    const aligned = viewRotation === 0 ? field : rotateXZ(field, viewRotation)
    useMultiplayerStore.getState().sendMotionField(aligned)
  })

  // Stop the dice if the controller unmounts mid-motion (leaving the room, Scene
  // teardown) without ever hitting a falling-edge frame.
  useEffect(() => {
    return () => {
      if (wasEnabledRef.current) {
        useMultiplayerStore.getState().sendMotionField(ZERO_FIELD)
      }
    }
  }, [])

  return null
}
