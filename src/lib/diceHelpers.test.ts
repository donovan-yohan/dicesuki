import { describe, expect, it } from 'vitest'
import { formatBonus, formatDiceEntry, formatSavedRoll } from './diceHelpers'
import { createAnonymousRollSource, createSpecificDieRollSource } from './rollSources'
import type { DiceShape } from './geometries'
import type { DiceEntry, SavedRoll } from '../types/savedRolls'

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
