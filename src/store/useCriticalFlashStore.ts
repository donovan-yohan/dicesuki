import { create } from 'zustand'
import type { CriticalScreenFlash } from '../themes/tokens'

interface CriticalFlashState {
  flashConfig: CriticalScreenFlash | null
  trigger: number // Incrementing counter to trigger flash
  triggerFlash: (config: CriticalScreenFlash) => void
}

/**
 * Store for managing critical screen flash effects
 * Dice components can trigger flashes by calling triggerFlash
 */
export const useCriticalFlashStore = create<CriticalFlashState>((set) => ({
  flashConfig: null,
  trigger: 0,

  triggerFlash: (config: CriticalScreenFlash) => {
    set((state) => ({
      flashConfig: config,
      trigger: state.trigger + 1,
    }))
  },
}))
