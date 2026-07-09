import type { DicePresentationMetadata } from './multiplayerMessages'
import type { InventoryDie } from '../types/inventory'

export function createDicePresentationMetadata(die: InventoryDie): DicePresentationMetadata {
  const metadata: DicePresentationMetadata = {
    inventoryDieId: die.id,
    displayName: die.name,
    setId: die.setId,
    rarity: die.rarity,
    baseColor: die.appearance.baseColor,
    accentColor: die.appearance.accentColor,
    material: die.appearance.material,
  }

  if (die.customAsset) {
    metadata.customAssetId = die.customAsset.assetId ?? die.id
    metadata.customAssetName = die.customAsset.metadata.name
    metadata.unsupportedReason = 'Custom GLB assets are local-only in multiplayer; using preserved presentation metadata with generic server physics.'
  }

  return metadata
}
