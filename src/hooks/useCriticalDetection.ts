/**
 * Critical Detection Hook
 *
 * Detects when a dice rolls a critical success (max value) or critical failure (min value).
 * Triggers callbacks for each type of critical.
 */

import { useEffect, useRef } from 'react'
import type { DiceShape } from '../lib/geometries'
import { isCriticalSuccess, isCriticalFailure } from '../lib/diceValues'

interface UseCriticalDetectionOptions {
  diceType: DiceShape
  faceValue: number | null
  isAtRest: boolean
  onCriticalSuccess?: () => void
  onCriticalFailure?: () => void
}

export function useCriticalDetection({
  diceType,
  faceValue,
  isAtRest,
  onCriticalSuccess,
  onCriticalFailure,
}: UseCriticalDetectionOptions) {
  const hasTriggeredRef = useRef(false)

  useEffect(() => {
    // Only trigger when:
    // 1. Dice is at rest
    // 2. We have a face value
    // 3. We haven't triggered yet
    if (!isAtRest || faceValue === null || hasTriggeredRef.current) {
      return
    }

    // Check for critical success
    if (isCriticalSuccess(diceType, faceValue)) {
      onCriticalSuccess?.()
      hasTriggeredRef.current = true
      return
    }

    // Check for critical failure
    if (isCriticalFailure(diceType, faceValue)) {
      onCriticalFailure?.()
      hasTriggeredRef.current = true
      return
    }
  }, [isAtRest, faceValue, diceType, onCriticalSuccess, onCriticalFailure])

  // Reset trigger flag when dice starts moving again
  useEffect(() => {
    if (!isAtRest) {
      hasTriggeredRef.current = false
    }
  }, [isAtRest])

  return {
    isCritical: hasTriggeredRef.current,
    isCriticalSuccess: faceValue !== null && isCriticalSuccess(diceType, faceValue),
    isCriticalFailure: faceValue !== null && isCriticalFailure(diceType, faceValue),
  }
}
