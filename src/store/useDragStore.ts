import { create } from 'zustand'

interface DragStore {
  draggedDiceId: string | null
  setDraggedDiceId: (id: string | null) => void
  onDiceDelete?: (id: string) => void
  setOnDiceDelete: (callback: ((id: string) => void) | undefined) => void
}

/**
 * Store for tracking dice drag state and delete interactions
 */
export const useDragStore = create<DragStore>((set) => ({
  draggedDiceId: null,
  setDraggedDiceId: (id) => set({ draggedDiceId: id }),
  onDiceDelete: undefined,
  setOnDiceDelete: (callback) => set({ onDiceDelete: callback }),
}))
