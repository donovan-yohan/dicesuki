/**
 * useThemedAsset Hook
 *
 * Convenience hook for accessing themed assets in components.
 * Provides easy access to icons, backgrounds, and other theme-specific assets.
 */

import { useTheme } from '../contexts/ThemeContext'

export function useThemedAsset() {
  const { currentTheme } = useTheme()

  return {
    // Asset getters
    icons: currentTheme.assets.icons,
    navbar: currentTheme.assets.ui.navbar,
    buttons: currentTheme.assets.ui.buttons,
    backgrounds: currentTheme.assets.backgrounds,
    sounds: currentTheme.assets.sounds,

    // Convenience methods
    getIcon: (name: keyof typeof currentTheme.assets.icons) => {
      return currentTheme.assets.icons[name]
    },

    getNavbarBackground: () => {
      return currentTheme.assets.ui.navbar.background
    },

    getNavbarPattern: () => {
      return currentTheme.assets.ui.navbar.pattern
    },

    getButtonBackground: (type: 'primary' | 'secondary') => {
      return currentTheme.assets.ui.buttons[type]
    },

    getBackground: (type: 'main' | 'dice') => {
      return currentTheme.assets.backgrounds[type]
    },

    // Check if asset exists
    hasAsset: (path: string | null | undefined): path is string => {
      return path !== null && path !== undefined && path.length > 0
    },
  }
}

/**
 * Example usage:
 *
 * ```tsx
 * function MyComponent() {
 *   const { getIcon, hasAsset, navbar } = useThemedAsset()
 *
 *   const rollIcon = getIcon('roll')
 *   const navBg = navbar.background
 *
 *   return (
 *     <div>
 *       <img src={rollIcon} alt="Roll" />
 *       {hasAsset(navBg) && (
 *         <div style={{ backgroundImage: `url(${navBg})` }} />
 *       )}
 *     </div>
 *   )
 * }
 * ```
 */
