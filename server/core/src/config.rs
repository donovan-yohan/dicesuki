//! Engine configuration surface (epic #111, Shared-ADR-007).
//!
//! [`EngineConfig`] is the **runtime projection of the engine physics constants**
//! defined once in [`crate::physics`]. It is how the browser obtains any engine
//! value it genuinely needs at runtime — arena bounds for camera fit and wall
//! rendering, the motion-impulse clamp/rate-limit the client mirrors — *without a
//! copied literal*:
//!
//! - the native server and the wasm room both attach [`EngineConfig::current`] to
//!   every `room_state` message (`ServerMessage::RoomState.config`), and
//! - the wasm module additionally exposes it before any room exists via the
//!   `engine_config_json()` `wasm-bindgen` getter (`server/wasm`).
//!
//! Because every field is built straight from the `physics` constants, editing a
//! constant there changes what both build targets serialize here — the single
//! source of truth the epic requires, enforced by [`tests`].

use serde::Serialize;

use crate::physics;

/// A snapshot of the engine physics constants the client consumes at runtime.
///
/// Field names serialize to camelCase to match the WebSocket JSON protocol
/// (Shared-ADR-002). Every engine-feel value is shared by all rooms; only the
/// arena footprint (`arenaHalfX`/`arenaHalfZ`) varies per room, so a room ships
/// [`EngineConfig::for_arena`] with its actual bounds on `room_state.config` —
/// [`crate::physics::ArenaBounds::default`] (9:16) for the native multiplayer
/// server, an aspect-fit for the in-browser solo room. [`EngineConfig::current`]
/// is the default-arena projection used before any room exists (the wasm
/// pre-join getter).
#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct EngineConfig {
    // World
    pub gravity: f32,

    // Material
    pub dice_restitution: f32,
    pub dice_friction: f32,

    // Settle / knock detection
    pub linear_velocity_threshold: f32,
    pub angular_velocity_threshold: f32,
    pub rest_duration_ms: u64,
    pub knock_wake_linear_speed: f32,
    pub knock_wake_angular_speed: f32,

    // Roll impulse + spin (the roll-feel truth)
    pub roll_horizontal_min: f32,
    pub roll_horizontal_max: f32,
    pub roll_vertical_min: f32,
    pub roll_vertical_max: f32,
    pub roll_torque_magnitude: f32,

    // Throw mechanics
    pub throw_velocity_scale: f32,
    pub throw_upward_boost: f32,
    pub min_throw_speed: f32,
    pub max_throw_speed: f32,
    pub max_dice_velocity: f32,

    // Drag response (server-side)
    pub drag_follow_speed: f32,
    pub drag_distance_boost: f32,
    pub drag_distance_threshold: f32,
    pub drag_spin_factor: f32,
    pub drag_roll_factor: f32,

    // Device-motion field (Shared-ADR-010; mirrored client-side)
    pub motion_field_max_accel: f32,
    pub motion_field_max_angular_accel: f32,
    pub motion_field_max_angular_speed: f32,
    pub motion_field_stale_ms: u64,

    // Arena bounds (per room: default 9:16 portrait, aspect-fit for solo)
    pub arena_half_x: f32,
    pub arena_half_z: f32,
    pub arena_ground_y: f32,
    pub arena_ceiling_y: f32,
    pub arena_wall_height: f32,
    pub arena_wall_thickness: f32,
}

impl EngineConfig {
    /// Build the config from the live [`crate::physics`] constants. This is the
    /// only constructor: every field reads its constant directly, so the config
    /// can never drift from what the physics world actually uses.
    #[must_use]
    pub fn current() -> Self {
        Self {
            gravity: physics::GRAVITY,

            dice_restitution: physics::DICE_RESTITUTION,
            dice_friction: physics::DICE_FRICTION,

            linear_velocity_threshold: physics::LINEAR_VELOCITY_THRESHOLD,
            angular_velocity_threshold: physics::ANGULAR_VELOCITY_THRESHOLD,
            rest_duration_ms: physics::REST_DURATION_MS,
            knock_wake_linear_speed: physics::KNOCK_WAKE_LINEAR_SPEED,
            knock_wake_angular_speed: physics::KNOCK_WAKE_ANGULAR_SPEED,

            roll_horizontal_min: physics::ROLL_HORIZONTAL_MIN,
            roll_horizontal_max: physics::ROLL_HORIZONTAL_MAX,
            roll_vertical_min: physics::ROLL_VERTICAL_MIN,
            roll_vertical_max: physics::ROLL_VERTICAL_MAX,
            roll_torque_magnitude: physics::ROLL_TORQUE_MAGNITUDE,

            throw_velocity_scale: physics::THROW_VELOCITY_SCALE,
            throw_upward_boost: physics::THROW_UPWARD_BOOST,
            min_throw_speed: physics::MIN_THROW_SPEED,
            max_throw_speed: physics::MAX_THROW_SPEED,
            max_dice_velocity: physics::MAX_DICE_VELOCITY,

            drag_follow_speed: physics::DRAG_FOLLOW_SPEED,
            drag_distance_boost: physics::DRAG_DISTANCE_BOOST,
            drag_distance_threshold: physics::DRAG_DISTANCE_THRESHOLD,
            drag_spin_factor: physics::DRAG_SPIN_FACTOR,
            drag_roll_factor: physics::DRAG_ROLL_FACTOR,

            motion_field_max_accel: physics::MOTION_FIELD_MAX_ACCEL,
            motion_field_max_angular_accel: physics::MOTION_FIELD_MAX_ANGULAR_ACCEL,
            motion_field_max_angular_speed: physics::MOTION_FIELD_MAX_ANGULAR_SPEED,
            motion_field_stale_ms: physics::MOTION_FIELD_STALE_MS,

            arena_half_x: physics::WALL_HALF_X,
            arena_half_z: physics::WALL_HALF_Z,
            arena_ground_y: physics::GROUND_Y,
            arena_ceiling_y: physics::CEILING_Y,
            arena_wall_height: physics::WALL_HEIGHT,
            arena_wall_thickness: physics::WALL_THICKNESS,
        }
    }

    /// [`EngineConfig::current`] with the arena footprint replaced by `bounds`.
    ///
    /// Every engine constant is shared by all rooms; only the arena's X/Z
    /// half-extents vary per room (Shared-ADR-007). A [`crate::room::Room`] builds
    /// its `room_state.config` from this so the client receives the ACTUAL walls
    /// its room simulates — [`crate::physics::ArenaBounds::default`] for the fixed
    /// multiplayer arena, an aspect-fitted footprint for the in-browser solo room.
    #[must_use]
    pub fn for_arena(bounds: &physics::ArenaBounds) -> Self {
        Self {
            arena_half_x: bounds.half_x,
            arena_half_z: bounds.half_z,
            ..Self::current()
        }
    }

    /// Serialize the current config to a JSON string. Used by the wasm getter and
    /// handy for tests.
    #[must_use]
    pub fn current_json() -> String {
        serde_json::to_string(&Self::current()).expect("EngineConfig serializes")
    }
}

impl Default for EngineConfig {
    fn default() -> Self {
        Self::current()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// The config is a faithful projection of the physics constants: a change to
    /// a constant is a change to what both build targets serialize. This is the
    /// crate-level half of the epic's "one constant change touches nothing else"
    /// invariant — the client's guard test is the other half.
    #[test]
    fn engine_config_reflects_physics_constants() {
        let c = EngineConfig::current();
        assert!((c.gravity - physics::GRAVITY).abs() < f32::EPSILON);
        assert!((c.dice_restitution - physics::DICE_RESTITUTION).abs() < f32::EPSILON);
        assert!((c.dice_friction - physics::DICE_FRICTION).abs() < f32::EPSILON);
        assert!((c.roll_torque_magnitude - physics::ROLL_TORQUE_MAGNITUDE).abs() < f32::EPSILON);
        assert!((c.drag_roll_factor - physics::DRAG_ROLL_FACTOR).abs() < f32::EPSILON);
        assert!((c.arena_half_x - physics::WALL_HALF_X).abs() < f32::EPSILON);
        assert!((c.arena_half_z - physics::WALL_HALF_Z).abs() < f32::EPSILON);
        assert_eq!(c.rest_duration_ms, physics::REST_DURATION_MS);
        assert!(
            (c.motion_field_max_accel - physics::MOTION_FIELD_MAX_ACCEL).abs() < f32::EPSILON
        );
        assert!((c.motion_field_max_angular_accel
            - physics::MOTION_FIELD_MAX_ANGULAR_ACCEL).abs() < f32::EPSILON);
        assert!((c.motion_field_max_angular_speed
            - physics::MOTION_FIELD_MAX_ANGULAR_SPEED).abs() < f32::EPSILON);
        assert_eq!(c.motion_field_stale_ms, physics::MOTION_FIELD_STALE_MS);
    }

    /// `current()` must remain the fixed default arena: it is what the wasm
    /// pre-join `engine_config_json()` getter and the native server both project,
    /// so the drift guard above stays meaningful when per-room bounds exist.
    #[test]
    fn engine_config_current_still_defaults_to_the_fixed_arena() {
        let c = EngineConfig::current();
        assert!((c.arena_half_x - physics::WALL_HALF_X).abs() < f32::EPSILON);
        assert!((c.arena_half_z - physics::WALL_HALF_Z).abs() < f32::EPSILON);
    }

    /// `for_arena` overrides ONLY the arena footprint; every other engine constant
    /// still comes from `current()`. This is what lets a room ship its actual walls
    /// on `room_state.config` without forking any physics-feel value.
    #[test]
    fn engine_config_for_arena_overrides_only_bounds() {
        let bounds = physics::ArenaBounds { half_x: 7.25, half_z: 12.5 };
        let c = EngineConfig::for_arena(&bounds);
        let base = EngineConfig::current();

        assert!((c.arena_half_x - 7.25).abs() < f32::EPSILON);
        assert!((c.arena_half_z - 12.5).abs() < f32::EPSILON);
        // Everything else is untouched relative to current().
        assert!((c.gravity - base.gravity).abs() < f32::EPSILON);
        assert!((c.roll_torque_magnitude - base.roll_torque_magnitude).abs() < f32::EPSILON);
        assert!((c.arena_ground_y - base.arena_ground_y).abs() < f32::EPSILON);
        assert!((c.arena_ceiling_y - base.arena_ceiling_y).abs() < f32::EPSILON);
        assert!((c.arena_wall_height - base.arena_wall_height).abs() < f32::EPSILON);
        assert_eq!(c.rest_duration_ms, base.rest_duration_ms);
    }

    /// A default-arena `for_arena` is byte-identical to `current()` — solo at 9:16
    /// and multiplayer serialize the same config.
    #[test]
    fn engine_config_for_arena_default_equals_current() {
        assert_eq!(
            EngineConfig::for_arena(&physics::ArenaBounds::default()),
            EngineConfig::current()
        );
    }

    #[test]
    fn engine_config_serializes_camel_case() {
        let json = EngineConfig::current_json();
        assert!(json.contains("\"rollTorqueMagnitude\":24"));
        assert!(json.contains("\"arenaHalfX\":4.5"));
        assert!(json.contains("\"arenaHalfZ\":8"));
        // No snake_case leaked through.
        assert!(!json.contains("roll_torque_magnitude"));
    }
}
