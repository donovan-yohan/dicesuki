import { create } from 'zustand'

/**
 * Zustand store for UI settings
 * Manages debug overlay visibility and motion mode
 */
interface UIStore {
  // Debug overlay visibility
  showDebugOverlay: boolean
  toggleDebugOverlay: () => void

  // Motion mode: when enabled, dice continuously register rolls from device motion
  motionMode: boolean
  toggleMotionMode: () => void
}

export const useUIStore = create<UIStore>((set) => ({
  showDebugOverlay: false,
  toggleDebugOverlay: () => set((state) => ({ showDebugOverlay: !state.showDebugOverlay })),

  motionMode: false,
  toggleMotionMode: () => set((state) => ({ motionMode: !state.motionMode }))
}))
