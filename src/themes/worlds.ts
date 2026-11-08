import { dungeonCastleTheme, neonCyberCityTheme, type Theme } from './tokens'
import { withWorldSkin } from './worldSkins'

export const cyberpunkCutlineTheme: Theme = withWorldSkin({
  ...neonCyberCityTheme,
  id: 'cyberpunk-cutline',
  name: 'Cyberpunk · Cutline',
  description: 'A neon service alley with wet paving and clipped industrial details.',
  price: 0,
  environment: {
    ...neonCyberCityTheme.environment,
    scene: { kind: 'cyberpunk-alley', seed: 41, shading: 'cel' },
    floor: { color: '#293b49', material: { roughness: 0.4, metalness: 0.2 }, receiveShadow: true },
    walls: { ...neonCyberCityTheme.environment.walls, visible: false },
    background: { color: '#080e18' },
    lighting: {
      ambient: { color: '#9bb4cc', intensity: 0.08 },
      directional: { color: '#b0c8e4', intensity: 0.2, position: [-4, 10, 3] },
    },
  },
}, 'cyberpunk')

export const monsterDungeonTheme: Theme = withWorldSkin({
  ...dungeonCastleTheme,
  id: 'monster-dungeon',
  name: 'Monster Dungeon',
  description: 'An aged crypt of stone, iron chains, moss and warm torchlight.',
  price: 0,
  environment: {
    ...dungeonCastleTheme.environment,
    scene: { kind: 'monster-dungeon', seed: 41, shading: 'cel' },
    floor: { color: '#4b565b', material: { roughness: 0.94, metalness: 0 }, receiveShadow: true },
    walls: { ...dungeonCastleTheme.environment.walls, visible: false },
    background: { color: '#101b22' },
    lighting: {
      // Readable game darkness: real room fill, with warm local torch contrast.
      ambient: { color: '#e5dccf', intensity: 0.75 },
      directional: { color: '#ffe1b5', intensity: 0.24, position: [-4, 10, -6] },
    },
  },
}, 'monster-dungeon')
