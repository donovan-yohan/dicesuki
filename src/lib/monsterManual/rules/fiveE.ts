import type { KeepMode } from '../../../types/savedRolls'

export function fiveED20(mode = 'normal'): { rollCount: number; keepMode?: KeepMode } {
  if (!['normal', 'advantage', 'disadvantage'].includes(mode)) throw new Error('Unsupported 5e roll mode')
  return mode === 'normal' ? { rollCount: 1 } : { rollCount: 2, keepMode: mode === 'advantage' ? 'highest' : 'lowest' }
}
