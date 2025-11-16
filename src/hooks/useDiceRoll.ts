import { useState, useCallback, useRef } from 'react'
import * as THREE from 'three'
import {
  ROLL_HORIZONTAL_MIN,
  ROLL_HORIZONTAL_MAX,
  ROLL_VERTICAL_MIN,
  ROLL_VERTICAL_MAX,
} from '../config/physicsConfig'
import { useDiceStore } from '../store/useDiceStore'
import { useDiceManagerStore } from '../store/useDiceManagerStore'

export interface DiceRollState {
  canRoll: boolean
  isRolling: boolean
  roll: (diceCount: number) => THREE.Vector3 | null
  onDiceRest: (diceId: string, faceValue: number, diceType: string) => void
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
    const horizontalStrength = ROLL_HORIZONTAL_MIN + Math.random() * (ROLL_HORIZONTAL_MAX - ROLL_HORIZONTAL_MIN)

    const x = Math.cos(angle) * horizontalStrength
    const z = Math.sin(angle) * horizontalStrength

    // Upward component (stronger to ensure good tumble)
    const y = ROLL_VERTICAL_MIN + Math.random() * (ROLL_VERTICAL_MAX - ROLL_VERTICAL_MIN)

    return new THREE.Vector3(x, y, z)
  }, [])

  /**
   * Initiate a dice roll
   * Returns impulse vector to apply to the physics body
   * Always returns an impulse (allows spam clicking)
   */
  const roll = useCallback((diceCount: number): THREE.Vector3 | null => {
    // Allow spam clicking - no canRoll check
    // Don't update state here since we're allowing continuous rolling
    // State is updated when dice come to rest

    // Only start roll tracking if not already rolling
    if (!isRolling) {
      setIsRolling(true)
      awaitingResultRef.current = true
      rollIdRef.current = Date.now()
      // Start new roll in store
      startRoll(diceCount)
    }

    return generateImpulse()
  }, [isRolling, generateImpulse, startRoll])

  /**
   * Callback when dice comes to rest
   * Updates state with the result via Zustand store
   *
   * Business Logic:
   * - Motion mode ON: Accept all results (continuous rolling)
   * - Motion mode OFF: Accept results from button-triggered rolls OR motion-control tilts
   *
   * IMPORTANT: We now accept motion control results even when motion mode is OFF.
   * This allows users to tilt their phone to roll dice without explicitly enabling motion mode.
   * The "awaiting result" check is removed because motion controls (gravity tilt) don't
   * call roll() but still cause legitimate dice movement.
   */
  const onDiceRest = useCallback((diceId: string, faceValue: number, diceType: string) => {
    // Accept all results - both button-triggered and motion-control triggered
    // The "phantom roll" concept only applies to spurious detections, not actual dice movement

    // Ensure we have started tracking the roll (for both motion mode and button rolls)
    const expectedCount = useDiceStore.getState().expectedDiceCount
    if (expectedCount === 0) {
      // No roll tracking started - this is a motion-control roll
      const diceCount = useDiceManagerStore.getState().dice.length
      console.log('useDiceRoll: Motion-control detected, starting roll tracking with', diceCount, 'dice')
      startRoll(diceCount)
      setIsRolling(true)
      awaitingResultRef.current = true
    }

    console.log('useDiceRoll: Recording dice result:', diceId, faceValue, diceType)
    recordDiceResult(diceId, faceValue, diceType)

    // Check if roll is complete (all dice reported)
    const currentRoll = useDiceStore.getState().currentRoll
    const updatedExpectedCount = useDiceStore.getState().expectedDiceCount

    if (currentRoll.length === updatedExpectedCount) {
      console.log('useDiceRoll: Roll complete, all', updatedExpectedCount, 'dice reported')
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
