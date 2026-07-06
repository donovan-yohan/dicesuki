import { beforeEach, describe, expect, it } from 'vitest'
import { normalizePersistedSavedRollsState, useSavedRollsStore } from './useSavedRollsStore'
import {
  createAnonymousRollSource,
  createSpecificDieRollSource,
  getDiceEntrySourceQuantity,
  getSpecificDieIds,
} from '../lib/rollSources'
import type { DiceEntry, SavedRoll } from '../types/savedRolls'

const baseRoll: SavedRoll = {
  id: 'roll-owned',
  name: 'Owned mixed roll',
  dice: [],
  flatBonus: 0,
  createdAt: 1,
}

function entry(id: string, type: DiceEntry['type'], quantity: number, sources = [createAnonymousRollSource(quantity)]): DiceEntry {
  return {
    id,
    type,
    quantity,
    perDieBonus: 0,
    sources,
  }
}

describe('useSavedRollsStore roll source identity', () => {
  beforeEach(() => {
    localStorage.clear()
    useSavedRollsStore.setState({ savedRolls: [], currentlyEditing: null })
  })

  it('normalizes legacy saved rolls without dropping existing skin behavior', () => {
    useSavedRollsStore.getState().addRoll({
      ...baseRoll,
      dice: [{ id: 'legacy', type: 'd6', quantity: 2, perDieBonus: 0, skinId: 'red' }],
    })

    const saved = useSavedRollsStore.getState().savedRolls[0]

    expect(saved.dice[0].sources).toEqual([{ kind: 'anonymous', quantity: 2, skinId: 'red' }])
    expect(saved.dice[0].skinId).toBe('red')
  })

  it('preserves specific die ids and anonymous quantities through add, remove, and reorder editing flows', () => {
    useSavedRollsStore.getState().startEditing(baseRoll)

    useSavedRollsStore.getState().addDiceEntry(entry('eight-d6', 'd6', 8))
    useSavedRollsStore.getState().addDiceEntry(entry('lucky-d20', 'd20', 1, [
      createSpecificDieRollSource('die_lucky_d20'),
    ]))
    useSavedRollsStore.getState().addDiceEntry(entry('bulk-d4', 'd4', 4))
    useSavedRollsStore.getState().removeDiceEntry('bulk-d4')
    useSavedRollsStore.getState().reorderDiceEntries(1, 0)

    const dice = useSavedRollsStore.getState().currentlyEditing?.dice ?? []

    expect(dice.map(d => d.id)).toEqual(['lucky-d20', 'eight-d6'])
    expect(getSpecificDieIds(dice[0])).toEqual(['die_lucky_d20'])
    expect(getDiceEntrySourceQuantity(dice[1])).toBe(8)
  })

  it('updates an entry to a mixed source shape without losing its entry id', () => {
    useSavedRollsStore.getState().startEditing({
      ...baseRoll,
      dice: [entry('mixed-d6', 'd6', 1)],
    })

    useSavedRollsStore.getState().updateDiceEntry('mixed-d6', {
      sources: [
        createAnonymousRollSource(2),
        createSpecificDieRollSource('die_favorite_d6'),
      ],
    })

    const updated = useSavedRollsStore.getState().currentlyEditing?.dice[0]

    expect(updated?.id).toBe('mixed-d6')
    expect(updated?.sources).toEqual([
      { kind: 'anonymous', quantity: 2 },
      { kind: 'specific', dieId: 'die_favorite_d6' },
    ])
    expect(updated?.quantity).toBe(3)
  })

  it('keeps existing sources in sync when editing a saved roll quantity', () => {
    useSavedRollsStore.getState().startEditing({
      ...baseRoll,
      dice: [entry('resized-d6', 'd6', 1)],
    })

    useSavedRollsStore.getState().updateDiceEntry('resized-d6', { quantity: 4 })

    const updated = useSavedRollsStore.getState().currentlyEditing?.dice[0]

    expect(updated?.quantity).toBe(4)
    expect(updated?.rollCount).toBeUndefined()
    expect(updated?.sources).toEqual([createAnonymousRollSource(4)])
    expect(getDiceEntrySourceQuantity(updated as DiceEntry)).toBe(4)
  })

  it('guards persisted migration state against corrupt saved rolls', () => {
    expect(normalizePersistedSavedRollsState('bad-state')).toEqual({
      savedRolls: [],
      currentlyEditing: null,
    })

    const migrated = normalizePersistedSavedRollsState({
      savedRolls: 'not-an-array',
      currentlyEditing: {
        ...baseRoll,
        dice: { nope: true },
      },
    })

    expect(migrated.savedRolls).toEqual([])
    expect(migrated.currentlyEditing?.dice).toEqual([])
  })
})
