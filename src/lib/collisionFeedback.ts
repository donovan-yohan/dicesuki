/**
 * Cross-player collision feedback dispatcher.
 *
 * Fired from the multiplayer store's `dice_knocked` handler (a non-React code path),
 * so it deliberately does NOT use the `useHapticFeedback` hook — it reads state via
 * `useUIStore.getState()` and calls the low-level haptics/SFX utilities directly.
 *
 * A server `dice_knocked` event reports an `impactSpeed`; that speed is mapped to a
 * haptic/SFX intensity so a hard cross-player smack feels stronger than a soft nudge.
 */

import { vibrate, HAPTIC_PATTERNS, isHapticsSupported, type HapticIntensity } from './haptics'
import { playCollisionSfx } from './soundEffects'
import { useUIStore } from '../store/useUIStore'
import {
  COLLISION_IMPACT_MEDIUM_SPEED,
  COLLISION_IMPACT_STRONG_SPEED,
  HAPTIC_THROTTLE_MS,
} from '../config/physicsConfig'

// Shared throttle so a flurry of near-simultaneous knocks doesn't spam vibration.
let lastCollisionTime = -HAPTIC_THROTTLE_MS

/**
 * Map a server-reported impact speed (engine U/s — the die's linear speed at the
 * knock; 62.5 U = 1 m) to a feedback intensity. Exported for testing and reuse.
 */
export function impactSpeedToIntensity(impactSpeed: number): HapticIntensity {
  if (impactSpeed >= COLLISION_IMPACT_STRONG_SPEED) return 'strong'
  if (impactSpeed >= COLLISION_IMPACT_MEDIUM_SPEED) return 'medium'
  return 'light'
}

/**
 * Trigger haptic + SFX feedback for a cross-player collision of the given impact speed.
 * Haptics respect the user's `hapticEnabled` setting and a shared throttle; SFX are
 * gated by their own opt-in flag (see soundEffects.ts). Safe to call from any context.
 */
export function triggerCollisionFeedback(impactSpeed: number): void {
  const intensity = impactSpeedToIntensity(impactSpeed)

  const now = typeof performance !== 'undefined' ? performance.now() : Date.now()
  if (now - lastCollisionTime < HAPTIC_THROTTLE_MS) {
    return
  }
  lastCollisionTime = now

  // Haptics: respect the global toggle and platform support.
  if (useUIStore.getState().hapticEnabled && isHapticsSupported()) {
    vibrate(HAPTIC_PATTERNS[intensity])
  }

  // SFX seam (self-gated by its opt-in flag).
  playCollisionSfx(intensity)
}

/** Test-only reset of the throttle clock. */
export function __resetCollisionFeedbackForTest(): void {
  lastCollisionTime = -HAPTIC_THROTTLE_MS
}
