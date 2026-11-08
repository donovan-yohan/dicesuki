import { describe, it, expect, beforeEach } from 'vitest'
import { createElement, type ReactNode } from 'react'
import { act, renderHook } from '@testing-library/react'
import { useEnvironmentTheme } from './useEnvironmentTheme'
import { ThemeProvider } from '../contexts/ThemeProvider'
import { useMultiplayerStore } from '../store/useMultiplayerStore'
import { useSettingsStore } from '../store/useSettingsStore'
import { defaultTheme } from '../themes/tokens'
import { getThemeById } from '../themes/registry'
import { useTheme } from '../contexts/ThemeContext'

// The ThemeProvider resolves its personal theme from the settings store (#82);
// pin it to the dungeon theme so the "personal" fallback is distinguishable
// from the default.
const PERSONAL_THEME_ID = 'monster-dungeon'

function wrapper({ children }: { children: ReactNode }) {
  return createElement(ThemeProvider, null, children)
}

describe('useEnvironmentTheme', () => {
  beforeEach(() => {
    useMultiplayerStore.getState().reset()
    useSettingsStore.setState({ themeId: PERSONAL_THEME_ID })
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

  it('switches room scenery live while retaining the personal UI theme', () => {
    const { result } = renderHook(() => ({ environment: useEnvironmentTheme(), personal: useTheme().currentTheme }), { wrapper })
    act(() => useMultiplayerStore.setState({ roomSettings: { version: 1, themeId: 'sunlit-glade' } }))
    expect(result.current.environment.id).toBe('sunlit-glade-cel')
    expect(result.current.personal.id).toBe(PERSONAL_THEME_ID)
    act(() => useMultiplayerStore.setState({ roomSettings: { version: 1 } }))
    expect(result.current.environment.id).toBe(PERSONAL_THEME_ID)
  })
})
