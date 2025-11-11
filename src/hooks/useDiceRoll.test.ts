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
        result.current.roll()
      })

      expect(result.current.isRolling).toBe(true)
    })

    it('should set canRoll to false when roll is called', () => {
      const { result } = renderHook(() => useDiceRoll())

      act(() => {
        result.current.roll()
      })

      expect(result.current.canRoll).toBe(false)
    })

    it('should not allow rolling when canRoll is false', () => {
      const { result } = renderHook(() => useDiceRoll())

      act(() => {
        result.current.roll()
      })

      const isRollingAfterFirst = result.current.isRolling

      act(() => {
        result.current.roll() // Second roll attempt
      })

      // State should not change on second roll
      expect(result.current.isRolling).toBe(isRollingAfterFirst)
    })

    it('should return impulse vector when roll is called', () => {
      const { result } = renderHook(() => useDiceRoll())

      let impulse: THREE.Vector3 | null = null
      act(() => {
        impulse = result.current.roll()
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
          const impulse = result.current.roll()
          if (impulse) impulses.push(impulse)
        })

        act(() => {
          result.current.onDiceRest(1) // Reset state
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
        result.current.roll()
      })

      act(() => {
        result.current.onDiceRest(5)
      })

      expect(useDiceStore.getState().lastResult).toBe(5)
    })

    it('should add result to roll history', () => {
      const { result } = renderHook(() => useDiceRoll())

      act(() => {
        result.current.roll()
      })

      act(() => {
        result.current.onDiceRest(3)
      })

      expect(useDiceStore.getState().rollHistory).toEqual([3])
    })

    it('should accumulate multiple results in history', () => {
      const { result } = renderHook(() => useDiceRoll())

      const rolls = [4, 2, 6, 1]

      for (const value of rolls) {
        act(() => {
          result.current.roll()
        })

        act(() => {
          result.current.onDiceRest(value)
        })
      }

      expect(useDiceStore.getState().rollHistory).toEqual(rolls)
    })

    it('should set isRolling to false when dice comes to rest', () => {
      const { result } = renderHook(() => useDiceRoll())

      act(() => {
        result.current.roll()
      })

      expect(result.current.isRolling).toBe(true)

      act(() => {
        result.current.onDiceRest(6)
      })

      expect(result.current.isRolling).toBe(false)
    })

    it('should allow rolling again after dice comes to rest', () => {
      const { result } = renderHook(() => useDiceRoll())

      act(() => {
        result.current.roll()
      })

      expect(result.current.canRoll).toBe(false)

      act(() => {
        result.current.onDiceRest(2)
      })

      expect(result.current.canRoll).toBe(true)
    })

    it('should not update state if onDiceRest called without rolling', () => {
      const { result } = renderHook(() => useDiceRoll())

      act(() => {
        result.current.onDiceRest(5)
      })

      expect(useDiceStore.getState().lastResult).toBeNull()
      expect(useDiceStore.getState().rollHistory).toEqual([])
    })
  })

  describe('reset function', () => {
    it('should clear roll history', () => {
      const { result } = renderHook(() => useDiceRoll())

      // Build up some history
      act(() => {
        result.current.roll()
      })
      act(() => {
        result.current.onDiceRest(4)
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
        result.current.roll()
      })
      act(() => {
        result.current.onDiceRest(6)
      })

      expect(useDiceStore.getState().lastResult).toBe(6)

      act(() => {
        result.current.reset()
      })

      expect(useDiceStore.getState().lastResult).toBeNull()
    })

    it('should reset isRolling state', () => {
      const { result } = renderHook(() => useDiceRoll())

      act(() => {
        result.current.roll()
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
        result.current.roll()
      })

      expect(result.current.canRoll).toBe(false)

      act(() => {
        result.current.reset()
      })

      expect(result.current.canRoll).toBe(true)
    })
  })

  describe('impulse generation', () => {
    it('should generate impulse with upward component', () => {
      const { result } = renderHook(() => useDiceRoll())

      let impulse: THREE.Vector3 | null = null
      act(() => {
        impulse = result.current.roll()
      })

      // Y component should be positive (upward)
      expect(impulse!.y).toBeGreaterThan(0)
    })

    it('should generate impulse within reasonable magnitude', () => {
      const { result } = renderHook(() => useDiceRoll())

      let impulse: THREE.Vector3 | null = null
      act(() => {
        impulse = result.current.roll()
      })

      const magnitude = impulse!.length()

      // Should be strong enough to roll but not too extreme
      expect(magnitude).toBeGreaterThan(1)
      expect(magnitude).toBeLessThan(20)
    })
  })
})
