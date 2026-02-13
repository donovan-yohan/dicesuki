import { describe, it, expect, beforeEach } from 'vitest'
import { useDiceStore } from './useDiceStore'

describe('useDiceStore', () => {
  beforeEach(() => {
    useDiceStore.getState().reset()
  })

  describe('initial state', () => {
    it('should start with empty settledDice', () => {
      expect(useDiceStore.getState().settledDice.size).toBe(0)
    })

    it('should start with empty rollingDice', () => {
      expect(useDiceStore.getState().rollingDice.size).toBe(0)
    })

    it('should start with empty currentRollCycleDice', () => {
      expect(useDiceStore.getState().currentRollCycleDice.size).toBe(0)
    })

    it('should start with empty rollHistory', () => {
      expect(useDiceStore.getState().rollHistory).toEqual([])
    })
  })

  describe('markDiceRolling', () => {
    it('should add dice IDs to rollingDice set', () => {
      useDiceStore.getState().markDiceRolling(['die-1', 'die-2'])
      const { rollingDice } = useDiceStore.getState()
      expect(rollingDice.has('die-1')).toBe(true)
      expect(rollingDice.has('die-2')).toBe(true)
      expect(rollingDice.size).toBe(2)
    })

    it('should remove dice from settledDice when marked as rolling', () => {
      // Settle a die first
      useDiceStore.getState().markDiceRolling(['die-1'])
      useDiceStore.getState().recordDieSettled('die-1', 4, 'd6')
      expect(useDiceStore.getState().settledDice.has('die-1')).toBe(true)

      // Mark as rolling again
      useDiceStore.getState().markDiceRolling(['die-1'])
      expect(useDiceStore.getState().settledDice.has('die-1')).toBe(false)
      expect(useDiceStore.getState().rollingDice.has('die-1')).toBe(true)
    })

    it('should start a new cycle when rollingDice was empty', () => {
      useDiceStore.getState().markDiceRolling(['die-1'])
      const { currentRollCycleDice } = useDiceStore.getState()
      expect(currentRollCycleDice.has('die-1')).toBe(true)
      expect(currentRollCycleDice.size).toBe(1)
    })

    it('should accumulate to existing cycle when rollingDice was non-empty', () => {
      // Start rolling one die (new cycle)
      useDiceStore.getState().markDiceRolling(['die-1'])
      expect(useDiceStore.getState().currentRollCycleDice.size).toBe(1)

      // Another die starts rolling (same cycle)
      useDiceStore.getState().markDiceRolling(['die-2'])
      const { currentRollCycleDice } = useDiceStore.getState()
      expect(currentRollCycleDice.has('die-1')).toBe(true)
      expect(currentRollCycleDice.has('die-2')).toBe(true)
      expect(currentRollCycleDice.size).toBe(2)
    })

    it('should start a fresh cycle after previous cycle completed', () => {
      // Complete a full cycle
      useDiceStore.getState().markDiceRolling(['die-1'])
      useDiceStore.getState().recordDieSettled('die-1', 4, 'd6')
      // die-1 settled, cycle complete, history saved

      const historyAfterFirst = useDiceStore.getState().rollHistory.length
      expect(historyAfterFirst).toBe(1)

      // Start a new cycle
      useDiceStore.getState().markDiceRolling(['die-2'])
      const { currentRollCycleDice } = useDiceStore.getState()
      // New cycle should only have die-2
      expect(currentRollCycleDice.has('die-2')).toBe(true)
      expect(currentRollCycleDice.has('die-1')).toBe(false)
    })
  })

  describe('recordDieSettled', () => {
    it('should add die to settledDice map', () => {
      useDiceStore.getState().recordDieSettled('die-1', 5, 'd6')
      const { settledDice } = useDiceStore.getState()
      expect(settledDice.has('die-1')).toBe(true)
      expect(settledDice.get('die-1')?.value).toBe(5)
      expect(settledDice.get('die-1')?.type).toBe('d6')
    })

    it('should remove die from rollingDice when it settles', () => {
      useDiceStore.getState().markDiceRolling(['die-1'])
      expect(useDiceStore.getState().rollingDice.has('die-1')).toBe(true)

      useDiceStore.getState().recordDieSettled('die-1', 3, 'd6')
      expect(useDiceStore.getState().rollingDice.has('die-1')).toBe(false)
    })

    it('should update value if die was already settled', () => {
      useDiceStore.getState().recordDieSettled('die-1', 3, 'd6')
      useDiceStore.getState().recordDieSettled('die-1', 5, 'd6')
      expect(useDiceStore.getState().settledDice.get('die-1')?.value).toBe(5)
    })

    it('should auto-save history when last rolling die settles', () => {
      // Mark two dice as rolling
      useDiceStore.getState().markDiceRolling(['die-1', 'die-2'])

      // Settle first die - no history yet
      useDiceStore.getState().recordDieSettled('die-1', 4, 'd6')
      expect(useDiceStore.getState().rollHistory.length).toBe(0)

      // Settle second die - history snapshot saved
      useDiceStore.getState().recordDieSettled('die-2', 6, 'd6')
      expect(useDiceStore.getState().rollHistory.length).toBe(1)

      const snapshot = useDiceStore.getState().rollHistory[0]
      expect(snapshot.sum).toBe(10) // 4 + 6
      expect(snapshot.dice.length).toBe(2)
    })

    it('should only include currentRollCycleDice in history snapshot', () => {
      // Settle die-3 without it being part of a cycle (e.g. already on table)
      useDiceStore.getState().recordDieSettled('die-3', 2, 'd6')

      // Start a roll cycle with die-1 and die-2
      useDiceStore.getState().markDiceRolling(['die-1', 'die-2'])
      useDiceStore.getState().recordDieSettled('die-1', 4, 'd6')
      useDiceStore.getState().recordDieSettled('die-2', 6, 'd6')

      const snapshot = useDiceStore.getState().rollHistory[0]
      // Only die-1 and die-2 should be in snapshot, not die-3
      expect(snapshot.dice.length).toBe(2)
      expect(snapshot.dice.map(d => d.diceId).sort()).toEqual(['die-1', 'die-2'])
      expect(snapshot.sum).toBe(10)
    })

    it('should handle knock-on effect: die knocked into another during cycle', () => {
      // Die-1 starts rolling (new cycle)
      useDiceStore.getState().markDiceRolling(['die-1'])

      // Die-1 knocks die-2 into motion (same cycle)
      useDiceStore.getState().markDiceRolling(['die-2'])

      // Both settle
      useDiceStore.getState().recordDieSettled('die-1', 3, 'd6')
      useDiceStore.getState().recordDieSettled('die-2', 5, 'd6')

      const snapshot = useDiceStore.getState().rollHistory[0]
      expect(snapshot.dice.length).toBe(2)
      expect(snapshot.sum).toBe(8)
    })
  })

  describe('tapping individual die', () => {
    it('should only track tapped die in cycle when others are settled', () => {
      // All dice settled on table
      useDiceStore.getState().recordDieSettled('die-1', 3, 'd6')
      useDiceStore.getState().recordDieSettled('die-2', 4, 'd6')
      useDiceStore.getState().recordDieSettled('die-3', 5, 'd6')

      // Tap/drag only die-2
      useDiceStore.getState().markDiceRolling(['die-2'])

      // Only die-2 in cycle
      expect(useDiceStore.getState().currentRollCycleDice.size).toBe(1)
      expect(useDiceStore.getState().currentRollCycleDice.has('die-2')).toBe(true)

      // die-1 and die-3 still settled
      expect(useDiceStore.getState().settledDice.has('die-1')).toBe(true)
      expect(useDiceStore.getState().settledDice.has('die-3')).toBe(true)

      // die-2 removed from settled
      expect(useDiceStore.getState().settledDice.has('die-2')).toBe(false)

      // When die-2 settles, history should only log die-2
      useDiceStore.getState().recordDieSettled('die-2', 6, 'd6')

      const snapshot = useDiceStore.getState().rollHistory[0]
      expect(snapshot.dice.length).toBe(1)
      expect(snapshot.dice[0].diceId).toBe('die-2')
      expect(snapshot.sum).toBe(6)
    })
  })

  describe('removeDieState', () => {
    it('should remove die from settledDice', () => {
      useDiceStore.getState().recordDieSettled('die-1', 3, 'd6')
      expect(useDiceStore.getState().settledDice.has('die-1')).toBe(true)

      useDiceStore.getState().removeDieState('die-1')
      expect(useDiceStore.getState().settledDice.has('die-1')).toBe(false)
    })

    it('should remove die from rollingDice', () => {
      useDiceStore.getState().markDiceRolling(['die-1'])
      expect(useDiceStore.getState().rollingDice.has('die-1')).toBe(true)

      useDiceStore.getState().removeDieState('die-1')
      expect(useDiceStore.getState().rollingDice.has('die-1')).toBe(false)
    })

    it('should remove die from currentRollCycleDice', () => {
      useDiceStore.getState().markDiceRolling(['die-1'])
      expect(useDiceStore.getState().currentRollCycleDice.has('die-1')).toBe(true)

      useDiceStore.getState().removeDieState('die-1')
      expect(useDiceStore.getState().currentRollCycleDice.has('die-1')).toBe(false)
    })
  })

  describe('clearAllDieStates', () => {
    it('should empty settledDice', () => {
      useDiceStore.getState().recordDieSettled('die-1', 3, 'd6')
      useDiceStore.getState().recordDieSettled('die-2', 4, 'd6')

      useDiceStore.getState().clearAllDieStates()
      expect(useDiceStore.getState().settledDice.size).toBe(0)
    })

    it('should empty rollingDice', () => {
      useDiceStore.getState().markDiceRolling(['die-1'])

      useDiceStore.getState().clearAllDieStates()
      expect(useDiceStore.getState().rollingDice.size).toBe(0)
    })

    it('should empty currentRollCycleDice', () => {
      useDiceStore.getState().markDiceRolling(['die-1'])

      useDiceStore.getState().clearAllDieStates()
      expect(useDiceStore.getState().currentRollCycleDice.size).toBe(0)
    })

    it('should not clear rollHistory', () => {
      // Create a history entry
      useDiceStore.getState().markDiceRolling(['die-1'])
      useDiceStore.getState().recordDieSettled('die-1', 4, 'd6')
      expect(useDiceStore.getState().rollHistory.length).toBe(1)

      useDiceStore.getState().clearAllDieStates()
      expect(useDiceStore.getState().rollHistory.length).toBe(1)
    })
  })

  describe('clearHistory', () => {
    it('should clear rollHistory', () => {
      useDiceStore.getState().markDiceRolling(['die-1'])
      useDiceStore.getState().recordDieSettled('die-1', 4, 'd6')
      expect(useDiceStore.getState().rollHistory.length).toBe(1)

      useDiceStore.getState().clearHistory()
      expect(useDiceStore.getState().rollHistory).toEqual([])
    })

    it('should not affect settledDice or rollingDice', () => {
      useDiceStore.getState().recordDieSettled('die-1', 3, 'd6')
      useDiceStore.getState().markDiceRolling(['die-2'])

      useDiceStore.getState().clearHistory()
      expect(useDiceStore.getState().settledDice.has('die-1')).toBe(true)
      expect(useDiceStore.getState().rollingDice.has('die-2')).toBe(true)
    })
  })

  describe('reset', () => {
    it('should clear everything', () => {
      useDiceStore.getState().recordDieSettled('die-1', 3, 'd6')
      useDiceStore.getState().markDiceRolling(['die-2'])
      useDiceStore.getState().markDiceRolling(['die-3'])
      useDiceStore.getState().recordDieSettled('die-3', 5, 'd6')

      useDiceStore.getState().reset()

      const state = useDiceStore.getState()
      expect(state.settledDice.size).toBe(0)
      expect(state.rollingDice.size).toBe(0)
      expect(state.currentRollCycleDice.size).toBe(0)
      expect(state.rollHistory).toEqual([])
    })
  })
})
