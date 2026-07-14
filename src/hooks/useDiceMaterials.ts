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
import { buildDiceFaceMaterial } from '../lib/diceMaterial'
import { type DiceRenderLodPolicy, resolveLodTextureSize } from '../lib/renderLod'

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

  /**
   * Optional per-texel material MASK renderer. When set, its green channel drives
   * roughness and its blue channel drives metalness (material.roughness/metalness
   * are forced to 1 so the map is authoritative), letting e.g. a metal die keep
   * matte painted numbers on metallic faces. See `renderMetalMaskD20`.
   */
  materialMaskRenderer?: FaceRenderer

  /** Texture size (defaults to 512) */
  textureSize?: number

  /** Rendering LOD policy selected by context/device/visibility/focus */
  lodPolicy?: DiceRenderLodPolicy

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
    materialMaskRenderer,
    textureSize = 512,
    lodPolicy,
    debugMode = false,
  } = config
  const resolvedTextureSize = resolveLodTextureSize(config.textureSize, lodPolicy, textureSize)

  // Create materials with memoization to prevent re-creation
  const materials = useMemo(() => {
    // Debug mode: return colored materials for visual mapping verification
    if (debugMode) {
      return createDebugMaterials(shape)
    }

    if (lodPolicy?.materialMode === 'solid' || lodPolicy?.materialMode === 'hidden') {
      const solidMaterial = new THREE.MeshStandardMaterial({
        color,
        roughness,
        metalness,
        flatShading: shape !== 'd6',
      })
      solidMaterial.userData.renderLod = lodPolicy
      return solidMaterial
    }

    // Production mode: create materials with face textures. Construction goes
    // through the shared `buildDiceFaceMaterial` so the tray and the inventory
    // previews build byte-identical materials from the same resolution.
    try {
      const resolution = { roughness, metalness, faceRenderer, materialMaskRenderer }
      const extras =
        emissiveIntensity !== undefined && emissiveIntensity > 0
          ? { emissive: color, emissiveIntensity }
          : undefined
      const materialsArray = createFaceMaterialsArray(shape, (faceValue) => {
        const material = buildDiceFaceMaterial({
          shape,
          faceValue,
          color,
          resolution,
          textureSize: resolvedTextureSize,
          extras,
        })
        material.userData.renderLod = lodPolicy
        return material
      })

      console.log(
        `[useDiceMaterials] Created ${materialsArray.length} materials for ${shape}`,
        lodPolicy ? `lod=${lodPolicy.debugLabel}` : `texture=${resolvedTextureSize}px`,
      )
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
      fallbackMaterial.userData.renderLod = lodPolicy

      console.log(`[useDiceMaterials] Using solid color fallback for ${shape}`)
      return fallbackMaterial
    }
  }, [shape, color, roughness, metalness, emissiveIntensity, faceRenderer, materialMaskRenderer, resolvedTextureSize, lodPolicy, debugMode])

  // Cleanup materials and textures on unmount or when dependencies change
  useEffect(() => {
    return () => {
      // Handle both single material and material array
      const materialArray = Array.isArray(materials) ? materials : [materials]

      materialArray.forEach((material) => {
        if (material instanceof THREE.MeshStandardMaterial) {
          material.map?.dispose()
          // matte-metal numbers add a mask assigned to both metalness/roughness
          // slots (same texture) — dispose once.
          material.metalnessMap?.dispose()
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
    lodPolicy,
  } = config
  const resolvedTextureSize = resolveLodTextureSize(config.textureSize, lodPolicy, textureSize)

  const textures = useMemo(() => {
    const textureMap: Record<number, THREE.CanvasTexture> = {}

    // Determine face range
    const faceCount = parseInt(shape.substring(1))
    const startValue = shape === 'd10' ? 0 : 1
    const endValue = shape === 'd10' ? 9 : faceCount

    // Render all faces
    for (let faceValue = startValue; faceValue <= endValue; faceValue++) {
      textureMap[faceValue] = renderDiceFaceToTexture(faceValue, color, faceRenderer, resolvedTextureSize)
    }

    return textureMap
  }, [shape, color, faceRenderer, resolvedTextureSize])

  // Cleanup textures on unmount
  useEffect(() => {
    return () => {
      disposeAllTextures(textures)
    }
  }, [textures])

  return textures
}
