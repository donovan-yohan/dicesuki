import { useMemo } from 'react'
import * as THREE from 'three'
import { resolveEnvironmentTextureConfig } from './textureConfig'
import { useEnvironmentTextureMaps, type EnvironmentTextureMapConfig } from './useEnvironmentTextureMaps'

export interface ThemedSurfaceMaterialProps extends EnvironmentTextureMapConfig {
  color: THREE.ColorRepresentation
  roughness: number
  metalness: number
  transparent?: boolean
  opacity?: number
  depthWrite?: boolean
}

export function ThemedSurfaceMaterial({
  color,
  roughness,
  metalness,
  texture,
  albedoTexture,
  colorTexture,
  normalTexture,
  normalScale,
  tileSize,
  repeat,
  surfaceSize,
  transparent,
  opacity,
  depthWrite,
}: ThemedSurfaceMaterialProps) {
  const { colorMap, normalMap } = useEnvironmentTextureMaps({
    texture,
    albedoTexture,
    colorTexture,
    normalTexture,
    normalScale,
    tileSize,
    repeat,
    surfaceSize,
  })
  const surfaceWidth = surfaceSize?.[0]
  const surfaceHeight = surfaceSize?.[1]
  const resolved = useMemo(
    () => resolveEnvironmentTextureConfig(
      { texture, albedoTexture, colorTexture, normalTexture, normalScale, tileSize, repeat },
      surfaceWidth !== undefined && surfaceHeight !== undefined ? [surfaceWidth, surfaceHeight] : undefined,
    ),
    [albedoTexture, colorTexture, normalScale, normalTexture, repeat, surfaceHeight, surfaceWidth, texture, tileSize],
  )
  const normalVector = useMemo(
    () => normalMap ? new THREE.Vector2(...resolved.normalScale) : undefined,
    [normalMap, resolved.normalScale],
  )

  return (
    <meshStandardMaterial
      color={color}
      roughness={roughness}
      metalness={metalness}
      map={colorMap}
      normalMap={normalMap}
      normalScale={normalVector}
      transparent={transparent}
      opacity={opacity}
      depthWrite={depthWrite}
    />
  )
}
