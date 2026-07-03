export type DiceRenderContext = 'hero' | 'tray' | 'grid' | 'offscreen'
export type RenderDeviceTier = 'low' | 'mid' | 'high'
export type DiceRenderFidelity = 'hero' | 'standard' | 'economy' | 'placeholder'
export type DiceGeometryDetail = 'full' | 'reduced' | 'billboard'
export type DiceMaterialMode = 'textured' | 'solid' | 'hidden'
export type DicePhysicsMode = 'dynamic' | 'static' | 'none'
export type DiceAnimationQuality = 'full' | 'reduced' | 'none'

export interface DiceRenderLodInput {
  context: DiceRenderContext
  deviceTier: RenderDeviceTier
  /** Whether the die is inside the current viewport or panel window. */
  isVisible?: boolean
  /** Whether this die is currently selected, hovered, inspected, or dragged. */
  isFocused?: boolean
  /** Whether this die is being rolled, dragged, or otherwise actively animated. */
  isInteracting?: boolean
}

export interface DiceRenderLodPolicy {
  context: DiceRenderContext
  deviceTier: RenderDeviceTier
  fidelity: DiceRenderFidelity
  textureSize: number
  geometryDetail: DiceGeometryDetail
  materialMode: DiceMaterialMode
  physicsMode: DicePhysicsMode
  animationQuality: DiceAnimationQuality
  castShadow: boolean
  receiveShadow: boolean
  debugLabel: string
}

const CONTEXT_BASE_POLICY: Record<DiceRenderContext, Omit<DiceRenderLodPolicy, 'context' | 'deviceTier' | 'debugLabel'>> = {
  hero: {
    fidelity: 'hero',
    textureSize: 1024,
    geometryDetail: 'full',
    materialMode: 'textured',
    physicsMode: 'static',
    animationQuality: 'full',
    castShadow: true,
    receiveShadow: true,
  },
  tray: {
    fidelity: 'standard',
    textureSize: 512,
    geometryDetail: 'full',
    materialMode: 'textured',
    physicsMode: 'dynamic',
    animationQuality: 'full',
    castShadow: true,
    receiveShadow: true,
  },
  grid: {
    fidelity: 'economy',
    textureSize: 256,
    geometryDetail: 'reduced',
    materialMode: 'textured',
    physicsMode: 'none',
    animationQuality: 'reduced',
    castShadow: false,
    receiveShadow: false,
  },
  offscreen: {
    fidelity: 'placeholder',
    textureSize: 0,
    geometryDetail: 'billboard',
    materialMode: 'hidden',
    physicsMode: 'none',
    animationQuality: 'none',
    castShadow: false,
    receiveShadow: false,
  },
}

const DEVICE_TEXTURE_CAPS: Record<RenderDeviceTier, Record<DiceRenderContext, number>> = {
  low: {
    hero: 512,
    tray: 256,
    grid: 128,
    offscreen: 0,
  },
  mid: {
    hero: 512,
    tray: 512,
    grid: 128,
    offscreen: 0,
  },
  high: {
    hero: 1024,
    tray: 512,
    grid: 256,
    offscreen: 0,
  },
}

const FIDELITY_ORDER: DiceRenderFidelity[] = ['placeholder', 'economy', 'standard', 'hero']

function minTextureByDevice(
  context: DiceRenderContext,
  deviceTier: RenderDeviceTier,
  requestedSize: number,
): number {
  return Math.min(requestedSize, DEVICE_TEXTURE_CAPS[deviceTier][context])
}

function clampFidelity(
  fidelity: DiceRenderFidelity,
  maxFidelity: DiceRenderFidelity,
): DiceRenderFidelity {
  return FIDELITY_ORDER[Math.min(
    FIDELITY_ORDER.indexOf(fidelity),
    FIDELITY_ORDER.indexOf(maxFidelity),
  )]
}

function buildDebugLabel(policy: Omit<DiceRenderLodPolicy, 'debugLabel'>): string {
  const texture = policy.textureSize > 0 ? `${policy.textureSize}px` : 'none'
  return `${policy.context}/${policy.deviceTier}/${policy.fidelity}/${texture}/${policy.physicsMode}`
}

/**
 * Selects the renderer seam for a die before any component decides how to draw it.
 * This keeps inventory hero, active tray, future grid previews, and offscreen dice
 * from accidentally paying the same geometry/texture/physics cost.
 */
export function resolveDiceRenderLod(input: DiceRenderLodInput): DiceRenderLodPolicy {
  if (input.isVisible === false || input.context === 'offscreen') {
    const policy = {
      ...CONTEXT_BASE_POLICY.offscreen,
      context: 'offscreen' as const,
      deviceTier: input.deviceTier,
    }
    return { ...policy, debugLabel: buildDebugLabel(policy) }
  }

  const base = CONTEXT_BASE_POLICY[input.context]
  const policy: Omit<DiceRenderLodPolicy, 'debugLabel'> = {
    ...base,
    context: input.context,
    deviceTier: input.deviceTier,
    textureSize: minTextureByDevice(input.context, input.deviceTier, base.textureSize),
  }

  if (input.deviceTier === 'low') {
    policy.fidelity = clampFidelity(policy.fidelity, 'standard')
    policy.castShadow = input.context === 'hero'
    policy.receiveShadow = input.context === 'hero'
    if (input.context === 'tray') {
      policy.animationQuality = input.isInteracting ? 'full' : 'reduced'
    }
  }

  if (input.deviceTier === 'mid' && input.context === 'grid') {
    policy.geometryDetail = 'reduced'
    policy.animationQuality = 'reduced'
  }

  if (input.isFocused && input.context === 'grid' && input.deviceTier !== 'low') {
    policy.fidelity = 'standard'
    policy.textureSize = minTextureByDevice(
      input.context,
      input.deviceTier,
      Math.max(policy.textureSize, 256),
    )
  }

  if (input.isFocused && input.context === 'tray' && input.deviceTier === 'high') {
    policy.fidelity = 'hero'
  }

  return { ...policy, debugLabel: buildDebugLabel(policy) }
}

export interface DeviceTierHints {
  gpuTier?: number
  isMobile?: boolean
  viewportWidth?: number
  devicePixelRatio?: number
}

/**
 * Maps coarse browser/device hints to the render LOD tiers used by the dice renderer.
 * GPU tier wins when available; viewport/DPR are fallbacks for tests and offline UI.
 */
export function resolveRenderDeviceTier(hints: DeviceTierHints = {}): RenderDeviceTier {
  if (typeof hints.gpuTier === 'number') {
    if (hints.gpuTier >= 3) return 'high'
    if (hints.gpuTier >= 2) return 'mid'
    return hints.isMobile ? 'low' : 'mid'
  }

  if (hints.isMobile || (hints.viewportWidth !== undefined && hints.viewportWidth < 768)) {
    return hints.devicePixelRatio !== undefined && hints.devicePixelRatio <= 1.5 ? 'low' : 'mid'
  }

  return 'high'
}

export function resolveLodTextureSize(
  explicitTextureSize: number | undefined,
  lodPolicy: DiceRenderLodPolicy | undefined,
  fallbackSize: number,
): number {
  if (explicitTextureSize !== undefined) return explicitTextureSize
  if (lodPolicy && lodPolicy.textureSize > 0) return lodPolicy.textureSize
  return fallbackSize
}
