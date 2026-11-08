import { afterEach, describe, expect, it, vi } from 'vitest'
import { createBasicDicePresentation } from './basicDice'
import * as catalog from './collectibleCatalog'
import { createThemeDicePresentation } from './themeDicePresentation'

const shapes = ['d4', 'd6', 'd8', 'd10', 'd12', 'd20'] as const
const worlds = [
  ['sunlit-glade-cel', 'woodland-sculpted-set'],
  ['cyberpunk-cutline', 'cyberpunk-cutline-set'],
  ['monster-dungeon', 'monster-dungeon-set'],
] as const

afterEach(() => vi.restoreAllMocks())

describe('theme standard dice presentations', () => {
  for (const [themeId, setId] of worlds) {
    it.each(shapes)(`${themeId} pins the real catalog presentation for %s without ownership`, shape => {
      const item = catalog.getCatalogItemByKey(`${setId}/${shape}`)!
      const asset = catalog.getCatalogAssetVersion(item.assetVersionId)!
      if (asset.assetKind !== 'gltf') throw new Error('Expected bundled GLB')
      const presentation = createThemeDicePresentation(themeId, shape)
      expect(presentation).toEqual({
        customAssetId: item.catalogKey,
        customAssetVersionId: asset.id,
        customAssetName: asset.metadata.diceMetadata.name,
        displayName: asset.metadata.name,
        setId: item.setId,
        baseColor: asset.metadata.appearance.baseColor,
        accentColor: asset.metadata.appearance.accentColor,
        material: asset.metadata.appearance.material,
      })
      expect(catalog.getBundledGltfDiceAsset(presentation.customAssetId!, presentation.customAssetVersionId, shape)).not.toBeNull()
    })
  }

  it.each(shapes)('Classic retains the existing basic %s', shape => {
    expect(createThemeDicePresentation('default', shape)).toEqual(createBasicDicePresentation(shape))
  })

  it.each([undefined, 'unknown-theme', 'sunlit-glade'])('does not guess an unsupported canonical theme %s', theme => {
    expect(createThemeDicePresentation(theme, 'd20')).toEqual(createBasicDicePresentation('d20'))
  })

  it('keeps unsupported percentile tens basic', () => {
    expect(createThemeDicePresentation('monster-dungeon', 'd10tens')).toEqual(createBasicDicePresentation('d10tens'))
  })

  it('falls back when the catalog item is missing', () => {
    vi.spyOn(catalog, 'getCatalogItemByKey').mockReturnValue(undefined)
    expect(createThemeDicePresentation('monster-dungeon', 'd20')).toEqual(createBasicDicePresentation('d20'))
  })

  it('falls back when the immutable asset is missing', () => {
    vi.spyOn(catalog, 'getCatalogAssetVersion').mockReturnValue(undefined)
    expect(createThemeDicePresentation('monster-dungeon', 'd20')).toEqual(createBasicDicePresentation('d20'))
  })

  it('rejects a real catalog item with the wrong shape', () => {
    const wrongShape = catalog.getCatalogItemByKey('monster-dungeon-set/d6')!
    vi.spyOn(catalog, 'getCatalogItemByKey').mockReturnValue(wrongShape)
    expect(createThemeDicePresentation('monster-dungeon', 'd20')).toEqual(createBasicDicePresentation('d20'))
  })

  it('requires bundled resolution with the pinned revision and expected shape', () => {
    const resolve = vi.spyOn(catalog, 'getBundledGltfDiceAsset').mockReturnValue(null)
    const item = catalog.getCatalogItemByKey('monster-dungeon-set/d20')!
    expect(createThemeDicePresentation('monster-dungeon', 'd20')).toEqual(createBasicDicePresentation('d20'))
    expect(resolve).toHaveBeenCalledWith(item.catalogKey, item.assetVersionId, 'd20')
  })
})
