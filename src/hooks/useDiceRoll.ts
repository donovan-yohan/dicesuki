import { useState, useCallback, useRef } from 'react'
import * as THREE from 'three'
import { useDiceStore } from '../store/useDiceStore'

export interface DiceRollState {
  canRoll: boolean
  isRolling: boolean
  roll: () => THREE.Vector3 | null
  onDiceRest: (faceValue: number) => void
  reset: () => void
}

/**
 * Hook to manage dice rolling state and mechanics
 *
 * Handles:
 * - Roll state management (can roll, is rolling)
 * - Impulse generation for physics
 * - Result callbacks
 *
 * NOTE: lastResult and rollHistory are now in useDiceStore
 * to prevent Canvas re-renders when UI state changes.
 */
export function useDiceRoll(): DiceRollState {
  const [canRoll, setCanRoll] = useState(true)
  const [isRolling, setIsRolling] = useState(false)
  const recordResult = useDiceStore((state) => state.recordResult)
  const resetStore = useDiceStore((state) => state.reset)

  // Track if we're expecting a result from the current roll
  const awaitingResultRef = useRef(false)

  /**
   * Generate a random impulse vector for the dice
   * Returns a vector with upward and random horizontal components
   */
  const generateImpulse = useCallback((): THREE.Vector3 => {
    // Random horizontal direction
    const angle = Math.random() * Math.PI * 2
    const horizontalStrength = 2 + Math.random() * 3 // 2-5 units

    const x = Math.cos(angle) * horizontalStrength
    const z = Math.sin(angle) * horizontalStrength

    // Upward component (stronger to ensure good tumble)
    const y = 5 + Math.random() * 3 // 5-8 units upward

    return new THREE.Vector3(x, y, z)
  }, [])

  /**
   * Initiate a dice roll
   * Returns impulse vector to apply to the physics body
   * Returns null if roll is not allowed
   */
  const roll = useCallback((): THREE.Vector3 | null => {
    if (!canRoll) {
      return null
    }

    setCanRoll(false)
    setIsRolling(true)
    awaitingResultRef.current = true

    return generateImpulse()
  }, [canRoll, generateImpulse])

  /**
   * Callback when dice comes to rest
   * Updates state with the result via Zustand store
   */
  const onDiceRest = useCallback((faceValue: number) => {
    // Only process if we're awaiting a result from a roll
    if (!awaitingResultRef.current) {
      console.log('Ignoring phantom roll:', faceValue, '(not awaiting result)')
      return
    }

    console.log('useDiceRoll: Recording result:', faceValue)
    recordResult(faceValue)
    setIsRolling(false)
    setCanRoll(true)
    awaitingResultRef.current = false
  }, [recordResult])

  /**
   * Reset all roll state
   */
  const reset = useCallback(() => {
    setCanRoll(true)
    setIsRolling(false)
    resetStore()
    awaitingResultRef.current = false
  }, [resetStore])

  return {
    canRoll,
    isRolling,
    roll,
    onDiceRest,
    reset,
  }
}
