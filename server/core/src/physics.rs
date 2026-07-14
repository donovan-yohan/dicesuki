//! Engine physics constants and the Rapier world.
//!
//! # Single source of truth (epic #111, Shared-ADR-007)
//!
//! Every physics-engine constant lives **here, once**. Both build targets — the
//! native multiplayer server binary and the `wasm32` in-browser room worker —
//! link this same crate, so a value edited in this file provably reaches both
//! with no second file to touch. This supersedes the Shared-ADR-003 "manual
//! sync between `physicsConfig.ts` and Rust" regime: `src/config/physicsConfig.ts`
//! no longer carries engine constants, and the browser reads the values it needs
//! at runtime from [`crate::config::EngineConfig`] (over the room protocol's
//! `room_state.config`, or the wasm `engine_config_json()` getter before a room
//! exists) — never from a copied literal.
//!
//! Each constant documents its purpose, recommended range, and the rationale for
//! its current value (Shared-ADR-003's documentation requirement, retained).

use rapier3d::prelude::*;

/// Standard gravity acceleration (m/s²) applied to the physics world.
/// - Earth standard: `-9.81` (current) — familiar, predictable dice falls.
/// - Lower (e.g. `-5`): floatier, slower falls. Higher (e.g. `-15`): snappier.
pub const GRAVITY: f32 = -9.81;

/// Restitution (bounciness) of dice and arena surfaces.
/// - Range `0.0` (dead) – `1.0` (perfect bounce).
/// - `0.3` (current): realistic — some bounce, settles quickly. `0.5` bounces
///   longer; `0.1` settles almost immediately.
pub const DICE_RESTITUTION: f32 = 0.3;

/// Friction coefficient for dice and arena surfaces.
/// - Range `0.0` (ice) – `1.0+` (very grippy).
/// - `0.6` (current): plastic dice on wood/felt. `0.8` rolls slower; `0.3` slides.
pub const DICE_FRICTION: f32 = 0.6;

/// Rounded-edge chamfer radius for the D6 round-cuboid collider (world units).
/// - `0.08` (current): subtle, realistic rounding. `0.12`–`0.15`: very smooth
///   edges (easier rolling); `0.04`–`0.06`: sharper edges.
pub const EDGE_CHAMFER_RADIUS: f32 = 0.08;

/// Linear speed (m/s) below which a die counts as "at rest" for settle detection.
/// - `0.01` (current): strict — waits until essentially still, so the
///   authoritative face is read only once the die has truly stopped.
/// - Larger values register a result while the die still creeps (risk of misreads).
pub const LINEAR_VELOCITY_THRESHOLD: f32 = 0.01;

/// Angular speed (rad/s) below which a die counts as "at rest" for settle detection.
/// - `0.01` (current): strict — no perceptible spin allowed before a face is read.
pub const ANGULAR_VELOCITY_THRESHOLD: f32 = 0.01;

/// Duration (ms) a die must stay below the rest thresholds before its face registers.
/// - `500` (current): prevents false positives from brief mid-roll stops without
///   feeling sluggish. `1000`+ is safer but slower; `<500` risks premature reads.
pub const REST_DURATION_MS: u64 = 500;

/// Linear speed (m/s) above which an already-settled die is treated as "knocked"
/// and must re-detect + rebroadcast its face. Set well above
/// `LINEAR_VELOCITY_THRESHOLD` so settling micro-jitter never re-wakes a resting die,
/// yet low enough that a genuine cross-player hit reliably re-triggers detection.
/// - `0.5` (current): reliable knock detection without false positives. `1.0` only
///   reacts to hard hits (risk of stale faces); `0.2` is jittery.
pub const KNOCK_WAKE_LINEAR_SPEED: f32 = 0.5;
/// Angular counterpart to `KNOCK_WAKE_LINEAR_SPEED` (rad/s): a settled die spun past
/// this by a collision must re-detect its face. `0.5` (current) matches the linear
/// threshold's sensitivity.
pub const KNOCK_WAKE_ANGULAR_SPEED: f32 = 0.5;

/// Minimum horizontal (XZ-plane) impulse magnitude for a button roll.
/// - `1.0`–`3.0` (current range): kept modest so rapid clicking stacks energy
///   rather than launching dice. Higher travels farther; lower stays centered.
pub const ROLL_HORIZONTAL_MIN: f32 = 1.0;
/// Maximum horizontal (XZ-plane) impulse magnitude for a button roll. See
/// [`ROLL_HORIZONTAL_MIN`].
pub const ROLL_HORIZONTAL_MAX: f32 = 3.0;
/// Minimum upward (Y) impulse for a button roll.
/// - `3.0`–`5.0` (current range): enough hop to tumble without flying into the
///   ceiling. Higher arcs more; lower settles faster.
pub const ROLL_VERTICAL_MIN: f32 = 3.0;
/// Maximum upward (Y) impulse for a button roll. See [`ROLL_VERTICAL_MIN`].
pub const ROLL_VERTICAL_MAX: f32 = 5.0;

/// **The single roll-feel torque truth.** Each axis of a rolled die receives a
/// random torque impulse in `-ROLL_TORQUE_MAGNITUDE ..= ROLL_TORQUE_MAGNITUDE`
/// (rad·kg·units), producing the tumble.
///
/// - `5.0` (current): the dramatic, lively tumble the owner has been playtesting
///   in multiplayer. This value is now the *only* torque definition in the
///   codebase — it reaches solo and multiplayer identically. It replaces the old
///   client-side `±1` angular impulse (`(Math.random()-0.5)*2`) that made the
///   same die throw differently by mode (the divergence issue #117 closes).
/// - Recommended range: `1.0` (gentle) – `6.0` (energetic). This is a one-file
///   edit here; feel tuning after solo playtesting is a single change in core.
pub const ROLL_TORQUE_MAGNITUDE: f32 = 5.0;

/// Base speed multiplier for how aggressively a dragged die chases the cursor.
/// - `12.0` (current): responsive but smooth. `20` is snappy; `8` feels laggy.
pub const DRAG_FOLLOW_SPEED: f32 = 12.0;
/// Extra follow-speed multiplier added when a dragged die is far from the cursor,
/// letting it catch up. - `2.5` (current): moderate. `5.0` overshoots; `1.0` minimal.
pub const DRAG_DISTANCE_BOOST: f32 = 2.5;
/// Distance (world units) beyond which [`DRAG_DISTANCE_BOOST`] starts applying.
/// - `3.0` (current): medium. `5.0` only boosts when very far; `1.0` always boosts.
pub const DRAG_DISTANCE_THRESHOLD: f32 = 3.0;
/// How much cursor motion induces spin on a dragged die (torque strength).
/// - `0.33` (current): subtle spin. `1.0` tumbles dramatically; `0.0` no spin.
pub const DRAG_SPIN_FACTOR: f32 = 0.33;
/// How much cursor motion induces rolling ("ball on a surface") on a dragged die.
/// - `0.5` (current): natural. `4.0` rolls aggressively; `0.0` is spin-only.
pub const DRAG_ROLL_FACTOR: f32 = 0.5;
/// Height (world units) of the invisible plane a drag is projected onto. This is a
/// server-side drag-target height; the *client* raycast plane is a separate render
/// concern in `physicsConfig.ts`. - `2.0` (current): natural above-table feel.
pub const DRAG_PLANE_HEIGHT: f32 = 2.0;

/// Scale applied to the drag-release velocity when a throw is computed.
/// - `0.8` (current): slightly dampened, realistic. `1.0` is 1:1; `0.5` is gentle.
pub const THROW_VELOCITY_SCALE: f32 = 0.8;
/// Upward (Y) velocity added on release to give thrown dice a dynamic arc.
/// - `3.0` (current): moderate arc. `5.0` arcs high; `0.0` throws flat.
pub const THROW_UPWARD_BOOST: f32 = 3.0;
/// Minimum release speed (units/s) for a drag-release to count as a throw rather
/// than a drop-in-place. - `2.0` (current): easy to trigger. `5.0` needs a fast swipe.
pub const MIN_THROW_SPEED: f32 = 2.0;
/// Maximum throw speed (units/s); faster releases are capped to prevent
/// unrealistic launches. - `20.0` (current). `30` allows very fast; `15` caps low.
pub const MAX_THROW_SPEED: f32 = 20.0;

/// Hard cap on any die's linear speed (units/s), applied continuously so impulses,
/// drags, and throws can never clip a die through a wall.
/// - `25.0` (current): dynamic rolls without clipping. `30` risks clipping; `20` is safe.
pub const MAX_DICE_VELOCITY: f32 = 25.0;

/// Minimum interval (ms) between accepted `motion_impulse` messages per player.
/// Device-motion input arriving faster than this is dropped so a shaking phone
/// cannot flood the physics loop.
/// - `50` (≈20Hz, current): responsive shake without spamming the loop.
///   Recommended `33` (30Hz) – `100` (10Hz).
pub const MOTION_IMPULSE_MIN_INTERVAL_MS: u64 = 50;
/// Maximum magnitude (world units) of a single motion impulse. Every incoming
/// impulse is clamped to this length so a malicious/miscalibrated client cannot
/// launch dice out of the arena.
/// - `30.0` (current): a firm shake, above a roll impulse but below escape velocity.
///   Recommended `15` (gentle) – `40` (energetic).
pub const MOTION_IMPULSE_MAX_MAGNITUDE: f32 = 30.0;

/// Ground plane height (world units) of the fixed 9:16 portrait arena.
pub const GROUND_Y: f32 = -0.5;
/// Ceiling height (world units) of the fixed 9:16 portrait arena.
pub const CEILING_Y: f32 = 6.0;
/// Arena half-width along X (world units): 9 units wide total. Consumed by the
/// client for camera fit and wall rendering via [`crate::config::EngineConfig`].
pub const WALL_HALF_X: f32 = 4.5;
/// Arena half-depth along Z (world units): 16 units deep total. See [`WALL_HALF_X`].
pub const WALL_HALF_Z: f32 = 8.0;
/// Height of the arena's four side walls (world units).
pub const WALL_HEIGHT: f32 = 8.0;
/// Thickness of the arena's four side walls (world units).
pub const WALL_THICKNESS: f32 = 0.5;
/// Extra distance (world units) a die may drift beyond an arena wall before the
/// room teleports it back onto the table. Added to a room's [`ArenaBounds`]
/// half-extents to form the horizontal escape thresholds
/// ([`ArenaBounds::escape_half_x`]/[`ArenaBounds::escape_half_z`]); the vertical
/// thresholds are the fixed [`ESCAPE_RESET_MIN_Y`]/[`ESCAPE_RESET_MAX_Y`].
/// - `8.0` (current): wide enough that normal fast rolls never trip it, tight
///   enough to recover a genuinely tunnelled die within a frame or two.
///   Recommended `4.0`–`12.0`.
pub const ESCAPE_RESET_MARGIN: f32 = 8.0;
/// Lowest Y (world units) a die may reach before the room recovers it: below the
/// ground by [`ESCAPE_RESET_MARGIN`]. Arena height is fixed, so this is constant.
pub const ESCAPE_RESET_MIN_Y: f32 = GROUND_Y - ESCAPE_RESET_MARGIN;
/// Highest Y (world units) a die may reach before the room recovers it: above the
/// ceiling by [`ESCAPE_RESET_MARGIN`]. Arena height is fixed, so this is constant.
pub const ESCAPE_RESET_MAX_Y: f32 = CEILING_Y + ESCAPE_RESET_MARGIN;

/// Horizontal footprint (floor half-extents, world units) of a room's arena.
///
/// The arena's **height** is fixed by [`GROUND_Y`], [`CEILING_Y`], and
/// [`WALL_HEIGHT`]; only the floor's X/Z half-extents vary so a room can match
/// the aspect ratio of the surface it renders on. Every room owns one of these
/// and builds its walls, escape bounds, and [`crate::config::EngineConfig`] from
/// it, so the client always sees the ACTUAL arena its room is simulating.
///
/// - Default (`half_x = WALL_HALF_X = 4.5`, `half_z = WALL_HALF_Z = 8.0`): the
///   fixed 9:16 portrait arena the native multiplayer server always uses.
/// - Recommended range: constructed only via [`ArenaBounds::from_aspect`], whose
///   aspect clamp keeps half-extents within roughly `[3.8, 9.5]`.
/// - Rationale: solo play runs in the browser, where the viewport aspect varies;
///   fitting the arena to it removes letterboxing while preserving playfield area.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct ArenaBounds {
    /// Arena half-width along X (world units).
    pub half_x: f32,
    /// Arena half-depth along Z (world units).
    pub half_z: f32,
}

impl Default for ArenaBounds {
    /// The fixed 9:16 portrait arena ([`WALL_HALF_X`] x [`WALL_HALF_Z`]) — what
    /// the native multiplayer server always uses.
    fn default() -> Self {
        Self { half_x: WALL_HALF_X, half_z: WALL_HALF_Z }
    }
}

impl ArenaBounds {
    /// Fit the arena to a window's `aspect` (= width / height) while preserving
    /// playfield area.
    ///
    /// Area is held at `WALL_HALF_X * WALL_HALF_Z` (= 36 world-unit², the default
    /// arena's quarter-area) so no window shape gains or loses room for dice to
    /// settle: `half_x = sqrt(AREA * aspect)`, `half_z = sqrt(AREA / aspect)`.
    ///
    /// - `aspect` is clamped to `[0.4, 2.4]` before use, bounding the arena to
    ///   sane shapes even for absurd viewports; half-extents then stay within
    ///   roughly `[3.8, 9.5]`.
    /// - Rationale: the canonical portrait aspect `9 / 16 = 0.5625` reproduces
    ///   exactly `half_x = 4.5`, `half_z = 8.0`, so the default arena is a fixed
    ///   point of this fit — solo at 9:16 is identical to multiplayer.
    #[must_use]
    pub fn from_aspect(aspect: f32) -> Self {
        const AREA: f32 = WALL_HALF_X * WALL_HALF_Z;
        let aspect = aspect.clamp(0.4, 2.4);
        Self {
            half_x: (AREA * aspect).sqrt(),
            half_z: (AREA / aspect).sqrt(),
        }
    }

    /// Horizontal (X) escape threshold: how far past the wall on X a die may drift
    /// before the room recovers it. See [`ESCAPE_RESET_MARGIN`].
    #[must_use]
    pub fn escape_half_x(&self) -> f32 {
        self.half_x + ESCAPE_RESET_MARGIN
    }

    /// Horizontal (Z) escape threshold: how far past the wall on Z a die may drift
    /// before the room recovers it. See [`ESCAPE_RESET_MARGIN`].
    #[must_use]
    pub fn escape_half_z(&self) -> f32 {
        self.half_z + ESCAPE_RESET_MARGIN
    }
}

pub struct PhysicsWorld {
    pub(crate) rigid_body_set: RigidBodySet,
    pub(crate) collider_set: ColliderSet,
    pub gravity: Vector<f32>,
    pub integration_parameters: IntegrationParameters,
    pub physics_pipeline: PhysicsPipeline,
    pub island_manager: IslandManager,
    pub broad_phase: DefaultBroadPhase,
    pub narrow_phase: NarrowPhase,
    pub impulse_joint_set: ImpulseJointSet,
    pub multibody_joint_set: MultibodyJointSet,
    pub ccd_solver: CCDSolver,
    pub query_pipeline: QueryPipeline,
}

impl Default for PhysicsWorld {
    fn default() -> Self {
        Self::new()
    }
}

impl PhysicsWorld {
    #[must_use]
    pub fn new() -> Self {
        Self::with_bounds(ArenaBounds::default())
    }

    /// Build the physics world for an arena of the given horizontal `bounds`.
    /// Ground, ceiling, and the four walls are sized from `bounds`; the arena's
    /// height ([`GROUND_Y`]/[`CEILING_Y`]/[`WALL_HEIGHT`]) is fixed. Solo passes an
    /// aspect-fitted `bounds` ([`ArenaBounds::from_aspect`]); the native
    /// multiplayer server passes [`ArenaBounds::default`].
    #[must_use]
    pub fn with_bounds(bounds: ArenaBounds) -> Self {
        let ArenaBounds { half_x, half_z } = bounds;
        let mut rigid_body_set = RigidBodySet::new();
        let mut collider_set = ColliderSet::new();
        let gravity = vector![0.0, GRAVITY, 0.0];

        // Ground plane
        let ground_body = RigidBodyBuilder::fixed()
            .translation(vector![0.0, GROUND_Y, 0.0])
            .build();
        let ground_handle = rigid_body_set.insert(ground_body);
        let ground_collider = ColliderBuilder::cuboid(half_x + 2.0, 0.5, half_z + 2.0)
            .restitution(DICE_RESTITUTION)
            .friction(DICE_FRICTION)
            .build();
        collider_set.insert_with_parent(ground_collider, ground_handle, &mut rigid_body_set);

        // Ceiling
        let ceiling_body = RigidBodyBuilder::fixed()
            .translation(vector![0.0, CEILING_Y, 0.0])
            .build();
        let ceiling_handle = rigid_body_set.insert(ceiling_body);
        let ceiling_collider = ColliderBuilder::cuboid(half_x + 2.0, 0.5, half_z + 2.0)
            .build();
        collider_set.insert_with_parent(ceiling_collider, ceiling_handle, &mut rigid_body_set);

        // 4 walls: +X, -X, +Z, -Z
        let walls = [
            (vector![half_x + WALL_THICKNESS, WALL_HEIGHT / 2.0, 0.0], vector![WALL_THICKNESS, WALL_HEIGHT, half_z + 2.0]),
            (vector![-(half_x + WALL_THICKNESS), WALL_HEIGHT / 2.0, 0.0], vector![WALL_THICKNESS, WALL_HEIGHT, half_z + 2.0]),
            (vector![0.0, WALL_HEIGHT / 2.0, half_z + WALL_THICKNESS], vector![half_x + 2.0, WALL_HEIGHT, WALL_THICKNESS]),
            (vector![0.0, WALL_HEIGHT / 2.0, -(half_z + WALL_THICKNESS)], vector![half_x + 2.0, WALL_HEIGHT, WALL_THICKNESS]),
        ];

        for (pos, half_extents) in walls {
            let wall_body = RigidBodyBuilder::fixed()
                .translation(pos)
                .build();
            let wall_handle = rigid_body_set.insert(wall_body);
            let wall_collider = ColliderBuilder::cuboid(half_extents.x, half_extents.y, half_extents.z)
                .restitution(DICE_RESTITUTION)
                .friction(DICE_FRICTION)
                .build();
            collider_set.insert_with_parent(wall_collider, wall_handle, &mut rigid_body_set);
        }

        Self {
            rigid_body_set,
            collider_set,
            gravity,
            integration_parameters: IntegrationParameters::default(),
            physics_pipeline: PhysicsPipeline::new(),
            island_manager: IslandManager::new(),
            broad_phase: DefaultBroadPhase::new(),
            narrow_phase: NarrowPhase::new(),
            impulse_joint_set: ImpulseJointSet::new(),
            multibody_joint_set: MultibodyJointSet::new(),
            ccd_solver: CCDSolver::new(),
            query_pipeline: QueryPipeline::new(),
        }
    }

    /// Step the physics simulation by one tick (1/60th second)
    pub fn step(&mut self) {
        self.physics_pipeline.step(
            &self.gravity,
            &self.integration_parameters,
            &mut self.island_manager,
            &mut self.broad_phase,
            &mut self.narrow_phase,
            &mut self.rigid_body_set,
            &mut self.collider_set,
            &mut self.impulse_joint_set,
            &mut self.multibody_joint_set,
            &mut self.ccd_solver,
            Some(&mut self.query_pipeline),
            &(),
            &(),
        );
    }

    /// Get position of a rigid body
    #[must_use]
    pub fn get_position(&self, handle: RigidBodyHandle) -> Option<[f32; 3]> {
        self.rigid_body_set.get(handle).map(|rb| {
            let pos = rb.translation();
            [pos.x, pos.y, pos.z]
        })
    }

    /// Get rotation (quaternion) of a rigid body
    #[must_use]
    pub fn get_rotation(&self, handle: RigidBodyHandle) -> Option<[f32; 4]> {
        self.rigid_body_set.get(handle).map(|rb| {
            let rot = rb.rotation();
            [rot.i, rot.j, rot.k, rot.w]
        })
    }

    /// Get linear velocity magnitude
    #[must_use]
    pub fn get_linear_speed(&self, handle: RigidBodyHandle) -> f32 {
        self.rigid_body_set.get(handle)
            .map_or(0.0, |rb| rb.linvel().magnitude())
    }

    /// Get angular velocity magnitude
    #[must_use]
    pub fn get_angular_speed(&self, handle: RigidBodyHandle) -> f32 {
        self.rigid_body_set.get(handle)
            .map_or(0.0, |rb| rb.angvel().magnitude())
    }

    /// Check if a body is at rest (below velocity thresholds)
    #[must_use]
    pub fn is_at_rest(&self, handle: RigidBodyHandle) -> bool {
        self.get_linear_speed(handle) < LINEAR_VELOCITY_THRESHOLD
            && self.get_angular_speed(handle) < ANGULAR_VELOCITY_THRESHOLD
    }

    /// Check if a body has been "knocked" — i.e. it is moving fast enough (linear or
    /// angular) that a previously-settled die must re-detect and rebroadcast its face.
    #[must_use]
    pub fn is_knocked(&self, handle: RigidBodyHandle) -> bool {
        self.get_linear_speed(handle) > KNOCK_WAKE_LINEAR_SPEED
            || self.get_angular_speed(handle) > KNOCK_WAKE_ANGULAR_SPEED
    }

    /// Insert a pre-built rigid body and attach a collider to it.
    /// Returns the handle of the inserted body.
    pub fn spawn_body(&mut self, body: RigidBody, collider: Collider) -> RigidBodyHandle {
        let handle = self.rigid_body_set.insert(body);
        self.collider_set.insert_with_parent(collider, handle, &mut self.rigid_body_set);
        handle
    }

    /// Set linear velocity of a rigid body
    pub fn set_linear_velocity(&mut self, handle: RigidBodyHandle, vel: [f32; 3]) {
        if let Some(rb) = self.rigid_body_set.get_mut(handle) {
            rb.set_linvel(vector![vel[0], vel[1], vel[2]], true);
        }
    }

    /// Set angular velocity of a rigid body
    pub fn set_angular_velocity(&mut self, handle: RigidBodyHandle, vel: [f32; 3]) {
        if let Some(rb) = self.rigid_body_set.get_mut(handle) {
            rb.set_angvel(vector![vel[0], vel[1], vel[2]], true);
        }
    }

    /// Scale the current angular velocity of a rigid body by a factor (e.g. 0.75 to dampen)
    pub fn scale_angular_velocity(&mut self, handle: RigidBodyHandle, scale: f32) {
        if let Some(rb) = self.rigid_body_set.get_mut(handle) {
            let ang = *rb.angvel();
            rb.set_angvel(ang * scale, true);
        }
    }

    /// Apply a linear impulse to a rigid body
    pub fn apply_impulse(&mut self, handle: RigidBodyHandle, impulse: [f32; 3]) {
        if let Some(rb) = self.rigid_body_set.get_mut(handle) {
            rb.apply_impulse(vector![impulse[0], impulse[1], impulse[2]], true);
        }
    }

    /// Apply a torque impulse to a rigid body
    pub fn apply_torque_impulse(&mut self, handle: RigidBodyHandle, torque: [f32; 3]) {
        if let Some(rb) = self.rigid_body_set.get_mut(handle) {
            rb.apply_torque_impulse(vector![torque[0], torque[1], torque[2]], true);
        }
    }

    /// Clamp the linear speed of a body to `max_speed`. No-op if already within bounds.
    pub fn clamp_velocity(&mut self, handle: RigidBodyHandle, max_speed: f32) {
        if let Some(rb) = self.rigid_body_set.get_mut(handle) {
            let vel = *rb.linvel();
            let speed = vel.magnitude();
            if speed > max_speed {
                rb.set_linvel(vel * (max_speed / speed), true);
            }
        }
    }

    /// Move a body back into the arena and stop its current motion.
    pub fn reset_body_to_position(&mut self, handle: RigidBodyHandle, position: [f32; 3]) {
        if let Some(rb) = self.rigid_body_set.get_mut(handle) {
            rb.set_translation(vector![position[0], position[1], position[2]], true);
            rb.set_rotation(Rotation::identity(), true);
            rb.set_linvel(vector![0.0, 0.0, 0.0], true);
            rb.set_angvel(vector![0.0, 0.0, 0.0], true);
        }
    }

    /// Returns the number of rigid bodies currently in the simulation.
    #[must_use]
    pub fn body_count(&self) -> usize {
        self.rigid_body_set.len()
    }

    /// Remove a rigid body and all its attached colliders from the simulation.
    /// No-op if the handle is invalid (already removed or never inserted).
    pub fn remove_body(&mut self, handle: RigidBodyHandle) {
        self.rigid_body_set.remove(
            handle,
            &mut self.island_manager,
            &mut self.collider_set,
            &mut self.impulse_joint_set,
            &mut self.multibody_joint_set,
            true,
        );
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_physics_world_creation() {
        let world = PhysicsWorld::new();
        // Ground + ceiling + 4 walls = 6 fixed bodies
        assert_eq!(world.rigid_body_set.len(), 6);
    }

    #[test]
    fn arena_bounds_default_is_the_fixed_9_16_arena() {
        let b = ArenaBounds::default();
        assert_eq!(b.half_x, WALL_HALF_X);
        assert_eq!(b.half_z, WALL_HALF_Z);
    }

    #[test]
    fn from_aspect_9_16_is_exactly_the_default_arena() {
        // The canonical portrait aspect is a fixed point of the fit: it must
        // reproduce the default arena's half-extents bit-for-bit.
        let b = ArenaBounds::from_aspect(9.0 / 16.0);
        assert_eq!(b.half_x, 4.5, "9:16 must reproduce WALL_HALF_X exactly");
        assert_eq!(b.half_z, 8.0, "9:16 must reproduce WALL_HALF_Z exactly");
        assert_eq!(b, ArenaBounds::default());
    }

    #[test]
    fn from_aspect_preserves_playfield_area_and_tracks_aspect() {
        const AREA: f32 = WALL_HALF_X * WALL_HALF_Z;
        for aspect in [0.5_f32, 0.75, 1.0, 1.5, 2.0] {
            let b = ArenaBounds::from_aspect(aspect);
            assert!(
                (b.half_x * b.half_z - AREA).abs() < 1e-3,
                "area preserved for aspect {aspect}: got {}",
                b.half_x * b.half_z
            );
            // Wider windows widen X and shorten Z; the ratio equals the aspect.
            assert!(
                (b.half_x / b.half_z - aspect).abs() < 1e-3,
                "half_x/half_z tracks aspect for {aspect}"
            );
        }
    }

    #[test]
    fn from_aspect_clamps_extreme_windows() {
        // Below the clamp floor: pinned to aspect 0.4.
        assert_eq!(
            ArenaBounds::from_aspect(0.1),
            ArenaBounds::from_aspect(0.4),
            "aspect below 0.4 clamps to 0.4"
        );
        // Above the clamp ceiling: pinned to aspect 2.4.
        assert_eq!(
            ArenaBounds::from_aspect(10.0),
            ArenaBounds::from_aspect(2.4),
            "aspect above 2.4 clamps to 2.4"
        );
        // A degenerate (zero-height) viewport → +inf aspect → clamps, never NaN.
        let inf = ArenaBounds::from_aspect(f32::INFINITY);
        assert!(inf.half_x.is_finite() && inf.half_z.is_finite());
    }

    #[test]
    fn with_bounds_scales_arena_but_keeps_body_count() {
        // A custom arena still has ground + ceiling + 4 walls.
        let world = PhysicsWorld::with_bounds(ArenaBounds::from_aspect(1.0));
        assert_eq!(world.rigid_body_set.len(), 6);
    }

    #[test]
    fn test_physics_step_does_not_panic() {
        let mut world = PhysicsWorld::new();
        for _ in 0..60 {
            world.step();
        }
    }

    #[test]
    fn test_dice_falls_to_ground() {
        let mut world = PhysicsWorld::new();

        // Spawn a dynamic body above the ground
        let body = RigidBodyBuilder::dynamic()
            .translation(vector![0.0, 5.0, 0.0])
            .build();
        let handle = world.rigid_body_set.insert(body);
        let collider = ColliderBuilder::cuboid(0.5, 0.5, 0.5)
            .restitution(DICE_RESTITUTION)
            .friction(DICE_FRICTION)
            .build();
        world.collider_set.insert_with_parent(collider, handle, &mut world.rigid_body_set);

        // Step for 2 seconds (120 ticks at 60Hz)
        for _ in 0..120 {
            world.step();
        }

        let pos = world.get_position(handle).unwrap();
        // Should have fallen near ground level (y ~= 0)
        assert!(pos[1] < 2.0, "Dice should have fallen, y={}", pos[1]);
        assert!(pos[1] > -1.0, "Dice should not fall through ground, y={}", pos[1]);
    }

    #[test]
    fn test_at_rest_detection() {
        let mut world = PhysicsWorld::new();

        let body = RigidBodyBuilder::dynamic()
            .translation(vector![0.0, 0.1, 0.0])
            .build();
        let handle = world.rigid_body_set.insert(body);
        let collider = ColliderBuilder::cuboid(0.5, 0.5, 0.5)
            .restitution(0.0) // No bounce for faster settling
            .friction(1.0)
            .build();
        world.collider_set.insert_with_parent(collider, handle, &mut world.rigid_body_set);

        // Step until settled (or timeout)
        for _ in 0..600 {
            world.step();
        }

        assert!(world.is_at_rest(handle), "Dice should be at rest after 10 seconds");
    }
}
