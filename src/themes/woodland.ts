import { critterForestTheme, type Theme } from './tokens'
import { withWorldSkin } from './worldSkins'

/** The room chooses the environment, never the appearance of another player's dice. */
export const sunlitGladeTheme: Theme = {
  ...critterForestTheme,
  id: 'sunlit-glade',
  name: 'Sunlit Glade',
  description: 'A leafy forest clearing with wildflowers and warm afternoon sunlight.',
  price: 0,
  category: 'nature',
  tokens: {
    ...critterForestTheme.tokens,
    typography: {
      ...critterForestTheme.tokens.typography,
      fontFamily: { primary: '"Quicksand", "Segoe UI", sans-serif', mono: 'monospace' },
    },
  },
  environment: {
    scene: {
      kind: 'woodland',
      seed: 2718,
      grass: { base: '#42694f', tip: '#9db579' },
      sunlight: '#fff0c2',
      pollen: '#ffe3a0',
    },
    floor: { color: '#567044', material: { roughness: 0.96, metalness: 0 }, receiveShadow: true },
    walls: { color: '#80502c', material: { roughness: 0.8, metalness: 0 }, visible: true, height: 0.45 },
    ceiling: { visible: false },
    lighting: {
      ambient: { color: '#d8edca', intensity: 0.9 },
      directional: { color: '#fff0c2', intensity: 2.2, position: [-4, 10, -6] },
    },
    background: { color: '#182a24' },
  },
}

/** A room-scoped lighting study; personal dice materials remain unchanged. */
export const sunlitGladeCelTheme: Theme = withWorldSkin({
  ...sunlitGladeTheme,
  id: 'sunlit-glade-cel',
  name: 'Sunlit Glade · Cel',
  description: 'Painted forest textures, crisp anime light and drifting seed fluff.',
  environment: {
    ...sunlitGladeTheme.environment,
    scene: {
      ...sunlitGladeTheme.environment.scene!, kind: 'woodland', shading: 'cel',
      sunlight: '#fff0cc', pollen: '#f4cf79',
      grass: { base: '#91ad85', tip: '#c3d19b' },
    },
    floor: { ...sunlitGladeTheme.environment.floor, color: '#91ad85' },
    background: { color: '#486b58' },
    lighting: {
      ambient: { color: '#d1e5dd', intensity: 0.32 },
      directional: { color: '#fff0cc', intensity: 2.4, position: [-4, 10, -6] },
    },
  },
}, 'woodland')
