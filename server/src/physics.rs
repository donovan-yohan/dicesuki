use rapier3d::prelude::*;

/// Constants matching the client-side physicsConfig.ts
pub const GRAVITY: f32 = -9.81;
pub const DICE_RESTITUTION: f32 = 0.3;
pub const DICE_FRICTION: f32 = 0.6;
pub const EDGE_CHAMFER_RADIUS: f32 = 0.08;
pub const LINEAR_VELOCITY_THRESHOLD: f32 = 0.01;
pub const ANGULAR_VELOCITY_THRESHOLD: f32 = 0.01;
pub const REST_DURATION_MS: u64 = 500;
pub const ROLL_HORIZONTAL_MIN: f32 = 1.0;
pub const ROLL_HORIZONTAL_MAX: f32 = 3.0;
pub const ROLL_VERTICAL_MIN: f32 = 3.0;
pub const ROLL_VERTICAL_MAX: f32 = 5.0;

// Drag interaction constants (matching client physicsConfig.ts)
pub const DRAG_FOLLOW_SPEED: f32 = 12.0;
pub const DRAG_DISTANCE_BOOST: f32 = 2.5;
pub const DRAG_DISTANCE_THRESHOLD: f32 = 3.0;
pub const DRAG_SPIN_FACTOR: f32 = 0.33;
pub const DRAG_ROLL_FACTOR: f32 = 0.5;
pub const DRAG_PLANE_HEIGHT: f32 = 2.0;

// Throw mechanics (matching client physicsConfig.ts)
pub const THROW_VELOCITY_SCALE: f32 = 0.8;
pub const THROW_UPWARD_BOOST: f32 = 3.0;
pub const MIN_THROW_SPEED: f32 = 2.0;
pub const MAX_THROW_SPEED: f32 = 20.0;

// Velocity clamping (matching client physicsConfig.ts)
pub const MAX_DICE_VELOCITY: f32 = 25.0;

/// Viewport bounds — fixed 9:16 portrait arena for multiplayer
pub const GROUND_Y: f32 = -0.5;
pub const CEILING_Y: f32 = 6.0;
pub const WALL_HALF_X: f32 = 4.5;   // 9 units wide total
pub const WALL_HALF_Z: f32 = 8.0;   // 16 units deep total
pub const WALL_HEIGHT: f32 = 8.0;
pub const WALL_THICKNESS: f32 = 0.5;
pub const ESCAPE_RESET_HALF_X: f32 = WALL_HALF_X + 8.0;
pub const ESCAPE_RESET_HALF_Z: f32 = WALL_HALF_Z + 8.0;
pub const ESCAPE_RESET_MIN_Y: f32 = GROUND_Y - 8.0;
pub const ESCAPE_RESET_MAX_Y: f32 = CEILING_Y + 8.0;

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
        let mut rigid_body_set = RigidBodySet::new();
        let mut collider_set = ColliderSet::new();
        let gravity = vector![0.0, GRAVITY, 0.0];

        // Ground plane
        let ground_body = RigidBodyBuilder::fixed()
            .translation(vector![0.0, GROUND_Y, 0.0])
            .build();
        let ground_handle = rigid_body_set.insert(ground_body);
        let ground_collider = ColliderBuilder::cuboid(WALL_HALF_X + 2.0, 0.5, WALL_HALF_Z + 2.0)
            .restitution(DICE_RESTITUTION)
            .friction(DICE_FRICTION)
            .build();
        collider_set.insert_with_parent(ground_collider, ground_handle, &mut rigid_body_set);

        // Ceiling
        let ceiling_body = RigidBodyBuilder::fixed()
            .translation(vector![0.0, CEILING_Y, 0.0])
            .build();
        let ceiling_handle = rigid_body_set.insert(ceiling_body);
        let ceiling_collider = ColliderBuilder::cuboid(WALL_HALF_X + 2.0, 0.5, WALL_HALF_Z + 2.0)
            .build();
        collider_set.insert_with_parent(ceiling_collider, ceiling_handle, &mut rigid_body_set);

        // 4 walls: +X, -X, +Z, -Z
        let walls = [
            (vector![WALL_HALF_X + WALL_THICKNESS, WALL_HEIGHT / 2.0, 0.0], vector![WALL_THICKNESS, WALL_HEIGHT, WALL_HALF_Z + 2.0]),
            (vector![-(WALL_HALF_X + WALL_THICKNESS), WALL_HEIGHT / 2.0, 0.0], vector![WALL_THICKNESS, WALL_HEIGHT, WALL_HALF_Z + 2.0]),
            (vector![0.0, WALL_HEIGHT / 2.0, WALL_HALF_Z + WALL_THICKNESS], vector![WALL_HALF_X + 2.0, WALL_HEIGHT, WALL_THICKNESS]),
            (vector![0.0, WALL_HEIGHT / 2.0, -(WALL_HALF_Z + WALL_THICKNESS)], vector![WALL_HALF_X + 2.0, WALL_HEIGHT, WALL_THICKNESS]),
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
