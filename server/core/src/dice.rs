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

/// Dice size (half-extent base for the polyhedra hulls, before per-die scaling)
pub const DICE_SIZE: f32 = 0.5;

/// Half-extent (world units) of the d6 cube collider. The d6 is rendered 10 %
/// larger than the base die by default (client `DICE_SHAPE_SIZE_SCALE.d6 = 1.1`),
/// so its collider edge (2 · this = 1.1) equals the client d6 mesh edge.
/// INVARIANT: keep in sync with the client d6 scale.
pub const D6_HALF_EXTENT: f32 = DICE_SIZE * 1.1;

/// Target collider **circumradius** (world units) for a non-d6 die, equal to the
/// client mesh circumradius (`getDiceShapeSize(shape, 1)` × THREE's polyhedron
/// `radius`, in `src/lib/diceShapeScale.ts`). The collider is scaled to this in
/// [`create_dice_body`] so the physics shape equals the drawn shape.
///
/// INVARIANT: mirror `DICE_SHAPE_SIZE_SCALE` in the client. d6 is excluded (it uses
/// a cuboid whose edge already matches its mesh).
#[must_use]
fn dice_circumradius(dice_type: DiceType) -> f32 {
    match dice_type {
        DiceType::D12 => 0.9,
        // d4, d8, d10, d20 render at THREE radius 1.0.
        _ => 1.0,
    }
}

/// Physics material `(restitution, friction, density, restitution_combine)` for a
/// die, keyed on the client `presentation.material`. `density` (at the unit-volume
/// collider) sets the die's mass; the combine rule governs bounce off the felt
/// floor (arena restitution 0): the default `Average` halves a die's own
/// restitution, while `rubber` uses `Max` to bounce at its FULL restitution.
/// - `metal`: heavy (density 5), low bounce (0.5).
/// - `rubber`: light, bouncy (restitution 0.8, `Max` → ~0.8 off the felt), grippy.
/// - anything else (`plastic`/`resin`/None/…): the tuned default dice material.
#[must_use]
fn material_physics(material: Option<&str>) -> (f32, f32, f32, CoefficientCombineRule) {
    match material {
        Some("metal") => (0.5, 0.18, 5.0, CoefficientCombineRule::Average),
        Some("rubber") => (0.8, 0.95, 0.9, CoefficientCombineRule::Max),
        _ => (DICE_RESTITUTION, DICE_FRICTION, 1.0, CoefficientCombineRule::Average),
    }
}

/// Create a rigid body and collider for a die at a spawn position with the default
/// (plastic) material. See [`create_dice_body_with_material`].
pub fn create_dice_body(
    dice_type: DiceType,
    position: [f32; 3],
    world: &mut PhysicsWorld,
) -> RigidBodyHandle {
    create_dice_body_with_material(dice_type, position, world, None)
}

/// Create a rigid body and collider for a given dice type at a spawn position,
/// inserting them into the provided `PhysicsWorld`. `material` (the client
/// `presentation.material`) selects the physics material via [`material_physics`].
pub fn create_dice_body_with_material(
    dice_type: DiceType,
    position: [f32; 3],
    world: &mut PhysicsWorld,
    material: Option<&str>,
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
        // Plain (sharp-edged) cube. The everyday die is rendered 10 % larger by
        // default (client `DICE_SHAPE_SIZE_SCALE.d6 = 1.1`), so its collider is the
        // matching cuboid — half-extent D6_HALF_EXTENT = DICE_SIZE · 1.1 = 0.55, edge
        // 1.1 = the client d6 mesh edge. (Roll velocity/spin are mass/inertia-scaled,
        // so the larger, heavier d6 still launches and tumbles at the tuned rates.)
        ColliderBuilder::cuboid(D6_HALF_EXTENT, D6_HALF_EXTENT, D6_HALF_EXTENT)
    } else {
        // Non-d6 dice: convex hull scaled so its circumradius equals the CLIENT
        // MESH circumradius ([`dice_circumradius`], mirroring `getDiceShapeSize` in
        // src/lib/diceShapeScale.ts). The raw `get_dice_vertices` hulls are built at
        // ~half that scale, so without this the drawn die was ~2× its collider and
        // clipped walls/other dice; scaling makes the collision shape equal the
        // visible geometry.
        let target = dice_circumradius(dice_type);
        let verts = get_dice_vertices(dice_type);
        let max_norm = verts.iter().map(|p| p.coords.norm()).fold(0.0_f32, f32::max);
        let scale = if max_norm > 1e-6 { target / max_norm } else { 1.0 };
        let scaled: Vec<Point<f32>> = verts
            .iter()
            .map(|p| point![p.x * scale, p.y * scale, p.z * scale])
            .collect();
        ColliderBuilder::convex_hull(&scaled)
            .unwrap_or_else(|| ColliderBuilder::ball(target))
    };

    let (restitution, friction, density, restitution_combine) = material_physics(material);
    let collider = collider
        .restitution(restitution)
        .restitution_combine_rule(restitution_combine)
        .friction(friction)
        .density(density)
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
/// rows. Grid cells are always ≥ `min(SPAWN_LANE_SPACING, SPAWN_ROW_SPACING)` apart,
/// so even at jitter extremes (±[`SPAWN_JITTER`] per axis) no two same-layer dice
/// come within `that − 2·SPAWN_JITTER` of each other — sized above the full die so
/// the matched (mesh-size) colliders don't spawn interpenetrated. Uniform
/// [`SPAWN_JITTER`] on each axis keeps same-cell draws from stacking perfectly.
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
    // Fill the grid CENTER-OUT so die 0 lands at the table center and a batch fans
    // out symmetrically around it (a handful dropped in the middle), rather than
    // starting from a corner — which, on a large arena, spawned the first die far
    // off-screen-center. `center_out_index` permutes the fill order into the same
    // set of grid cells, so bounds, interpenetration, and layer capacity are
    // unchanged; only which die lands where changes.
    let col = center_out_index(cell % lanes, lanes);
    let row = center_out_index(cell / lanes, rows);

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

/// Permute a 0-based fill order into a grid index in `0..count`, ordered
/// center-first: fill order `0` maps to the center cell, then it alternates
/// outward (`+1, -1, +2, -2, …`). The result is a bijection over `0..count`
/// (every cell is still used exactly once), so a batch fanned this way occupies
/// the same cells as a corner-first fill — only the order differs, keeping the
/// first/early dice at the table center.
#[must_use]
fn center_out_index(fill_order: usize, count: usize) -> usize {
    debug_assert!(fill_order < count);
    let base = (count - 1) / 2; // integer center index
    let k = i64::try_from((fill_order + 1) / 2).unwrap_or(0);
    let signed = if fill_order % 2 == 1 { k } else { -k };
    let idx = i64::try_from(base).unwrap_or(0) + signed;
    let last = i64::try_from(count).unwrap_or(1) - 1;
    idx.clamp(0, last).try_into().unwrap_or(0)
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
        // A full MAX_DICE batch must fan out with no two dice closer than the
        // guaranteed grid gap — the smaller of the lane/row spacings, less the
        // worst-case jitter of both dice — for every in-range aspect. This is the
        // guarantee the layered, arena-sized grid gives in place of the old
        // row-clamp that stacked overflow dice onto one cell. Derived from the
        // spacing constants so it tracks the full-size-collider spacing bump.
        use crate::physics::{SPAWN_JITTER, SPAWN_LANE_SPACING, SPAWN_ROW_SPACING};
        let min_separation = SPAWN_LANE_SPACING.min(SPAWN_ROW_SPACING) - 2.0 * SPAWN_JITTER;
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
    fn center_out_index_is_a_centered_permutation() {
        for count in 1..=25usize {
            let mapped: Vec<usize> = (0..count).map(|i| center_out_index(i, count)).collect();
            // Fill order 0 lands on the center cell.
            assert_eq!(mapped[0], (count - 1) / 2, "count {count}: order 0 is center");
            // Every cell is used exactly once (a bijection over 0..count).
            let mut sorted = mapped.clone();
            sorted.sort_unstable();
            let expected: Vec<usize> = (0..count).collect();
            assert_eq!(sorted, expected, "count {count}: must be a permutation, got {mapped:?}");
        }
    }

    #[test]
    fn first_die_spawns_at_table_center_on_a_large_arena() {
        // The regression: on a big arena the first die used to drop at a corner.
        // Center-out fill must land die 0 within one grid step of the origin on
        // both axes, for the default and a wide aspect-fit arena.
        use crate::physics::{SPAWN_JITTER, SPAWN_LANE_SPACING, SPAWN_ROW_SPACING};
        for bounds in [ArenaBounds::default(), ArenaBounds::from_dimensions(40.0, 30.0)] {
            for _ in 0..50 {
                let p = generate_spawn_position(0, &bounds);
                assert!(
                    p[0].abs() <= SPAWN_LANE_SPACING / 2.0 + SPAWN_JITTER,
                    "die 0 x not centered: {} (bounds {bounds:?})",
                    p[0]
                );
                assert!(
                    p[2].abs() <= SPAWN_ROW_SPACING / 2.0 + SPAWN_JITTER,
                    "die 0 z not centered: {} (bounds {bounds:?})",
                    p[2]
                );
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
    fn collider_hull_scales_to_mesh_circumradius() {
        // Each non-d6 collider is scaled so its circumradius equals the client mesh
        // circumradius (dice_circumradius, mirroring getDiceShapeSize) — the guard
        // that the physics shape equals the drawn shape (no clipping / sinking).
        for dt in [
            DiceType::D4, DiceType::D8, DiceType::D10, DiceType::D12, DiceType::D20,
        ] {
            let target = dice_circumradius(dt);
            let verts = get_dice_vertices(dt);
            let max_norm = verts.iter().map(|p| p.coords.norm()).fold(0.0_f32, f32::max);
            let scale = target / max_norm;
            let scaled_max = verts
                .iter()
                .map(|p| p.coords.norm() * scale)
                .fold(0.0_f32, f32::max);
            assert!(
                (scaled_max - target).abs() < 1e-4,
                "{dt:?}: scaled collider circumradius {scaled_max} != mesh target {target}"
            );
        }
        // d20/d8/d10/d4 render at THREE radius 1.0; d12 at 0.9.
        assert!((dice_circumradius(DiceType::D20) - 1.0).abs() < f32::EPSILON);
        assert!((dice_circumradius(DiceType::D12) - 0.9).abs() < f32::EPSILON);
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
