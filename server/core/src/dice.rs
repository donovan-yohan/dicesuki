use rapier3d::prelude::*;
use nalgebra::{Vector3, UnitQuaternion};
use rand::Rng;
use crate::messages::DiceType;
use crate::physics::{
    ArenaBounds, PhysicsWorld, DICE_RESTITUTION, DICE_FRICTION,
    ROLL_HORIZONTAL_MIN, ROLL_HORIZONTAL_MAX, ROLL_VERTICAL_MIN, ROLL_VERTICAL_MAX,
    ROLL_TORQUE_MAGNITUDE, SPAWN_HEIGHT, SPAWN_LANE_SPACING, SPAWN_ROW_SPACING,
    SPAWN_JITTER, SPAWN_WALL_MARGIN, SPAWN_LAYER_SPACING,
};

/// Face definition for face detection
#[derive(Debug, Clone)]
pub struct DiceFace {
    pub value: u32,
    pub normal: Vector3<f32>,
}

/// Dice size (half-extent for d6, approximate radius for others)
pub const DICE_SIZE: f32 = 0.5;

/// Create a rigid body and collider for a given dice type at a spawn position,
/// inserting them into the provided `PhysicsWorld`.
pub fn create_dice_body(
    dice_type: DiceType,
    position: [f32; 3],
    world: &mut PhysicsWorld,
) -> RigidBodyHandle {
    let mut rng = rand::thread_rng();

    // Random initial rotation
    let rot = UnitQuaternion::from_euler_angles(
        rng.gen_range(0.0..std::f32::consts::TAU),
        rng.gen_range(0.0..std::f32::consts::TAU),
        rng.gen_range(0.0..std::f32::consts::TAU),
    );

    let (roll, pitch, yaw) = rot.euler_angles();
    let body = RigidBodyBuilder::dynamic()
        .translation(vector![position[0], position[1], position[2]])
        .rotation(vector![roll, pitch, yaw])
        .can_sleep(false)
        // Continuous collision detection: at MAX_DICE_VELOCITY a die travels
        // 1.82 U per 1/120 s substep, more than the 1.0 U wall slabs, so the sweep
        // is required to keep fast throws from tunnelling (Shared-ADR-005/007).
        .ccd_enabled(true)
        .build();

    let collider = if dice_type == DiceType::D6 {
        // Plain (sharp-edged) cube: the chamfer was removed to restore the legacy
        // settle-creep fix (a rounded cube micro-rolls forever under loose settle
        // thresholds) and to give the die its full mass (m = 1.0, I = 1/6), which
        // the recalibrated roll torque assumes.
        ColliderBuilder::cuboid(DICE_SIZE, DICE_SIZE, DICE_SIZE)
    } else {
        // For non-d6 dice, use convex hull from vertices
        let vertices = get_dice_vertices(dice_type);
        ColliderBuilder::convex_hull(&vertices)
            .unwrap_or_else(|| ColliderBuilder::ball(DICE_SIZE))
    }
    .restitution(DICE_RESTITUTION)
    .friction(DICE_FRICTION)
    .density(1.0)
    .build();

    world.spawn_body(body, collider)
}

/// Generate a random roll impulse matching client-side parameters
#[must_use]
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

/// Generate a random per-axis target spin (angular velocity, rad/s) for realistic
/// tumbling. Each axis gets an independent random Δω in
/// `-ROLL_TORQUE_MAGNITUDE ..= ROLL_TORQUE_MAGNITUDE` — the single roll-feel spin
/// truth (see [`ROLL_TORQUE_MAGNITUDE`]) — applied per body via
/// [`crate::physics::PhysicsWorld::apply_spin_impulse`], which scales it by the
/// die's actual inertia so every hull tumbles at the same rate. Identical for solo
/// and multiplayer.
#[must_use]
pub fn generate_roll_spin() -> Vector3<f32> {
    let mut rng = rand::thread_rng();
    Vector3::new(
        rng.gen_range(-ROLL_TORQUE_MAGNITUDE..ROLL_TORQUE_MAGNITUDE),
        rng.gen_range(-ROLL_TORQUE_MAGNITUDE..ROLL_TORQUE_MAGNITUDE),
        rng.gen_range(-ROLL_TORQUE_MAGNITUDE..ROLL_TORQUE_MAGNITUDE),
    )
}

/// Compute the spawn position for the `n`-th die of a batch, dropped above the
/// table and fanned out so a multi-die batch (e.g. a saved roll) never spawns
/// dice inside one another.
///
/// The fan-out is an X×Z grid **sized to the current arena**: as many lanes on X
/// ([`SPAWN_LANE_SPACING`]) and rows on Z ([`SPAWN_ROW_SPACING`]) as fit inside
/// `bounds` (less [`SPAWN_WALL_MARGIN`]), centered on the table so a wide
/// (landscape) arena fans across more lanes and a deep (portrait) one across more
/// rows. Grid cells are always ≥ `SPAWN_LANE_SPACING` (1.12 U) apart, so even at
/// jitter extremes (±[`SPAWN_JITTER`] per axis) no two same-layer dice come within
/// `1.12 − 2·SPAWN_JITTER` = 0.68 U of each other. Uniform [`SPAWN_JITTER`] on each
/// axis keeps same-cell draws from stacking perfectly.
///
/// When a batch exhausts the layer-0 grid, overflow dice drop from a **higher
/// layer** (`y += SPAWN_LAYER_SPACING`) with the grid restarting — a second
/// handful dropped above the first — instead of clamping onto an occupied cell
/// (the interpenetration bug this replaces). For any in-range aspect the layer-0
/// grid already holds a full [`crate::room::MAX_DICE`] batch, so layering is a
/// guarded overflow. `n` is the die's index across the room (existing dice count +
/// position within the batch), so successive batches keep fanning out.
#[must_use]
#[allow(clippy::cast_precision_loss)] // lane/row/layer indices are small integers — lossless in f32
pub fn generate_spawn_position(n: usize, bounds: &ArenaBounds) -> [f32; 3] {
    let mut rng = rand::thread_rng();

    // Lanes (X) and rows (Z) that fit the current arena, centered on the table.
    let lane_span = (bounds.half_x - SPAWN_WALL_MARGIN).max(0.0) * 2.0;
    let row_span = (bounds.half_z - SPAWN_WALL_MARGIN).max(0.0) * 2.0;
    #[allow(clippy::cast_possible_truncation, clippy::cast_sign_loss)] // spans are small, non-negative
    let lanes = (lane_span / SPAWN_LANE_SPACING) as usize + 1; // ≥ 1
    #[allow(clippy::cast_possible_truncation, clippy::cast_sign_loss)]
    let rows = (row_span / SPAWN_ROW_SPACING) as usize + 1; // ≥ 1
    let per_layer = lanes * rows;

    let layer = n / per_layer;
    let cell = n % per_layer;
    let col = cell % lanes;
    let row = cell / lanes;

    // Center each grid axis about 0: the extreme cell sits at
    // (count-1)/2 · spacing ≤ half_extent − margin, so the whole grid (plus jitter)
    // stays inside the walls for every aspect.
    let x = (col as f32 - (lanes - 1) as f32 / 2.0) * SPAWN_LANE_SPACING
        + rng.gen_range(-SPAWN_JITTER..SPAWN_JITTER);
    let z = (row as f32 - (rows - 1) as f32 / 2.0) * SPAWN_ROW_SPACING
        + rng.gen_range(-SPAWN_JITTER..SPAWN_JITTER);
    let y = SPAWN_HEIGHT + layer as f32 * SPAWN_LAYER_SPACING;

    [x, y, z]
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
            // Match the client pentagonal trapezohedron vertices in
            // src/lib/geometries.ts so the server collider rests on the same
            // face planes the client renders and labels.
            let mut verts = vec![point![0.0, s, 0.0], point![0.0, -s, 0.0]];
            let altitude = (std::f32::consts::PI / 10.0).tan().powi(2) * s;
            for i in 0..10_i32 {
                #[allow(clippy::cast_possible_truncation)]
                let angle = (f64::from(i) as f32) * std::f32::consts::TAU / 10.0;
                let y = if i % 2 == 0 { -altitude } else { altitude };
                verts.push(point![-angle.cos() * s, y, -angle.sin() * s]);
            }
            verts
        }
        DiceType::D12 => {
            // Regular dodecahedron
            let phi = f32::midpoint(1.0, 5.0_f32.sqrt());
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
            let phi = f32::midpoint(1.0, 5.0_f32.sqrt());
            let a = s * 0.5;
            let b = s * 0.5 * phi;
            vec![
                point![-a, b, 0.0], point![a, b, 0.0], point![-a, -b, 0.0], point![a, -b, 0.0],
                point![0.0, -a, b], point![0.0, a, b], point![0.0, -a, -b], point![0.0, a, -b],
                point![b, 0.0, -a], point![b, 0.0, a], point![-b, 0.0, -a], point![-b, 0.0, a],
            ]
        }
        DiceType::D6 => {
            // Not used (d6 uses a plain cuboid collider) but included for completeness
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
#[must_use]
pub fn get_face_normals(dice_type: DiceType) -> Vec<DiceFace> {
    match dice_type {
        DiceType::D4 => {
            let s = 1.0 / 3.0_f32.sqrt();
            vec![
                DiceFace { value: 1, normal: Vector3::new(-s, s, s) },
                DiceFace { value: 2, normal: Vector3::new(s, s, -s) },
                DiceFace { value: 3, normal: Vector3::new(s, -s, s) },
                DiceFace { value: 4, normal: Vector3::new(-s, -s, -s) },
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
                DiceFace { value: 2, normal: Vector3::new(s, -s, s) },
                DiceFace { value: 3, normal: Vector3::new(s, -s, -s) },
                DiceFace { value: 4, normal: Vector3::new(s, s, -s) },
                DiceFace { value: 7, normal: Vector3::new(-s, s, -s) },
                DiceFace { value: 8, normal: Vector3::new(-s, -s, -s) },
                DiceFace { value: 5, normal: Vector3::new(-s, -s, s) },
                DiceFace { value: 6, normal: Vector3::new(-s, s, s) },
            ]
        }
        DiceType::D10 => {
            // Normals extracted from client Three.js D10 geometry (createD10Geometry)
            // to ensure perfect alignment with rendered faces.
            // Upper kites (0-4): values [0, 2, 4, 6, 8]
            // Lower kites (5-9): values [3, 1, 9, 7, 5]
            vec![
                DiceFace { value: 0, normal: Vector3::new(-0.741_629, 0.670_810, 0.0).normalize() },
                DiceFace { value: 2, normal: Vector3::new(-0.229_176, 0.670_810, -0.705_331).normalize() },
                DiceFace { value: 4, normal: Vector3::new(0.599_991, 0.670_810, -0.435_919).normalize() },
                DiceFace { value: 6, normal: Vector3::new(0.599_991, 0.670_810, 0.435_919).normalize() },
                DiceFace { value: 8, normal: Vector3::new(-0.229_176, 0.670_810, 0.705_331).normalize() },
                DiceFace { value: 3, normal: Vector3::new(-0.599_991, -0.670_810, -0.435_919).normalize() },
                DiceFace { value: 1, normal: Vector3::new(0.229_176, -0.670_810, -0.705_331).normalize() },
                DiceFace { value: 9, normal: Vector3::new(0.741_629, -0.670_810, 0.0).normalize() },
                DiceFace { value: 7, normal: Vector3::new(0.229_176, -0.670_810, 0.705_331).normalize() },
                DiceFace { value: 5, normal: Vector3::new(-0.599_991, -0.670_810, 0.435_919).normalize() },
            ]
        }
        DiceType::D12 => {
            let a: f32 = 0.525_731_1;
            let b: f32 = 0.850_650_8;
            vec![
                DiceFace { value: 1,  normal: Vector3::new(0.0, b, a) },
                DiceFace { value: 2,  normal: Vector3::new(b, a, 0.0) },
                DiceFace { value: 3,  normal: Vector3::new(a, 0.0, -b) },
                DiceFace { value: 4,  normal: Vector3::new(-a, 0.0, -b) },
                DiceFace { value: 11, normal: Vector3::new(-b, -a, 0.0) },
                DiceFace { value: 5,  normal: Vector3::new(0.0, b, -a) },
                DiceFace { value: 6,  normal: Vector3::new(-b, a, 0.0) },
                DiceFace { value: 10, normal: Vector3::new(-a, 0.0, b) },
                DiceFace { value: 12, normal: Vector3::new(0.0, -b, -a) },
                DiceFace { value: 9,  normal: Vector3::new(a, 0.0, b) },
                DiceFace { value: 7,  normal: Vector3::new(b, -a, 0.0) },
                DiceFace { value: 8,  normal: Vector3::new(0.0, -b, a) },
            ]
        }
        DiceType::D20 => {
            // Normals extracted from Three.js IcosahedronGeometry to match client exactly.
            // Opposite faces sum to 21.
            vec![
                DiceFace { value: 1,  normal: Vector3::new(-0.5774, 0.5774, 0.5774).normalize() },
                DiceFace { value: 2,  normal: Vector3::new(0.0000, 0.9342, 0.3568).normalize() },
                DiceFace { value: 3,  normal: Vector3::new(0.0000, 0.9342, -0.3568).normalize() },
                DiceFace { value: 4,  normal: Vector3::new(-0.5774, 0.5774, -0.5774).normalize() },
                DiceFace { value: 5,  normal: Vector3::new(-0.9342, 0.3568, 0.0000).normalize() },
                DiceFace { value: 6,  normal: Vector3::new(0.5774, 0.5774, 0.5774).normalize() },
                DiceFace { value: 7,  normal: Vector3::new(-0.3568, 0.0000, 0.9342).normalize() },
                DiceFace { value: 8,  normal: Vector3::new(-0.9342, -0.3568, 0.0000).normalize() },
                DiceFace { value: 9,  normal: Vector3::new(-0.3568, 0.0000, -0.9342).normalize() },
                DiceFace { value: 10, normal: Vector3::new(0.5774, 0.5774, -0.5774).normalize() },
                DiceFace { value: 17, normal: Vector3::new(0.5774, -0.5774, 0.5774).normalize() },
                DiceFace { value: 18, normal: Vector3::new(0.0000, -0.9342, 0.3568).normalize() },
                DiceFace { value: 19, normal: Vector3::new(0.0000, -0.9342, -0.3568).normalize() },
                DiceFace { value: 20, normal: Vector3::new(0.5774, -0.5774, -0.5774).normalize() },
                DiceFace { value: 16, normal: Vector3::new(0.9342, -0.3568, 0.0000).normalize() },
                DiceFace { value: 12, normal: Vector3::new(0.3568, 0.0000, 0.9342).normalize() },
                DiceFace { value: 11, normal: Vector3::new(-0.5774, -0.5774, 0.5774).normalize() },
                DiceFace { value: 15, normal: Vector3::new(-0.5774, -0.5774, -0.5774).normalize() },
                DiceFace { value: 14, normal: Vector3::new(0.3568, 0.0000, -0.9342).normalize() },
                DiceFace { value: 13, normal: Vector3::new(0.9342, 0.3568, 0.0000).normalize() },
            ]
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
    fn test_d8_opposite_faces_sum_to_9() {
        let faces = get_face_normals(DiceType::D8);
        for face in &faces {
            let opposite = faces.iter().find(|f| {
                (f.normal + face.normal).magnitude() < 0.01
            });
            if let Some(opp) = opposite {
                assert_eq!(face.value + opp.value, 9,
                    "D8 opposite faces {} and {} should sum to 9", face.value, opp.value);
            }
        }
    }

    #[test]
    fn test_d10_opposite_faces_sum_to_9() {
        let faces = get_face_normals(DiceType::D10);
        for face in &faces {
            let opposite = faces.iter().find(|f| {
                (f.normal + face.normal).magnitude() < 0.01
            });
            if let Some(opp) = opposite {
                assert_eq!(face.value + opp.value, 9,
                    "D10 opposite faces {} and {} should sum to 9", face.value, opp.value);
            }
        }
    }

    #[test]
    fn test_d12_opposite_faces_sum_to_13() {
        let faces = get_face_normals(DiceType::D12);
        for face in &faces {
            let opposite = faces.iter().find(|f| {
                (f.normal + face.normal).magnitude() < 0.01
            });
            if let Some(opp) = opposite {
                assert_eq!(face.value + opp.value, 13,
                    "D12 opposite faces {} and {} should sum to 13", face.value, opp.value);
            }
        }
    }

    #[test]
    fn test_d20_opposite_faces_sum_to_21() {
        let faces = get_face_normals(DiceType::D20);
        for face in &faces {
            let opposite = faces.iter().find(|f| {
                (f.normal + face.normal).magnitude() < 0.01
            });
            if let Some(opp) = opposite {
                assert_eq!(face.value + opp.value, 21,
                    "D20 opposite faces {} and {} should sum to 21", face.value, opp.value);
            }
        }
    }

    #[test]
    fn test_roll_impulse_in_range() {
        for _ in 0..100 {
            let impulse = generate_roll_impulse();
            let horizontal = (impulse.x * impulse.x + impulse.z * impulse.z).sqrt();
            assert!(horizontal >= ROLL_HORIZONTAL_MIN * 0.99, "Horizontal too small: {horizontal}");
            assert!(horizontal <= ROLL_HORIZONTAL_MAX * 1.01, "Horizontal too large: {horizontal}");
            assert!(impulse.y >= ROLL_VERTICAL_MIN, "Vertical too small: {}", impulse.y);
            assert!(impulse.y <= ROLL_VERTICAL_MAX, "Vertical too large: {}", impulse.y);
        }
    }

    #[test]
    #[allow(clippy::float_cmp)]
    fn test_spawn_position_in_bounds() {
        // Every spawned die drops from SPAWN_HEIGHT (layer 0 — the arena-sized grid
        // holds the whole batch) and lands strictly inside the arena walls, for both
        // the default arena and an aspect-fitted one, across a large batch. The grid
        // is centered on both axes, so X and Z are symmetric about 0.
        use crate::physics::{SPAWN_HEIGHT, SPAWN_JITTER, SPAWN_WALL_MARGIN};
        for bounds in [ArenaBounds::default(), ArenaBounds::from_aspect(1.0)] {
            for n in 0..40usize {
                let pos = generate_spawn_position(n, &bounds);
                assert_eq!(pos[1], SPAWN_HEIGHT, "layer-0 spawn height is SPAWN_HEIGHT");
                assert!(pos[0].abs() <= bounds.half_x - SPAWN_WALL_MARGIN + SPAWN_JITTER + 1e-4);
                assert!(pos[0].abs() < bounds.half_x, "x inside wall: {}", pos[0]);
                assert!(pos[2].abs() <= bounds.half_z - SPAWN_WALL_MARGIN + SPAWN_JITTER + 1e-4);
                assert!(pos[2].abs() < bounds.half_z, "z inside wall: {}", pos[2]);
            }
        }
    }

    #[test]
    fn test_spawn_batch_has_no_interpenetration_any_aspect() {
        // A full MAX_DICE batch must fan out with no two dice within
        // (1 U − 2·SPAWN_JITTER) of each other, for every in-range aspect and at
        // jitter extremes — the guarantee the layered, arena-sized grid gives in
        // place of the old row-clamp that stacked overflow dice onto one cell.
        // (Nominal grid cells are ≥ SPAWN_LANE_SPACING = 1.12 U apart; worst-case
        // jitter of both dice removes at most 2·SPAWN_JITTER = 0.44 U, so the true
        // floor is ~0.68 U — comfortably above the asserted 1 U − 0.44 U = 0.56 U.)
        use crate::physics::SPAWN_JITTER;
        let min_separation = 1.0 - 2.0 * SPAWN_JITTER; // 0.56 U
        let aspects = [0.4_f32, 0.5625, 0.75, 1.0, 1.5, 2.0, 2.4];
        for aspect in aspects {
            let bounds = ArenaBounds::from_aspect(aspect);
            for _ in 0..50 {
                let positions: Vec<[f32; 3]> = (0..crate::room::MAX_DICE)
                    .map(|n| generate_spawn_position(n, &bounds))
                    .collect();
                for i in 0..positions.len() {
                    for j in (i + 1)..positions.len() {
                        let (a, b) = (positions[i], positions[j]);
                        let d = ((a[0] - b[0]).powi(2)
                            + (a[1] - b[1]).powi(2)
                            + (a[2] - b[2]).powi(2))
                        .sqrt();
                        assert!(
                            d >= min_separation,
                            "aspect {aspect}: dice {i},{j} only {d} U apart (< {min_separation})"
                        );
                    }
                }
            }
        }
    }

    #[test]
    fn test_spawn_overflow_stacks_into_layers() {
        // Past the layer-0 grid, overflow dice rise by SPAWN_LAYER_SPACING rather
        // than clamping onto an occupied cell (the interpenetration this replaces).
        use crate::physics::{SPAWN_HEIGHT, SPAWN_LAYER_SPACING};
        // The widest (landscape) arena has the smallest per-layer grid, so overflow
        // is reachable within a modest index range.
        let bounds = ArenaBounds::from_aspect(2.4);
        let first_layer1 = (0..400)
            .find(|&n| generate_spawn_position(n, &bounds)[1] > SPAWN_HEIGHT + 0.5)
            .expect("overflow must eventually rise to a new layer");
        let y = generate_spawn_position(first_layer1, &bounds)[1];
        assert!(
            (y - (SPAWN_HEIGHT + SPAWN_LAYER_SPACING)).abs() < 1e-3,
            "first overflow layer y = SPAWN_HEIGHT + SPAWN_LAYER_SPACING, got {y}"
        );
    }

    #[test]
    fn apply_spin_impulse_is_exact_for_the_d6() {
        // The d6 (I = 1/6 M·U² isotropic) must reproduce the target Δω exactly, so
        // re-expressing the roll (torque 4.2 → spin rate 25.2) leaves d6 behavior
        // numerically unchanged.
        use crate::physics::{PhysicsWorld, ROLL_TORQUE_MAGNITUDE};
        let mut world = PhysicsWorld::new();
        let handle = create_dice_body(DiceType::D6, [0.0, 5.0, 0.0], &mut world);
        world.set_angular_velocity(handle, [0.0, 0.0, 0.0]);
        world.apply_spin_impulse(handle, [ROLL_TORQUE_MAGNITUDE, 0.0, 0.0]);
        let omega = world.get_angular_speed(handle);
        assert!(
            (omega - ROLL_TORQUE_MAGNITUDE).abs() < 1e-2,
            "d6 spin {omega} must equal target {ROLL_TORQUE_MAGNITUDE}"
        );
    }

    #[test]
    fn apply_spin_impulse_gives_every_die_the_same_rate() {
        // A per-axis target Δω must produce ~that angular speed on every die type,
        // regardless of hull inertia — the fix for d20/d4 spinning several times
        // faster than the calibrated d6 off a raw torque impulse.
        use crate::physics::{PhysicsWorld, ROLL_TORQUE_MAGNITUDE};
        let target = ROLL_TORQUE_MAGNITUDE;
        for dice_type in [
            DiceType::D4,
            DiceType::D6,
            DiceType::D8,
            DiceType::D10,
            DiceType::D12,
            DiceType::D20,
        ] {
            let mut world = PhysicsWorld::new();
            let handle = create_dice_body(dice_type, [0.0, 5.0, 0.0], &mut world);
            world.set_angular_velocity(handle, [0.0, 0.0, 0.0]);
            world.apply_spin_impulse(handle, [target, 0.0, 0.0]);
            let omega = world.get_angular_speed(handle);
            // Platonic dice are isotropic tops (exact); the d10 is mildly anisotropic.
            assert!(
                (omega - target).abs() <= 0.25 * target,
                "{dice_type:?} spin {omega} vs target {target}"
            );
        }
    }

    #[test]
    fn test_create_d6_body() {
        let mut world = PhysicsWorld::new();
        let initial_count = world.rigid_body_set.len();
        let handle = create_dice_body(DiceType::D6, [0.0, 2.0, 0.0], &mut world);
        assert_eq!(world.rigid_body_set.len(), initial_count + 1);
        assert!(world.get_position(handle).is_some());
    }

    #[test]
    fn test_create_d20_body() {
        let mut world = PhysicsWorld::new();
        let handle = create_dice_body(DiceType::D20, [0.0, 2.0, 0.0], &mut world);
        assert!(world.get_position(handle).is_some());
    }
}
