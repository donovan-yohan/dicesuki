import { describe, it, expect, beforeEach, vi } from 'vitest'
import {
  impactSpeedToIntensity,
  triggerCollisionFeedback,
  __resetCollisionFeedbackForTest,
} from './collisionFeedback'
import { HAPTIC_PATTERNS } from './haptics'
import {
  COLLISION_IMPACT_MEDIUM_SPEED,
  COLLISION_IMPACT_STRONG_SPEED,
  HAPTIC_THROTTLE_MS,
} from '../config/physicsConfig'
import { useUIStore } from '../store/useUIStore'
import { __resetSfxForTest, setSfxEnabled, playCollisionSfx } from './soundEffects'

describe('collisionFeedback', () => {
  beforeEach(() => {
    __resetCollisionFeedbackForTest()
    __resetSfxForTest()
    useUIStore.getState().setHapticEnabled(true)
    vi.restoreAllMocks()
    // Provide a vibrate stub so haptics are considered supported.
    Object.defineProperty(navigator, 'vibrate', {
      value: vi.fn(),
      configurable: true,
      writable: true,
    })
  })

  describe('impactSpeedToIntensity', () => {
    it('maps sub-medium speeds to light', () => {
      expect(impactSpeedToIntensity(COLLISION_IMPACT_MEDIUM_SPEED - 0.1)).toBe('light')
      expect(impactSpeedToIntensity(0.6)).toBe('light')
    })

    it('maps medium-range speeds to medium', () => {
      expect(impactSpeedToIntensity(COLLISION_IMPACT_MEDIUM_SPEED)).toBe('medium')
      expect(impactSpeedToIntensity(COLLISION_IMPACT_STRONG_SPEED - 0.1)).toBe('medium')
    })

    it('maps hard hits to strong', () => {
      expect(impactSpeedToIntensity(COLLISION_IMPACT_STRONG_SPEED)).toBe('strong')
      expect(impactSpeedToIntensity(COLLISION_IMPACT_STRONG_SPEED + 10)).toBe('strong')
    })
  })

  describe('triggerCollisionFeedback', () => {
    it('vibrates with the intensity-matched pattern when haptics are enabled', () => {
      triggerCollisionFeedback(COLLISION_IMPACT_STRONG_SPEED)
      expect(navigator.vibrate).toHaveBeenCalledWith(HAPTIC_PATTERNS.strong)
    })

    it('does not vibrate when haptics are disabled', () => {
      useUIStore.getState().setHapticEnabled(false)
      triggerCollisionFeedback(10)
      expect(navigator.vibrate).not.toHaveBeenCalled()
    })

    it('throttles rapid successive collisions', () => {
      triggerCollisionFeedback(10)
      triggerCollisionFeedback(10)
      expect(navigator.vibrate).toHaveBeenCalledTimes(1)
    })

    it('allows another collision after the throttle window', () => {
      const nowSpy = vi.spyOn(performance, 'now')
      nowSpy.mockReturnValue(1000)
      triggerCollisionFeedback(10)
      nowSpy.mockReturnValue(1000 + HAPTIC_THROTTLE_MS + 1)
      triggerCollisionFeedback(10)
      expect(navigator.vibrate).toHaveBeenCalledTimes(2)
    })
  })

  describe('playCollisionSfx seam', () => {
    it('is a no-op when SFX are disabled (default)', () => {
      // Should not throw even without an AudioContext.
      expect(() => playCollisionSfx('strong')).not.toThrow()
    })

    it('is safe to enable in environments without Web Audio', () => {
      setSfxEnabled(true)
      expect(() => playCollisionSfx('medium')).not.toThrow()
    })
  })
})
