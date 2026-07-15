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
 * onto — the height a grabbed die hovers at. This is a client input-mapping
 * height, not the server drag-target height.
 * - `2.0` (current): a grabbed d6 rises ~1.5 U off the table — a clear pickup that
 *   lifts the die above the settled pile. Well above the tallest die's resting
 *   center (~0.8 U for the d20) so nothing is pulled into the floor.
 */
export const DRAG_PLANE_HEIGHT = 2.0

/**
 * Number of recent position+timestamp samples the client keeps during a drag to
 * compute the release throw velocity (sent to the room as `velocityHistory`).
 * - `5` (current): good balance. `10` smoother but laggier; `3` more immediate.
 */
export const VELOCITY_HISTORY_SIZE = 5

// ============================================================================
// DEVICE MOTION (sensor scaling & shake detection — client)
// ============================================================================

/**
 * Scale mapping the phone's linear acceleration (m/s²) to the engine-unit motion
 * field (U/s²) — the continuous "shake your dice box" pseudo-force the room applies
 * to the local player's own dice (Shared-ADR-010). This is the tunable feel knob:
 * the full physical scale is 62.5 U/m, and the engine runs at ≈0.39× real gravity
 * (−240 vs −613 U/s²), so ~25 keeps the shake proportional to the engine's floaty
 * feel rather than overpowering it. The room re-clamps to its authoritative
 * `motionFieldMaxAccel`, so this only shapes feel, never safety.
 * - `25` (current): a lively but controllable box. Higher = more violent slides;
 *   lower = subtler. Recommended `10` (gentle) – `62.5` (full physical scale).
 */
export const MOTION_ACCEL_SCALE = 25

/**
 * Minimum linear-acceleration magnitude (m/s²) that registers as motion, filtering
 * hand tremors and sensor noise so a still — or statically tilted — phone produces
 * a zero field and the dice settle (Shared-ADR-010: shake the box, don't tilt it).
 * - `1.0` (current): filters small vibrations. `3.0` only large moves; `0.5` very sensitive.
 */
export const MOTION_DEADZONE = 1.0

/**
 * Low-pass retention (0..1) for the gravity estimate used to recover movement
 * acceleration on devices whose gravity-removed `DeviceMotionEvent.acceleration`
 * channel is null (common on Android). The estimate follows `alpha·prev + (1−alpha)·
 * total`; movement = total − estimate. Higher = slower to follow, so a static tilt is
 * absorbed (excluded) while a sustained push survives longer.
 * - `0.8` (current): the standard Android gravity-filter constant at ~60 Hz.
 *   Recommended `0.7`–`0.9`.
 */
export const MOTION_GRAVITY_LOWPASS = 0.8

/**
 * Minimum acceleration magnitude (m/s²) that flags a shake for UI feedback
 * (DeviceMotionButton's "Shaking!" indicator). This is NOT a physics input — the
 * continuous field drives the dice; this only lights up the UI.
 * - `20` (current): moderate. `30` needs hard shaking; `10` triggers on light shakes.
 */
export const SHAKE_THRESHOLD = 20

/**
 * Duration (ms) the shake UI state persists after detection, preventing flicker.
 * - `500` (current): half-second. `1000` full second; `250` quick re-shake.
 */
export const SHAKE_DURATION = 500

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
 * Impact speed (engine U/s) mapping a room `dice_knocked` event to a *medium*
 * haptic/SFX pulse. In a room there is no client physics, so impact strength comes
 * from the server-reported `impactSpeed` (a die's linear speed at the knock, in
 * the engine's U/s — 62.5 U = 1 m). Below this: light; at/above: medium.
 * - `26.25` (current): a firm nudge — 0.12 × the engine velocity cap
 *   (`maxDiceVelocity` = 218.75 U/s), ≈ 1.65× the 15.9 U/s knock-wake floor, so the
 *   softest knocks stay light. A client haptic tier boundary (a client concern per
 *   Shared-ADR-007), expressed in the shared U/s unit; rescaled from the old 3.0
 *   when impact speeds were in old units (≈0.05 m). Recommended `0.10`–`0.15` × cap.
 */
export const COLLISION_IMPACT_MEDIUM_SPEED = 26.25

/**
 * Impact speed (engine U/s) mapping a room `dice_knocked` event to a *strong*
 * pulse — a hard cross-player smack. At/above this: strong.
 * - `61.25` (current): a solid throw connecting — 0.28 × the engine velocity cap
 *   (218.75 U/s), ≈ 3.85× the 15.9 U/s knock-wake floor. Same rescale/rationale as
 *   `COLLISION_IMPACT_MEDIUM_SPEED`. Recommended `0.25`–`0.35` × cap.
 */
export const COLLISION_IMPACT_STRONG_SPEED = 61.25

// ============================================================================
// MULTIPLAYER INPUT THROTTLES & MOTION SEND POLICY (client)
// ============================================================================

/**
 * Interval (ms) at which the client sends `drag_move` messages during a drag.
 * - `33` ≈ 30Hz (current): balances responsiveness and bandwidth.
 */
export const MULTIPLAYER_DRAG_THROTTLE_MS = 33

/**
 * Interval (ms) between `motion_field` messages the client streams while device
 * motion is engaged. A client-side send throttle so a moving phone does not flood
 * the socket; the room latches the last field and integrates it every tick, with
 * its own authoritative staleness (`motionFieldStaleMs`) and magnitude clamp
 * (`motionFieldMaxAccel`) defined once in `dicesuki-core` and delivered via
 * `EngineConfig`.
 * - `33` ≈ 30Hz (current): smooth for a continuous field. Recommended `33` (30Hz) –
 *   `100` (10Hz).
 */
export const MOTION_FIELD_SEND_THROTTLE_MS = 33
