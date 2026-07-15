import { create } from 'zustand'
import {
  normalizeViewRotation,
  rotateCW,
  rotateCCW,
  type ViewRotation,
} from '../lib/viewRotation'

const HAPTIC_STORAGE_KEY = 'hapticFeedbackEnabled'
const VIEW_ROTATION_STORAGE_KEY = 'viewRotation'

/**
 * Zustand store for UI settings
 * Manages motion mode, UI visibility, haptic feedback, and view rotation
 */
interface UIStore {
  // Motion mode: when enabled, dice continuously register rolls from device motion
  motionMode: boolean
  toggleMotionMode: () => void

  // UI visibility: when hidden, only shows minimal toggle button
  isUIVisible: boolean
  setUIVisible: (visible: boolean) => void
  toggleUIVisibility: () => void

  // Haptic feedback: when enabled, vibrates on dice collisions
  hapticEnabled: boolean
  setHapticEnabled: (enabled: boolean) => void

  // View rotation: this client's local 90° view of the shared world (ADR 009).
  // Per-device (persisted locally, NOT synced) — a phone's rotation must not
  // rotate the user's desktop.
  viewRotation: ViewRotation
  rotateViewCW: () => void
  rotateViewCCW: () => void
}

export const useUIStore = create<UIStore>((set) => ({
  motionMode: false,
  toggleMotionMode: () => set((state) => ({ motionMode: !state.motionMode })),

  isUIVisible: true,
  setUIVisible: (visible: boolean) => set({ isUIVisible: visible }),
  toggleUIVisibility: () => set((state) => ({ isUIVisible: !state.isUIVisible })),

  // Load haptic setting from localStorage
  hapticEnabled: (() => {
    const stored = localStorage.getItem(HAPTIC_STORAGE_KEY)
    return stored ? stored === 'true' : true
  })(),
  setHapticEnabled: (enabled: boolean) => {
    localStorage.setItem(HAPTIC_STORAGE_KEY, enabled.toString())
    set({ hapticEnabled: enabled })
  },

  // Load persisted view rotation (per device).
  viewRotation: normalizeViewRotation(localStorage.getItem(VIEW_ROTATION_STORAGE_KEY)),
  rotateViewCW: () =>
    set((state) => {
      const next = rotateCW(state.viewRotation)
      localStorage.setItem(VIEW_ROTATION_STORAGE_KEY, String(next))
      return { viewRotation: next }
    }),
  rotateViewCCW: () =>
    set((state) => {
      const next = rotateCCW(state.viewRotation)
      localStorage.setItem(VIEW_ROTATION_STORAGE_KEY, String(next))
      return { viewRotation: next }
    }),
}))
