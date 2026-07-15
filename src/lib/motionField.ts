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
