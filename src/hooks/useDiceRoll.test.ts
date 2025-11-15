import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useDiceRoll } from './useDiceRoll'
import { useDiceStore } from '../store/useDiceStore'
import * as THREE from 'three'

describe('useDiceRoll', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    // Reset Zustand store before each test
    useDiceStore.getState().reset()
  })

  describe('initial state', () => {
    it('should start with canRoll true', () => {
      const { result } = renderHook(() => useDiceRoll())
      expect(result.current.canRoll).toBe(true)
    })

    it('should start with empty roll history in store', () => {
      renderHook(() => useDiceRoll())
      expect(useDiceStore.getState().rollHistory).toEqual([])
    })

    it('should start with null lastResult in store', () => {
      renderHook(() => useDiceRoll())
      expect(useDiceStore.getState().lastResult).toBeNull()
    })

    it('should start with isRolling false', () => {
      const { result } = renderHook(() => useDiceRoll())
      expect(result.current.isRolling).toBe(false)
    })
  })

  describe('roll function', () => {
    it('should provide a roll function', () => {
      const { result } = renderHook(() => useDiceRoll())
      expect(typeof result.current.roll).toBe('function')
    })

    it('should set isRolling to true when roll is called', () => {
      const { result } = renderHook(() => useDiceRoll())

      act(() => {
        result.current.roll(1) // Pass diceCount
      })

      expect(result.current.isRolling).toBe(true)
    })

    it('should allow spam clicking (canRoll remains true)', () => {
      const { result } = renderHook(() => useDiceRoll())

      act(() => {
        result.current.roll(1) // Pass diceCount
      })

      // canRoll should still be true to allow spam clicking
      expect(result.current.canRoll).toBe(true)
    })

    it('should allow multiple rolls (spam clicking)', () => {
      const { result } = renderHook(() => useDiceRoll())

      let impulse1: THREE.Vector3 | null = null
      let impulse2: THREE.Vector3 | null = null

      act(() => {
        impulse1 = result.current.roll(1) // First roll with diceCount
      })

      act(() => {
        impulse2 = result.current.roll(1) // Second roll (should be allowed)
      })

      // Both should return valid impulses
      expect(impulse1).toBeInstanceOf(THREE.Vector3)
      expect(impulse2).toBeInstanceOf(THREE.Vector3)
      expect(result.current.isRolling).toBe(true)
    })

    it('should return impulse vector when roll is called', () => {
      const { result } = renderHook(() => useDiceRoll())

      let impulse: THREE.Vector3 | null = null
      act(() => {
        impulse = result.current.roll(1) // Pass diceCount
      })

      expect(impulse).toBeInstanceOf(THREE.Vector3)
      expect(impulse!.length()).toBeGreaterThan(0)
    })

    it('should return random impulse vectors', () => {
      const { result } = renderHook(() => useDiceRoll())

      const impulses: THREE.Vector3[] = []

      // Roll multiple times (need to reset between rolls)
      for (let i = 0; i < 5; i++) {
        act(() => {
          const impulse = result.current.roll(1) // Pass diceCount
          if (impulse) impulses.push(impulse)
        })

        act(() => {
          result.current.onDiceRest('dice-1', 1, 'd6') // New signature: diceId, faceValue, diceType
        })
      }

      // Check that at least some impulses are different
      const uniqueImpulses = new Set(impulses.map(v => `${v.x},${v.y},${v.z}`))
      expect(uniqueImpulses.size).toBeGreaterThan(1)
    })
  })

  describe('onDiceRest callback', () => {
    it('should update lastResult when dice comes to rest', () => {
      const { result } = renderHook(() => useDiceRoll())

      act(() => {
        result.current.roll(1) // Pass diceCount
      })

      act(() => {
        result.current.onDiceRest('dice-1', 5, 'd6') // New signature
      })

      const lastResult = useDiceStore.getState().lastResult
      expect(lastResult?.sum).toBe(5)
    })

    it('should add result to roll history', () => {
      const { result } = renderHook(() => useDiceRoll())

      act(() => {
        result.current.roll(1) // Pass diceCount
      })

      act(() => {
        result.current.onDiceRest('dice-1', 3, 'd6') // New signature
      })

      const history = useDiceStore.getState().rollHistory
      expect(history.length).toBe(1)
      expect(history[0].sum).toBe(3)
    })

    it('should accumulate multiple results in history', () => {
      const { result } = renderHook(() => useDiceRoll())

      const rolls = [4, 2, 6, 1]

      for (let i = 0; i < rolls.length; i++) {
        const value = rolls[i]
        act(() => {
          result.current.roll(1) // Pass diceCount
        })

        act(() => {
          result.current.onDiceRest(`dice-${i}`, value, 'd6') // New signature
        })
      }

      const history = useDiceStore.getState().rollHistory
      expect(history.length).toBe(rolls.length)
      expect(history.map(r => r.sum)).toEqual(rolls)
    })

    it('should set isRolling to false when dice comes to rest', () => {
      const { result } = renderHook(() => useDiceRoll())

      act(() => {
        result.current.roll(1) // Pass diceCount
      })

      expect(result.current.isRolling).toBe(true)

      act(() => {
        result.current.onDiceRest('dice-1', 6, 'd6') // New signature
      })

      expect(result.current.isRolling).toBe(false)
    })

    it('should allow rolling again after dice comes to rest', () => {
      const { result } = renderHook(() => useDiceRoll())

      act(() => {
        result.current.roll(1) // Pass diceCount
      })

      // canRoll remains true (spam-click allowed)
      expect(result.current.canRoll).toBe(true)

      act(() => {
        result.current.onDiceRest('dice-1', 2, 'd6') // New signature
      })

      // Still true after dice rest
      expect(result.current.canRoll).toBe(true)
    })

    it('should handle motion-control rolls (no explicit roll call)', () => {
      const { result } = renderHook(() => useDiceRoll())

      // Motion control triggers onDiceRest without roll() being called
      act(() => {
        result.current.onDiceRest('dice-1', 5, 'd6')
      })

      const lastResult = useDiceStore.getState().lastResult
      expect(lastResult?.sum).toBe(5)
    })
  })

  describe('reset function', () => {
    it('should clear roll history', () => {
      const { result } = renderHook(() => useDiceRoll())

      // Build up some history
      act(() => {
        result.current.roll(1) // Pass diceCount
      })
      act(() => {
        result.current.onDiceRest('dice-1', 4, 'd6') // New signature
      })

      expect(useDiceStore.getState().rollHistory.length).toBeGreaterThan(0)

      act(() => {
        result.current.reset()
      })

      expect(useDiceStore.getState().rollHistory).toEqual([])
    })

    it('should clear lastResult', () => {
      const { result } = renderHook(() => useDiceRoll())

      act(() => {
        result.current.roll(1) // Pass diceCount
      })
      act(() => {
        result.current.onDiceRest('dice-1', 6, 'd6') // New signature
      })

      expect(useDiceStore.getState().lastResult).not.toBeNull()

      act(() => {
        result.current.reset()
      })

      expect(useDiceStore.getState().lastResult).toBeNull()
    })

    it('should reset isRolling state', () => {
      const { result } = renderHook(() => useDiceRoll())

      act(() => {
        result.current.roll(1) // Pass diceCount
      })

      expect(result.current.isRolling).toBe(true)

      act(() => {
        result.current.reset()
      })

      expect(result.current.isRolling).toBe(false)
    })

    it('should allow rolling after reset', () => {
      const { result } = renderHook(() => useDiceRoll())

      act(() => {
        result.current.roll(1) // Pass diceCount
      })

      // canRoll stays true (spam-click allowed)
      expect(result.current.canRoll).toBe(true)

      act(() => {
        result.current.reset()
      })

      // Still true after reset
      expect(result.current.canRoll).toBe(true)
    })
  })

  describe('impulse generation', () => {
    it('should generate impulse with upward component', () => {
      const { result } = renderHook(() => useDiceRoll())

      let impulse: THREE.Vector3 | null = null
      act(() => {
        impulse = result.current.roll(1) // Pass diceCount
      })

      // Y component should be positive (upward)
      expect(impulse!.y).toBeGreaterThan(0)
    })

    it('should generate impulse within reasonable magnitude', () => {
      const { result } = renderHook(() => useDiceRoll())

      let impulse: THREE.Vector3 | null = null
      act(() => {
        impulse = result.current.roll(1) // Pass diceCount
      })

      const magnitude = impulse!.length()

      // Should be strong enough to roll but not too extreme
      expect(magnitude).toBeGreaterThan(1)
      expect(magnitude).toBeLessThan(20)
    })
  })
})
