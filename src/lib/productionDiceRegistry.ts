/**
 * Production Dice Registry
 *
 * Handles loading and managing production-ready custom dice assets
 * from the public/dice folder. Uses a manifest.json that lists all
 * available sets and dice, which is generated from the folder structure.
 */

import { DiceMetadata, DiceSetMetadata, CustomDiceAsset, DiceRarity } from '../types/customDice'

// Base path for dice assets
const DICE_BASE_PATH = '/dice'

/**
 * Manifest structure (auto-generated from folder structure)
 */
export interface DiceManifest {
  /** Schema version */
  version: string
  /** When manifest was last generated */
  generatedAt: string
  /** All available sets */
  sets: ManifestSet[]
}

/**
 * Set entry in manifest
 */
export interface ManifestSet {
  /** Set folder name (also used as ID) */
  id: string
  /** Path to set folder */
  path: string
  /** Dice in this set */
  dice: ManifestDice[]
}

/**
 * Dice entry in manifest
 */
export interface ManifestDice {
  /** Dice folder name */
  id: string
  /** Path to dice folder */
  path: string
  /** Whether thumbnail exists */
  hasThumbnail?: boolean
}

/**
 * Loaded production dice with full data
 */
export interface LoadedProductionDice {
  /** Unique ID (set-id/dice-id) */
  id: string
  /** Set this dice belongs to */
  setId: string
  /** Set metadata */
  setMetadata: DiceSetMetadata
  /** Dice metadata */
  metadata: DiceMetadata
  /** Full asset ready for use */
  asset: CustomDiceAsset
  /** URL to thumbnail image (if available) */
  thumbnailUrl?: string
}

/**
 * Fetch the dice manifest
 */
export async function fetchDiceManifest(): Promise<DiceManifest | null> {
  try {
    const response = await fetch(`${DICE_BASE_PATH}/manifest.json`)
    if (!response.ok) {
      console.warn('[ProductionDiceRegistry] No manifest.json found - run generate-dice-manifest')
      return null
    }
    return await response.json()
  } catch (error) {
    console.error('[ProductionDiceRegistry] Failed to fetch manifest:', error)
    return null
  }
}

/**
 * Load set metadata
 */
export async function loadSetMetadata(setPath: string): Promise<DiceSetMetadata | null> {
  try {
    const response = await fetch(`${DICE_BASE_PATH}/${setPath}/set.json`)
    if (!response.ok) {
      console.warn(`[ProductionDiceRegistry] No set.json found for ${setPath}`)
      return null
    }
    return await response.json()
  } catch (error) {
    console.error(`[ProductionDiceRegistry] Failed to load set metadata for ${setPath}:`, error)
    return null
  }
}

/**
 * Load dice metadata
 */
export async function loadDiceMetadata(dicePath: string): Promise<DiceMetadata | null> {
  try {
    const response = await fetch(`${DICE_BASE_PATH}/${dicePath}/metadata.json`)
    if (!response.ok) {
      console.warn(`[ProductionDiceRegistry] No metadata.json found for ${dicePath}`)
      return null
    }
    return await response.json()
  } catch (error) {
    console.error(`[ProductionDiceRegistry] Failed to load dice metadata for ${dicePath}:`, error)
    return null
  }
}

/**
 * Get the model URL for a dice
 */
export function getDiceModelUrl(dicePath: string): string {
  return `${DICE_BASE_PATH}/${dicePath}/model.glb`
}

/**
 * Get the thumbnail URL for a dice
 */
export function getDiceThumbnailUrl(dicePath: string): string {
  return `${DICE_BASE_PATH}/${dicePath}/thumbnail.png`
}

/**
 * Load a single production dice
 */
export async function loadProductionDice(
  setId: string,
  diceId: string,
  setMetadata: DiceSetMetadata
): Promise<LoadedProductionDice | null> {
  const dicePath = `${setId}/${diceId}`
  const metadata = await loadDiceMetadata(dicePath)

  if (!metadata) {
    return null
  }

  const fullId = `${setId}/${diceId}`
  const modelUrl = getDiceModelUrl(dicePath)
  const thumbnailUrl = getDiceThumbnailUrl(dicePath)

  const asset: CustomDiceAsset = {
    id: fullId,
    metadata,
    modelUrl,
    thumbnailUrl,
  }

  return {
    id: fullId,
    setId,
    setMetadata,
    metadata,
    asset,
    thumbnailUrl,
  }
}

/**
 * Load all production dice from the manifest
 */
export async function loadAllProductionDice(): Promise<LoadedProductionDice[]> {
  const manifest = await fetchDiceManifest()
  if (!manifest) {
    return []
  }

  const loadedDice: LoadedProductionDice[] = []

  for (const set of manifest.sets) {
    const setMetadata = await loadSetMetadata(set.path)
    if (!setMetadata) continue

    for (const dice of set.dice) {
      const loaded = await loadProductionDice(set.id, dice.id, setMetadata)
      if (loaded) {
        loadedDice.push(loaded)
      }
    }
  }

  console.log(`[ProductionDiceRegistry] Loaded ${loadedDice.length} production dice`)
  return loadedDice
}

/**
 * Load all dice from a specific set
 */
export async function loadProductionDiceBySet(setId: string): Promise<LoadedProductionDice[]> {
  const manifest = await fetchDiceManifest()
  if (!manifest) return []

  const set = manifest.sets.find((s) => s.id === setId)
  if (!set) return []

  const setMetadata = await loadSetMetadata(set.path)
  if (!setMetadata) return []

  const loadedDice: LoadedProductionDice[] = []

  for (const dice of set.dice) {
    const loaded = await loadProductionDice(setId, dice.id, setMetadata)
    if (loaded) {
      loadedDice.push(loaded)
    }
  }

  return loadedDice
}

/**
 * Get all available set IDs
 */
export async function getAvailableSets(): Promise<string[]> {
  const manifest = await fetchDiceManifest()
  if (!manifest) return []
  return manifest.sets.map((s) => s.id)
}

/**
 * Get rarity from metadata with fallback
 */
export function getDiceRarity(metadata: DiceMetadata): DiceRarity {
  return metadata.rarity || 'common'
}

/**
 * Get description from metadata with fallback
 */
export function getDiceDescription(metadata: DiceMetadata): string {
  return metadata.description || `Created by ${metadata.artist}`
}
