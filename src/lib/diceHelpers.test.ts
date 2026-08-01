import { describe, expect, it } from 'vitest'
import {
  calculateDiceEntryRange,
  calculateSavedRollRange,
  formatBonus,
  formatDiceEntry,
  formatSavedRoll,
  getDiceEntryBadges,
  getKeptDiceCount,
  hasKeepDrop,
} from './diceHelpers'
import { createAnonymousRollSource, createSpecificDieRollSource } from './rollSources'
import type { DiceShape } from './geometries'
import type { CompareMode, DiceEntry, SavedRoll } from '../types/savedRolls'

function makeEntry(overrides: Partial<DiceEntry> = {}): DiceEntry {
  return {
    id: 'entry-1',
    type: 'd4',
    quantity: 1,
    perDieBonus: 0,
    ...overrides,
  }
}

function makeRoll(dice: DiceEntry[], flatBonus = 0): SavedRoll {
  return {
    id: 'roll-1',
    name: 'Test roll',
    dice,
    flatBonus,
    createdAt: 0,
  }
}

describe('formatBonus', () => {
  it('signs positive, negative, and zero bonuses', () => {
    // Arrange / Act / Assert
    expect(formatBonus(3)).toBe('+3')
    expect(formatBonus(-3)).toBe('-3')
    expect(formatBonus(0)).toBe('')
  })
})

describe('formatDiceEntry', () => {
  it('puts the count outside the parens and the die inside for a per-die bonus', () => {
    // Arrange
    const entry = makeEntry({ type: 'd4', quantity: 4, perDieBonus: 1 })

    // Act
    const text = formatDiceEntry(entry)

    // Assert — count x (die + per-die bonus), never "4d(4+1)"
    expect(text).toBe('4(d4+1)')
  })

  it('renders a negative per-die bonus inside the parens', () => {
    // Arrange
    const entry = makeEntry({ type: 'd4', quantity: 4, perDieBonus: -1 })

    // Act / Assert
    expect(formatDiceEntry(entry)).toBe('4(d4-1)')
  })

  it('keeps the plain NdX form when there is no per-die bonus', () => {
    // Arrange
    const entry = makeEntry({ type: 'd4', quantity: 4, perDieBonus: 0 })

    // Act / Assert
    expect(formatDiceEntry(entry)).toBe('4d4')
  })

  it('formats a single die of every shape without a bonus', () => {
    // Arrange
    const shapes: DiceShape[] = ['d4', 'd6', 'd8', 'd10', 'd12', 'd20']

    // Act / Assert
    for (const type of shapes) {
      expect(formatDiceEntry(makeEntry({ type }))).toBe(`1${type}`)
    }
  })

  it('appends a keep-highest suffix when more dice are rolled than kept', () => {
    // Arrange
    const entry = makeEntry({ type: 'd20', quantity: 1, rollCount: 2, keepMode: 'highest' })

    // Act / Assert
    expect(formatDiceEntry(entry)).toBe('2d20 kh1')
  })

  it('appends a keep-lowest suffix when more dice are rolled than kept', () => {
    // Arrange
    const entry = makeEntry({ type: 'd20', quantity: 1, rollCount: 2, keepMode: 'lowest' })

    // Act / Assert
    expect(formatDiceEntry(entry)).toBe('2d20 kl1')
  })

  it('combines a per-die bonus with a keep suffix', () => {
    // Arrange
    const entry = makeEntry({
      type: 'd20',
      quantity: 1,
      perDieBonus: 2,
      rollCount: 2,
      keepMode: 'highest',
    })

    // Act / Assert
    expect(formatDiceEntry(entry)).toBe('2(d20+2) kh1')
  })

  it('appends a specific-dice suffix counting owned sources', () => {
    // Arrange
    const entry = makeEntry({
      type: 'd6',
      quantity: 3,
      sources: [
        createSpecificDieRollSource('owned-a'),
        createSpecificDieRollSource('owned-b'),
        createAnonymousRollSource(1),
      ],
    })

    // Act / Assert
    expect(formatDiceEntry(entry)).toBe('3d6 [2 specific]')
  })

  it('omits the specific suffix for a purely anonymous entry', () => {
    // Arrange
    const entry = makeEntry({ type: 'd6', quantity: 8, sources: [createAnonymousRollSource(8)] })

    // Act / Assert
    expect(formatDiceEntry(entry)).toBe('8d6')
  })

  it('attaches a bare bang for a die that explodes on its maximum face', () => {
    // Arrange
    const entry = makeEntry({ type: 'd6', quantity: 4, exploding: { on: 'max' } })

    // Act / Assert — no space: the trigger binds to the die, not the formula
    expect(formatDiceEntry(entry)).toBe('4d6!')
  })

  it('attaches the trigger face for a die that explodes on a number', () => {
    // Arrange
    const entry = makeEntry({ type: 'd6', quantity: 4, exploding: { on: 5 } })

    // Act / Assert
    expect(formatDiceEntry(entry)).toBe('4d6!5')
  })

  it('keeps the explosion trigger next to the die and before the keep suffix', () => {
    // Arrange
    const entry = makeEntry({
      type: 'd6',
      quantity: 1,
      rollCount: 2,
      keepMode: 'highest',
      exploding: { on: 'max' },
    })

    // Act / Assert
    expect(formatDiceEntry(entry)).toBe('2d6! kh1')
  })

  it('renders a lessOrEqual reroll with the ≤ symbol', () => {
    // Arrange
    const entry = makeEntry({ type: 'd6', reroll: { condition: 'lessOrEqual', value: 2 } })

    // Act / Assert
    expect(formatDiceEntry(entry)).toBe('1d6 r≤2')
  })

  it('renders an equals reroll with the = symbol', () => {
    // Arrange
    const entry = makeEntry({ type: 'd20', reroll: { condition: 'equals', value: 1 } })

    // Act / Assert
    expect(formatDiceEntry(entry)).toBe('1d20 r=1')
  })

  it('renders every comparison mode with its own symbol', () => {
    // Arrange
    const expected: Record<CompareMode, string> = {
      equals: '1d6 r=3',
      lessThan: '1d6 r<3',
      lessOrEqual: '1d6 r≤3',
      greaterThan: '1d6 r>3',
      greaterOrEqual: '1d6 r≥3',
    }

    // Act / Assert
    for (const condition of Object.keys(expected) as CompareMode[]) {
      const entry = makeEntry({ type: 'd6', reroll: { condition, value: 3 } })
      expect(formatDiceEntry(entry)).toBe(expected[condition])
    }
  })

  it('renders a success-counting entry as a target threshold', () => {
    // Arrange
    const entry = makeEntry({ type: 'd10', quantity: 5, countSuccesses: { targetNumber: 5 } })

    // Act / Assert
    expect(formatDiceEntry(entry)).toBe('5d10 ≥5')
  })

  it('locks the suffix order for an entry that uses every mechanic at once', () => {
    // Arrange
    const entry = makeEntry({
      type: 'd6',
      quantity: 2,
      rollCount: 4,
      keepMode: 'highest',
      perDieBonus: 1,
      exploding: { on: 'max' },
      reroll: { condition: 'lessOrEqual', value: 2 },
      countSuccesses: { targetNumber: 5 },
      sources: [
        createSpecificDieRollSource('owned-a'),
        createSpecificDieRollSource('owned-b'),
        createAnonymousRollSource(1),
      ],
    })

    // Act / Assert — die+bonus, explode, keep, reroll, successes, owned tally
    expect(formatDiceEntry(entry)).toBe('4(d6+1)! kh2 r≤2 ≥5 [2 specific]')
  })

  it('leaves min/max clamps out of the formula entirely', () => {
    // Arrange
    const entry = makeEntry({ type: 'd6', quantity: 4, minimum: 2, maximum: 5 })

    // Act / Assert — clamps are a badge, not notation
    expect(formatDiceEntry(entry)).toBe('4d6')
  })
})

describe('formatSavedRoll', () => {
  it('returns "0" for a roll with no dice and no flat bonus', () => {
    // Arrange / Act / Assert
    expect(formatSavedRoll(makeRoll([]))).toBe('0')
  })

  it('joins a single entry with a positive flat bonus', () => {
    // Arrange
    const roll = makeRoll([makeEntry({ type: 'd6', quantity: 2 })], 4)

    // Act / Assert
    expect(formatSavedRoll(roll)).toBe('2d6 + 4')
  })

  it('joins a single entry with a negative flat bonus using a minus operator', () => {
    // Arrange
    const roll = makeRoll([makeEntry({ type: 'd6', quantity: 2 })], -4)

    // Act / Assert
    expect(formatSavedRoll(roll)).toBe('2d6 - 4')
  })

  it('omits a zero flat bonus', () => {
    // Arrange
    const roll = makeRoll([makeEntry({ type: 'd6', quantity: 2 })], 0)

    // Act / Assert
    expect(formatSavedRoll(roll)).toBe('2d6')
  })

  it('renders the flat bonus alone when the roll has no dice', () => {
    // Arrange / Act / Assert
    expect(formatSavedRoll(makeRoll([], 3))).toBe('3')
  })

  it('joins multiple entries, per-die bonuses, and a flat bonus', () => {
    // Arrange
    const roll = makeRoll([
      makeEntry({ id: 'a', type: 'd4', quantity: 4, perDieBonus: 1 }),
      makeEntry({ id: 'b', type: 'd6', quantity: 8 }),
      makeEntry({ id: 'c', type: 'd20', quantity: 1, perDieBonus: -1 }),
    ], 2)

    // Act / Assert
    expect(formatSavedRoll(roll)).toBe('4(d4+1) + 8d6 + 1(d20-1) + 2')
  })

  it('keeps the plain multi-entry form owned-die suffixes are appended to', () => {
    // Arrange
    const roll = makeRoll([
      makeEntry({ id: 'a', type: 'd6', quantity: 8, sources: [createAnonymousRollSource(8)] }),
      makeEntry({
        id: 'b',
        type: 'd20',
        quantity: 1,
        sources: [createSpecificDieRollSource('owned-d20')],
      }),
    ])

    // Act / Assert
    expect(formatSavedRoll(roll)).toBe('8d6 + 1d20 [1 specific]')
  })
})

describe('hasKeepDrop', () => {
  it('is false when the entry never declares a roll count', () => {
    // Arrange / Act / Assert
    expect(hasKeepDrop({ quantity: 2, rollCount: undefined })).toBe(false)
  })

  it('is false when the roll count equals the keep count', () => {
    // Arrange / Act / Assert
    expect(hasKeepDrop({ quantity: 2, rollCount: 2 })).toBe(false)
  })

  it('is true only when more dice are rolled than kept', () => {
    // Arrange / Act / Assert
    expect(hasKeepDrop({ quantity: 2, rollCount: 3 })).toBe(true)
  })

  it('is false for the invalid case of rolling fewer dice than are kept', () => {
    // Arrange / Act / Assert — nothing is dropped, so keep/drop is not active
    expect(hasKeepDrop({ quantity: 4, rollCount: 2 })).toBe(false)
  })
})

describe('getKeptDiceCount', () => {
  it('scores every die when there is no roll count', () => {
    // Arrange / Act / Assert
    expect(getKeptDiceCount(makeEntry({ type: 'd6', quantity: 3 }))).toBe(3)
  })

  it('scores every die when the roll count equals the keep count', () => {
    // Arrange / Act / Assert
    expect(getKeptDiceCount(makeEntry({ type: 'd6', quantity: 3, rollCount: 3 }))).toBe(3)
  })

  it('scores only the kept dice under keep/drop', () => {
    // Arrange
    const entry = makeEntry({ type: 'd20', quantity: 1, rollCount: 3, keepMode: 'highest' })

    // Act / Assert
    expect(getKeptDiceCount(entry)).toBe(1)
  })

  it('falls back to the rolled count when fewer dice are rolled than kept', () => {
    // Arrange / Act / Assert — you cannot score dice that were never rolled
    expect(getKeptDiceCount(makeEntry({ type: 'd6', quantity: 4, rollCount: 2 }))).toBe(2)
  })

  it('counts owned and generic sources together when there is no keep/drop', () => {
    // Arrange
    const entry = makeEntry({
      type: 'd6',
      quantity: 3,
      sources: [
        createSpecificDieRollSource('owned-a'),
        createSpecificDieRollSource('owned-b'),
        createAnonymousRollSource(1),
      ],
    })

    // Act / Assert
    expect(getKeptDiceCount(entry)).toBe(3)
  })
})

describe('calculateDiceEntryRange', () => {
  it('spans one die minimum to one die maximum per die', () => {
    // Arrange
    const entry = makeEntry({ type: 'd6', quantity: 3 })

    // Act / Assert
    expect(calculateDiceEntryRange(entry)).toEqual({ min: 3, max: 18 })
  })

  it('counts only the kept dice under keep/drop', () => {
    // Arrange
    const entry = makeEntry({ type: 'd20', quantity: 1, rollCount: 2, keepMode: 'highest' })

    // Act / Assert — advantage is still a single d20 of spread
    expect(calculateDiceEntryRange(entry)).toEqual({ min: 1, max: 20 })
  })

  it('applies the per-die bonus once per KEPT die', () => {
    // Arrange
    const entry = makeEntry({
      type: 'd6',
      quantity: 2,
      rollCount: 5,
      keepMode: 'lowest',
      perDieBonus: 1,
    })

    // Act / Assert — (1+1)*2 .. (6+1)*2, never five bonuses
    expect(calculateDiceEntryRange(entry)).toEqual({ min: 4, max: 14 })
  })

  it('applies the per-die bonus to every die when nothing is dropped', () => {
    // Arrange
    const entry = makeEntry({ type: 'd6', quantity: 4, perDieBonus: 2 })

    // Act / Assert
    expect(calculateDiceEntryRange(entry)).toEqual({ min: 12, max: 32 })
  })

  it('applies a negative per-die bonus to every kept die', () => {
    // Arrange
    const entry = makeEntry({ type: 'd6', quantity: 2, perDieBonus: -1 })

    // Act / Assert
    expect(calculateDiceEntryRange(entry)).toEqual({ min: 0, max: 10 })
  })

  it('raises the lower bound to the minimum clamp', () => {
    // Arrange
    const entry = makeEntry({ type: 'd6', quantity: 1, minimum: 3 })

    // Act / Assert
    expect(calculateDiceEntryRange(entry)).toEqual({ min: 3, max: 6 })
  })

  it('lowers the upper bound to the maximum clamp', () => {
    // Arrange
    const entry = makeEntry({ type: 'd6', quantity: 2, maximum: 4 })

    // Act / Assert
    expect(calculateDiceEntryRange(entry)).toEqual({ min: 2, max: 8 })
  })

  it('narrows both bounds when both clamps are set', () => {
    // Arrange
    const entry = makeEntry({ type: 'd6', quantity: 1, minimum: 2, maximum: 5 })

    // Act / Assert
    expect(calculateDiceEntryRange(entry)).toEqual({ min: 2, max: 5 })
  })

  it('never widens the range past the real die', () => {
    // Arrange — a d6 cannot show 0 or 99 no matter what the clamps say
    const entry = makeEntry({ type: 'd6', quantity: 1, minimum: 0, maximum: 99 })

    // Act / Assert
    expect(calculateDiceEntryRange(entry)).toEqual({ min: 1, max: 6 })
  })

  it('collapses to a point when a minimum clamp exceeds the die maximum', () => {
    // Arrange
    const entry = makeEntry({ type: 'd6', quantity: 1, minimum: 99 })

    // Act / Assert
    expect(calculateDiceEntryRange(entry)).toEqual({ min: 6, max: 6 })
  })

  it('flags an exploding entry as open-ended with the no-explosion upper bound', () => {
    // Arrange
    const entry = makeEntry({ type: 'd6', quantity: 2, exploding: { on: 'max' } })

    // Act / Assert
    expect(calculateDiceEntryRange(entry)).toEqual({ min: 2, max: 12, open: true })
  })

  it('leaves both bounds untouched for a reroll', () => {
    // Arrange
    const plain = makeEntry({ type: 'd6', quantity: 2 })
    const rerolling = makeEntry({
      type: 'd6',
      quantity: 2,
      reroll: { condition: 'lessOrEqual', value: 2 },
    })

    // Act / Assert — a reroll lands on the same faces
    expect(calculateDiceEntryRange(rerolling)).toEqual(calculateDiceEntryRange(plain))
    expect(calculateDiceEntryRange(rerolling)).toEqual({ min: 2, max: 12 })
  })
})

describe('calculateDiceEntryRange — success counting', () => {
  it('returns a range of success COUNTS, not a sum', () => {
    // Arrange
    const entry = makeEntry({
      type: 'd10',
      quantity: 5,
      countSuccesses: { targetNumber: 7 },
    })

    // Act / Assert
    expect(calculateDiceEntryRange(entry)).toEqual({ min: 0, max: 5 })
  })

  it('drops the floor below zero when botches are configured', () => {
    // Arrange
    const entry = makeEntry({
      type: 'd10',
      quantity: 5,
      countSuccesses: { targetNumber: 7, botchOn: 1 },
    })

    // Act / Assert
    expect(calculateDiceEntryRange(entry)).toEqual({ min: -5, max: 5 })
  })

  it('doubles the ceiling when criticals are configured', () => {
    // Arrange
    const entry = makeEntry({
      type: 'd10',
      quantity: 5,
      countSuccesses: { targetNumber: 7, criticalOn: 10 },
    })

    // Act / Assert
    expect(calculateDiceEntryRange(entry)).toEqual({ min: 0, max: 10 })
  })

  it('combines botches and criticals into one count range', () => {
    // Arrange
    const entry = makeEntry({
      type: 'd10',
      quantity: 5,
      countSuccesses: { targetNumber: 7, criticalOn: 10, botchOn: 1 },
    })

    // Act / Assert
    expect(calculateDiceEntryRange(entry)).toEqual({ min: -5, max: 10 })
  })

  it('counts only the kept dice under keep/drop', () => {
    // Arrange
    const entry = makeEntry({
      type: 'd10',
      quantity: 3,
      rollCount: 6,
      keepMode: 'highest',
      countSuccesses: { targetNumber: 7 },
    })

    // Act / Assert
    expect(calculateDiceEntryRange(entry)).toEqual({ min: 0, max: 3 })
  })

  it('ignores clamps and the per-die bonus because the unit is successes', () => {
    // Arrange
    const entry = makeEntry({
      type: 'd10',
      quantity: 2,
      perDieBonus: 5,
      minimum: 4,
      countSuccesses: { targetNumber: 7 },
    })

    // Act / Assert
    expect(calculateDiceEntryRange(entry)).toEqual({ min: 0, max: 2 })
  })
})

describe('calculateSavedRollRange', () => {
  it('is the flat bonus alone for a roll with no dice', () => {
    // Arrange / Act / Assert
    expect(calculateSavedRollRange(makeRoll([], 3))).toEqual({ min: 3, max: 3 })
  })

  it('adds a positive flat bonus to both bounds', () => {
    // Arrange
    const roll = makeRoll([makeEntry({ type: 'd6', quantity: 2 })], 3)

    // Act / Assert
    expect(calculateSavedRollRange(roll)).toEqual({ min: 5, max: 15 })
  })

  it('subtracts a negative flat bonus from both bounds', () => {
    // Arrange
    const roll = makeRoll([makeEntry({ type: 'd6', quantity: 2 })], -2)

    // Act / Assert
    expect(calculateSavedRollRange(roll)).toEqual({ min: 0, max: 10 })
  })

  it('sums every entry range', () => {
    // Arrange
    const roll = makeRoll([
      makeEntry({ id: 'a', type: 'd6', quantity: 2 }),
      makeEntry({ id: 'b', type: 'd20', quantity: 1, perDieBonus: 3 }),
    ])

    // Act / Assert — (2..12) + (4..23)
    expect(calculateSavedRollRange(roll)).toEqual({ min: 6, max: 35 })
  })

  it('omits the flat bonus when any entry counts successes', () => {
    // Arrange
    const roll = makeRoll(
      [
        makeEntry({ id: 'a', type: 'd6', quantity: 2 }),
        makeEntry({
          id: 'b',
          type: 'd10',
          quantity: 3,
          countSuccesses: { targetNumber: 7 },
        }),
      ],
      5,
    )

    // Act / Assert — (2..12) + (0..3), the +5 is dropped
    expect(calculateSavedRollRange(roll)).toEqual({ min: 2, max: 15 })
  })

  it('propagates open when any entry explodes', () => {
    // Arrange
    const roll = makeRoll([
      makeEntry({ id: 'a', type: 'd6', quantity: 1 }),
      makeEntry({ id: 'b', type: 'd8', quantity: 1, exploding: { on: 'max' } }),
    ])

    // Act / Assert
    expect(calculateSavedRollRange(roll)).toEqual({ min: 2, max: 14, open: true })
  })

  it('stays closed when nothing explodes', () => {
    // Arrange
    const roll = makeRoll([makeEntry({ type: 'd6', quantity: 1 })], 1)

    // Act / Assert
    expect(calculateSavedRollRange(roll)).toEqual({ min: 2, max: 7 })
  })
})

describe('percentile entries never advertise physical waves', () => {
  function percentileEntry(overrides: Partial<DiceEntry> = {}): DiceEntry {
    return makeEntry({ type: 'd10', percentile: true, ...overrides })
  }

  it('omits the exploding and reroll suffixes a d100 cannot run', () => {
    // Arrange — a legacy/hand-edited entry carrying both
    const entry = percentileEntry({
      quantity: 1,
      exploding: { on: 'max' },
      reroll: { condition: 'lessOrEqual', value: 2, maxRerolls: 1 },
    })

    // Act / Assert — reads as a plain d100, not `1d100! r≤2`
    expect(formatDiceEntry(entry)).toBe('1d100')
  })

  it('omits their badges too', () => {
    // Arrange
    const entry = percentileEntry({
      quantity: 1,
      exploding: { on: 'max' },
      reroll: { condition: 'equals', value: 1, maxRerolls: 1 },
    })

    // Act
    const badges = getDiceEntryBadges(entry)

    // Assert
    expect(badges).not.toContain('💥 Explode')
    expect(badges).not.toContain('🍀 LUCK')
  })

  it('still shows keep/drop and success counting, which a pair CAN do', () => {
    // Arrange — keep the best of two d100s, success on 80+
    const entry = percentileEntry({
      quantity: 1,
      rollCount: 2,
      keepMode: 'highest',
      countSuccesses: { targetNumber: 80 },
    })

    // Act / Assert
    expect(formatDiceEntry(entry)).toBe('2d100 kh1 ≥80')
    expect(getDiceEntryBadges(entry)).toContain('⬆️ ADV')
  })
})
