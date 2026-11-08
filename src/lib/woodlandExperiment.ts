import type { RenderDeviceTier } from './renderLod'

interface WoodDiePreviewInput {
  development: boolean
  requested: boolean
  workerRoom: boolean
  shape: string
  owned: boolean
}

/** Local authoring proof only. Never replace an owned or network die. */
export function shouldPreviewWoodDie(input: WoodDiePreviewInput): boolean {
  return input.development && input.requested && input.workerRoom && input.shape === 'd6' && !input.owned
}

const SCULPTED_SHAPES = ['d4', 'd6', 'd8', 'd10', 'd12', 'd20']

/** Exact selected exports only; percentile tens must keep its own numerals. */
export function sculptedDiePreviewUrl(shape: string): string | null {
  return SCULPTED_SHAPES.includes(shape) ? `/__experiments/woodland/sculpted/${shape}.glb` : null
}

/** Same local authoring boundary as the legacy D6 proof. */
export function shouldPreviewSculptedDie(input: WoodDiePreviewInput): boolean {
  return input.development && input.requested && input.workerRoom && !input.owned && sculptedDiePreviewUrl(input.shape) !== null
}

export function woodDiePreviewUrl(tier: RenderDeviceTier): string {
  return `/__experiments/woodland/variants/${tier === 'high' ? 'desktop' : 'mobile'}.glb`
}
