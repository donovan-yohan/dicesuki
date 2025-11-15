import { create } from 'zustand'
import { DiceShape } from '../lib/geometries'

export interface DiceInstance {
  id: string
  type: DiceShape
  position: [number, number, number]
  rotation: [number, number, number]
  color: string
}

interface DiceManagerStore {
  dice: DiceInstance[]
  addDice: (type: DiceShape) => void
  removeDice: (id: string) => void
  removeAllDice: () => void
  updateDicePosition: (id: string, position: [number, number, number]) => void
}

/**
 * Generate random spawn position within viewport bounds
 */
function getRandomSpawnPosition(): [number, number, number] {
  // Spawn within a small area near center
  const x = (Math.random() - 0.5) * 2 // -1 to 1
  const y = 5 // Always spawn at height 5
  const z = (Math.random() - 0.5) * 2 // -1 to 1
  return [x, y, z]
}

/**
 * Generate random rotation
 */
function getRandomRotation(): [number, number, number] {
  return [
    Math.random() * Math.PI * 2,
    Math.random() * Math.PI * 2,
    Math.random() * Math.PI * 2
  ]
}

/**
 * Get color for dice type
 */
function getColorForType(type: DiceShape): string {
  const colors: Record<DiceShape, string> = {
    'd4': '#ff6b6b',
    'd6': '#ffa500',
    'd8': '#4ecdc4',
    'd10': '#95e1d3',
    'd12': '#f38181',
    'd20': '#aa96da'
  }
  return colors[type]
}

export const useDiceManagerStore = create<DiceManagerStore>((set) => ({
  // Start with one D6
  dice: [{
    id: 'dice-0',
    type: 'd6',
    position: [0, 5, 0],
    rotation: [0, 0, 0],
    color: '#ffa500'
  }],

  addDice: (type) => set((state) => ({
    dice: [
      ...state.dice,
      {
        id: `dice-${Date.now()}`,
        type,
        position: getRandomSpawnPosition(),
        rotation: getRandomRotation(),
        color: getColorForType(type)
      }
    ]
  })),

  removeDice: (id) => set((state) => ({
    dice: state.dice.filter(d => d.id !== id)
  })),

  removeAllDice: () => set({ dice: [] }),

  updateDicePosition: (id, position) => set((state) => ({
    dice: state.dice.map(d =>
      d.id === id ? { ...d, position } : d
    )
  }))
}))
