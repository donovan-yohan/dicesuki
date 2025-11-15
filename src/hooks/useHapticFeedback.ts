import { useState, useCallback, useRef } from 'react'
import { isHapticsSupported, vibrate, HAPTIC_PATTERNS, type HapticIntensity } from '../lib/haptics'
import { HAPTIC_THROTTLE_MS } from '../config/physicsConfig'

const STORAGE_KEY = 'hapticFeedbackEnabled'

export interface HapticFeedbackState {
  isEnabled: boolean
  isSupported: boolean
  setEnabled: (enabled: boolean) => void
  vibrateOnCollision: (intensity: HapticIntensity) => void
}

/**
 * Hook for managing haptic feedback preferences and triggering vibrations
 * Provides throttling to prevent overwhelming feedback
 */
export function useHapticFeedback(): HapticFeedbackState {
  // Load enabled state from localStorage
  const [isEnabled, setIsEnabledState] = useState(() => {
    const stored = localStorage.getItem(STORAGE_KEY)
    return stored ? stored === 'true' : true
  })

  // Track last vibration time for throttling
  // Initialize to -HAPTIC_THROTTLE_MS to allow first vibration immediately
  const lastVibrateTimeRef = useRef(-HAPTIC_THROTTLE_MS)

  // Set enabled state and persist to localStorage
  const setEnabled = useCallback((enabled: boolean) => {
    setIsEnabledState(enabled)
    localStorage.setItem(STORAGE_KEY, enabled.toString())
  }, [])

  // Trigger vibration based on collision intensity
  const vibrateOnCollision = useCallback((intensity: HapticIntensity) => {
    // Don't vibrate if disabled or not supported (check dynamically)
    if (!isEnabled || !isHapticsSupported()) {
      return
    }

    // Throttle vibrations
    const now = performance.now()
    if (now - lastVibrateTimeRef.current < HAPTIC_THROTTLE_MS) {
      return
    }

    lastVibrateTimeRef.current = now

    // Trigger vibration with appropriate pattern
    const pattern = HAPTIC_PATTERNS[intensity]
    vibrate(pattern)
  }, [isEnabled])

  return {
    isEnabled,
    isSupported: isHapticsSupported(),
    setEnabled,
    vibrateOnCollision
  }
}
