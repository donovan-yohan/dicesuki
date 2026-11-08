import { beforeEach, describe, expect, it } from 'vitest'
import { encodeSoloTable, readSoloTable, resolveSoloTableDie, type SoloTableDie } from './soloTableLoadout'
import { createThemeDicePresentation } from './themeDicePresentation'
import { createBasicDicePresentation } from './basicDice'
import { useInventoryStore } from '../store/useInventoryStore'

const key = 'dicesuki-solo-table:v1:guest'
beforeEach(() => { localStorage.clear(); useInventoryStore.getState().reset() })

describe('solo table data boundary', () => {
  it('retains valid paired percentile metadata but drops orphaned and mismatched pairs', () => {
    const pair: SoloTableDie[] = [
      { shape: 'd10tens', presentation: { ...createBasicDicePresentation('d10tens'), percentilePairId: 'pair-1', percentileRole: 'tens' } },
      { shape: 'd10', presentation: { ...createBasicDicePresentation('d10'), percentilePairId: 'pair-1', percentileRole: 'ones' } },
    ]
    localStorage.setItem(key, encodeSoloTable(pair))
    expect(readSoloTable(key).dice).toEqual(pair)
    expect(JSON.parse(encodeSoloTable(pair.slice(0, 1))).dice[0].presentation).not.toHaveProperty('percentilePairId')
    expect(JSON.parse(encodeSoloTable([pair[0], pair[0]])).dice[0].presentation).not.toHaveProperty('percentilePairId')
  })

  it.each(['{', JSON.stringify({ version: 2, dice: [] }), JSON.stringify({ version: 1, dice: Array(31).fill({ shape: 'd6', presentation: {} }) }), 'x'.repeat(65537), JSON.stringify({ version: 1, dice: [{ shape: 'd999', presentation: {} }] })])('rejects invalid data without rewriting its bytes', raw => {
    localStorage.setItem(key, raw)
    expect(readSoloTable(key)).toEqual({ raw, dice: null, rejected: true })
    expect(localStorage.getItem(key)).toBe(raw)
  })

  it('restores unlimited pinned bundled standards without ownership or current-theme substitution', () => {
    const presentation = createThemeDicePresentation('monster-dungeon', 'd6')
    expect(resolveSoloTableDie({ shape: 'd6', presentation }, [], new Set())).toEqual(presentation)
    expect(resolveSoloTableDie({ shape: 'd8', presentation }, [], new Set())).toEqual(createBasicDicePresentation('d8'))
    expect(resolveSoloTableDie({ shape: 'd6', presentation: { ...presentation, customAssetVersionId: 'missing' } }, [], new Set())).toEqual(createBasicDicePresentation('d6'))
    expect(resolveSoloTableDie({ shape: 'd6', presentation: { customAssetId: 'https://example.invalid/model.glb' } }, [], new Set())).toEqual(createBasicDicePresentation('d6'))
  })

  it('re-resolves a matching owned copy once and falls back for duplicates, deleted IDs and wrong shapes', () => {
    const owned = useInventoryStore.getState().addDie({ id: 'mine', type: 'd6', setId: 'starter', rarity: 'rare', name: 'Actual name', appearance: { baseColor: '#123456', accentColor: '#ffffff', material: 'wood' }, vfx: {}, source: 'starter', isFavorite: false, isLocked: false })
    const unavailable = new Set<string>()
    const entry: SoloTableDie = { shape: 'd6', presentation: { inventoryDieId: 'mine', displayName: 'Forged name' } }
    expect(resolveSoloTableDie(entry, [owned], unavailable)).toMatchObject({ inventoryDieId: 'mine', displayName: 'Actual name', baseColor: '#123456' })
    expect(resolveSoloTableDie(entry, [owned], unavailable)).toEqual(createBasicDicePresentation('d6'))
    expect(resolveSoloTableDie(entry, [], new Set())).toEqual(createBasicDicePresentation('d6'))
    expect(resolveSoloTableDie({ ...entry, shape: 'd20' }, [owned], new Set())).toEqual(createBasicDicePresentation('d20'))
  })
})
