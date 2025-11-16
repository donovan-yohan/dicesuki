/**
 * Roll Engine Tests
 *
 * Tests for the dice roll calculation engine.
 * Following TDD approach from CLAUDE.md.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { executeSavedRoll, rollDiceEntry, rollSingleDie } from './rollEngine'
import { DiceEntry, SavedRoll } from '../types/savedRolls'

describe('rollEngine', () => {
  beforeEach(() => {
    // Set up predictable random for testing
    vi.spyOn(Math, 'random')
  })

  describe('rollSingleDie', () => {
    it('should roll a d6 within valid range', () => {
      for (let i = 0; i < 100; i++) {
        const result = rollSingleDie('d6')
        expect(result).toBeGreaterThanOrEqual(1)
        expect(result).toBeLessThanOrEqual(6)
      }
    })

    it('should roll a d20 within valid range', () => {
      for (let i = 0; i < 100; i++) {
        const result = rollSingleDie('d20')
        expect(result).toBeGreaterThanOrEqual(1)
        expect(result).toBeLessThanOrEqual(20)
      }
    })
  })

  describe('rollDiceEntry - basic rolling', () => {
    it('should roll simple 2d6', () => {
      const entry: DiceEntry = {
        id: 'test',
        type: 'd6',
        quantity: 2,
        perDieBonus: 0,
      }

      const result = rollDiceEntry(entry)

      expect(result.rolls).toHaveLength(2)
      expect(result.rolls.every((r) => r.wasKept)).toBe(true)
      expect(result.subtotal).toBeGreaterThanOrEqual(2)
      expect(result.subtotal).toBeLessThanOrEqual(12)
    })

    it('should apply per-die bonus correctly', () => {
      const entry: DiceEntry = {
        id: 'test',
        type: 'd6',
        quantity: 2,
        perDieBonus: 1,
      }

      const result = rollDiceEntry(entry)

      // Each die gets +1, so min is 2*(1+1) = 4, max is 2*(6+1) = 14
      expect(result.subtotal).toBeGreaterThanOrEqual(4)
      expect(result.subtotal).toBeLessThanOrEqual(14)
    })
  })

  describe('rollDiceEntry - keep/drop mechanics', () => {
    it('should roll advantage (2d20 keep highest)', () => {
      const entry: DiceEntry = {
        id: 'test',
        type: 'd20',
        quantity: 1,
        rollCount: 2,
        keepMode: 'highest',
        perDieBonus: 0,
      }

      const result = rollDiceEntry(entry)

      expect(result.rolls).toHaveLength(2)
      const keptDice = result.rolls.filter((r) => r.wasKept)
      const droppedDice = result.rolls.filter((r) => !r.wasKept)

      expect(keptDice).toHaveLength(1)
      expect(droppedDice).toHaveLength(1)

      // The kept die should be >= the dropped die
      expect(keptDice[0].value).toBeGreaterThanOrEqual(droppedDice[0].value)
    })

    it('should roll disadvantage (2d20 keep lowest)', () => {
      const entry: DiceEntry = {
        id: 'test',
        type: 'd20',
        quantity: 1,
        rollCount: 2,
        keepMode: 'lowest',
        perDieBonus: 0,
      }

      const result = rollDiceEntry(entry)

      expect(result.rolls).toHaveLength(2)
      const keptDice = result.rolls.filter((r) => r.wasKept)
      const droppedDice = result.rolls.filter((r) => !r.wasKept)

      expect(keptDice).toHaveLength(1)
      expect(droppedDice).toHaveLength(1)

      // The kept die should be <= the dropped die
      expect(keptDice[0].value).toBeLessThanOrEqual(droppedDice[0].value)
    })

    it('should roll 4d6 drop lowest (ability score generation)', () => {
      const entry: DiceEntry = {
        id: 'test',
        type: 'd6',
        quantity: 3,
        rollCount: 4,
        keepMode: 'highest',
        perDieBonus: 0,
      }

      const result = rollDiceEntry(entry)

      expect(result.rolls).toHaveLength(4)
      const keptDice = result.rolls.filter((r) => r.wasKept)
      const droppedDice = result.rolls.filter((r) => !r.wasKept)

      expect(keptDice).toHaveLength(3)
      expect(droppedDice).toHaveLength(1)

      // Each kept die should be >= the dropped die
      const droppedValue = droppedDice[0].value
      keptDice.forEach((die) => {
        expect(die.value).toBeGreaterThanOrEqual(droppedValue)
      })
    })
  })

  describe('rollDiceEntry - reroll mechanics', () => {
    it('should reroll 1s once (Halfling Luck)', () => {
      const entry: DiceEntry = {
        id: 'test',
        type: 'd20',
        quantity: 1,
        perDieBonus: 0,
        reroll: {
          condition: 'equals',
          value: 1,
          maxRerolls: 1,
        },
      }

      // Mock Math.random to guarantee a 1 on first roll, then a 10
      let callCount = 0
      vi.mocked(Math.random).mockImplementation(() => {
        if (callCount === 0) {
          callCount++
          return 0.001 // Will produce 1
        }
        return 0.5 // Will produce ~10
      })

      const result = rollDiceEntry(entry)

      expect(result.rolls).toHaveLength(1)
      expect(result.rolls[0].wasRerolled).toBe(true)
      expect(result.rolls[0].originalValue).toBe(1)
      expect(result.rolls[0].value).toBeGreaterThan(1)
    })

    it('should reroll 1-2 once (Great Weapon Fighting)', () => {
      const entry: DiceEntry = {
        id: 'test',
        type: 'd6',
        quantity: 2,
        perDieBonus: 0,
        reroll: {
          condition: 'lessOrEqual',
          value: 2,
          maxRerolls: 1,
        },
      }

      // Mock to get a 1 and 2 on first rolls, then higher values on rerolls
      const values = [
        0.001, // Die 1 initial: rolls 1 (needs reroll)
        0.8,   // Die 1 reroll: rolls 5
        0.1,   // Die 2 initial: rolls 1 (needs reroll)
        0.9,   // Die 2 reroll: rolls 6
      ]
      let callIndex = 0
      vi.mocked(Math.random).mockImplementation(() => {
        return values[callIndex++] || 0.5
      })

      const result = rollDiceEntry(entry)

      expect(result.rolls).toHaveLength(2)
      expect(result.rolls[0].wasRerolled).toBe(true)
      expect(result.rolls[0].originalValue).toBe(1)
      expect(result.rolls[1].wasRerolled).toBe(true)
      expect(result.rolls[1].originalValue).toBe(1)
    })
  })

  describe('rollDiceEntry - exploding dice', () => {
    it('should explode on max value (6 on d6)', () => {
      const entry: DiceEntry = {
        id: 'test',
        type: 'd6',
        quantity: 1,
        perDieBonus: 0,
        exploding: {
          on: 'max',
        },
      }

      // Mock to get a 6 (explodes), then a 4
      let callCount = 0
      vi.mocked(Math.random).mockImplementation(() => {
        if (callCount === 0) {
          callCount++
          return 0.99 // Will produce 6
        }
        return 0.6 // Will produce 4
      })

      const result = rollDiceEntry(entry)

      expect(result.rolls).toHaveLength(1)
      expect(result.rolls[0].explosions).toBeDefined()
      expect(result.rolls[0].explosions!.length).toBeGreaterThan(0)
    })

    it('should respect explosion limit', () => {
      const entry: DiceEntry = {
        id: 'test',
        type: 'd6',
        quantity: 1,
        perDieBonus: 0,
        exploding: {
          on: 'max',
          limit: 2,
        },
      }

      // Mock to always roll 6 (would explode infinitely without limit)
      vi.mocked(Math.random).mockReturnValue(0.99)

      const result = rollDiceEntry(entry)

      expect(result.rolls).toHaveLength(1)
      expect(result.rolls[0].explosions!.length).toBeLessThanOrEqual(2)
    })
  })

  describe('rollDiceEntry - value constraints', () => {
    it('should enforce minimum value', () => {
      const entry: DiceEntry = {
        id: 'test',
        type: 'd6',
        quantity: 1,
        perDieBonus: 0,
        minimum: 3,
      }

      // Mock to get a 1
      vi.mocked(Math.random).mockReturnValue(0.001)

      const result = rollDiceEntry(entry)

      expect(result.subtotal).toBe(3)
    })

    it('should enforce maximum value', () => {
      const entry: DiceEntry = {
        id: 'test',
        type: 'd20',
        quantity: 1,
        perDieBonus: 0,
        maximum: 15,
      }

      // Mock to get a 20
      vi.mocked(Math.random).mockReturnValue(0.99)

      const result = rollDiceEntry(entry)

      expect(result.subtotal).toBe(15)
    })
  })

  describe('rollDiceEntry - success counting', () => {
    it('should count successes (World of Darkness style)', () => {
      const entry: DiceEntry = {
        id: 'test',
        type: 'd10',
        quantity: 5,
        perDieBonus: 0,
        countSuccesses: {
          targetNumber: 8,
        },
      }

      const result = rollDiceEntry(entry)

      expect(result.rolls).toHaveLength(5)
      expect(result.successCount).toBeDefined()
      expect(result.successCount).toBeGreaterThanOrEqual(0)
      expect(result.successCount).toBeLessThanOrEqual(5)
    })

    it('should count critical successes as 2', () => {
      const entry: DiceEntry = {
        id: 'test',
        type: 'd10',
        quantity: 1,
        perDieBonus: 0,
        countSuccesses: {
          targetNumber: 8,
          criticalOn: 10,
        },
      }

      // Mock to get a 10
      vi.mocked(Math.random).mockReturnValue(0.99)

      const result = rollDiceEntry(entry)

      expect(result.successCount).toBe(2)
    })
  })

  describe('executeSavedRoll', () => {
    it('should execute a simple roll (2d6+4)', () => {
      const roll: SavedRoll = {
        id: 'test-roll',
        name: 'Test Roll',
        dice: [
          {
            id: 'dice-1',
            type: 'd6',
            quantity: 2,
            perDieBonus: 0,
          },
        ],
        flatBonus: 4,
        createdAt: Date.now(),
      }

      const result = executeSavedRoll(roll)

      expect(result.rollId).toBe('test-roll')
      expect(result.rollName).toBe('Test Roll')
      expect(result.diceResults).toHaveLength(1)
      expect(result.flatBonus).toBe(4)
      expect(result.total).toBeGreaterThanOrEqual(6) // 2*1 + 4
      expect(result.total).toBeLessThanOrEqual(16) // 2*6 + 4
    })

    it('should execute a complex roll (1d20 adv + 2d6+1 + 5)', () => {
      const roll: SavedRoll = {
        id: 'test-roll',
        name: 'Attack Roll',
        dice: [
          {
            id: 'attack',
            type: 'd20',
            quantity: 1,
            rollCount: 2,
            keepMode: 'highest',
            perDieBonus: 0,
          },
          {
            id: 'damage',
            type: 'd6',
            quantity: 2,
            perDieBonus: 1,
          },
        ],
        flatBonus: 5,
        createdAt: Date.now(),
      }

      const result = executeSavedRoll(roll)

      expect(result.diceResults).toHaveLength(2)
      expect(result.diceResults[0].rolls).toHaveLength(2) // Rolled 2d20, kept 1
      expect(result.diceResults[1].rolls).toHaveLength(2) // Rolled 2d6
    })
  })
})
