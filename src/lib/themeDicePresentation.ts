import type { DiceShape } from './geometries'
import type { DicePresentationMetadata } from './multiplayerMessages'
import { createBasicDicePresentation } from './basicDice'
import { getBundledGltfDiceAsset, getCatalogAssetVersion, getCatalogItemByKey } from './collectibleCatalog'

const THEME_DICE_SETS: ReadonlyMap<string, string> = new Map([
  ['sunlit-glade-cel', 'woodland-sculpted-set'],
  ['cyberpunk-cutline', 'cyberpunk-cutline-set'],
  ['monster-dungeon', 'monster-dungeon-set'],
])
const STANDARD_SHAPES = new Set<DiceShape>(['d4', 'd6', 'd8', 'd10', 'd12', 'd20'])

/** Infinite visual supply, not a collectible instance or an ownership grant. */
export function createThemeDicePresentation(themeId: string | undefined, shape: DiceShape): DicePresentationMetadata {
  const setId = themeId ? THEME_DICE_SETS.get(themeId) : undefined
  const item = setId && STANDARD_SHAPES.has(shape) ? getCatalogItemByKey(`${setId}/${shape}`) : undefined
  const asset = item ? getCatalogAssetVersion(item.assetVersionId) : undefined
  if (!item || item.diceType !== shape || item.setId !== setId || !asset
    || asset.catalogItemId !== item.id || asset.assetKind !== 'gltf'
    || !getBundledGltfDiceAsset(item.catalogKey, asset.id, shape)) {
    return createBasicDicePresentation(shape)
  }
  return {
    customAssetId: item.catalogKey,
    customAssetVersionId: asset.id,
    customAssetName: asset.metadata.diceMetadata.name,
    displayName: asset.metadata.name,
    setId: item.setId,
    baseColor: asset.metadata.appearance.baseColor,
    accentColor: asset.metadata.appearance.accentColor,
    material: asset.metadata.appearance.material,
  }
}
