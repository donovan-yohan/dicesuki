/**
 * Single source of truth for how a die's MATERIAL becomes its rendered look.
 *
 * The tray (`MultiplayerDie` via `useDiceMaterials`) and the inventory previews
 * (`SharedInventoryDicePreviewCanvas`) used to build their materials independently,
 * so a new material look (tie-dye rubber, matte-metal numbers) landed on one and not
 * the other. Both now go through `resolveDiceMaterial` (the DECISION: which face
 * renderer, which material mask, what roughness/metalness) and `buildDiceFaceMaterial`
 * (the CONSTRUCTION: the actual THREE material), so they cannot drift by design.
 *
 * Everything is keyed on the material string, which is the one field carried
 * identically on both an `InventoryDie.appearance.material` and the spawned die's
 * `presentation.material`.
 */

import * as THREE from 'three'
import type { DiceShape } from './geometries'
import type { FaceRenderer } from './textureRendering'
import { renderDiceFaceToTexture } from './textureRendering'
import { getFaceRendererForShape } from './faceRenderers'
import { renderTieDyeD20, renderMetalMaskD20 } from './faceRenderers/materialRenderers'

/** PBR roughness/metalness per material. The single map for tray + previews. */
const MATERIAL_PBR: Record<string, { roughness: number; metalness: number }> = {
  plastic: { roughness: 0.68, metalness: 0.06 },
  resin: { roughness: 0.42, metalness: 0.08 },
  metal: { roughness: 0.28, metalness: 1.0 },
  rubber: { roughness: 0.95, metalness: 0.0 },
  stone: { roughness: 0.86, metalness: 0.02 },
  glass: { roughness: 0.14, metalness: 0.02 },
  crystal: { roughness: 0.2, metalness: 0.08 },
  wood: { roughness: 0.78, metalness: 0.02 },
  bone: { roughness: 0.7, metalness: 0.02 },
  obsidian: { roughness: 0.24, metalness: 0.18 },
  celestial: { roughness: 0.34, metalness: 0.2 },
}
const DEFAULT_PBR = { roughness: 0.7, metalness: 0.1 }

/** The resolved look for a die: what to draw and how the surface reacts to light. */
export interface DiceMaterialResolution {
  roughness: number
  metalness: number
  /** Draws the face (background + numbers) into the albedo texture. */
  faceRenderer: FaceRenderer
  /** Optional per-texel material mask (G→roughness, B→metalness); e.g. matte metal numbers. */
  materialMaskRenderer?: FaceRenderer
}

/**
 * Resolve a die's material look from its `shape` + `material` string. The ONE place
 * material-specific rendering lives. The tie-dye / metal-mask renderers assume the
 * d20's triangular faces, so they only apply to the d20.
 */
export function resolveDiceMaterial(shape: DiceShape, material?: string): DiceMaterialResolution {
  const pbr = (material && MATERIAL_PBR[material]) || DEFAULT_PBR
  const faceRenderer =
    material === 'rubber' && shape === 'd20' ? renderTieDyeD20 : getFaceRendererForShape(shape)
  const materialMaskRenderer =
    material === 'metal' && shape === 'd20' ? renderMetalMaskD20 : undefined
  return { roughness: pbr.roughness, metalness: pbr.metalness, faceRenderer, materialMaskRenderer }
}

/** Non-material extras a call site may layer on (emissive glow, glass transparency). */
export interface DiceFaceMaterialExtras {
  emissive?: string
  emissiveIntensity?: number
  transparent?: boolean
  opacity?: number
}

/**
 * Build the THREE material for ONE die face from a resolved look. The single
 * material constructor shared by `useDiceMaterials` (tray) and the inventory
 * previews, so the albedo map, the roughness/metalness maps for matte-metal numbers,
 * and the scalar PBR are applied identically everywhere.
 */
export function buildDiceFaceMaterial(params: {
  shape: DiceShape
  faceValue: number
  color: string
  resolution: DiceMaterialResolution
  textureSize: number
  extras?: DiceFaceMaterialExtras
}): THREE.MeshStandardMaterial {
  const { shape, faceValue, color, resolution, textureSize, extras } = params
  const { faceRenderer, materialMaskRenderer, roughness, metalness } = resolution

  const texture = renderDiceFaceToTexture(faceValue, color, faceRenderer, textureSize)
  const material = new THREE.MeshStandardMaterial({
    map: texture,
    // When a mask is present it governs per-texel, so the scalars go to 1.
    roughness: materialMaskRenderer ? 1 : roughness,
    metalness: materialMaskRenderer ? 1 : metalness,
    flatShading: shape === 'd10',
    transparent: extras?.transparent ?? false,
    opacity: extras?.opacity ?? 1,
  })

  if (materialMaskRenderer) {
    const mask = renderDiceFaceToTexture(faceValue, '#000000', materialMaskRenderer, textureSize)
    mask.colorSpace = THREE.NoColorSpace // raw channel values, not sRGB color
    material.metalnessMap = mask
    material.roughnessMap = mask
  }

  if (extras?.emissive) {
    material.emissive = new THREE.Color(extras.emissive)
    material.emissiveIntensity = extras.emissiveIntensity ?? 0
  }

  return material
}
