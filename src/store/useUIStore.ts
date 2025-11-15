import { create } from 'zustand'

/**
 * Zustand store for UI settings
 * Manages motion mode and UI visibility
 */
interface UIStore {
  // Motion mode: when enabled, dice continuously register rolls from device motion
  motionMode: boolean
  toggleMotionMode: () => void

  // UI visibility: when hidden, only shows minimal toggle button
  isUIVisible: boolean
  setUIVisible: (visible: boolean) => void
  toggleUIVisibility: () => void
}

export const useUIStore = create<UIStore>((set) => ({
  motionMode: false,
  toggleMotionMode: () => set((state) => ({ motionMode: !state.motionMode })),

  isUIVisible: true,
  setUIVisible: (visible: boolean) => set({ isUIVisible: visible }),
  toggleUIVisibility: () => set((state) => ({ isUIVisible: !state.isUIVisible }))
}))
