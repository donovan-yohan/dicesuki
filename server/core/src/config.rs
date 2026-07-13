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
/// (Shared-ADR-002). Values are always [`EngineConfig::current`] — there is no
/// per-room variation today, but shipping the config per `room_state` keeps the
/// door open for future per-room tuning without another protocol change.
#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct EngineConfig {
    // World
    pub gravity: f32,

    // Material
    pub dice_restitution: f32,
    pub dice_friction: f32,
    pub edge_chamfer_radius: f32,

    // Settle / knock detection
    pub linear_velocity_threshold: f32,
    pub angular_velocity_threshold: f32,
    pub rest_duration_ms: u64,
    pub knock_wake_linear_speed: f32,
    pub knock_wake_angular_speed: f32,

    // Roll impulse + torque (the roll-feel truth)
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

    // Motion control policy (mirrored client-side)
    pub motion_impulse_min_interval_ms: u64,
    pub motion_impulse_max_magnitude: f32,

    // Arena bounds (fixed 9:16 portrait)
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
            edge_chamfer_radius: physics::EDGE_CHAMFER_RADIUS,

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

            motion_impulse_min_interval_ms: physics::MOTION_IMPULSE_MIN_INTERVAL_MS,
            motion_impulse_max_magnitude: physics::MOTION_IMPULSE_MAX_MAGNITUDE,

            arena_half_x: physics::WALL_HALF_X,
            arena_half_z: physics::WALL_HALF_Z,
            arena_ground_y: physics::GROUND_Y,
            arena_ceiling_y: physics::CEILING_Y,
            arena_wall_height: physics::WALL_HEIGHT,
            arena_wall_thickness: physics::WALL_THICKNESS,
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
        assert!((c.arena_half_x - physics::WALL_HALF_X).abs() < f32::EPSILON);
        assert!((c.arena_half_z - physics::WALL_HALF_Z).abs() < f32::EPSILON);
        assert_eq!(c.rest_duration_ms, physics::REST_DURATION_MS);
        assert_eq!(
            c.motion_impulse_min_interval_ms,
            physics::MOTION_IMPULSE_MIN_INTERVAL_MS
        );
    }

    #[test]
    fn engine_config_serializes_camel_case() {
        let json = EngineConfig::current_json();
        assert!(json.contains("\"rollTorqueMagnitude\":5"));
        assert!(json.contains("\"arenaHalfX\":4.5"));
        assert!(json.contains("\"arenaHalfZ\":8"));
        // No snake_case leaked through.
        assert!(!json.contains("roll_torque_magnitude"));
    }
}
