import type { RenderDeviceTier } from './renderLod'

/** Art direction only; never changes arena physics or dice materials. */
export interface WoodlandRecipe {
  kind: 'woodland'
  seed: number
  grass: { base: string; tip: string }
  sunlight: string
  pollen: string
  shading?: 'cel'
}

export type EnvironmentSceneRecipe = WoodlandRecipe | {
  kind: 'cyberpunk-alley' | 'monster-dungeon'
  seed: number
  shading: 'cel'
}

export interface EnvironmentQuality {
  tier: RenderDeviceTier
  maxDpr: number
  shadowMapSize: number
  grassCount: number
  particleCount: number
  shaftCount: number
  animate: boolean
}

interface EnvironmentQualityHints {
  deviceTier: RenderDeviceTier
  compactViewport: boolean
  coarsePointer: boolean
  reducedMotion: boolean
}

// Initial draw budgets, not device-performance guarantees. Keep all adaptation
// here so Canvas, light shadows and decorative geometry use the same decision.
export function resolveEnvironmentQuality(hints: EnvironmentQualityHints): EnvironmentQuality {
  const constrained = hints.compactViewport || hints.coarsePointer
  const tier = constrained && hints.deviceTier === 'high' ? 'mid' : hints.deviceTier
  if (tier === 'low') {
    return {
      tier, maxDpr: 1, shadowMapSize: 512,
      grassCount: 2500, particleCount: 0, shaftCount: 0, animate: !hints.reducedMotion,
    }
  }
  if (tier === 'mid') {
    return {
      tier, maxDpr: 1.5, shadowMapSize: constrained ? 512 : 1024,
      grassCount: 6000, particleCount: 12, shaftCount: 2, animate: !hints.reducedMotion,
    }
  }
  return {
    tier, maxDpr: 2, shadowMapSize: 2048,
    grassCount: 12000, particleCount: 48, shaftCount: 4, animate: !hints.reducedMotion,
  }
}
