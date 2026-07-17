/**
 * Per-player device-motion field (Shared-ADR-010).
 *
 * The room applies a continuous per-die acceleration — the non-inertial
 * pseudo-force of the player's "dice box" — to the sender's own dice each tick.
 * This combines the phone's LINEAR acceleration with a gravity-direction
 * correction derived from fused device orientation. Both terms travel through the
 * same per-player field, so tilt and shake remain scoped to the sender's dice and
 * never mutate the room's shared world gravity.
 */

/** World-space acceleration `[x, y, z]` (engine U/s²) sent as `motion_field`. */
export type MotionField = [number, number, number]
export type AngularMotionField = [number, number, number]

/** Nullable sensor triple, matching `DeviceMotionEvent.acceleration`. */
export interface SensorAcceleration {
  x: number | null
  y: number | null
  z: number | null
}

/** Fused device orientation angles from `DeviceOrientationEvent`. */
export interface SensorOrientation {
  beta?: number | null
  gamma?: number | null
}

/** Nullable device rotation-rate channels (degrees/s). */
export interface SensorRotationRate {
  alpha: number | null
  beta: number | null
  gamma: number | null
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
 * Derive a world-space tumble acceleration exclusively from the current dynamic
 * (gravity-removed/high-pass) linear-acceleration sample. Rotation rate may choose
 * an axis when available, but never creates or sizes a tumble by itself; fused
 * orientation is deliberately absent from this API.
 *
 * Without a usable rotation rate, the axis is perpendicular to horizontal hand
 * movement. A deterministic X axis handles a purely vertical shake, where that
 * cross product is undefined.
 */
export function computeShakeAngularAcceleration(
  linear: SensorAcceleration | null | undefined,
  rotationRate: SensorRotationRate | null | undefined,
  scale: number,
  deadzone: number,
): AngularMotionField {
  if (!linear) return [0, 0, 0]
  const ax = linear.x ?? 0
  const ay = linear.y ?? 0
  const az = linear.z ?? 0
  const magnitude = Math.hypot(ax, ay, az)
  if (!Number.isFinite(magnitude) || magnitude <= deadzone) return [0, 0, 0]

  const angularMagnitude = (magnitude - deadzone) * scale
  if (rotationRate) {
    // Device beta/gamma/alpha are rotations about device X/Y/Z. Map them to the
    // engine axes consistently with the sensor field before normalizing.
    const mapped = [
      -(rotationRate.beta ?? 0),
      -(rotationRate.alpha ?? 0),
      rotationRate.gamma ?? 0,
    ] as const
    const rateMagnitude = Math.hypot(...mapped)
    if (Number.isFinite(rateMagnitude) && rateMagnitude > 1e-3) {
      return mapped.map(
        (component) => component === 0
          ? 0
          : component / rateMagnitude * angularMagnitude,
      ) as AngularMotionField
    }
  }

  // Dynamic device acceleration maps to world horizontal `[-ax, ay]`; this is
  // its perpendicular `[worldZ, -worldX]` tumble axis.
  const horizontalAxis: AngularMotionField = [ay, 0, ax]
  const axisMagnitude = Math.hypot(...horizontalAxis)
  if (axisMagnitude > 1e-6) {
    return horizontalAxis.map(
      (component) => component / axisMagnitude * angularMagnitude,
    ) as AngularMotionField
  }
  return [angularMagnitude, 0, 0]
}

/** Add independently-derived tilt and linear-acceleration field terms. */
export function combineMotionFields(a: MotionField, b: MotionField): MotionField {
  return [a[0] + b[0], a[1] + b[1], a[2] + b[2]]
}

/**
 * Convert fused device orientation into the per-die correction that redirects
 * the room's normal downward gravity toward the phone's physical down direction.
 *
 * `beta` and `gamma` follow the Device Orientation specification's intrinsic
 * Z-X'-Y'' rotations. Alpha is irrelevant to gravity. The resulting device-frame
 * gravity direction is mapped through the same device-to-world axes as linear
 * acceleration. Subtracting the shared `[0, gravity, 0]` vector makes a flat phone
 * produce exactly zero while a 90-degree tilt cancels downward gravity and replaces
 * it horizontally for only the targeted dice.
 */
export function computeTiltGravityCorrection(
  orientation: SensorOrientation | null | undefined,
  gravity: number,
  deadzoneDegrees: number,
): MotionField {
  if (!orientation || orientation.beta == null || orientation.gamma == null) {
    return [0, 0, 0]
  }

  const beta = orientation.beta * Math.PI / 180
  const gamma = orientation.gamma * Math.PI / 180

  // Unit gravity direction in the device's natural (normally portrait) frame.
  const deviceX = -Math.cos(beta) * Math.sin(gamma)
  const deviceY = Math.sin(beta)
  const deviceZ = Math.cos(beta) * Math.cos(gamma)
  const tiltAngle = Math.acos(Math.max(-1, Math.min(1, deviceZ)))
  const deadzone = Math.max(0, deadzoneDegrees) * Math.PI / 180
  if (tiltAngle <= deadzone) return [0, 0, 0]

  const magnitude = Math.abs(gravity)
  const desired: MotionField = [
    -deviceX * magnitude,
    -deviceZ * magnitude,
    deviceY * magnitude,
  ]

  return [desired[0], desired[1] - gravity, desired[2]]
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
 * excluded from the movement term. Tilt itself comes from fused device orientation;
 * this fallback only recovers translational acceleration. `alpha` is the estimate's
 * retention (0..1): higher tracks gravity more slowly, so more of a sustained push
 * survives as movement. The first sample seeds the estimate directly so there is no
 * startup transient.
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
