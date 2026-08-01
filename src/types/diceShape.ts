/**
 * Dice shape types
 *
 * `d10tens` is the percentile TENS die: the exact same pentagonal trapezohedron
 * solid, collider and settle contract as `d10` (see `DiceType::D10Tens` in
 * `server/core/src/messages.rs`), but its ten faces read `00, 10, … 90` instead
 * of `0..=9`. A d100 roll is one `d10tens` + one `d10`; the combined result is
 * `tens + ones`, with `00 + 0` reading 100 (`src/lib/percentileRolls.ts`).
 *
 * It is an ENGINE shape only: it is never minted, owned, pulled, themed as a
 * collectible or dragged out of the inventory. Use `INVENTORY_DICE_SHAPES` /
 * `isInventoryDiceShape` wherever a shape must be player-ownable.
 */
export type DiceShape = 'd4' | 'd6' | 'd8' | 'd10' | 'd10tens' | 'd12' | 'd20'

/** The shapes a player can actually own (excludes the engine-only tens die). */
export type InventoryDiceShape = Exclude<DiceShape, 'd10tens'>

/** Ordered list of ownable shapes — the inventory/shop/toolbar surface. */
export const INVENTORY_DICE_SHAPES: readonly InventoryDiceShape[] = [
  'd4',
  'd6',
  'd8',
  'd10',
  'd12',
  'd20',
] as const

/** True when `shape` is a shape a player can own, drag and equip. */
export function isInventoryDiceShape(shape: DiceShape): shape is InventoryDiceShape {
  return shape !== 'd10tens'
}

/**
 * The engine face values a shape can settle on, ascending.
 *
 * Most dice read `1..N`. The physical d10 reads `0..9` (the virtual roll engine
 * maps that to 1–10 separately), and the percentile tens die reads `0, 10, … 90`.
 * This is the one place that range lives — texture pre-rendering and material
 * arrays both derive from it instead of re-deriving `parseInt(shape.slice(1))`.
 */
export function getDiceFaceValues(shape: DiceShape): number[] {
  if (shape === 'd10') {
    return Array.from({ length: 10 }, (_, index) => index)
  }
  if (shape === 'd10tens') {
    return Array.from({ length: 10 }, (_, index) => index * 10)
  }
  const faceCount = Number.parseInt(shape.slice(1), 10)
  return Array.from({ length: faceCount }, (_, index) => index + 1)
}
