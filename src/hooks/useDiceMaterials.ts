import { useMemo, useEffect } from 'react'
import * as THREE from 'three'
import { DiceShape } from '../lib/geometries'
import { createFaceMaterialsArray, createDebugMaterials } from '../lib/faceMaterialMapping'
import {
  renderDiceFaceToTexture,
  renderSimpleNumber,
  FaceRenderer,
  disposeAllTextures,
} from '../lib/textureRendering'

/**
 * Configuration for dice material creation
 */
export interface DiceMaterialConfig {
  /** Dice shape (d4, d6, d8, d10, d12, d20) */
  shape: DiceShape

  /** Base color for dice faces */
  color?: string

  /** Material roughness (0 = smooth, 1 = rough) */
  roughness?: number

  /** Material metalness (0 = non-metal, 1 = metallic) */
  metalness?: number

  /** Emissive intensity for glow effect */
  emissiveIntensity?: number

  /** Custom face renderer (defaults to renderSimpleNumber) */
  faceRenderer?: FaceRenderer

  /** Texture size (defaults to 512) */
  textureSize?: number

  /** Use debug materials (colored faces for mapping verification) */
  debugMode?: boolean
}

/**
 * Hook for managing dice materials with automatic cleanup
 *
 * This hook:
 * 1. Creates materials array in correct order for Three.js geometry
 * 2. Generates textures for each face value
 * 3. Handles material/texture disposal on unmount
 * 4. Memoizes materials to prevent re-creation on re-renders
 *
 * @param config - Material configuration
 * @returns Array of materials ready for use in mesh
 *
 * @example
 * ```typescript
 * const materials = useDiceMaterials({
 *   shape: 'd6',
 *   color: '#ff6b35',
 *   faceRenderer: renderStyledNumber
 * });
 *
 * return (
 *   <mesh geometry={geometry} material={materials} />
 * );
 * ```
 */
export function useDiceMaterials(config: DiceMaterialConfig): THREE.Material[] {
  const {
    shape,
    color = '#ff6b35',
    roughness = 0.7,
    metalness = 0.1,
    emissiveIntensity,
    faceRenderer = renderSimpleNumber,
    textureSize = 512,
    debugMode = false,
  } = config

  // Create materials with memoization to prevent re-creation
  const materials = useMemo(() => {
    // Debug mode: return colored materials for visual mapping verification
    if (debugMode) {
      return createDebugMaterials(shape)
    }

    // Production mode: create materials with face textures
    try {
      const materialsArray = createFaceMaterialsArray(shape, (faceValue) => {
        // Render face value to canvas texture
        const texture = renderDiceFaceToTexture(faceValue, color, faceRenderer, textureSize)

        // Create material with texture
        const material = new THREE.MeshStandardMaterial({
          map: texture,
          roughness,
          metalness,
          flatShading: true,
        })

        // Add emissive glow if specified
        if (emissiveIntensity !== undefined && emissiveIntensity > 0) {
          material.emissive = new THREE.Color(color)
          material.emissiveIntensity = emissiveIntensity
        }

        return material
      })

      console.log(`[useDiceMaterials] Created ${materialsArray.length} materials for ${shape}`)
      return materialsArray
    } catch (error) {
      // If material mapping not implemented, fall back to single solid material
      console.error(`[useDiceMaterials] Material mapping error for ${shape}:`, error)

      // Return single solid color material for all shapes
      const fallbackMaterial = new THREE.MeshStandardMaterial({
        color,
        roughness,
        metalness,
        flatShading: shape !== 'd6',
      })

      console.log(`[useDiceMaterials] Using solid color fallback for ${shape}`)
      return fallbackMaterial
    }
  }, [shape, color, roughness, metalness, emissiveIntensity, faceRenderer, textureSize, debugMode])

  // Cleanup materials and textures on unmount or when dependencies change
  useEffect(() => {
    return () => {
      // Handle both single material and material array
      const materialArray = Array.isArray(materials) ? materials : [materials]

      materialArray.forEach((material) => {
        if (material instanceof THREE.MeshStandardMaterial) {
          // Dispose texture if present
          if (material.map) {
            material.map.dispose()
          }

          // Dispose material
          material.dispose()
        }
      })
    }
  }, [materials])

  // Always return array for consistency (Three.js accepts both)
  return Array.isArray(materials) ? materials : [materials]
}

/**
 * Hook for pre-rendering face textures (optimization for multiple dice)
 *
 * If you're spawning multiple dice of the same type, pre-render the textures
 * once and share them across all dice instances.
 *
 * @param config - Material configuration
 * @returns Map of face values to textures
 *
 * @example
 * ```typescript
 * const textures = usePreRenderedTextures({
 *   shape: 'd6',
 *   color: '#4ecdc4',
 *   faceRenderer: renderBorderedNumber
 * });
 *
 * // Use textures in multiple dice
 * const materials = useMemo(() => {
 *   return createFaceMaterialsArray('d6', (faceValue) => {
 *     return new THREE.MeshStandardMaterial({ map: textures[faceValue] });
 *   });
 * }, [textures]);
 * ```
 */
export function usePreRenderedTextures(
  config: Omit<DiceMaterialConfig, 'debugMode'>
): Record<number, THREE.CanvasTexture> {
  const {
    shape,
    color = '#ff6b35',
    faceRenderer = renderSimpleNumber,
    textureSize = 512,
  } = config

  const textures = useMemo(() => {
    const textureMap: Record<number, THREE.CanvasTexture> = {}

    // Determine face range
    const faceCount = parseInt(shape.substring(1))
    const startValue = shape === 'd10' ? 0 : 1
    const endValue = shape === 'd10' ? 9 : faceCount

    // Render all faces
    for (let faceValue = startValue; faceValue <= endValue; faceValue++) {
      textureMap[faceValue] = renderDiceFaceToTexture(faceValue, color, faceRenderer, textureSize)
    }

    return textureMap
  }, [shape, color, faceRenderer, textureSize])

  // Cleanup textures on unmount
  useEffect(() => {
    return () => {
      disposeAllTextures(textures)
    }
  }, [textures])

  return textures
}
