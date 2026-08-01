import { describe, expect, it } from 'vitest'
import { formatSavedRoll } from './diceHelpers'
import { rollDiceEntry } from './rollEngine'
import {
  createAnonymousRollSource,
  createSpecificDieRollSource,
  expandDiceEntrySources,
  getDiceEntrySourceQuantity,
  getSpecificDieIds,
  getRollDiceCount,
  normalizeSavedRollSources,
  resizeRollSources,
  withNormalizedRollSources,
  withRollSources,
} from './rollSources'
import type { DiceEntry, SavedRoll } from '../types/savedRolls'

describe('rollSources', () => {
  it('drops malformed persisted sources instead of throwing during normalization', () => {
    const corruptEntry = {
      id: 'corrupt-entry',
      type: 'd6',
      quantity: Number.NaN,
      perDieBonus: 0,
      sources: [
        { kind: 'specific' },
        { kind: 'anonymous', quantity: Number.POSITIVE_INFINITY },
      ],
    } as unknown as DiceEntry

    expect(expandDiceEntrySources(corruptEntry)).toEqual([
      { kind: 'anonymous', quantity: 1 },
    ])
  })

  it('falls back when persisted sources or dice are not arrays', () => {
    const corruptEntry = {
      id: 'corrupt-entry',
      type: 'd6',
      quantity: 2,
      perDieBonus: 0,
      sources: { kind: 'anonymous', quantity: 99 },
    } as unknown as DiceEntry

    expect(expandDiceEntrySources(corruptEntry)).toEqual([
      { kind: 'anonymous', quantity: 1 },
      { kind: 'anonymous', quantity: 1 },
    ])
    expect(normalizeSavedRollSources({
      id: 'corrupt-roll',
      name: 'Corrupt roll',
      dice: 'not-an-array',
      flatBonus: 0,
      createdAt: 1,
    } as unknown as SavedRoll).dice).toEqual([])
  })

  it('reconciles stale sources when an existing entry quantity changes', () => {
    const entry: DiceEntry = {
      id: 'anon-d6',
      type: 'd6',
      quantity: 1,
      perDieBonus: 0,
      sources: [createAnonymousRollSource(1)],
    }

    const resized = withNormalizedRollSources({ ...entry, quantity: 3 })

    expect(resized.sources).toEqual([createAnonymousRollSource(3)])
    expect(getDiceEntrySourceQuantity(resized)).toBe(3)
  })

  it('preserves multiple anonymous skin groups when shrinking quantity', () => {
    const entry: DiceEntry = {
      id: 'multi-skin-d6',
      type: 'd6',
      quantity: 3,
      perDieBonus: 0,
      sources: [
        createAnonymousRollSource(2, 'red'),
        createAnonymousRollSource(2, 'blue'),
      ],
    }

    const resized = withNormalizedRollSources(entry)

    expect(resized.sources).toEqual([
      createAnonymousRollSource(2, 'red'),
      createAnonymousRollSource(1, 'blue'),
    ])
    expect(getDiceEntrySourceQuantity(resized)).toBe(3)
  })

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


describe('resizeRollSources', () => {
  const a = createSpecificDieRollSource('die-a')
  const b = createSpecificDieRollSource('die-b')
  const c = createSpecificDieRollSource('die-c')

  it('appends generic dice when growing', () => {
    // Arrange / Act
    const result = resizeRollSources([a, b], 5)

    // Assert
    expect(result.sources).toEqual([a, b, createAnonymousRollSource(3)])
    expect(result.droppedDieIds).toEqual([])
  })

  it('returns the list untouched when the target already matches', () => {
    // Arrange
    const sources = [a, createAnonymousRollSource(2)]

    // Act
    const result = resizeRollSources(sources, 3)

    // Assert
    expect(result.sources).toBe(sources)
    expect(result.droppedDieIds).toEqual([])
  })

  it('gives up generic dice before touching owned dice when shrinking', () => {
    // Arrange — 3 owned + 5 generic = 8 dice
    const sources = [a, b, c, createAnonymousRollSource(5)]

    // Act — down to 4
    const result = resizeRollSources(sources, 4)

    // Assert — every owned die survives, generics absorb the whole cut
    expect(result.sources).toEqual([a, b, c, createAnonymousRollSource(1)])
    expect(result.droppedDieIds).toEqual([])
  })

  it('removes a generic source entirely when it is fully consumed', () => {
    // Arrange
    const sources = [a, createAnonymousRollSource(2)]

    // Act
    const result = resizeRollSources(sources, 1)

    // Assert
    expect(result.sources).toEqual([a])
    expect(result.droppedDieIds).toEqual([])
  })

  it('drops owned dice from the end only once generics are exhausted', () => {
    // Arrange — 3 owned + 1 generic = 4 dice
    const sources = [a, b, c, createAnonymousRollSource(1)]

    // Act — down to 2
    const result = resizeRollSources(sources, 2)

    // Assert — generic goes first, then the last owned die
    expect(result.sources).toEqual([a, b])
    expect(result.droppedDieIds).toEqual(['die-c'])
  })

  it('reports every dropped owned die in original order', () => {
    // Arrange
    const sources = [a, b, c]

    // Act
    const result = resizeRollSources(sources, 1)

    // Assert
    expect(result.sources).toEqual([a])
    expect(result.droppedDieIds).toEqual(['die-b', 'die-c'])
  })

  it('never shrinks below a single die', () => {
    // Arrange / Act
    const result = resizeRollSources([a, b], 0)

    // Assert
    expect(result.sources).toEqual([a])
    expect(result.droppedDieIds).toEqual(['die-b'])
  })
})

describe('getRollDiceCount', () => {
  it('sums the physical dice across every entry', () => {
    // Arrange
    const dice: DiceEntry[] = [
      withRollSources({ id: '1', type: 'd6', quantity: 8, perDieBonus: 0 }, [createAnonymousRollSource(8)]),
      withRollSources({ id: '2', type: 'd20', quantity: 1, perDieBonus: 0 }, [createSpecificDieRollSource('die-a')]),
    ]

    // Act / Assert
    expect(getRollDiceCount(dice)).toBe(9)
  })

  it('counts what execution actually spawns for every entry', () => {
    // Arrange
    const dice: DiceEntry[] = [
      withRollSources({ id: '1', type: 'd6', quantity: 3, perDieBonus: 0 }, [
        createSpecificDieRollSource('die-a'),
        createAnonymousRollSource(2),
      ]),
    ]

    // Act / Assert — the guard must agree with expandDiceEntrySources
    expect(getRollDiceCount(dice)).toBe(expandDiceEntrySources(dice[0]).length)
  })

  it('treats a missing dice array as empty', () => {
    // Arrange / Act / Assert
    expect(getRollDiceCount(undefined)).toBe(0)
  })
})
