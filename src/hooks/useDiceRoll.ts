import { useCallback } from 'react'
import * as THREE from 'three'
import {
  ROLL_HORIZONTAL_MIN,
  ROLL_HORIZONTAL_MAX,
  ROLL_VERTICAL_MIN,
  ROLL_VERTICAL_MAX,
} from '../config/physicsConfig'
import { useDiceStore } from '../store/useDiceStore'

export interface DiceRollState {
  isRolling: boolean
  roll: () => THREE.Vector3
  onDiceRest: (diceId: string, faceValue: number, diceType: string) => void
  onDiceMoving: (diceId: string) => void
  reset: () => void
}

/**
 * Hook to manage dice rolling state and mechanics
 *
 * Handles:
 * - Impulse generation for physics
 * - Per-die rolling/settled state via useDiceStore
 * - isRolling derived from store's rollingDice set
 */
export function useDiceRoll(): DiceRollState {
  const rollingDice = useDiceStore((s) => s.rollingDice)
  const isRolling = rollingDice.size > 0

  const generateImpulse = useCallback((): THREE.Vector3 => {
    const angle = Math.random() * Math.PI * 2
    const horizontalStrength = ROLL_HORIZONTAL_MIN + Math.random() * (ROLL_HORIZONTAL_MAX - ROLL_HORIZONTAL_MIN)

    const x = Math.cos(angle) * horizontalStrength
    const z = Math.sin(angle) * horizontalStrength
    const y = ROLL_VERTICAL_MIN + Math.random() * (ROLL_VERTICAL_MAX - ROLL_VERTICAL_MIN)

    return new THREE.Vector3(x, y, z)
  }, [])

  const roll = useCallback((): THREE.Vector3 => {
    return generateImpulse()
  }, [generateImpulse])

  const onDiceRest = useCallback((diceId: string, faceValue: number, diceType: string) => {
    useDiceStore.getState().recordDieSettled(diceId, faceValue, diceType)
  }, [])

  const onDiceMoving = useCallback((diceId: string) => {
    useDiceStore.getState().markDiceRolling([diceId])
  }, [])

  const reset = useCallback(() => {
    useDiceStore.getState().reset()
  }, [])

  return { isRolling, roll, onDiceRest, onDiceMoving, reset }
}
