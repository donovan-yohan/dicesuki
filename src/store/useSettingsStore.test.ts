import { beforeEach, describe, expect, it } from 'vitest'
import { useSettingsStore } from './useSettingsStore'
import { defaultTheme } from '../themes/tokens'

describe('useSettingsStore', () => {
  beforeEach(() => {
    localStorage.clear()
    useSettingsStore.setState({ themeId: defaultTheme.id })
  })

  it('defaults to the default theme id', () => {
    expect(useSettingsStore.getState().themeId).toBe(defaultTheme.id)
  })

  it('updates the selected theme id via setThemeId', () => {
    useSettingsStore.getState().setThemeId('neon-cyber-city')
    expect(useSettingsStore.getState().themeId).toBe('neon-cyber-city')
  })

  it('persists the selected theme id to localStorage', () => {
    useSettingsStore.getState().setThemeId('dungeon-castle')
    const raw = localStorage.getItem('dicesuki-settings')
    expect(raw).toBeTruthy()
    expect(JSON.parse(raw!).state.themeId).toBe('dungeon-castle')
  })
})
