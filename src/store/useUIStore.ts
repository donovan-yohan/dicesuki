import { create } from 'zustand'

const HAPTIC_STORAGE_KEY = 'hapticFeedbackEnabled'

/**
 * Zustand store for UI settings
 * Manages motion mode, UI visibility, and haptic feedback
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
  }
}))
