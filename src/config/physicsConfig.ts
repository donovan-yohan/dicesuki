/**
 * Physics Configuration
 *
 * Central configuration for all physics-related parameters in the dice simulator.
 * Organized by category for easy tweaking and tuning of game feel.
 *
 * General Guidelines:
 * - Lower values = more subtle/realistic behavior
 * - Higher values = more dramatic/arcade-like behavior
 * - Test changes incrementally (±10-20% adjustments recommended)
 */

// ============================================================================
// WORLD PHYSICS
// ============================================================================

/**
 * Standard gravity acceleration (m/s²)
 * - Earth standard: -9.81
 * - Lower: Floatier, slower falls (e.g., -5)
 * - Higher: Faster, snappier falls (e.g., -15)
 */
export const GRAVITY = -9.81

/**
 * Time step mode for physics simulation
 * - 'vary': Variable time step (adapts to frame rate, more stable)
 * - 'fixed': Fixed time step (predictable but can lag on slow devices)
 */
export const TIME_STEP_MODE = 'vary' as const

// ============================================================================
// DICE MATERIAL PROPERTIES
// ============================================================================

/**
 * Restitution (bounciness) of dice
 * - Range: 0.0 (no bounce) to 1.0 (perfect bounce)
 * - 0.3: Realistic dice behavior (some bounce, settles quickly)
 * - 0.5: Bouncy, takes longer to settle
 * - 0.1: Dead bounce, settles very fast
 */
export const DICE_RESTITUTION = 0.3

/**
 * Friction coefficient for dice surfaces
 * - Range: 0.0 (ice-like) to 1.0+ (very grippy)
 * - 0.6: Realistic plastic dice on wood/felt
 * - 0.8: High friction, slower rolling
 * - 0.3: Low friction, slides more
 */
export const DICE_FRICTION = 0.6

/**
 * Edge chamfer radius for rounded edges
 * - Applies to D6 collider physics shape
 * - 0.08: Subtle rounding (realistic)
 * - 0.12-0.15: Very smooth edges (easier rolling)
 * - 0.04-0.06: Slight chamfer (sharper edges)
 */
export const EDGE_CHAMFER_RADIUS = 0.08

// ============================================================================
// ROLL IMPULSE GENERATION
// ============================================================================

/**
 * Horizontal impulse strength range for button rolls
 * - Min/Max random range for XZ plane force
 * - Current: 2-5 units
 * - Higher: Dice travels farther horizontally
 * - Lower: Dice stays more centered
 */
export const ROLL_HORIZONTAL_MIN = 2
export const ROLL_HORIZONTAL_MAX = 5

/**
 * Upward impulse strength range for button rolls
 * - Min/Max random range for Y axis force
 * - Current: 5-8 units
 * - Higher: Dice flies higher, more tumbling
 * - Lower: Lower trajectory, faster settling
 */
export const ROLL_VERTICAL_MIN = 5
export const ROLL_VERTICAL_MAX = 8

// ============================================================================
// FACE DETECTION & REST STATE
// ============================================================================

/**
 * Linear velocity threshold for rest detection (m/s)
 * - Dice must be below this speed to be considered "at rest"
 * - 0.01: Very strict (waits until completely still)
 * - 0.05: Lenient (registers result while still moving slightly)
 * - Recommended: 0.01 for accuracy
 */
export const LINEAR_VELOCITY_THRESHOLD = 0.01

/**
 * Angular velocity threshold for rest detection (rad/s)
 * - Dice must be rotating slower than this to be "at rest"
 * - 0.01: Very strict (no rotation allowed)
 * - 0.05: Lenient (slight wobble OK)
 * - Recommended: 0.01 for clean results
 */
export const ANGULAR_VELOCITY_THRESHOLD = 0.01

/**
 * Duration dice must remain still before result registers (ms)
 * - Prevents false positives from brief stops during rolling
 * - 1000ms: Safe, prevents premature reads
 * - 500ms: Faster results, slight risk of misreads
 * - 1500ms: Very conservative, slower gameplay
 */
export const REST_DURATION_MS = 1000

// ============================================================================
// DRAG INTERACTION
// ============================================================================

/**
 * Base speed multiplier for drag following
 * - How aggressively dice follows cursor/touch
 * - 12: Responsive but smooth
 * - 20: Very snappy, immediate response
 * - 8: Slower, more laggy feel
 */
export const DRAG_FOLLOW_SPEED = 12

/**
 * Extra speed boost when dice is far from cursor
 * - Multiplier added to base speed at max distance
 * - 2.5: Moderate boost for overshooting
 * - 5.0: Aggressive catch-up, lots of overshoot
 * - 1.0: Minimal boost, less overshoot
 */
export const DRAG_DISTANCE_BOOST = 2.5

/**
 * Distance threshold where boost starts applying (world units)
 * - Below this distance: normal speed
 * - Above this distance: boost kicks in
 * - 3.0: Medium threshold
 * - 5.0: Only boosts when very far
 * - 1.0: Always boosting (even when close)
 */
export const DRAG_DISTANCE_THRESHOLD = 3

/**
 * How much drag movement induces rotational spin
 * - Torque impulse strength from cursor movement
 * - 0.33: Subtle spin from dragging
 * - 1.0: Dramatic tumbling while dragging
 * - 0.0: No spin induced (dice stays oriented)
 */
export const DRAG_SPIN_FACTOR = 0.33

/**
 * How much drag movement induces rolling motion towards cursor
 * - Creates "ball rolling on surface" effect
 * - 2.0: Natural rolling motion
 * - 4.0: Aggressive rolling
 * - 0.0: No rolling (only tumbling from DRAG_SPIN_FACTOR)
 */
export const DRAG_ROLL_FACTOR = 0.5

/**
 * Y-coordinate of invisible drag plane (world units)
 * - Height above table where dragging occurs
 * - 2.0: Above table, natural feel
 * - 3.0: Higher up, more dramatic
 * - 1.0: Closer to table surface
 */
export const DRAG_PLANE_HEIGHT = 2

// ============================================================================
// THROW MECHANICS (Release from drag)
// ============================================================================

/**
 * Scale factor for throw velocity on release
 * - Multiplies calculated velocity from drag motion
 * - 0.8: Slightly dampened (realistic)
 * - 1.0: No dampening (1:1 motion)
 * - 0.5: Very dampened (gentle throws)
 */
export const THROW_VELOCITY_SCALE = 0.8

/**
 * Upward boost added to throw velocity (world units/s)
 * - Extra Y velocity for dynamic throws
 * - 3.0: Moderate upward arc
 * - 5.0: High arcing throws
 * - 0.0: Horizontal throws only
 */
export const THROW_UPWARD_BOOST = 3

/**
 * Minimum throw speed to register as throw (world units/s)
 * - Below this: drop in place, no throw
 * - 2.0: Easy to trigger throws
 * - 5.0: Requires fast swipe to throw
 */
export const MIN_THROW_SPEED = 2

/**
 * Maximum throw velocity cap (world units/s)
 * - Prevents unrealistic fast throws
 * - 20: Reasonable max speed
 * - 30: Allow very fast throws
 * - 15: Cap throws lower
 */
export const MAX_THROW_SPEED = 20

/**
 * Number of position samples for velocity calculation
 * - More samples = smoother but less responsive
 * - 5: Good balance
 * - 10: Very smooth, might feel laggy
 * - 3: More immediate, less smooth
 */
export const VELOCITY_HISTORY_SIZE = 5

// ============================================================================
// DEVICE MOTION (Tilt & Shake)
// ============================================================================

/**
 * Scale factor for device tilt to gravity force
 * - Multiplies tilt angle to physics gravity
 * - 15: Strong tilt response
 * - 25: Very responsive to tilting
 * - 5: Subtle tilt effect
 */
export const GRAVITY_SCALE = 15

/**
 * Scale factor for linear acceleration effects
 * - Pseudo-force when phone moves/accelerates
 * - 15: Moderate acceleration response
 * - 25: High sensitivity to phone movement
 * - 5: Low sensitivity
 */
export const ACCELERATION_SCALE = 15

/**
 * Minimum acceleration magnitude to detect shake (m/s²)
 * - Higher = harder to trigger shake
 * - 20: Moderate shake threshold
 * - 30: Hard shaking required
 * - 10: Light shaking triggers
 */
export const SHAKE_THRESHOLD = 20

/**
 * Duration shake state persists after detection (ms)
 * - Prevents rapid re-triggering
 * - 500ms: Half second cooldown
 * - 1000ms: Full second cooldown
 * - 250ms: Quick re-shake allowed
 */
export const SHAKE_DURATION = 500

/**
 * Minimum tilt to register as actual tilt (m/s²)
 * - Filters sensor noise when phone is still
 * - 2.0: Filters minor jitter
 * - 5.0: Requires significant tilt
 * - 0.5: Very sensitive to slight tilts
 */
export const TILT_DEADZONE = 2.0

/**
 * Minimum linear acceleration to register (m/s²)
 * - Filters hand tremors and minor movements
 * - 1.0: Filters small vibrations
 * - 3.0: Only large movements register
 * - 0.5: Very sensitive
 */
export const ACCELERATION_DEADZONE = 1.0

/**
 * Throttle UI updates from motion events (ms)
 * - Limits UI re-renders for performance
 * - 100ms: 10fps UI updates (good balance)
 * - 50ms: 20fps UI updates (smoother, more CPU)
 * - 200ms: 5fps UI updates (more performant)
 */
export const UI_UPDATE_THROTTLE = 100

// ============================================================================
// GEOMETRY SETTINGS
// ============================================================================

/**
 * Subdivision detail level for polyhedral dice
 * - Higher = smoother edges but more vertices
 * - 1: Good balance (current setting)
 * - 2: Very smooth, more expensive
 * - 0: Sharp edges, cheapest
 */
export const POLYHEDRON_DETAIL_LEVEL = 0

// ============================================================================
// PRESETS (Quick configs for different feels)
// ============================================================================

/**
 * Preset configurations for different gameplay styles
 * Uncomment and export to use
 */

// REALISTIC - Simulates real dice on felt table
export const PRESET_REALISTIC = {
  DICE_RESTITUTION: 0.25,
  DICE_FRICTION: 0.7,
  ROLL_HORIZONTAL_MIN: 1.5,
  ROLL_HORIZONTAL_MAX: 3,
  ROLL_VERTICAL_MIN: 4,
  ROLL_VERTICAL_MAX: 6,
  DRAG_FOLLOW_SPEED: 10,
  REST_DURATION_MS: 1200,
} as const

// ARCADE - Fast, snappy, responsive
export const PRESET_ARCADE = {
  DICE_RESTITUTION: 0.4,
  DICE_FRICTION: 0.5,
  ROLL_HORIZONTAL_MIN: 3,
  ROLL_HORIZONTAL_MAX: 6,
  ROLL_VERTICAL_MIN: 6,
  ROLL_VERTICAL_MAX: 10,
  DRAG_FOLLOW_SPEED: 18,
  REST_DURATION_MS: 800,
} as const

// GENTLE - Slow, careful, precise
export const PRESET_GENTLE = {
  DICE_RESTITUTION: 0.2,
  DICE_FRICTION: 0.8,
  ROLL_HORIZONTAL_MIN: 1,
  ROLL_HORIZONTAL_MAX: 2.5,
  ROLL_VERTICAL_MIN: 3,
  ROLL_VERTICAL_MAX: 5,
  DRAG_FOLLOW_SPEED: 8,
  REST_DURATION_MS: 1500,
} as const
