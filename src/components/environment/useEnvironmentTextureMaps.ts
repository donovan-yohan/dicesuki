import { useLoader } from '@react-three/fiber'
import { useEffect, useMemo } from 'react'
import * as THREE from 'three'
import {
  configureEnvironmentTexture,
  resolveEnvironmentTextureConfig,
  type EnvironmentTextureConfig,
} from './textureConfig'

export interface EnvironmentTextureMaps {
  colorMap?: THREE.Texture
  normalMap?: THREE.Texture
}

export interface EnvironmentTextureMapConfig extends EnvironmentTextureConfig {
  /** Width/height of the visible surface axes in world units. */
  surfaceSize?: [number, number]
}

/**
 * Loads optional environment maps without mutating Three's shared loader cache.
 * Calling useLoader with an empty array keeps the hook order stable for color-only themes.
 */
export function useEnvironmentTextureMaps({
  texture,
  albedoTexture,
  colorTexture,
  normalTexture,
  normalScale,
  tileSize,
  repeat,
  surfaceSize,
}: EnvironmentTextureMapConfig): EnvironmentTextureMaps {
  const surfaceWidth = surfaceSize?.[0]
  const surfaceHeight = surfaceSize?.[1]
  const resolved = useMemo(
    () => resolveEnvironmentTextureConfig(
      { texture, albedoTexture, colorTexture, normalTexture, normalScale, tileSize, repeat },
      surfaceWidth !== undefined && surfaceHeight !== undefined ? [surfaceWidth, surfaceHeight] : undefined,
    ),
    [albedoTexture, colorTexture, normalScale, normalTexture, repeat, surfaceHeight, surfaceWidth, texture, tileSize],
  )
  const urls = useMemo(
    () => [resolved.colorUrl, resolved.normalUrl].filter((url): url is string => Boolean(url)),
    [resolved.colorUrl, resolved.normalUrl],
  )
  const loadedTextures = useLoader(THREE.TextureLoader, urls) as THREE.Texture[]

  const textureMaps = useMemo(() => {
    let index = 0
    const colorSource = resolved.colorUrl ? loadedTextures[index++] : undefined
    const normalSource = resolved.normalUrl ? loadedTextures[index] : undefined

    return {
      colorMap: colorSource ? configureEnvironmentTexture(colorSource.clone(), 'color', resolved.repeat) : undefined,
      normalMap: normalSource ? configureEnvironmentTexture(normalSource.clone(), 'normal', resolved.repeat) : undefined,
    }
  }, [loadedTextures, resolved.colorUrl, resolved.normalUrl, resolved.repeat])

  useEffect(() => () => {
    textureMaps.colorMap?.dispose()
    textureMaps.normalMap?.dispose()
  }, [textureMaps])

  return textureMaps
}
