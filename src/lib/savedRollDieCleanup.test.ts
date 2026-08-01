import { beforeEach, describe, expect, it } from 'vitest'

import {
  pruneRemovedDiceFromSavedRoll,
  pruneRemovedDiceFromSavedRolls,
  pruneSavedRollsForRemovedDice,
} from './savedRollDieCleanup'
import { useSavedRollsStore } from '../store/useSavedRollsStore'
import type { SavedRoll } from '../types/savedRolls'

function makeRoll(overrides: Partial<SavedRoll> = {}): SavedRoll {
  return {
    id: 'roll-1',
    name: 'Sword attack',
    flatBonus: 2,
    createdAt: 1,
    dice: [{
      id: 'entry-1',
      type: 'd6',
      quantity: 2,
      perDieBonus: 1,
      sources: [
        { kind: 'specific', dieId: 'die_gone' },
        { kind: 'specific', dieId: 'die_kept' },
      ],
    }],
    ...overrides,
  }
}

describe('pruneRemovedDiceFromSavedRoll', () => {
  it('rewrites only the sources naming a removed die', () => {
    const pruned = pruneRemovedDiceFromSavedRoll(makeRoll(), new Set(['die_gone']))

    expect(pruned.dice[0].sources).toEqual([
      { kind: 'anonymous', quantity: 1 },
      { kind: 'specific', dieId: 'die_kept' },
    ])
  })

  it('keeps every other property of the roll and the entry', () => {
    const roll = makeRoll()
    const pruned = pruneRemovedDiceFromSavedRoll(roll, new Set(['die_gone']))

    expect(pruned.name).toBe('Sword attack')
    expect(pruned.flatBonus).toBe(2)
    expect(pruned.dice[0]).toMatchObject({ id: 'entry-1', quantity: 2, perDieBonus: 1 })
  })

  it('preserves a skin so the replacement basic still renders in context', () => {
    const roll = makeRoll({
      dice: [{
        id: 'entry-1',
        type: 'd6',
        quantity: 1,
        perDieBonus: 0,
        sources: [{ kind: 'specific', dieId: 'die_gone', skinId: 'cozy' }],
      }],
    })

    expect(pruneRemovedDiceFromSavedRoll(roll, new Set(['die_gone'])).dice[0].sources)
      .toEqual([{ kind: 'anonymous', quantity: 1, skinId: 'cozy' }])
  })

  it('returns the same object when nothing was removed', () => {
    const roll = makeRoll()

    expect(pruneRemovedDiceFromSavedRoll(roll, new Set(['die_unrelated']))).toBe(roll)
    expect(pruneRemovedDiceFromSavedRoll(roll, new Set())).toBe(roll)
  })

  it('counts only the rolls it actually changed', () => {
    const touched = makeRoll({ id: 'roll-touched' })
    const untouched = makeRoll({
      id: 'roll-untouched',
      dice: [{ id: 'e', type: 'd6', quantity: 1, perDieBonus: 0, sources: [{ kind: 'anonymous', quantity: 1 }] }],
    })

    const result = pruneRemovedDiceFromSavedRolls([touched, untouched], new Set(['die_gone']))

    expect(result.changedCount).toBe(1)
    expect(result.rolls[1]).toBe(untouched)
  })
})

describe('pruneSavedRollsForRemovedDice', () => {
  beforeEach(() => {
    localStorage.clear()
    useSavedRollsStore.setState({ savedRolls: [], currentlyEditing: null })
  })

  it('repairs both the saved list and the roll being edited', () => {
    useSavedRollsStore.setState({
      savedRolls: [makeRoll()],
      currentlyEditing: makeRoll({ id: 'roll-editing' }),
    })

    pruneSavedRollsForRemovedDice(['die_gone'])

    const { savedRolls, currentlyEditing } = useSavedRollsStore.getState()
    expect(savedRolls[0].dice[0].sources?.[0]).toEqual({ kind: 'anonymous', quantity: 1 })
    expect(currentlyEditing?.dice[0].sources?.[0]).toEqual({ kind: 'anonymous', quantity: 1 })
  })

  it('does not publish an update when nothing referenced a removed die', () => {
    const before = makeRoll()
    useSavedRollsStore.setState({ savedRolls: [before], currentlyEditing: null })
    let notifications = 0
    const unsubscribe = useSavedRollsStore.subscribe(() => { notifications += 1 })

    pruneSavedRollsForRemovedDice(['die_unrelated'])
    pruneSavedRollsForRemovedDice([])
    unsubscribe()

    expect(notifications).toBe(0)
    expect(useSavedRollsStore.getState().savedRolls[0]).toBe(before)
  })
})
