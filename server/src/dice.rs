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
