import type { Vector3 } from 'three'
import {
  MOTION_IMPULSE_MAX_MAGNITUDE,
  SHAKE_IMPULSE_VERTICAL,
  SHAKE_IMPULSE_HORIZONTAL_SCALE,
  SHAKE_IMPULSE_JITTER,
} from '../config/physicsConfig'

/** World-space impulse vector `[x, y, z]` sent to the server as `motion_impulse`. */
export type ImpulseVector = [number, number, number]

/** Anything with `x`/`z` we can read a horizontal component from (e.g. `gravityRef.current`). */
type GravityLike = Vector3 | ImpulseVector

function horizontalXZ(gravity: GravityLike): [number, number] {
  if (Array.isArray(gravity)) return [gravity[0], gravity[2]]
  return [gravity.x, gravity.z]
}

/**
 * Clamp a world-space vector to `maxMagnitude`, preserving direction. Mirrors
 * the server-side clamp so the client never sends an impulse the server would
 * scale down anyway.
 */
export function clampImpulseMagnitude(
  impulse: ImpulseVector,
  maxMagnitude: number,
): ImpulseVector {
  const [x, y, z] = impulse
  const magnitude = Math.sqrt(x * x + y * y + z * z)
  if (magnitude === 0 || magnitude <= maxMagnitude) return [x, y, z]
  const scale = maxMagnitude / magnitude
  return [x * scale, y * scale, z * scale]
}

/**
 * Map the device's effective-gravity vector — tilt plus the shake pseudo-force,
 * as produced by `useDeviceMotion`'s `gravityRef` — to a world-space toss
 * impulse for a room shake-to-roll.
 *
 * The impulse is mostly upward (`SHAKE_IMPULSE_VERTICAL`) so dice hop off the
 * table and tumble like the single-player shake, with horizontal energy pulled
 * from the sensor in the shake direction (`SHAKE_IMPULSE_HORIZONTAL_SCALE`) plus
 * a little random jitter (`SHAKE_IMPULSE_JITTER`) so stacked dice scatter. The
 * result is clamped to `MOTION_IMPULSE_MAX_MAGNITUDE` to match the server clamp.
 *
 * `rng` is injectable for deterministic tests.
 */
export function computeShakeImpulse(
  gravity: GravityLike,
  rng: () => number = Math.random,
): ImpulseVector {
  const [gx, gz] = horizontalXZ(gravity)
  const jitter = () => (rng() - 0.5) * 2 * SHAKE_IMPULSE_JITTER
  const impulse: ImpulseVector = [
    gx * SHAKE_IMPULSE_HORIZONTAL_SCALE + jitter(),
    SHAKE_IMPULSE_VERTICAL,
    gz * SHAKE_IMPULSE_HORIZONTAL_SCALE + jitter(),
  ]
  return clampImpulseMagnitude(impulse, MOTION_IMPULSE_MAX_MAGNITUDE)
}

/**
 * Per-frame decision for the multiplayer shake controller.
 *
 * Emits an impulse only on the *rising edge* of a shake (`isShaking &&
 * !wasShaking`) and only when the local motion opt-in is enabled, so a held,
 * still-shaking phone fires once per shake rather than every frame. Returns
 * `null` otherwise.
 *
 * The room's `motionControl` policy (`off`) and the send rate-limit are enforced
 * downstream by `useMultiplayerStore.sendMotionImpulse`, and per-die ownership is
 * enforced by the server, so callers may forward every non-null result directly.
 */
export function shakeImpulseForFrame(params: {
  isShaking: boolean
  wasShaking: boolean
  motionEnabled: boolean
  gravity: GravityLike
  rng?: () => number
}): ImpulseVector | null {
  const { isShaking, wasShaking, motionEnabled, gravity, rng } = params
  if (!motionEnabled) return null
  if (!isShaking || wasShaking) return null
  return computeShakeImpulse(gravity, rng)
}
