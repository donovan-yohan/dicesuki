/**
 * Per-client view rotation (Shared-ADR-009): a local, view-only rotation of the
 * shared world in 90° steps. It changes only this client's camera — never the
 * shared simulation or other clients. Degrees are clockwise on screen.
 */
export type ViewRotation = 0 | 90 | 180 | 270

export const VIEW_ROTATIONS: ViewRotation[] = [0, 90, 180, 270]

/** Coerce an arbitrary value to a valid {@link ViewRotation} (default 0). */
export function normalizeViewRotation(value: unknown): ViewRotation {
  const n = Number(value)
  return VIEW_ROTATIONS.includes(n as ViewRotation) ? (n as ViewRotation) : 0
}

/** The next rotation clockwise (…→0→90→180→270→0…). */
export function rotateCW(current: ViewRotation): ViewRotation {
  return ((current + 90) % 360) as ViewRotation
}

/** The next rotation counter-clockwise. */
export function rotateCCW(current: ViewRotation): ViewRotation {
  return ((current + 270) % 360) as ViewRotation
}

/** True when the rotation swaps the screen axes (90° / 270°). */
export function swapsAxes(rotation: ViewRotation): boolean {
  return rotation === 90 || rotation === 270
}

/**
 * Rotate a world vector's horizontal (X/Z) components by `degrees` about the +Y
 * axis (right-handed), leaving Y untouched.
 *
 * Used to align a client's device-motion impulse with its rotated view so a "tilt
 * right" still tosses dice toward screen-right. The sign matches the camera's
 * `rotateOnWorldAxis(+Y, degrees)` spin, so applying the SAME `viewRotation` to
 * both keeps input and view consistent (e.g. at 90° screen-right is world −Z, and
 * `rotateXZ([1,0,0], 90) = [0,0,-1]`).
 */
export function rotateXZ(
  vec: [number, number, number],
  degrees: number,
): [number, number, number] {
  const r = (degrees * Math.PI) / 180
  const c = Math.cos(r)
  const s = Math.sin(r)
  const [x, y, z] = vec
  return [x * c + z * s, y, -x * s + z * c]
}
