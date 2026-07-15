/**
 * Per-player device-motion field (Shared-ADR-010).
 *
 * The room applies a continuous per-die acceleration — the non-inertial
 * pseudo-force of the player's "dice box" — to the sender's own dice each tick.
 * This maps the phone's LINEAR acceleration (gravity removed) to that field in
 * engine units. It deliberately ignores the static tilt/gravity direction, so a
 * still or statically-tilted phone yields a zero field: it is "shake the box," not
 * "tilt changes gravity."
 */

/** World-space acceleration `[x, y, z]` (engine U/s²) sent as `motion_field`. */
export type MotionField = [number, number, number]

/** Nullable sensor triple, matching `DeviceMotionEvent.acceleration`. */
export interface SensorAcceleration {
  x: number | null
  y: number | null
  z: number | null
}

/** Magnitude of a motion field vector. */
export function motionFieldMagnitude(field: MotionField): number {
  const [x, y, z] = field
  return Math.sqrt(x * x + y * y + z * z)
}

/**
 * Map the phone's linear acceleration (m/s², gravity already removed — i.e.
 * `DeviceMotionEvent.acceleration`) to the engine-unit motion field (U/s²).
 *
 * The field is the pseudo-force the dice feel in the moving box frame, so it is the
 * NEGATED hand acceleration, scaled to engine units by `scale`. The device→world
 * axis map matches the historical shake pseudo-force so the "which way did they
 * move" feel is unchanged:
 *   world X = −accel.x, world Y = −accel.z, world Z = accel.y.
 *
 * Below `deadzone` (m/s²) the field is zero, filtering hand tremors and ensuring a
 * still or statically-tilted phone produces no push. Null sensor components (older
 * devices without a gyro-separated linear channel) are treated as 0.
 */
export function computeMotionField(
  accel: SensorAcceleration | null | undefined,
  scale: number,
  deadzone: number,
): MotionField {
  if (!accel) return [0, 0, 0]
  const ax = accel.x ?? 0
  const ay = accel.y ?? 0
  const az = accel.z ?? 0

  const magnitude = Math.sqrt(ax * ax + ay * ay + az * az)
  if (magnitude <= deadzone) return [0, 0, 0]

  return [-ax * scale, -az * scale, ay * scale]
}

/**
 * Running low-pass estimate of the gravity vector (device frame), used to derive
 * the dynamic movement acceleration when a device does not expose a gravity-removed
 * linear channel (`DeviceMotionEvent.acceleration` is null — common on Android).
 */
export interface GravityEstimate {
  x: number
  y: number
  z: number
  initialized: boolean
}

/** A fresh, uninitialized gravity estimate. */
export function initialGravityEstimate(): GravityEstimate {
  return { x: 0, y: 0, z: 0, initialized: false }
}

/**
 * Derive the phone's dynamic (movement) acceleration from
 * `accelerationIncludingGravity` by subtracting a low-pass gravity estimate,
 * returning the movement vector and the updated estimate. This is the fallback for
 * devices whose gravity-removed `DeviceMotionEvent.acceleration` is null.
 *
 * A static tilt is constant, so it is absorbed into the gravity estimate and
 * excluded from the movement — preserving "shake the box, don't tilt it." `alpha`
 * is the estimate's retention (0..1): higher tracks gravity more slowly, so more of
 * a sustained push survives as movement. The first sample seeds the estimate
 * directly so there is no startup transient.
 */
export function dynamicAccelFromTotal(
  total: SensorAcceleration,
  gravity: GravityEstimate,
  alpha: number,
): { linear: SensorAcceleration; gravity: GravityEstimate } {
  const tx = total.x ?? 0
  const ty = total.y ?? 0
  const tz = total.z ?? 0
  const next: GravityEstimate = gravity.initialized
    ? {
        x: alpha * gravity.x + (1 - alpha) * tx,
        y: alpha * gravity.y + (1 - alpha) * ty,
        z: alpha * gravity.z + (1 - alpha) * tz,
        initialized: true,
      }
    : { x: tx, y: ty, z: tz, initialized: true }
  return {
    linear: { x: tx - next.x, y: ty - next.y, z: tz - next.z },
    gravity: next,
  }
}
