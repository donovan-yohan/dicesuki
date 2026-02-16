# Multiplayer 02: Server Physics

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Integrate Rapier3D physics into the server — dice geometries, colliders, face detection, simulation loop, and snapshot generation.

**Architecture:** Each Room owns a Rapier PhysicsWorld. The server creates rigid bodies for ground/walls/dice, steps physics at 60Hz, and emits position/rotation snapshots at 20Hz.

**Tech Stack:** rapier3d (native), nalgebra

**Depends on:** Plan 01 (Rust Server Core)

---

## Task 1: Physics World Setup

**Files:**
- Create: `server/src/physics.rs`
- Modify: `server/src/main.rs`

**Step 1: Write physics world module**

Create `server/src/physics.rs`:

```rust
use rapier3d::prelude::*;

/// Constants matching the client-side physicsConfig.ts
pub const GRAVITY: f32 = -9.81;
pub const DICE_RESTITUTION: f32 = 0.3;
pub const DICE_FRICTION: f32 = 0.6;
pub const EDGE_CHAMFER_RADIUS: f32 = 0.08;
pub const LINEAR_VELOCITY_THRESHOLD: f32 = 0.01;
pub const ANGULAR_VELOCITY_THRESHOLD: f32 = 0.01;
pub const REST_DURATION_MS: u64 = 500;
pub const MAX_DICE_VELOCITY: f32 = 25.0;
pub const ROLL_HORIZONTAL_MIN: f32 = 1.0;
pub const ROLL_HORIZONTAL_MAX: f32 = 3.0;
pub const ROLL_VERTICAL_MIN: f32 = 3.0;
pub const ROLL_VERTICAL_MAX: f32 = 5.0;

/// Viewport bounds — matching client camera at height=15, fov=40deg
/// Visible area at y=0: ~10.9 units tall, ~19.4 units wide (16:9)
/// We use fixed conservative bounds that work for all aspect ratios
pub const GROUND_Y: f32 = -0.5;
pub const CEILING_Y: f32 = 15.0;
pub const WALL_HALF_X: f32 = 8.0;
pub const WALL_HALF_Z: f32 = 5.0;
pub const WALL_HEIGHT: f32 = 8.0;
pub const WALL_THICKNESS: f32 = 0.5;

pub struct PhysicsWorld {
    pub rigid_body_set: RigidBodySet,
    pub collider_set: ColliderSet,
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

impl PhysicsWorld {
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
    pub fn get_position(&self, handle: RigidBodyHandle) -> Option<[f32; 3]> {
        self.rigid_body_set.get(handle).map(|rb| {
            let pos = rb.translation();
            [pos.x, pos.y, pos.z]
        })
    }

    /// Get rotation (quaternion) of a rigid body
    pub fn get_rotation(&self, handle: RigidBodyHandle) -> Option<[f32; 4]> {
        self.rigid_body_set.get(handle).map(|rb| {
            let rot = rb.rotation();
            [rot.i, rot.j, rot.k, rot.w]
        })
    }

    /// Get linear velocity magnitude
    pub fn get_linear_speed(&self, handle: RigidBodyHandle) -> f32 {
        self.rigid_body_set.get(handle)
            .map(|rb| rb.linvel().magnitude())
            .unwrap_or(0.0)
    }

    /// Get angular velocity magnitude
    pub fn get_angular_speed(&self, handle: RigidBodyHandle) -> f32 {
        self.rigid_body_set.get(handle)
            .map(|rb| rb.angvel().magnitude())
            .unwrap_or(0.0)
    }

    /// Check if a body is at rest (below velocity thresholds)
    pub fn is_at_rest(&self, handle: RigidBodyHandle) -> bool {
        self.get_linear_speed(handle) < LINEAR_VELOCITY_THRESHOLD
            && self.get_angular_speed(handle) < ANGULAR_VELOCITY_THRESHOLD
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
```

**Step 2: Register module**

Add `mod physics;` to `server/src/main.rs`.

**Step 3: Run tests**

```bash
cd server && cargo test
```

Expected: All tests pass. The physics tests may take a moment due to simulation.

**Step 4: Commit**

```bash
git add server/src/physics.rs server/src/main.rs
git commit -m "feat(server): add Rapier physics world with ground, walls, and boundary setup"
```

---

## Task 2: Dice Geometries & Colliders

**Files:**
- Create: `server/src/dice.rs`
- Modify: `server/src/main.rs`

**Step 1: Write dice module with collider creation and face normals**

Create `server/src/dice.rs`:

```rust
use rapier3d::prelude::*;
use nalgebra::{Vector3, UnitQuaternion};
use rand::Rng;
use crate::messages::DiceType;
use crate::physics::*;

/// Face definition for face detection
#[derive(Debug, Clone)]
pub struct DiceFace {
    pub value: u32,
    pub normal: Vector3<f32>,
}

/// Dice size (half-extent for d6, approximate radius for others)
pub const DICE_SIZE: f32 = 0.5;

/// Create a rigid body and collider for a given dice type at a spawn position
pub fn create_dice_body(
    dice_type: DiceType,
    position: [f32; 3],
    rigid_body_set: &mut RigidBodySet,
    collider_set: &mut ColliderSet,
) -> RigidBodyHandle {
    let mut rng = rand::thread_rng();

    // Random initial rotation
    let rot = UnitQuaternion::from_euler_angles(
        rng.gen_range(0.0..std::f32::consts::TAU),
        rng.gen_range(0.0..std::f32::consts::TAU),
        rng.gen_range(0.0..std::f32::consts::TAU),
    );

    let body = RigidBodyBuilder::dynamic()
        .translation(vector![position[0], position[1], position[2]])
        .rotation(vector![rot.euler_angles().0, rot.euler_angles().1, rot.euler_angles().2])
        .can_sleep(false)
        .build();
    let handle = rigid_body_set.insert(body);

    let collider = match dice_type {
        DiceType::D6 => {
            ColliderBuilder::round_cuboid(
                DICE_SIZE - EDGE_CHAMFER_RADIUS,
                DICE_SIZE - EDGE_CHAMFER_RADIUS,
                DICE_SIZE - EDGE_CHAMFER_RADIUS,
                EDGE_CHAMFER_RADIUS,
            )
        }
        _ => {
            // For non-d6 dice, use convex hull from vertices
            let vertices = get_dice_vertices(dice_type);
            ColliderBuilder::convex_hull(&vertices)
                .unwrap_or_else(|| ColliderBuilder::ball(DICE_SIZE))
        }
    }
    .restitution(DICE_RESTITUTION)
    .friction(DICE_FRICTION)
    .density(1.0)
    .build();

    collider_set.insert_with_parent(collider, handle, rigid_body_set);
    handle
}

/// Generate a random roll impulse matching client-side parameters
pub fn generate_roll_impulse() -> Vector3<f32> {
    let mut rng = rand::thread_rng();
    let angle = rng.gen_range(0.0..std::f32::consts::TAU);
    let horizontal = rng.gen_range(ROLL_HORIZONTAL_MIN..ROLL_HORIZONTAL_MAX);
    let vertical = rng.gen_range(ROLL_VERTICAL_MIN..ROLL_VERTICAL_MAX);

    Vector3::new(
        angle.cos() * horizontal,
        vertical,
        angle.sin() * horizontal,
    )
}

/// Generate random angular torque for realistic tumbling
pub fn generate_roll_torque() -> Vector3<f32> {
    let mut rng = rand::thread_rng();
    Vector3::new(
        rng.gen_range(-5.0..5.0),
        rng.gen_range(-5.0..5.0),
        rng.gen_range(-5.0..5.0),
    )
}

/// Generate a random spawn position above the table
pub fn generate_spawn_position() -> [f32; 3] {
    let mut rng = rand::thread_rng();
    [
        rng.gen_range(-3.0..3.0),
        2.0, // Above the ground
        rng.gen_range(-2.0..2.0),
    ]
}

/// Get vertices for convex hull collider based on dice type
fn get_dice_vertices(dice_type: DiceType) -> Vec<Point<f32>> {
    let s = DICE_SIZE;
    match dice_type {
        DiceType::D4 => {
            // Regular tetrahedron
            let a = s * 1.0;
            vec![
                point![a, a, a],
                point![a, -a, -a],
                point![-a, a, -a],
                point![-a, -a, a],
            ]
        }
        DiceType::D8 => {
            // Regular octahedron
            let a = s * 1.0;
            vec![
                point![a, 0.0, 0.0],
                point![-a, 0.0, 0.0],
                point![0.0, a, 0.0],
                point![0.0, -a, 0.0],
                point![0.0, 0.0, a],
                point![0.0, 0.0, -a],
            ]
        }
        DiceType::D10 => {
            // Pentagonal trapezohedron (simplified as vertices)
            let mut verts = Vec::new();
            let top = s * 0.8;
            let bot = -s * 0.8;
            let mid_top = s * 0.3;
            let mid_bot = -s * 0.3;
            let r = s * 0.9;
            for i in 0..5 {
                let angle = (i as f32) * std::f32::consts::TAU / 5.0;
                let offset_angle = angle + std::f32::consts::TAU / 10.0;
                verts.push(point![angle.cos() * r, mid_top, angle.sin() * r]);
                verts.push(point![offset_angle.cos() * r, mid_bot, offset_angle.sin() * r]);
            }
            verts.push(point![0.0, top, 0.0]);
            verts.push(point![0.0, bot, 0.0]);
            verts
        }
        DiceType::D12 => {
            // Regular dodecahedron
            let phi = (1.0 + 5.0_f32.sqrt()) / 2.0;
            let a = s * 0.5;
            let b = s * 0.5 / phi;
            let c = s * 0.5 * phi;
            let mut verts = Vec::new();
            // Cube vertices
            for &x in &[-a, a] {
                for &y in &[-a, a] {
                    for &z in &[-a, a] {
                        verts.push(point![x, y, z]);
                    }
                }
            }
            // Rectangle vertices
            for &(x, y, z) in &[
                (0.0, b, c), (0.0, b, -c), (0.0, -b, c), (0.0, -b, -c),
                (b, c, 0.0), (b, -c, 0.0), (-b, c, 0.0), (-b, -c, 0.0),
                (c, 0.0, b), (c, 0.0, -b), (-c, 0.0, b), (-c, 0.0, -b),
            ] {
                verts.push(point![x, y, z]);
            }
            verts
        }
        DiceType::D20 => {
            // Regular icosahedron
            let phi = (1.0 + 5.0_f32.sqrt()) / 2.0;
            let a = s * 0.5;
            let b = s * 0.5 * phi;
            vec![
                point![-a, b, 0.0], point![a, b, 0.0], point![-a, -b, 0.0], point![a, -b, 0.0],
                point![0.0, -a, b], point![0.0, a, b], point![0.0, -a, -b], point![0.0, a, -b],
                point![b, 0.0, -a], point![b, 0.0, a], point![-b, 0.0, -a], point![-b, 0.0, a],
            ]
        }
        DiceType::D6 => {
            // Not used (d6 uses round_cuboid) but included for completeness
            let a = s;
            vec![
                point![-a, -a, -a], point![a, -a, -a], point![-a, a, -a], point![a, a, -a],
                point![-a, -a, a], point![a, -a, a], point![-a, a, a], point![a, a, a],
            ]
        }
    }
}

/// Get face normals for a given dice type
/// These MUST match the client-side face normals in src/lib/geometries.ts
pub fn get_face_normals(dice_type: DiceType) -> Vec<DiceFace> {
    match dice_type {
        DiceType::D4 => {
            let s = 1.0 / 3.0_f32.sqrt();
            vec![
                DiceFace { value: 1, normal: Vector3::new(s, s, s) },
                DiceFace { value: 2, normal: Vector3::new(s, -s, -s) },
                DiceFace { value: 3, normal: Vector3::new(-s, s, -s) },
                DiceFace { value: 4, normal: Vector3::new(-s, -s, s) },
            ]
        }
        DiceType::D6 => {
            vec![
                DiceFace { value: 1, normal: Vector3::new(0.0, -1.0, 0.0) },
                DiceFace { value: 2, normal: Vector3::new(0.0, 0.0, 1.0) },
                DiceFace { value: 3, normal: Vector3::new(1.0, 0.0, 0.0) },
                DiceFace { value: 4, normal: Vector3::new(-1.0, 0.0, 0.0) },
                DiceFace { value: 5, normal: Vector3::new(0.0, 0.0, -1.0) },
                DiceFace { value: 6, normal: Vector3::new(0.0, 1.0, 0.0) },
            ]
        }
        DiceType::D8 => {
            let s = 1.0 / 3.0_f32.sqrt();
            vec![
                DiceFace { value: 1, normal: Vector3::new(s, s, s) },
                DiceFace { value: 2, normal: Vector3::new(-s, s, s) },
                DiceFace { value: 3, normal: Vector3::new(s, s, -s) },
                DiceFace { value: 4, normal: Vector3::new(-s, s, -s) },
                DiceFace { value: 5, normal: Vector3::new(s, -s, s) },
                DiceFace { value: 6, normal: Vector3::new(-s, -s, s) },
                DiceFace { value: 7, normal: Vector3::new(s, -s, -s) },
                DiceFace { value: 8, normal: Vector3::new(-s, -s, -s) },
            ]
        }
        DiceType::D10 => {
            // D10 face normals — computed from kite geometry
            // Upper faces (even: 0,2,4,6,8) and lower faces (odd: 3,1,9,7,5)
            let mut faces = Vec::new();
            let values_upper = [0u32, 2, 4, 6, 8];
            let values_lower = [3u32, 1, 9, 7, 5];
            for i in 0..5 {
                let angle = (i as f32) * std::f32::consts::TAU / 5.0;
                let nx = angle.cos();
                let nz = angle.sin();
                faces.push(DiceFace { value: values_upper[i], normal: Vector3::new(nx, 0.3, nz).normalize() });
            }
            for i in 0..5 {
                let angle = (i as f32) * std::f32::consts::TAU / 5.0 + std::f32::consts::TAU / 10.0;
                let nx = angle.cos();
                let nz = angle.sin();
                faces.push(DiceFace { value: values_lower[i], normal: Vector3::new(nx, -0.3, nz).normalize() });
            }
            faces
        }
        DiceType::D12 => {
            let a = 0.5257311; // 1/sqrt(phi+2) approximately
            let b = 0.8506508; // phi/sqrt(phi+2) approximately
            vec![
                DiceFace { value: 1, normal: Vector3::new(0.0, b, a) },
                DiceFace { value: 2, normal: Vector3::new(0.0, b, -a) },
                DiceFace { value: 3, normal: Vector3::new(0.0, -b, a) },
                DiceFace { value: 4, normal: Vector3::new(0.0, -b, -a) },
                DiceFace { value: 5, normal: Vector3::new(a, 0.0, b) },
                DiceFace { value: 6, normal: Vector3::new(-a, 0.0, b) },
                DiceFace { value: 7, normal: Vector3::new(a, 0.0, -b) },
                DiceFace { value: 8, normal: Vector3::new(-a, 0.0, -b) },
                DiceFace { value: 9, normal: Vector3::new(b, a, 0.0) },
                DiceFace { value: 10, normal: Vector3::new(-b, a, 0.0) },
                DiceFace { value: 11, normal: Vector3::new(b, -a, 0.0) },
                DiceFace { value: 12, normal: Vector3::new(-b, -a, 0.0) },
            ]
        }
        DiceType::D20 => {
            // Icosahedron face normals (20 faces)
            // These are the centroids of each triangular face, normalized
            let phi = (1.0 + 5.0_f32.sqrt()) / 2.0;
            let a = 1.0;
            let b = phi;
            // Vertices of icosahedron
            let verts = [
                Vector3::new(-a, b, 0.0), Vector3::new(a, b, 0.0),
                Vector3::new(-a, -b, 0.0), Vector3::new(a, -b, 0.0),
                Vector3::new(0.0, -a, b), Vector3::new(0.0, a, b),
                Vector3::new(0.0, -a, -b), Vector3::new(0.0, a, -b),
                Vector3::new(b, 0.0, -a), Vector3::new(b, 0.0, a),
                Vector3::new(-b, 0.0, -a), Vector3::new(-b, 0.0, a),
            ];
            // 20 triangular faces (vertex indices)
            let face_indices: [(usize, usize, usize); 20] = [
                (0, 11, 5), (0, 5, 1), (0, 1, 7), (0, 7, 10), (0, 10, 11),
                (1, 5, 9), (5, 11, 4), (11, 10, 2), (10, 7, 6), (7, 1, 8),
                (3, 9, 4), (3, 4, 2), (3, 2, 6), (3, 6, 8), (3, 8, 9),
                (4, 9, 5), (2, 4, 11), (6, 2, 10), (8, 6, 7), (9, 8, 1),
            ];
            face_indices.iter().enumerate().map(|(i, &(a_i, b_i, c_i))| {
                let center = (verts[a_i] + verts[b_i] + verts[c_i]) / 3.0;
                DiceFace {
                    value: (i + 1) as u32,
                    normal: center.normalize(),
                }
            }).collect()
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_d6_has_6_faces() {
        let faces = get_face_normals(DiceType::D6);
        assert_eq!(faces.len(), 6);
    }

    #[test]
    fn test_d6_opposite_faces_sum_to_7() {
        let faces = get_face_normals(DiceType::D6);
        for face in &faces {
            // Find the face with opposite normal
            let opposite = faces.iter().find(|f| {
                (f.normal + face.normal).magnitude() < 0.01
            });
            if let Some(opp) = opposite {
                assert_eq!(face.value + opp.value, 7,
                    "Opposite faces {} and {} should sum to 7", face.value, opp.value);
            }
        }
    }

    #[test]
    fn test_d20_has_20_faces() {
        let faces = get_face_normals(DiceType::D20);
        assert_eq!(faces.len(), 20);
    }

    #[test]
    fn test_d4_has_4_faces() {
        let faces = get_face_normals(DiceType::D4);
        assert_eq!(faces.len(), 4);
    }

    #[test]
    fn test_d10_has_10_faces() {
        let faces = get_face_normals(DiceType::D10);
        assert_eq!(faces.len(), 10);
    }

    #[test]
    fn test_d12_has_12_faces() {
        let faces = get_face_normals(DiceType::D12);
        assert_eq!(faces.len(), 12);
    }

    #[test]
    fn test_roll_impulse_in_range() {
        for _ in 0..100 {
            let impulse = generate_roll_impulse();
            let horizontal = (impulse.x * impulse.x + impulse.z * impulse.z).sqrt();
            assert!(horizontal >= ROLL_HORIZONTAL_MIN * 0.99, "Horizontal too small: {}", horizontal);
            assert!(horizontal <= ROLL_HORIZONTAL_MAX * 1.01, "Horizontal too large: {}", horizontal);
            assert!(impulse.y >= ROLL_VERTICAL_MIN, "Vertical too small: {}", impulse.y);
            assert!(impulse.y <= ROLL_VERTICAL_MAX, "Vertical too large: {}", impulse.y);
        }
    }

    #[test]
    fn test_spawn_position_in_bounds() {
        for _ in 0..100 {
            let pos = generate_spawn_position();
            assert!(pos[0].abs() <= 3.0);
            assert_eq!(pos[1], 2.0);
            assert!(pos[2].abs() <= 2.0);
        }
    }

    #[test]
    fn test_create_d6_body() {
        let mut world = PhysicsWorld::new();
        let initial_count = world.rigid_body_set.len();
        let handle = create_dice_body(
            DiceType::D6,
            [0.0, 2.0, 0.0],
            &mut world.rigid_body_set,
            &mut world.collider_set,
        );
        assert_eq!(world.rigid_body_set.len(), initial_count + 1);
        assert!(world.get_position(handle).is_some());
    }

    #[test]
    fn test_create_d20_body() {
        let mut world = PhysicsWorld::new();
        let handle = create_dice_body(
            DiceType::D20,
            [0.0, 2.0, 0.0],
            &mut world.rigid_body_set,
            &mut world.collider_set,
        );
        assert!(world.get_position(handle).is_some());
    }
}
```

**Step 2: Register module**

Add `mod dice;` to `server/src/main.rs`.

**Step 3: Run tests**

```bash
cd server && cargo test
```

Expected: All tests pass.

**Step 4: Commit**

```bash
git add server/src/dice.rs server/src/main.rs
git commit -m "feat(server): add dice geometries, colliders, face normals, and impulse generation"
```

---

## Task 3: Face Detection

**Files:**
- Create: `server/src/face_detection.rs`
- Modify: `server/src/main.rs`

**Step 1: Write face detection module**

Create `server/src/face_detection.rs`:

```rust
use nalgebra::{UnitQuaternion, Vector3};
use crate::dice::{get_face_normals, DiceFace};
use crate::messages::DiceType;

/// Detect which face is pointing up given a quaternion rotation.
/// Matches the client-side getDiceFaceValue() in src/lib/geometries.ts.
///
/// Algorithm:
/// 1. For each face normal, rotate it by the die's quaternion
/// 2. Dot the rotated normal with the target direction (up or down)
/// 3. The face with the highest dot product is the one showing
///
/// For d4: we check which face points DOWN (d4 rests on a face, value is on top vertex)
/// For all others: we check which face points UP
pub fn detect_face_value(rotation: [f32; 4], dice_type: DiceType) -> u32 {
    let quat = UnitQuaternion::from_quaternion(
        nalgebra::Quaternion::new(rotation[3], rotation[0], rotation[1], rotation[2])
    );

    let faces = get_face_normals(dice_type);

    // D4 reads from the bottom face (value on top), others read from top
    let target = match dice_type {
        DiceType::D4 => Vector3::new(0.0, -1.0, 0.0),
        _ => Vector3::new(0.0, 1.0, 0.0),
    };

    let mut best_value = 1;
    let mut best_dot = f32::NEG_INFINITY;

    for face in &faces {
        let rotated_normal = quat * face.normal;
        let dot = rotated_normal.dot(&target);
        if dot > best_dot {
            best_dot = dot;
            best_value = face.value;
        }
    }

    best_value
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::f32::consts::PI;

    #[test]
    fn test_d6_identity_rotation_is_6() {
        // Identity quaternion [0, 0, 0, 1] = no rotation
        // D6 face 6 has normal (0, 1, 0) = pointing up = top face
        let value = detect_face_value([0.0, 0.0, 0.0, 1.0], DiceType::D6);
        assert_eq!(value, 6, "Identity rotation should show face 6 (top)");
    }

    #[test]
    fn test_d6_flipped_upside_down_is_1() {
        // Rotate 180 degrees around X axis: face 1 (bottom) now points up
        let quat = UnitQuaternion::from_axis_angle(
            &Vector3::x_axis(),
            PI,
        );
        let q = quat.quaternion();
        let value = detect_face_value([q.i, q.j, q.k, q.w], DiceType::D6);
        assert_eq!(value, 1, "Flipped d6 should show face 1");
    }

    #[test]
    fn test_d6_rotated_90_around_x() {
        // 90 degrees around X axis: face 5 (back, normal 0,0,-1) ends up pointing up
        let quat = UnitQuaternion::from_axis_angle(
            &Vector3::x_axis(),
            PI / 2.0,
        );
        let q = quat.quaternion();
        let value = detect_face_value([q.i, q.j, q.k, q.w], DiceType::D6);
        assert_eq!(value, 5, "90deg X rotation should show face 5");
    }

    #[test]
    fn test_d6_rotated_90_around_z() {
        // 90 degrees around Z axis: face 3 (right, normal 1,0,0) ends up pointing up
        let quat = UnitQuaternion::from_axis_angle(
            &Vector3::z_axis(),
            PI / 2.0,
        );
        let q = quat.quaternion();
        let value = detect_face_value([q.i, q.j, q.k, q.w], DiceType::D6);
        // When rotating 90 around Z: Y->-X, so (0,1,0) goes to (-1,0,0)
        // The face with normal closest to new up is face 4 (normal -1,0,0)... wait
        // Actually: rotating the die 90 around Z means face 3 (normal 1,0,0) rotates to (0,1,0)
        // No - we rotate the NORMAL by the quaternion. If die rotates +90 around Z:
        // Face with original normal (1,0,0) -> after rotation -> (0,1,0) = up
        assert_eq!(value, 3, "90deg Z rotation should show face 3");
    }

    #[test]
    fn test_d20_identity_returns_valid_value() {
        let value = detect_face_value([0.0, 0.0, 0.0, 1.0], DiceType::D20);
        assert!(value >= 1 && value <= 20, "D20 value should be 1-20, got {}", value);
    }

    #[test]
    fn test_all_dice_types_return_valid_range() {
        let types_and_max = [
            (DiceType::D4, 4),
            (DiceType::D6, 6),
            (DiceType::D8, 8),
            (DiceType::D10, 9), // D10 values are 0-9
            (DiceType::D12, 12),
            (DiceType::D20, 20),
        ];
        for (dice_type, max) in types_and_max {
            let value = detect_face_value([0.0, 0.0, 0.0, 1.0], dice_type);
            assert!(value <= max, "{:?} returned {}, expected <= {}", dice_type, value, max);
        }
    }
}
```

**Step 2: Register module**

Add `mod face_detection;` to `server/src/main.rs`.

**Step 3: Run tests**

```bash
cd server && cargo test
```

Expected: All tests pass.

**Step 4: Commit**

```bash
git add server/src/face_detection.rs server/src/main.rs
git commit -m "feat(server): add face detection algorithm matching client-side implementation"
```

---

## Task 4: Simulation Loop & Snapshot Generation

**Files:**
- Modify: `server/src/room.rs`

**Step 1: Add physics integration to Room**

This task integrates the physics world into the Room struct and adds the simulation loop logic. Update `server/src/room.rs`:

Add these imports at the top:
```rust
use std::time::Duration;
use rapier3d::prelude::RigidBodyHandle;
use crate::physics::PhysicsWorld;
use crate::dice::{create_dice_body, generate_roll_impulse, generate_roll_torque, generate_spawn_position};
use crate::face_detection::detect_face_value;
```

Add `RigidBodyHandle` tracking to `ServerDie`:
```rust
pub struct ServerDie {
    pub id: String,
    pub owner_id: String,
    pub dice_type: DiceType,
    pub position: [f32; 3],
    pub rotation: [f32; 4],
    pub is_rolling: bool,
    pub face_value: Option<u32>,
    pub body_handle: Option<RigidBodyHandle>,
    pub rest_start_tick: Option<u64>,
}
```

Add `physics` field to Room:
```rust
pub struct Room {
    pub id: String,
    pub players: HashMap<String, Player>,
    pub dice: HashMap<String, ServerDie>,
    pub last_activity: Instant,
    pub is_simulating: bool,
    pub tick_count: u64,
    pub physics: PhysicsWorld,
}
```

Update `Room::new`:
```rust
pub fn new(id: String) -> Self {
    Self {
        id,
        players: HashMap::new(),
        dice: HashMap::new(),
        last_activity: Instant::now(),
        is_simulating: false,
        tick_count: 0,
        physics: PhysicsWorld::new(),
    }
}
```

Add physics-aware methods:

```rust
/// Spawn dice with physics bodies
pub fn spawn_dice_with_physics(&mut self, owner_id: &str, entries: Vec<(String, DiceType)>) -> Result<Vec<DiceState>, String> {
    if self.dice.len() + entries.len() > MAX_DICE {
        return Err("DICE_LIMIT".to_string());
    }
    if !self.players.contains_key(owner_id) {
        return Err("PLAYER_NOT_FOUND".to_string());
    }

    let mut spawned = Vec::new();
    for (id, dice_type) in entries {
        let position = generate_spawn_position();
        let body_handle = create_dice_body(
            dice_type,
            position,
            &mut self.physics.rigid_body_set,
            &mut self.physics.collider_set,
        );
        let rotation = self.physics.get_rotation(body_handle).unwrap_or([0.0, 0.0, 0.0, 1.0]);

        let die = ServerDie {
            id: id.clone(),
            owner_id: owner_id.to_string(),
            dice_type,
            position,
            rotation,
            is_rolling: false,
            face_value: None,
            body_handle: Some(body_handle),
            rest_start_tick: None,
        };
        spawned.push(DiceState {
            id: id.clone(),
            owner_id: owner_id.to_string(),
            dice_type,
            position,
            rotation,
        });
        if let Some(player) = self.players.get_mut(owner_id) {
            player.dice_ids.push(id.clone());
        }
        self.dice.insert(id, die);
    }

    self.touch();
    Ok(spawned)
}

/// Apply roll impulse to all of a player's dice
pub fn roll_player_dice(&mut self, player_id: &str) -> Vec<String> {
    let dice_ids: Vec<String> = self.dice.iter()
        .filter(|(_, d)| d.owner_id == player_id)
        .map(|(id, _)| id.clone())
        .collect();

    for dice_id in &dice_ids {
        if let Some(die) = self.dice.get_mut(dice_id) {
            if let Some(handle) = die.body_handle {
                if let Some(rb) = self.physics.rigid_body_set.get_mut(handle) {
                    let impulse = generate_roll_impulse();
                    let torque = generate_roll_torque();
                    rb.apply_impulse(impulse, true);
                    rb.apply_torque_impulse(torque, true);
                }
                die.is_rolling = true;
                die.face_value = None;
                die.rest_start_tick = None;
            }
        }
    }

    self.is_simulating = true;
    self.touch();
    dice_ids
}

/// Step physics and check for settled dice.
/// Returns (snapshot, newly_settled_dice) tuple.
pub fn physics_tick(&mut self) -> (Option<ServerMessage>, Vec<(String, u32)>) {
    self.physics.step();
    self.tick_count += 1;

    // Update positions from physics
    for die in self.dice.values_mut() {
        if let Some(handle) = die.body_handle {
            if let Some(pos) = self.physics.get_position(handle) {
                die.position = pos;
            }
            if let Some(rot) = self.physics.get_rotation(handle) {
                die.rotation = rot;
            }
        }
    }

    // Build snapshot every 3rd tick (20Hz)
    let snapshot = if self.tick_count % 3 == 0 {
        let dice_snapshots: Vec<DiceSnapshot> = self.dice.values()
            .filter(|d| d.is_rolling)
            .map(|d| DiceSnapshot {
                id: d.id.clone(),
                position: d.position,
                rotation: d.rotation,
            })
            .collect();

        if !dice_snapshots.is_empty() {
            Some(ServerMessage::PhysicsSnapshot {
                tick: self.tick_count,
                dice: dice_snapshots,
            })
        } else {
            None
        }
    } else {
        None
    };

    // Check for newly settled dice
    let rest_ticks = (REST_DURATION_MS as f64 / (1000.0 / 60.0)) as u64; // ~30 ticks
    let mut newly_settled = Vec::new();

    let dice_ids: Vec<String> = self.dice.keys().cloned().collect();
    for dice_id in dice_ids {
        let (is_rolling, handle, rest_start, dice_type, rotation) = {
            let die = &self.dice[&dice_id];
            (die.is_rolling, die.body_handle, die.rest_start_tick, die.dice_type, die.rotation)
        };

        if !is_rolling {
            continue;
        }

        if let Some(handle) = handle {
            if self.physics.is_at_rest(handle) {
                let die = self.dice.get_mut(&dice_id).unwrap();
                match rest_start {
                    None => {
                        die.rest_start_tick = Some(self.tick_count);
                    }
                    Some(start) if self.tick_count - start >= rest_ticks => {
                        let face_value = detect_face_value(rotation, dice_type);
                        die.is_rolling = false;
                        die.face_value = Some(face_value);
                        newly_settled.push((dice_id.clone(), face_value));
                    }
                    _ => {}
                }
            } else {
                // Reset rest timer if dice starts moving again
                let die = self.dice.get_mut(&dice_id).unwrap();
                die.rest_start_tick = None;
            }
        }
    }

    // Check if all dice are settled
    let any_rolling = self.dice.values().any(|d| d.is_rolling);
    if !any_rolling {
        self.is_simulating = false;
    }

    (snapshot, newly_settled)
}

/// Check if a full roll is complete for a player (all their dice settled)
pub fn is_player_roll_complete(&self, player_id: &str) -> bool {
    self.dice.iter()
        .filter(|(_, d)| d.owner_id == player_id)
        .all(|(_, d)| !d.is_rolling)
}

/// Get roll results for a player
pub fn get_player_results(&self, player_id: &str) -> (Vec<DieResult>, u32) {
    let results: Vec<DieResult> = self.dice.iter()
        .filter(|(_, d)| d.owner_id == player_id && d.face_value.is_some())
        .map(|(_, d)| DieResult {
            dice_id: d.id.clone(),
            dice_type: d.dice_type,
            face_value: d.face_value.unwrap(),
        })
        .collect();
    let total: u32 = results.iter().map(|r| r.face_value).sum();
    (results, total)
}
```

**Step 2: Add simulation loop tests**

Add to the `#[cfg(test)]` module in `room.rs`:

```rust
#[test]
fn test_spawn_dice_with_physics() {
    let mut room = Room::new("test".to_string());
    let player = make_player("p1", "Gandalf");
    room.add_player(player).unwrap();

    let result = room.spawn_dice_with_physics("p1", vec![
        ("d1".to_string(), DiceType::D6),
    ]);
    assert!(result.is_ok());
    assert_eq!(room.dice_count(), 1);
    assert!(room.dice.get("d1").unwrap().body_handle.is_some());
}

#[test]
fn test_roll_marks_dice_as_rolling() {
    let mut room = Room::new("test".to_string());
    let player = make_player("p1", "Gandalf");
    room.add_player(player).unwrap();
    room.spawn_dice_with_physics("p1", vec![("d1".to_string(), DiceType::D6)]).unwrap();

    let rolled = room.roll_player_dice("p1");
    assert_eq!(rolled.len(), 1);
    assert!(room.dice.get("d1").unwrap().is_rolling);
    assert!(room.is_simulating);
}

#[test]
fn test_physics_tick_produces_snapshots() {
    let mut room = Room::new("test".to_string());
    let player = make_player("p1", "Gandalf");
    room.add_player(player).unwrap();
    room.spawn_dice_with_physics("p1", vec![("d1".to_string(), DiceType::D6)]).unwrap();
    room.roll_player_dice("p1");

    // Tick 3 times to get a snapshot (every 3rd tick)
    let (snap1, _) = room.physics_tick();
    let (snap2, _) = room.physics_tick();
    let (snap3, _) = room.physics_tick();

    assert!(snap1.is_none() || snap2.is_none()); // Not every tick
    assert!(snap3.is_some()); // 3rd tick should have snapshot
}

#[test]
fn test_dice_eventually_settle() {
    let mut room = Room::new("test".to_string());
    let player = make_player("p1", "Test");
    room.add_player(player).unwrap();
    room.spawn_dice_with_physics("p1", vec![("d1".to_string(), DiceType::D6)]).unwrap();
    room.roll_player_dice("p1");

    // Run simulation for up to 10 seconds (600 ticks)
    let mut settled = false;
    for _ in 0..600 {
        let (_, newly_settled) = room.physics_tick();
        if !newly_settled.is_empty() {
            settled = true;
            break;
        }
    }

    assert!(settled, "Dice should settle within 10 seconds");
    assert!(!room.is_simulating, "Room should stop simulating after all dice settle");

    let die = room.dice.get("d1").unwrap();
    assert!(die.face_value.is_some(), "Settled die should have a face value");
    let value = die.face_value.unwrap();
    assert!(value >= 1 && value <= 6, "D6 should show 1-6, got {}", value);
}
```

**Step 3: Run tests**

```bash
cd server && cargo test
```

Expected: All tests pass. The settlement test may take a moment.

**Step 4: Commit**

```bash
git add server/src/room.rs server/src/physics.rs server/src/dice.rs
git commit -m "feat(server): integrate Rapier physics into Room with simulation loop and settlement detection"
```

---

## Notes for Plan 03 (WebSocket Networking)

The simulation loop (`physics_tick`) is designed to be called from a tokio task at 60Hz:

```rust
// Pseudocode for the room tick task (implemented in Plan 03)
loop {
    tokio::time::sleep(Duration::from_millis(16)).await; // ~60Hz
    let room = room.write().await;
    if !room.is_simulating { break; }
    let (snapshot, settled) = room.physics_tick();
    if let Some(snap) = snapshot { room.broadcast(&snap); }
    for (dice_id, face_value) in settled { /* send DieSettled + check RollComplete */ }
}
```
