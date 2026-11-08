import patches from './worldSkinPatches.json'
import type { Theme } from './tokens'

type WorldSkin = keyof typeof patches

/** Paint only. The theme keeps ownership of its environment and dice. */
export function withWorldSkin(theme: Theme, skin: WorldSkin): Theme {
  const patch = patches[skin]
  return {
    ...theme,
    tokens: {
      ...theme.tokens,
      colors: patch.tokens.colors,
      typography: {
        ...theme.tokens.typography,
        fontFamily: patch.tokens.typography.fontFamily,
      },
      effects: patch.tokens.effects,
    },
    assets: { ...theme.assets, icons: patch.assets.icons },
  }
}
