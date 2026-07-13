/**
 * Sound-effect seam for dice collision feedback.
 *
 * Multiplayer has no client-side physics, so impact SFX are driven by server
 * `dice_knocked` events (see collisionFeedback.ts) rather than local collision
 * callbacks. This module is a self-contained hook point: it synthesizes a short
 * click with the Web Audio API, best-effort and safe in unsupported environments
 * (jsdom/tests, no AudioContext), and is gated behind an opt-in flag so it never
 * surprises users with audio until wired to a UI toggle.
 */

import type { HapticIntensity } from './haptics'

// Opt-in: SFX are silent until explicitly enabled (e.g. by a future settings toggle).
let sfxEnabled = false

/** Lazily-created shared AudioContext; `null` until first use / when unsupported. */
let audioContext: AudioContext | null = null

/** Per-intensity synth parameters: [frequency Hz, gain, duration seconds]. */
const COLLISION_TONE: Record<HapticIntensity, [number, number, number]> = {
  light: [220, 0.05, 0.04],
  medium: [160, 0.09, 0.06],
  strong: [110, 0.14, 0.09],
}

/** Whether collision SFX are currently enabled. */
export function isSfxEnabled(): boolean {
  return sfxEnabled
}

/** Enable or disable collision SFX. */
export function setSfxEnabled(enabled: boolean): void {
  sfxEnabled = enabled
}

/** True when the Web Audio API is available in this environment. */
export function isSfxSupported(): boolean {
  return typeof window !== 'undefined' &&
    ('AudioContext' in window || 'webkitAudioContext' in window)
}

function getAudioContext(): AudioContext | null {
  if (!isSfxSupported()) return null
  if (audioContext) return audioContext
  try {
    const Ctor = window.AudioContext ||
      (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext
    audioContext = new Ctor()
  } catch {
    audioContext = null
  }
  return audioContext
}

/**
 * Play a short collision click for the given impact intensity.
 * No-op when disabled or unsupported; never throws.
 */
export function playCollisionSfx(intensity: HapticIntensity): void {
  if (!sfxEnabled) return
  const ctx = getAudioContext()
  if (!ctx) return

  try {
    const [frequency, gain, duration] = COLLISION_TONE[intensity]
    const now = ctx.currentTime
    const osc = ctx.createOscillator()
    const envelope = ctx.createGain()

    osc.type = 'triangle'
    osc.frequency.setValueAtTime(frequency, now)

    envelope.gain.setValueAtTime(gain, now)
    envelope.gain.exponentialRampToValueAtTime(0.0001, now + duration)

    osc.connect(envelope)
    envelope.connect(ctx.destination)
    osc.start(now)
    osc.stop(now + duration)
  } catch {
    // Best-effort: audio failures must never break gameplay.
  }
}

/** Test-only reset of the cached AudioContext and enabled flag. */
export function __resetSfxForTest(): void {
  audioContext = null
  sfxEnabled = false
}
