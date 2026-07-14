import type { DiceShape } from '../types/diceShape'

/**
 * Per-shape render scale (the THREE polyhedron `radius`, or the d6 cube edge). The
 * physics colliders in `server/core/src/dice.rs` are grown to MATCH these mesh
 * sizes (each die's collider circumradius = its mesh circumradius = the value
 * below), so the visible geometry equals the collision shape — a die collides,
 * rests, and blocks exactly where it is drawn.
 *
 * INVARIANT: the Rust colliders mirror these (see `dice.rs::dice_circumradius`).
 * If a value changes here, update the matching target there.
 */
const DICE_SHAPE_SIZE_SCALE: Record<DiceShape, number> = {
  d4: 1,
  d6: 1.1, // d6 is the everyday die — rendered 10% larger by default (collider matches: cuboid half 0.55 in dice.rs)
  d8: 1,
  d10: 1,
  d12: 0.9,
  d20: 1,
}

export function getDiceShapeSize(shape: DiceShape, baseSize: number): number {
  return baseSize * DICE_SHAPE_SIZE_SCALE[shape]
}

