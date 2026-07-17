import { describe, expect, it } from 'vitest'
import type { InventoryDie } from '../types/inventory'
import { createDicePresentationMetadata } from './dicePresentation'

function die(storage: 'bundled' | 'indexeddb'): InventoryDie {
  return {
    id: 'inventory-die',
    type: 'd6',
    setId: 'cozy-forest-imagegen-set',
    rarity: 'uncommon',
    appearance: { baseColor: '#123456', accentColor: '#ffffff', material: 'wood' },
    vfx: {},
    name: 'Hearthwood D6',
    isFavorite: false,
    isLocked: false,
    acquiredAt: 1,
    source: 'starter',
    catalogRef: storage === 'bundled' ? {
      itemId: 'cozy-forest-imagegen-set/hearthwood-d6@1',
      assetVersionId: 'cozy-forest-imagegen-set/hearthwood-d6@1/asset@1',
    } : undefined,
    stats: { timesRolled: 0, totalValue: 0, critsRolled: 0, failsRolled: 0 },
    assignedToRolls: [],
    customAsset: {
      modelUrl: '/dice/cozy-forest-imagegen-set/hearthwood-d6/model.glb',
      assetId: 'cozy-forest-imagegen-set/hearthwood-d6',
      storage,
      metadata: {
        version: '1.0',
        diceType: 'd6',
        name: 'Hearthwood D6',
        artist: 'Dicesuki',
        created: '2026-07-17',
        scale: 1.1,
        faceNormals: [],
        physics: { density: 0.38, restitution: 0.3, friction: 0.7 },
        colliderType: 'hull',
        colliderArgs: {},
      },
    },
  }
}

describe('dice presentation metadata', () => {
  it('allows bundled catalog GLBs to resolve on remote tables', () => {
    expect(createDicePresentationMetadata(die('bundled'))).toMatchObject({
      customAssetId: 'cozy-forest-imagegen-set/hearthwood-d6',
      customAssetVersionId: 'cozy-forest-imagegen-set/hearthwood-d6@1/asset@1',
      customAssetName: 'Hearthwood D6',
    })
    expect(createDicePresentationMetadata(die('bundled'))).not.toHaveProperty('unsupportedReason')
  })

  it('keeps local IndexedDB GLBs explicitly unsupported for remote players', () => {
    expect(createDicePresentationMetadata(die('indexeddb')).unsupportedReason).toMatch(/local-only/)
  })
})
