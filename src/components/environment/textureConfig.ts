import * as THREE from 'three'

export type TextureRepeat = [number, number]
export type TextureNormalScale = number | TextureRepeat

export interface EnvironmentTextureConfig {
  texture?: string
  albedoTexture?: string
  colorTexture?: string
  normalTexture?: string
  normalScale?: TextureNormalScale
  /** World units covered by one texture tile. A scalar preserves square texels. */
  tileSize?: number | TextureRepeat
  /** Legacy fixed repeat fallback used when tileSize or surface dimensions are absent. */
  repeat?: TextureRepeat
}

export interface ResolvedEnvironmentTextureConfig {
  colorUrl?: string
  normalUrl?: string
  repeat: TextureRepeat
  normalScale: TextureRepeat
}

const DEFAULT_REPEAT: TextureRepeat = [1, 1]
const DEFAULT_NORMAL_SCALE: TextureRepeat = [1, 1]

function normalizePair(value: number | TextureRepeat | undefined, fallback: TextureRepeat): TextureRepeat {
  if (typeof value === 'number') {
    return Number.isFinite(value) ? [value, value] : fallback
  }

  if (value && Number.isFinite(value[0]) && Number.isFinite(value[1])) {
    return [value[0], value[1]]
  }

  return fallback
}

function normalizePositivePair(value: number | TextureRepeat | undefined): TextureRepeat | undefined {
  const pair = normalizePair(value, [0, 0])
  return pair[0] > 0 && pair[1] > 0 ? pair : undefined
}

/** Converts world-space surface dimensions to UV repeat counts. */
export function resolveEnvironmentTextureRepeat(
  config: Pick<EnvironmentTextureConfig, 'repeat' | 'tileSize'>,
  surfaceSize?: TextureRepeat,
): TextureRepeat {
  const normalizedTileSize = normalizePositivePair(config.tileSize)
  const normalizedSurfaceSize = normalizePositivePair(surfaceSize)

  if (normalizedTileSize && normalizedSurfaceSize) {
    return [
      normalizedSurfaceSize[0] / normalizedTileSize[0],
      normalizedSurfaceSize[1] / normalizedTileSize[1],
    ]
  }

  return normalizePair(config.repeat, DEFAULT_REPEAT)
}

/** Resolves legacy and explicit theme texture fields into material-ready settings. */
export function resolveEnvironmentTextureConfig(
  config: EnvironmentTextureConfig,
  surfaceSize?: TextureRepeat,
): ResolvedEnvironmentTextureConfig {
  return {
    colorUrl: config.albedoTexture ?? config.colorTexture ?? config.texture,
    normalUrl: config.normalTexture,
    repeat: resolveEnvironmentTextureRepeat(config, surfaceSize),
    normalScale: normalizePair(config.normalScale, DEFAULT_NORMAL_SCALE),
  }
}

export function configureEnvironmentTexture(
  texture: THREE.Texture,
  kind: 'color' | 'normal',
  repeat: TextureRepeat,
): THREE.Texture {
  texture.wrapS = THREE.RepeatWrapping
  texture.wrapT = THREE.RepeatWrapping
  texture.repeat.set(repeat[0], repeat[1])
  texture.colorSpace = kind === 'color' ? THREE.SRGBColorSpace : THREE.NoColorSpace
  texture.needsUpdate = true
  return texture
}
