/**
 * Haptic feedback utilities for dice collision feedback
 * Uses the Web Vibration API with graceful fallback
 */

import {
  HAPTIC_LIGHT_DURATION,
  HAPTIC_MEDIUM_DURATION,
  HAPTIC_STRONG_DURATION,
} from '../config/physicsConfig'

export type HapticIntensity = 'light' | 'medium' | 'strong'

/**
 * Predefined haptic patterns for different collision intensities
 * Values sourced from physicsConfig.ts for centralized tuning
 */
export const HAPTIC_PATTERNS = {
  light: HAPTIC_LIGHT_DURATION,
  medium: HAPTIC_MEDIUM_DURATION,
  strong: HAPTIC_STRONG_DURATION,
} as const

/**
 * Check if the Vibration API is supported
 */
export function isHapticsSupported(): boolean {
  return typeof navigator !== 'undefined' && 'vibrate' in navigator
}

/**
 * Trigger device vibration with the given pattern
 * Safely handles unsupported environments
 *
 * @param pattern - Vibration duration in ms, or array of [vibrate, pause, vibrate, ...]
 */
export function vibrate(pattern: number | number[]): void {
  if (isHapticsSupported()) {
    navigator.vibrate(pattern)
  }
}
