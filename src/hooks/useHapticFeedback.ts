import { useCallback, useRef } from 'react'
import { isHapticsSupported, vibrate, HAPTIC_PATTERNS, type HapticIntensity } from '../lib/haptics'
import { HAPTIC_THROTTLE_MS } from '../config/physicsConfig'
import { useUIStore } from '../store/useUIStore'

export interface HapticFeedbackState {
  isEnabled: boolean
  isSupported: boolean
  setEnabled: (enabled: boolean) => void
  vibrateOnCollision: (intensity: HapticIntensity) => void
}

/**
 * Hook for managing haptic feedback preferences and triggering vibrations
 * Provides throttling to prevent overwhelming feedback
 * Uses global Zustand store for state management
 */
export function useHapticFeedback(): HapticFeedbackState {
  // Get haptic state from global store
  const isEnabled = useUIStore((state) => state.hapticEnabled)
  const setEnabled = useUIStore((state) => state.setHapticEnabled)

  // Track last vibration time for throttling
  // Initialize to -HAPTIC_THROTTLE_MS to allow first vibration immediately
  const lastVibrateTimeRef = useRef(-HAPTIC_THROTTLE_MS)

  // Trigger vibration based on collision intensity
  const vibrateOnCollision = useCallback((intensity: HapticIntensity) => {
    // Read from store directly to get latest value
    const isCurrentlyEnabled = useUIStore.getState().hapticEnabled

    // Don't vibrate if disabled or not supported (check dynamically)
    if (!isCurrentlyEnabled || !isHapticsSupported()) {
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
  }, [])

  return {
    isEnabled,
    isSupported: isHapticsSupported(),
    setEnabled,
    vibrateOnCollision
  }
}
