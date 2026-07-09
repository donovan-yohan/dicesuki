import type { DiceShape } from '../types/diceShape'

const DICE_SHAPE_SIZE_SCALE: Record<DiceShape, number> = {
  d4: 1,
  d6: 1,
  d8: 1,
  d10: 1,
  d12: 0.9,
  d20: 1,
}

export function getDiceShapeSize(shape: DiceShape, baseSize: number): number {
  return baseSize * DICE_SHAPE_SIZE_SCALE[shape]
}

