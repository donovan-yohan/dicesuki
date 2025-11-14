import { useState, useCallback, useRef } from 'react'
import * as THREE from 'three'
import { useDiceStore } from '../store/useDiceStore'
import { useDiceManagerStore } from '../store/useDiceManagerStore'
import { useUIStore } from '../store/useUIStore'

export interface DiceRollState {
  canRoll: boolean
  isRolling: boolean
  roll: (diceCount: number) => THREE.Vector3 | null
  onDiceRest: (diceId: string, faceValue: number) => void
  reset: () => void
}

/**
 * Hook to manage dice rolling state and mechanics
 *
 * Handles:
 * - Roll state management (can roll, is rolling)
 * - Impulse generation for physics
 * - Result callbacks
 * - Motion mode: continuous rolling vs button-triggered rolling
 *
 * NOTE: lastResult and rollHistory are now in useDiceStore
 * to prevent Canvas re-renders when UI state changes.
 */
export function useDiceRoll(): DiceRollState {
  const [canRoll, setCanRoll] = useState(true)
  const [isRolling, setIsRolling] = useState(false)

  // Use shallow comparison to prevent re-renders when store state changes
  // Only extract action functions (stable references)
  const startRoll = useDiceStore.getState().startRoll
  const recordDiceResult = useDiceStore.getState().recordDiceResult
  const resetStore = useDiceStore.getState().reset

  // Track if we're expecting results from the current roll
  const awaitingResultRef = useRef(false)
  const rollIdRef = useRef<number>(0)

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
  const roll = useCallback((diceCount: number): THREE.Vector3 | null => {
    if (!canRoll) {
      return null
    }

    setCanRoll(false)
    setIsRolling(true)
    awaitingResultRef.current = true
    rollIdRef.current = Date.now()

    // Start new roll in store
    startRoll(diceCount)

    return generateImpulse()
  }, [canRoll, generateImpulse, startRoll])

  /**
   * Callback when dice comes to rest
   * Updates state with the result via Zustand store
   *
   * Business Logic:
   * - Motion mode ON: Accept all results (continuous rolling)
   * - Motion mode OFF: Only accept results from button-triggered rolls
   */
  const onDiceRest = useCallback((diceId: string, faceValue: number) => {
    // Check motion mode from UI store (no subscription, no re-renders)
    const motionMode = useUIStore.getState().motionMode

    // In motion mode: always accept results (continuous rolling)
    // In normal mode: only process if we're awaiting a result from a button roll
    if (!motionMode && !awaitingResultRef.current) {
      console.log('Ignoring phantom roll:', diceId, faceValue, '(not awaiting result)')
      return
    }

    // In motion mode, ensure we have started tracking the roll
    const expectedCount = useDiceStore.getState().expectedDiceCount
    if (motionMode && expectedCount === 0) {
      // Motion mode but no roll started - get current dice count and start tracking
      const diceCount = useDiceManagerStore.getState().dice.length
      console.log('Motion mode: Starting roll tracking with', diceCount, 'dice')
      startRoll(diceCount)
    }

    console.log('useDiceRoll: Recording dice result:', diceId, faceValue)
    recordDiceResult(diceId, faceValue)

    // Check if roll is complete (all dice reported)
    const currentRoll = useDiceStore.getState().currentRoll
    const updatedExpectedCount = useDiceStore.getState().expectedDiceCount

    if (currentRoll.length === updatedExpectedCount) {
      setIsRolling(false)
      setCanRoll(true)
      awaitingResultRef.current = false
    }
  }, [recordDiceResult, startRoll])

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
