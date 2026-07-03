import { describe, expect, it } from 'vitest'
import { formatSavedRoll } from './diceHelpers'
import { rollDiceEntry } from './rollEngine'
import {
  createAnonymousRollSource,
  createSpecificDieRollSource,
  expandDiceEntrySources,
  getDiceEntrySourceQuantity,
  getSpecificDieIds,
  normalizeSavedRollSources,
  withRollSources,
} from './rollSources'
import type { DiceEntry, SavedRoll } from '../types/savedRolls'

describe('rollSources', () => {
  it('represents anonymous quantities and specific owned dice in one saved roll', () => {
    const roll: SavedRoll = normalizeSavedRollSources({
      id: 'mixed-roll',
      name: 'Fireball plus lucky attack',
      dice: [
        {
          id: 'anon-d6',
          type: 'd6',
          quantity: 8,
          perDieBonus: 0,
          sources: [createAnonymousRollSource(8)],
        },
        {
          id: 'lucky-d20',
          type: 'd20',
          quantity: 1,
          perDieBonus: 0,
          sources: [createSpecificDieRollSource('die_lucky_d20', 'skin_gold')],
        },
      ],
      flatBonus: 0,
      createdAt: 1,
    })

    expect(getDiceEntrySourceQuantity(roll.dice[0])).toBe(8)
    expect(getDiceEntrySourceQuantity(roll.dice[1])).toBe(1)
    expect(getSpecificDieIds(roll.dice[1])).toEqual(['die_lucky_d20'])
    expect(formatSavedRoll(roll)).toBe('8d6 + 1d20 [1 specific]')
  })

  it('migrates legacy quantity and skinId into anonymous roll sources', () => {
    const legacyEntry: DiceEntry = {
      id: 'legacy',
      type: 'd6',
      quantity: 3,
      perDieBonus: 0,
      skinId: 'classic-red',
    }

    const sources = expandDiceEntrySources(legacyEntry)

    expect(sources).toHaveLength(3)
    expect(sources).toEqual([
      { kind: 'anonymous', quantity: 1, skinId: 'classic-red' },
      { kind: 'anonymous', quantity: 1, skinId: 'classic-red' },
      { kind: 'anonymous', quantity: 1, skinId: 'classic-red' },
    ])
  })

  it('keeps roll-source metadata on rolled dice', () => {
    const entry: DiceEntry = withRollSources(
      {
        id: 'owned-entry',
        type: 'd20',
        quantity: 1,
        perDieBonus: 0,
      },
      [createSpecificDieRollSource('die_lucky_d20')]
    )

    const result = rollDiceEntry(entry)

    expect(result.rolls).toHaveLength(1)
    expect(result.rolls[0].source).toMatchObject({
      kind: 'specific',
      dieId: 'die_lucky_d20',
      slotIndex: 0,
    })
  })
})
