import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useDiceRoll } from './useDiceRoll'
import { useDiceStore } from '../store/useDiceStore'
import * as THREE from 'three'

describe('useDiceRoll', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    useDiceStore.getState().reset()
  })

  describe('initial state', () => {
    it('should start with isRolling false', () => {
      const { result } = renderHook(() => useDiceRoll())
      expect(result.current.isRolling).toBe(false)
    })

    it('should start with empty rollHistory in store', () => {
      renderHook(() => useDiceRoll())
      expect(useDiceStore.getState().rollHistory).toEqual([])
    })

    it('should start with empty settledDice in store', () => {
      renderHook(() => useDiceRoll())
      expect(useDiceStore.getState().settledDice.size).toBe(0)
    })

    it('should start with empty rollingDice in store', () => {
      renderHook(() => useDiceRoll())
      expect(useDiceStore.getState().rollingDice.size).toBe(0)
    })
  })

  describe('roll function', () => {
    it('should return a THREE.Vector3 impulse', () => {
      const { result } = renderHook(() => useDiceRoll())

      let impulse: THREE.Vector3
      act(() => {
        impulse = result.current.roll()
      })

      expect(impulse!).toBeInstanceOf(THREE.Vector3)
      expect(impulse!.length()).toBeGreaterThan(0)
    })

    it('should not take a diceCount parameter', () => {
      const { result } = renderHook(() => useDiceRoll())

      // roll() takes no arguments and always returns a Vector3
      let impulse: THREE.Vector3
      act(() => {
        impulse = result.current.roll()
      })

      expect(impulse!).toBeInstanceOf(THREE.Vector3)
    })

    it('should return different impulses on multiple calls (randomness)', () => {
      const { result } = renderHook(() => useDiceRoll())

      const impulses: THREE.Vector3[] = []
      for (let i = 0; i < 10; i++) {
        act(() => {
          impulses.push(result.current.roll())
        })
      }

      const uniqueImpulses = new Set(impulses.map(v => `${v.x},${v.y},${v.z}`))
      expect(uniqueImpulses.size).toBeGreaterThan(1)
    })
  })

  describe('onDiceRest', () => {
    it('should call recordDieSettled on the store', () => {
      const { result } = renderHook(() => useDiceRoll())
      const spy = vi.spyOn(useDiceStore.getState(), 'recordDieSettled')

      act(() => {
        result.current.onDiceRest('dice-1', 5, 'd6')
      })

      expect(spy).toHaveBeenCalledWith('dice-1', 5, 'd6')
      spy.mockRestore()
    })

    it('should add die to settledDice in the store', () => {
      const { result } = renderHook(() => useDiceRoll())

      // Mark die as rolling first, then settle it
      act(() => {
        useDiceStore.getState().markDiceRolling(['dice-1'])
      })

      act(() => {
        result.current.onDiceRest('dice-1', 4, 'd6')
      })

      const settled = useDiceStore.getState().settledDice.get('dice-1')
      expect(settled).toBeDefined()
      expect(settled!.value).toBe(4)
      expect(settled!.type).toBe('d6')
    })

    it('should remove die from rollingDice when it settles', () => {
      const { result } = renderHook(() => useDiceRoll())

      act(() => {
        useDiceStore.getState().markDiceRolling(['dice-1'])
      })

      expect(useDiceStore.getState().rollingDice.has('dice-1')).toBe(true)

      act(() => {
        result.current.onDiceRest('dice-1', 3, 'd6')
      })

      expect(useDiceStore.getState().rollingDice.has('dice-1')).toBe(false)
    })
  })

  describe('onDiceMoving', () => {
    it('should call markDiceRolling with the dice id', () => {
      const { result } = renderHook(() => useDiceRoll())
      const spy = vi.spyOn(useDiceStore.getState(), 'markDiceRolling')

      act(() => {
        result.current.onDiceMoving('dice-2')
      })

      expect(spy).toHaveBeenCalledWith(['dice-2'])
      spy.mockRestore()
    })

    it('should add die to rollingDice in the store', () => {
      const { result } = renderHook(() => useDiceRoll())

      act(() => {
        result.current.onDiceMoving('dice-2')
      })

      expect(useDiceStore.getState().rollingDice.has('dice-2')).toBe(true)
    })
  })

  describe('isRolling', () => {
    it('should be true when rollingDice is non-empty', () => {
      const { result } = renderHook(() => useDiceRoll())

      act(() => {
        useDiceStore.getState().markDiceRolling(['dice-1'])
      })

      expect(result.current.isRolling).toBe(true)
    })

    it('should be false when rollingDice is empty', () => {
      const { result } = renderHook(() => useDiceRoll())

      act(() => {
        useDiceStore.getState().markDiceRolling(['dice-1'])
      })

      expect(result.current.isRolling).toBe(true)

      act(() => {
        useDiceStore.getState().recordDieSettled('dice-1', 6, 'd6')
      })

      expect(result.current.isRolling).toBe(false)
    })

    it('should track multiple dice rolling', () => {
      const { result } = renderHook(() => useDiceRoll())

      act(() => {
        useDiceStore.getState().markDiceRolling(['dice-1', 'dice-2'])
      })

      expect(result.current.isRolling).toBe(true)

      // Settle one die — still rolling
      act(() => {
        useDiceStore.getState().recordDieSettled('dice-1', 3, 'd6')
      })

      expect(result.current.isRolling).toBe(true)

      // Settle second die — no longer rolling
      act(() => {
        useDiceStore.getState().recordDieSettled('dice-2', 5, 'd6')
      })

      expect(result.current.isRolling).toBe(false)
    })
  })

  describe('reset', () => {
    it('should call store reset', () => {
      const { result } = renderHook(() => useDiceRoll())
      const spy = vi.spyOn(useDiceStore.getState(), 'reset')

      act(() => {
        result.current.reset()
      })

      expect(spy).toHaveBeenCalled()
      spy.mockRestore()
    })

    it('should clear all store state', () => {
      const { result } = renderHook(() => useDiceRoll())

      // Build up state
      act(() => {
        useDiceStore.getState().markDiceRolling(['dice-1'])
      })
      act(() => {
        useDiceStore.getState().recordDieSettled('dice-1', 4, 'd6')
      })

      expect(useDiceStore.getState().settledDice.size).toBeGreaterThan(0)
      expect(useDiceStore.getState().rollHistory.length).toBeGreaterThan(0)

      act(() => {
        result.current.reset()
      })

      expect(useDiceStore.getState().settledDice.size).toBe(0)
      expect(useDiceStore.getState().rollingDice.size).toBe(0)
      expect(useDiceStore.getState().rollHistory).toEqual([])
    })

    it('should set isRolling to false', () => {
      const { result } = renderHook(() => useDiceRoll())

      act(() => {
        useDiceStore.getState().markDiceRolling(['dice-1'])
      })

      expect(result.current.isRolling).toBe(true)

      act(() => {
        result.current.reset()
      })

      expect(result.current.isRolling).toBe(false)
    })
  })

  describe('impulse generation', () => {
    it('should generate impulse with positive upward (Y) component', () => {
      const { result } = renderHook(() => useDiceRoll())

      let impulse: THREE.Vector3
      act(() => {
        impulse = result.current.roll()
      })

      expect(impulse!.y).toBeGreaterThan(0)
    })

    it('should generate impulse within reasonable magnitude', () => {
      const { result } = renderHook(() => useDiceRoll())

      let impulse: THREE.Vector3
      act(() => {
        impulse = result.current.roll()
      })

      const magnitude = impulse!.length()
      expect(magnitude).toBeGreaterThan(1)
      expect(magnitude).toBeLessThan(20)
    })

    it('should have non-zero horizontal components', () => {
      const { result } = renderHook(() => useDiceRoll())

      let impulse: THREE.Vector3
      act(() => {
        impulse = result.current.roll()
      })

      // At least one of X or Z should be non-zero
      const horizontalMagnitude = Math.sqrt(impulse!.x ** 2 + impulse!.z ** 2)
      expect(horizontalMagnitude).toBeGreaterThan(0)
    })
  })
})
