import { DICE_SHAPES, type DiceShape } from '../types/diceShape'
import type { DicePresentationMetadata } from './multiplayerMessages'
import type { InventoryDie } from '../types/inventory'
import { createBasicDicePresentation } from './basicDice'
import { createDicePresentationMetadata } from './dicePresentation'
import { getBundledGltfDiceAsset, getCatalogAssetVersion } from './collectibleCatalog'
import { createThemeDicePresentation } from './themeDicePresentation'
import { THEME_REGISTRY } from '../themes/registry'

export interface SoloTableDie { shape: DiceShape; presentation: DicePresentationMetadata }
export interface SoloTableLoadout { version: 1; dice: SoloTableDie[] }
export const SOLO_TABLE_LIMIT = 30
const BYTE_LIMIT = 64 * 1024
const STRING_FIELDS = ['inventoryDieId', 'displayName', 'setId', 'rarity', 'baseColor', 'accentColor', 'material', 'customAssetId', 'customAssetVersionId', 'customAssetName', 'percentilePairId'] as const
const MATERIALS = new Set(['plastic', 'resin', 'metal', 'rubber', 'stone', 'glass', 'crystal', 'wood', 'bone', 'obsidian', 'celestial'])

function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid table entry')
  return value as Record<string, unknown>
}

/** Whitelist display fields. Percentile pairs are checked across the full table below. */
function sanitizeSoloPresentation(value: unknown): DicePresentationMetadata {
  const input = object(value)
  const result: DicePresentationMetadata = {}
  for (const field of STRING_FIELDS) {
    const text = input[field]
    if (text === undefined) continue
    if (typeof text !== 'string' || !text.length || text.length > 200 || [...text].some(char => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127)) throw new Error('Invalid table presentation')
    if ((field === 'baseColor' || field === 'accentColor') && !/^#(?:[\da-f]{3}|[\da-f]{6}|[\da-f]{8})$/iu.test(text)) throw new Error('Invalid table color')
    if (field === 'material' && !MATERIALS.has(text)) throw new Error('Invalid table material')
    result[field] = text
  }
  if (input.basic !== undefined) {
    if (typeof input.basic !== 'boolean') throw new Error('Invalid basic marker')
    if (input.basic) result.basic = true
  }
  if (input.percentileRole !== undefined) {
    if (input.percentileRole !== 'tens' && input.percentileRole !== 'ones') throw new Error('Invalid percentile role')
    result.percentileRole = input.percentileRole
  }
  return result
}

function validPairs(dice: SoloTableDie[]): SoloTableDie[] {
  return dice.map(die => {
    const { percentilePairId: id, percentileRole: role, ...rest } = die.presentation
    const pair = id ? dice.filter(candidate => candidate.presentation.percentilePairId === id) : []
    const valid = pair.length === 2
      && pair.some(candidate => candidate.shape === 'd10tens' && candidate.presentation.percentileRole === 'tens')
      && pair.some(candidate => candidate.shape === 'd10' && candidate.presentation.percentileRole === 'ones')
    return { ...die, presentation: valid ? { ...rest, percentilePairId: id, percentileRole: role } : rest }
  })
}

export function encodeSoloTable(dice: SoloTableDie[]): string {
  if (dice.length > SOLO_TABLE_LIMIT) throw new Error('Too many table dice')
  const data: SoloTableLoadout = { version: 1, dice: validPairs(dice.map(die => {
    if (!DICE_SHAPES.includes(die.shape)) throw new Error('Invalid table shape')
    return { shape: die.shape, presentation: sanitizeSoloPresentation(die.presentation) }
  })) }
  const encoded = JSON.stringify(data)
  if (new TextEncoder().encode(encoded).length > BYTE_LIMIT) throw new Error('Table storage limit')
  return encoded
}

export function readSoloTable(scope: string): { raw: string | null; dice: SoloTableDie[] | null; rejected: boolean } {
  let raw: string | null = null
  try {
    raw = localStorage.getItem(scope)
    if (raw === null) return { raw, dice: null, rejected: false }
    if (raw.length > BYTE_LIMIT || new TextEncoder().encode(raw).length > BYTE_LIMIT) throw new Error('Table storage limit')
    const data = object(JSON.parse(raw))
    if (data.version !== 1 || !Array.isArray(data.dice) || data.dice.length > SOLO_TABLE_LIMIT) throw new Error('Unsupported table data')
    const dice = data.dice.map(value => {
      const entry = object(value)
      if (!DICE_SHAPES.includes(entry.shape as DiceShape)) throw new Error('Invalid table shape')
      return { shape: entry.shape as DiceShape, presentation: sanitizeSoloPresentation(entry.presentation) }
    })
    return { raw, dice: validPairs(dice), rejected: false }
  } catch {
    return { raw, dice: null, rejected: true }
  }
}

/** Stored ownership is a request, never an entitlement. Re-resolve each available copy. */
export function resolveSoloTableDie(die: SoloTableDie, inventory: readonly InventoryDie[], unavailable: Set<string>): DicePresentationMetadata {
  const saved = die.presentation
  const pairing = saved.percentilePairId && saved.percentileRole
    ? { percentilePairId: saved.percentilePairId, percentileRole: saved.percentileRole } : {}
  const basic = () => ({ ...createBasicDicePresentation(die.shape), ...pairing })
  if (saved.inventoryDieId) {
    const owned = inventory.find(item => item.id === saved.inventoryDieId && item.type === die.shape && !unavailable.has(item.id))
    if (!owned) return basic()
    unavailable.add(owned.id)
    const presentation = createDicePresentationMetadata(owned)
    if (presentation.customAssetId && (!presentation.customAssetVersionId || !getBundledGltfDiceAsset(presentation.customAssetId, presentation.customAssetVersionId, die.shape))) {
      return basic()
    }
    return { ...sanitizeSoloPresentation(presentation), ...pairing }
  }
  if (saved.customAssetId && saved.customAssetVersionId) {
    // Only public unlimited theme standards may be restored without a current owned copy.
    const unlimited = THEME_REGISTRY.some(theme => createThemeDicePresentation(theme.id, die.shape).customAssetId === saved.customAssetId)
    const bundled = unlimited && getBundledGltfDiceAsset(saved.customAssetId, saved.customAssetVersionId, die.shape)
    const asset = bundled ? getCatalogAssetVersion(saved.customAssetVersionId) : undefined
    if (asset && asset.assetKind === 'gltf') {
      return {
        ...pairing,
        customAssetId: saved.customAssetId, customAssetVersionId: saved.customAssetVersionId,
        customAssetName: saved.customAssetName ?? asset.metadata.diceMetadata.name,
        displayName: saved.displayName ?? asset.metadata.name,
        setId: saved.setId,
        baseColor: saved.baseColor ?? asset.metadata.appearance.baseColor,
        accentColor: saved.accentColor ?? asset.metadata.appearance.accentColor,
        material: saved.material ?? asset.metadata.appearance.material,
      }
    }
  }
  return basic()
}
