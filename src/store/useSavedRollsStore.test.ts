import { beforeEach, describe, expect, it, vi } from 'vitest'
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
      deletedRolls: {},
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

describe('useSavedRollsStore sync revisions and tombstones', () => {
  beforeEach(() => {
    localStorage.clear()
    useSavedRollsStore.setState({ savedRolls: [], currentlyEditing: null, deletedRolls: {} })
  })

  /** Seed one roll whose revision is pinned far in the past. */
  function seedStaleRoll(updatedAt = 1_000): void {
    useSavedRollsStore.setState({
      savedRolls: [{ ...baseRoll, id: 'r1', updatedAt }],
      currentlyEditing: null,
      deletedRolls: {},
    })
  }

  function revisionOf(id = 'r1'): number | undefined {
    return useSavedRollsStore.getState().savedRolls.find(r => r.id === id)?.updatedAt
  }

  // Each case compares against a PINNED stale revision rather than against the
  // previous call's value. Asserting `>= previous` was tautological: an action
  // that never stamped at all left the value untouched, which still satisfied it.
  it.each([
    ['updateRoll', () => useSavedRollsStore.getState().updateRoll('r1', { name: 'renamed' })],
    ['toggleFavorite', () => useSavedRollsStore.getState().toggleFavorite('r1')],
  ])('advances the roll revision on %s', (_label, mutate) => {
    seedStaleRoll()
    mutate()
    expect(revisionOf()).toBeGreaterThan(1_000)
  })

  it('stamps a revision on addRoll and duplicateRoll', () => {
    useSavedRollsStore.getState().addRoll({ ...baseRoll, id: 'r1' })
    expect(revisionOf()).toBeGreaterThan(1_000)

    useSavedRollsStore.getState().duplicateRoll('r1')
    const copy = useSavedRollsStore.getState().savedRolls[1]
    expect(copy.updatedAt).toBeGreaterThan(1_000)
  })

  it('does NOT advance the revision on markRollAsUsed', () => {
    // Rolling a saved roll is not an edit. If it moved the revision it would
    // beat a rename made later on another device, and could out-rank the roll's
    // own tombstone and bring a deleted roll back.
    seedStaleRoll()
    useSavedRollsStore.getState().markRollAsUsed('r1')

    expect(revisionOf()).toBe(1_000)
    expect(useSavedRollsStore.getState().savedRolls[0].lastUsed).toBeTypeOf('number')
  })

  it('mints a unique id when duplicating twice inside one millisecond', () => {
    // `roll-${Date.now()}` is millisecond-resolution, and a collision costs one
    // of the two rolls the moment sync keys on the id.
    useSavedRollsStore.getState().addRoll({ ...baseRoll, id: 'r1' })
    const now = Date.now()
    const spy = vi.spyOn(Date, 'now').mockReturnValue(now)
    try {
      useSavedRollsStore.getState().duplicateRoll('r1')
      useSavedRollsStore.getState().duplicateRoll('r1')
    } finally {
      spy.mockRestore()
    }

    const ids = useSavedRollsStore.getState().savedRolls.map(r => r.id)
    expect(ids).toHaveLength(3)
    expect(new Set(ids).size).toBe(3)
  })

  it('records a tombstone on delete so the removal can propagate', () => {
    useSavedRollsStore.getState().addRoll({ ...baseRoll, id: 'r1' })
    useSavedRollsStore.getState().deleteRoll('r1')

    expect(useSavedRollsStore.getState().savedRolls).toEqual([])
    expect(useSavedRollsStore.getState().deletedRolls.r1).toBeTypeOf('number')
  })

  it('retires the tombstone when the same id is added back', () => {
    // Left in place it would delete the new roll on the next merge.
    useSavedRollsStore.getState().addRoll({ ...baseRoll, id: 'r1' })
    useSavedRollsStore.getState().deleteRoll('r1')
    useSavedRollsStore.getState().addRoll({ ...baseRoll, id: 'r1' })

    expect(useSavedRollsStore.getState().savedRolls.map(r => r.id)).toEqual(['r1'])
    expect(useSavedRollsStore.getState().deletedRolls).not.toHaveProperty('r1')
  })

  it('reads a legacy blob with no tombstone map as "no deletions known"', () => {
    expect(normalizePersistedSavedRollsState({ savedRolls: [] }).deletedRolls).toEqual({})
  })
})
