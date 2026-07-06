import { describe, it, expect, beforeEach } from 'vitest'
import { useInventoryStore } from './useInventoryStore'
import type { NewInventoryDie } from '../types/inventory'

// Minimal valid die for test fixtures
const makeNewDie = (overrides: Partial<NewInventoryDie> = {}): NewInventoryDie => ({
  type: 'd6',
  setId: 'test-set',
  rarity: 'common',
  appearance: {
    baseColor: '#ffffff',
    accentColor: '#000000',
    material: 'plastic'
  },
  vfx: {},
  name: 'Test Die',
  isFavorite: false,
  isLocked: false,
  source: 'starter',
  assignedToRolls: [],
  ...overrides
})

describe('useInventoryStore', () => {
  beforeEach(() => {
    useInventoryStore.getState().reset()
  })

  describe('removeDie', () => {
    it('removes a die with no assignments', () => {
      // Arrange
      const die = useInventoryStore.getState().addDie(makeNewDie())
      expect(useInventoryStore.getState().dice).toHaveLength(1)

      // Act
      const result = useInventoryStore.getState().removeDie(die.id)

      // Assert
      expect(result).toBe(true)
      expect(useInventoryStore.getState().dice).toHaveLength(0)
    })

    it('removes a die that has roll assignments and cleans up those assignments', () => {
      // Arrange
      const die = useInventoryStore.getState().addDie(makeNewDie())
      useInventoryStore.getState().assignDieToSlot('roll-1', 'entry-1', 0, die.id)
      useInventoryStore.getState().assignDieToSlot('roll-2', 'entry-2', 1, die.id)

      const assignmentsBefore = useInventoryStore.getState().assignments
      expect(Object.values(assignmentsBefore)).toContain(die.id)

      // Act
      const result = useInventoryStore.getState().removeDie(die.id)

      // Assert
      expect(result).toBe(true)
      expect(useInventoryStore.getState().dice).toHaveLength(0)

      const assignmentsAfter = useInventoryStore.getState().assignments
      expect(Object.values(assignmentsAfter)).not.toContain(die.id)
      expect(Object.keys(assignmentsAfter)).toHaveLength(0)
    })

    it('preserves other dice assignments when removing a specific die', () => {
      // Arrange
      const die1 = useInventoryStore.getState().addDie(makeNewDie({ name: 'Die 1' }))
      const die2 = useInventoryStore.getState().addDie(makeNewDie({ name: 'Die 2' }))
      useInventoryStore.getState().assignDieToSlot('roll-1', 'entry-1', 0, die1.id)
      useInventoryStore.getState().assignDieToSlot('roll-1', 'entry-1', 1, die2.id)

      // Act
      useInventoryStore.getState().removeDie(die1.id)

      // Assert: die1 assignment is gone, die2 assignment remains
      const assignments = useInventoryStore.getState().assignments
      expect(Object.values(assignments)).not.toContain(die1.id)
      expect(Object.values(assignments)).toContain(die2.id)
    })

    it('returns false and does nothing for a nonexistent die id', () => {
      // Arrange
      useInventoryStore.getState().addDie(makeNewDie())
      const countBefore = useInventoryStore.getState().dice.length

      // Act
      const result = useInventoryStore.getState().removeDie('nonexistent-id')

      // Assert
      expect(result).toBe(false)
      expect(useInventoryStore.getState().dice).toHaveLength(countBefore)
    })

    it('returns false and does not remove a locked die', () => {
      // Arrange
      const die = useInventoryStore.getState().addDie(makeNewDie({ isLocked: true }))

      // Act
      const result = useInventoryStore.getState().removeDie(die.id)

      // Assert
      expect(result).toBe(false)
      expect(useInventoryStore.getState().dice).toHaveLength(1)
    })
  })
})
