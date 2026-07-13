/**
 * Client-side interaction & feedback configuration.
 *
 * # No engine constants here (epic #111, Shared-ADR-007)
 *
 * The physics-*engine* constants (gravity, restitution/friction, roll impulse &
 * torque, settle thresholds, arena bounds, drag/throw response) used to live here
 * and be "manually kept in sync" with the Rust server (Shared-ADR-003). That
 * regime is retired: those constants now live **once** in `dicesuki-core`
 * (`server/core/src/physics.rs`), reach the native server and the in-browser wasm
 * room from that single source, and — where the browser genuinely needs one at
 * runtime (arena bounds for camera fit / wall rendering) — arrive via the room's
 * `EngineConfig` (see `src/config/engineConfig.ts`), never a copied literal.
 *
 * What remains here is purely **client-side**: rendering/geometry detail, device-
 * motion sensor scaling, haptic thresholds, and input/message throttles — none of
 * which the physics engine consumes. (The deprecated client `<Physics>` path's
 * leftover engine constants live, quarantined, in `legacyClientPhysics.ts` until
 * issue #115 deletes them with the rest of client physics.)
 *
 * General guidance: lower = subtler, higher = more dramatic; tune in ±10–20% steps.
 */

// ============================================================================
// GEOMETRY SETTINGS
// ============================================================================

/**
 * Subdivision detail level for polyhedral dice meshes (render only).
 * - `0` (current): sharp edges, cheapest. `1` balances; `2` is very smooth/expensive.
 */
export const POLYHEDRON_DETAIL_LEVEL = 0

// ============================================================================
// DRAG INPUT (client raycast / velocity sampling)
// ============================================================================

/**
 * Y-coordinate (world units) of the invisible plane a pointer drag is raycast
 * onto. This is a client input-mapping height, not the server drag-target height.
 * - `2.0` (current): natural above-table feel. `3.0` higher; `1.0` near the table.
 */
export const DRAG_PLANE_HEIGHT = 2

/**
 * Number of recent position+timestamp samples the client keeps during a drag to
 * compute the release throw velocity (sent to the room as `velocityHistory`).
 * - `5` (current): good balance. `10` smoother but laggier; `3` more immediate.
 */
export const VELOCITY_HISTORY_SIZE = 5

// ============================================================================
// DEVICE MOTION (Tilt & Shake sensor scaling — client)
// ============================================================================

/**
 * Scale factor mapping device tilt angle to an effective-gravity force.
 * - `15` (current): strong tilt response. `25` very responsive; `5` subtle.
 */
export const GRAVITY_SCALE = 15

/**
 * Scale factor for the linear-acceleration pseudo-force when the phone moves.
 * - `15` (current): moderate. `25` high sensitivity; `5` low.
 */
export const ACCELERATION_SCALE = 15

/**
 * Minimum acceleration magnitude (m/s²) to detect a shake.
 * - `20` (current): moderate. `30` needs hard shaking; `10` triggers on light shakes.
 */
export const SHAKE_THRESHOLD = 20

/**
 * Duration (ms) the shake state persists after detection, preventing rapid retrigger.
 * - `500` (current): half-second cooldown. `1000` full second; `250` quick re-shake.
 */
export const SHAKE_DURATION = 500

/**
 * Minimum tilt (m/s²) to register as an actual tilt, filtering sensor noise.
 * - `2.0` (current): filters minor jitter. `5.0` needs significant tilt; `0.5` very sensitive.
 */
export const TILT_DEADZONE = 2.0

/**
 * Minimum linear acceleration (m/s²) to register, filtering hand tremors.
 * - `1.0` (current): filters small vibrations. `3.0` only large moves; `0.5` very sensitive.
 */
export const ACCELERATION_DEADZONE = 1.0

/**
 * Throttle (ms) for UI updates driven by motion events (perf).
 * - `100` (current): ~10fps UI. `50` smoother/more CPU; `200` more performant.
 */
export const UI_UPDATE_THROTTLE = 100

// ============================================================================
// HAPTIC FEEDBACK (client vibration mapping)
// ============================================================================

/**
 * Minimum speed (units/s) required to trigger haptic feedback.
 * - `1.0` (current): only meaningful movement. `0.2` gentler bumps; higher = only fast hits.
 */
export const HAPTIC_MIN_SPEED = 1.0

/**
 * Minimum velocity change (units/s) to detect an impact from deceleration.
 * - `0.5` (current): moderate impacts. `1.0` only strong; `0.3` gentle collisions.
 */
export const HAPTIC_MIN_VELOCITY_CHANGE = 0.5

/**
 * Dot-product threshold: contact force must oppose velocity to count as an impact.
 * - `-0.5` (current): force must strongly oppose motion. `-0.1` more triggers; `-0.3` middle.
 */
export const HAPTIC_FORCE_DIRECTION_THRESHOLD = -0.5

/**
 * Minimum contact-force magnitude to trigger any haptic (filters friction/weak contacts).
 * - `50` (current). Higher = only significant impacts; lower = more sensitive.
 */
export const HAPTIC_MIN_FORCE = 50

/**
 * Force above which the direction check is bypassed (lets wall hits vibrate).
 * - `30` (current): good wall vs dice-to-dice split. `40` conservative; `20` lenient.
 */
export const HAPTIC_HIGH_FORCE_BYPASS = 30

/**
 * Force threshold for a *light* vibration; below it, no vibration.
 * - `75` (current). Higher = fewer light taps; lower = more sensitive.
 */
export const HAPTIC_LIGHT_THRESHOLD = 75

/**
 * Force threshold for a *medium* vibration; below it, light.
 * - `100` (current). Higher = harder impacts only; lower = more medium buzzes.
 */
export const HAPTIC_MEDIUM_THRESHOLD = 100

/**
 * Vibration duration (ms) for light impacts.
 * - `1` (current): very subtle tap.
 */
export const HAPTIC_LIGHT_DURATION = 1

/**
 * Vibration duration (ms) for medium impacts.
 * - `15` (current): noticeable bump.
 */
export const HAPTIC_MEDIUM_DURATION = 15

/**
 * Vibration duration (ms) for strong impacts.
 * - `75` (current): strong impact feel.
 */
export const HAPTIC_STRONG_DURATION = 75

/**
 * Minimum time (ms) between haptic triggers, preventing vibration spam.
 * - `100` (current): up to 10/s. `50` up to 20/s; `30` may feel buzzy.
 */
export const HAPTIC_THROTTLE_MS = 100

// ============================================================================
// MULTIPLAYER COLLISION FEEDBACK (client haptic/SFX mapping)
// ============================================================================

/**
 * Impact speed (m/s) mapping a room `dice_knocked` event to a *medium* haptic/SFX
 * pulse. In a room there is no client physics, so impact strength comes from the
 * server-reported `impactSpeed`. Below this: light; at/above: medium.
 * - `3.0` (current): a firm nudge.
 */
export const COLLISION_IMPACT_MEDIUM_SPEED = 3.0

/**
 * Impact speed (m/s) mapping a room `dice_knocked` event to a *strong* pulse — a
 * hard cross-player smack. At/above this: strong.
 * - `7.0` (current): a solid throw connecting.
 */
export const COLLISION_IMPACT_STRONG_SPEED = 7.0

// ============================================================================
// MULTIPLAYER INPUT THROTTLES & MOTION SEND POLICY (client)
// ============================================================================

/**
 * Interval (ms) at which the client sends `drag_move` messages during a drag.
 * - `33` ≈ 30Hz (current): balances responsiveness and bandwidth.
 */
export const MULTIPLAYER_DRAG_THROTTLE_MS = 33

/**
 * Minimum interval (ms) between `motion_impulse` messages the client sends. A
 * client-side send throttle so a shaking phone does not flood the socket; the
 * room's authoritative rate-limit (`motionImpulseMinIntervalMs`) is defined in
 * `dicesuki-core` and delivered via `EngineConfig`.
 * - `50` ≈ 20Hz (current). Recommended `33` (30Hz) – `100` (10Hz).
 */
export const MOTION_IMPULSE_MIN_INTERVAL_MS = 50

/**
 * Magnitude (world units) the client clamps a shake impulse to before sending, so
 * it never emits an impulse the room would scale down anyway. Mirrors the room's
 * authoritative clamp (`motionImpulseMaxMagnitude`), which is defined once in
 * `dicesuki-core` and delivered via `EngineConfig`.
 * - `30` (current). Recommended `15` (gentle) – `40` (energetic).
 */
export const MOTION_IMPULSE_MAX_MAGNITUDE = 30

/**
 * Upward (world +Y) component of a shake-to-roll impulse. Mostly upward so dice
 * hop off the table and tumble, mirroring the single-player shake feel.
 * - `4` (current): a firm toss that clears the tray. Recommended `3`–`6`.
 */
export const SHAKE_IMPULSE_VERTICAL = 4

/**
 * Scale applied to the sensor's effective-gravity horizontal (X/Z) components when
 * mapping a shake to a world-space impulse, giving horizontal energy in the shake
 * direction. - `0.3` (current). Recommended `0.2` (subtle) – `0.5` (skittery).
 */
export const SHAKE_IMPULSE_HORIZONTAL_SCALE = 0.3

/**
 * Peak random horizontal jitter (world units) added to each shake impulse so
 * identically-stacked dice scatter instead of translating in lockstep. Applied as
 * `(rng() - 0.5) * 2 * SHAKE_IMPULSE_JITTER` on X and Z.
 * - `1.5` (current). Recommended `0` (deterministic) – `3` (chaotic).
 */
export const SHAKE_IMPULSE_JITTER = 1.5
