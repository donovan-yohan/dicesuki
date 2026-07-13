use rapier3d::prelude::*;
use nalgebra::{Vector3, UnitQuaternion};
use rand::Rng;
use crate::messages::DiceType;
use crate::physics::{PhysicsWorld, EDGE_CHAMFER_RADIUS, DICE_RESTITUTION, DICE_FRICTION, ROLL_HORIZONTAL_MIN, ROLL_HORIZONTAL_MAX, ROLL_VERTICAL_MIN, ROLL_VERTICAL_MAX, ROLL_TORQUE_MAGNITUDE};

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
        .build();

    let collider = if dice_type == DiceType::D6 {
        ColliderBuilder::round_cuboid(
            DICE_SIZE - EDGE_CHAMFER_RADIUS,
            DICE_SIZE - EDGE_CHAMFER_RADIUS,
            DICE_SIZE - EDGE_CHAMFER_RADIUS,
            EDGE_CHAMFER_RADIUS,
        )
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

/// Generate random angular torque for realistic tumbling. Each axis gets an
/// independent random impulse in `-ROLL_TORQUE_MAGNITUDE ..= ROLL_TORQUE_MAGNITUDE`
/// — the single roll-feel torque truth (see [`ROLL_TORQUE_MAGNITUDE`]), applied
/// identically for solo and multiplayer.
#[must_use]
pub fn generate_roll_torque() -> Vector3<f32> {
    let mut rng = rand::thread_rng();
    Vector3::new(
        rng.gen_range(-ROLL_TORQUE_MAGNITUDE..ROLL_TORQUE_MAGNITUDE),
        rng.gen_range(-ROLL_TORQUE_MAGNITUDE..ROLL_TORQUE_MAGNITUDE),
        rng.gen_range(-ROLL_TORQUE_MAGNITUDE..ROLL_TORQUE_MAGNITUDE),
    )
}

/// Generate a random spawn position above the table
#[must_use]
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
