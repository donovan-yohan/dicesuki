import { describe, it, expect, beforeEach } from 'vitest'
import { createElement, type ReactNode } from 'react'
import { renderHook } from '@testing-library/react'
import { useEnvironmentTheme } from './useEnvironmentTheme'
import { ThemeProvider } from '../contexts/ThemeProvider'
import { useMultiplayerStore } from '../store/useMultiplayerStore'
import { defaultTheme } from '../themes/tokens'
import { getThemeById } from '../themes/registry'

// The ThemeProvider seeds its personal theme from localStorage; pin it to the
// fantasy theme so the "personal" fallback is distinguishable from the default.
const PERSONAL_THEME_ID = 'fantasy-earth'

function wrapper({ children }: { children: ReactNode }) {
  return createElement(ThemeProvider, null, children)
}

describe('useEnvironmentTheme', () => {
  beforeEach(() => {
    useMultiplayerStore.getState().reset()
    localStorage.setItem('dicesuki-current-theme', PERSONAL_THEME_ID)
  })

  it('uses the player personal theme when no room theme is set (solo / local)', () => {
    useMultiplayerStore.setState({ roomSettings: { version: 1 } })
    const { result } = renderHook(() => useEnvironmentTheme(), { wrapper })
    expect(result.current.id).toBe(PERSONAL_THEME_ID)
  })

  it('applies the shared room theme, overriding the personal theme', () => {
    useMultiplayerStore.setState({
      roomSettings: { version: 1, themeId: 'neon-cyber-city' },
    })
    const { result } = renderHook(() => useEnvironmentTheme(), { wrapper })
    expect(result.current).toBe(getThemeById('neon-cyber-city'))
  })

  it('falls back to the default theme for an unknown room theme id', () => {
    useMultiplayerStore.setState({
      roomSettings: { version: 1, themeId: 'no-such-theme' },
    })
    const { result } = renderHook(() => useEnvironmentTheme(), { wrapper })
    expect(result.current).toBe(defaultTheme)
  })
})
