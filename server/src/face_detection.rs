use nalgebra::{UnitQuaternion, Vector3};
use crate::dice::get_face_normals;
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
