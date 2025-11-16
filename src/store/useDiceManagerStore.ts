import { create } from 'zustand'
import { DiceShape } from '../lib/geometries'
import { getThemeById } from '../themes/registry'

export interface DiceInstance {
  id: string
  type: DiceShape
  position: [number, number, number]
  rotation: [number, number, number]
  color: string
}

interface DiceManagerStore {
  dice: DiceInstance[]
  addDice: (type: DiceShape, themeId?: string) => void
  removeDice: (id: string) => void
  removeAllDice: () => void
  updateDicePosition: (id: string, position: [number, number, number]) => void
  updateDiceColors: (themeId: string) => void
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
 * Get color for dice type from current theme
 */
function getColorForType(type: DiceShape, themeId: string = 'default'): string {
  const theme = getThemeById(themeId)
  if (theme && theme.dice.defaultColors[type]) {
    return theme.dice.defaultColors[type]
  }

  // Fallback colors if theme not found (should never happen)
  const fallbackColors: Record<DiceShape, string> = {
    'd4': '#ef4444',
    'd6': '#3b82f6',
    'd8': '#10b981',
    'd10': '#f59e0b',
    'd12': '#8b5cf6',
    'd20': '#ec4899'
  }
  return fallbackColors[type]
}

export const useDiceManagerStore = create<DiceManagerStore>((set) => ({
  // Start with one D6 - color will be updated when theme loads
  dice: [{
    id: 'dice-0',
    type: 'd6',
    position: [0, 5, 0],
    rotation: [0, 0, 0],
    color: getColorForType('d6', 'default')
  }],

  addDice: (type, themeId = 'default') => set((state) => ({
    dice: [
      ...state.dice,
      {
        id: `dice-${Date.now()}`,
        type,
        position: getRandomSpawnPosition(),
        rotation: getRandomRotation(),
        color: getColorForType(type, themeId)
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
  })),

  updateDiceColors: (themeId) => set((state) => ({
    dice: state.dice.map(d => ({
      ...d,
      color: getColorForType(d.type, themeId)
    }))
  }))
}))
