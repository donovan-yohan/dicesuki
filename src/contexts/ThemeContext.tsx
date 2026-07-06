import { createContext, useContext } from 'react'
import type { Theme } from '../themes/tokens'

export interface ThemeContextValue {
  currentTheme: Theme
  setTheme: (themeId: string) => boolean
  availableThemes: Theme[]
  ownedThemes: string[]
  purchaseTheme: (themeId: string) => Promise<boolean>
}

export const ThemeContext = createContext<ThemeContextValue | null>(null)

export function useTheme() {
  const context = useContext(ThemeContext)
  if (!context) {
    throw new Error('useTheme must be used within ThemeProvider')
  }
  return context
}
