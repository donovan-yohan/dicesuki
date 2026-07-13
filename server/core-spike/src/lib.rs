//! WASM feasibility spike for running the server's physics/room core in-browser.
//!
//! This crate does NOT copy the server logic. It pulls the ACTUAL server source
//! files in verbatim via `#[path]` module declarations, so if this compiles for
//! `wasm32-unknown-unknown`, the real files compile for wasm unmodified.
//!
//! The four modules below are exactly the "pure logic" seam identified in the
//! spike: no tokio, no axum, no reqwest, no jsonwebtoken. `messages` is pulled in
//! because `dice`/`face_detection` reference `crate::messages::DiceType`.

#[path = "../../src/messages.rs"]
pub mod messages;
#[path = "../../src/physics.rs"]
pub mod physics;
#[path = "../../src/dice.rs"]
pub mod dice;
#[path = "../../src/face_detection.rs"]
pub mod face_detection;

use wasm_bindgen::prelude::*;

use crate::dice::{create_dice_body, generate_roll_impulse, generate_roll_torque};
use crate::face_detection::detect_face_value;
use crate::messages::DiceType;
use crate::physics::PhysicsWorld;

/// Browser-callable proof: spawn one die of each type, throw them, step the world
/// 60 ticks (1 second at 60Hz), and return the settled/current face values as a
/// comma-separated string. This exercises the full pure-logic path a Web Worker
/// room loop would drive: world construction, dice body + collider creation,
/// impulse/torque application, stepping, and server-side face detection.
#[wasm_bindgen]
pub fn spike_tick_room() -> String {
    let mut world = PhysicsWorld::new();

    let types = [
        DiceType::D4,
        DiceType::D6,
        DiceType::D8,
        DiceType::D10,
        DiceType::D12,
        DiceType::D20,
    ];

    let mut handles = Vec::new();
    for (i, &t) in types.iter().enumerate() {
        #[allow(clippy::cast_precision_loss)]
        let x = (i as f32) - 2.5;
        let handle = create_dice_body(t, [x, 2.0, 0.0], &mut world);

        let impulse = generate_roll_impulse();
        world.apply_impulse(handle, [impulse.x, impulse.y, impulse.z]);
        let torque = generate_roll_torque();
        world.apply_torque_impulse(handle, [torque.x, torque.y, torque.z]);

        handles.push((t, handle));
    }

    // Step 60 ticks (1s @ 60Hz).
    for _ in 0..60 {
        world.step();
    }

    // Read authoritative face values server-side, exactly as multiplayer does.
    let mut out = Vec::new();
    for (t, handle) in handles {
        let rot = world.get_rotation(handle).unwrap_or([0.0, 0.0, 0.0, 1.0]);
        let value = detect_face_value(rot, t);
        out.push(format!("{t:?}={value}"));
    }

    out.join(",")
}

/// Minimal deterministic proof usable without any RNG: drop a d6 and report its
/// resting face. Handy for a headless wasm smoke test.
#[wasm_bindgen]
pub fn spike_drop_d6() -> u32 {
    let mut world = PhysicsWorld::new();
    let handle = create_dice_body(DiceType::D6, [0.0, 2.0, 0.0], &mut world);
    for _ in 0..120 {
        world.step();
    }
    let rot = world.get_rotation(handle).unwrap_or([0.0, 0.0, 0.0, 1.0]);
    detect_face_value(rot, DiceType::D6)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn tick_room_returns_valid_faces() {
        let result = spike_tick_room();
        assert!(result.contains("D6="), "got: {result}");
        // 6 dice types reported.
        assert_eq!(result.split(',').count(), 6, "got: {result}");
    }

    #[test]
    fn drop_d6_settles_to_valid_face() {
        let v = spike_drop_d6();
        assert!((1..=6).contains(&v), "d6 face out of range: {v}");
    }
}
