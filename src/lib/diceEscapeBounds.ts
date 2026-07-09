export interface DiceEscapeBounds {
  maxAbsX: number
  maxAbsZ: number
  minY: number
  maxY: number
}

export interface DicePositionLike {
  x: number
  y: number
  z: number
}

export const DICE_ESCAPE_BOUNDS: DiceEscapeBounds = {
  maxAbsX: 18,
  maxAbsZ: 18,
  minY: -6,
  maxY: 18,
}

export function isDiceOutsideEscapeBounds(
  position: DicePositionLike,
  bounds: DiceEscapeBounds = DICE_ESCAPE_BOUNDS,
) {
  return (
    Math.abs(position.x) > bounds.maxAbsX ||
    Math.abs(position.z) > bounds.maxAbsZ ||
    position.y < bounds.minY ||
    position.y > bounds.maxY
  )
}
