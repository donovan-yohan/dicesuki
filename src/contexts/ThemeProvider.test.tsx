import { act, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { useSettingsStore } from '../store/useSettingsStore'
import { defaultTheme } from '../themes/tokens'
import { THEME_REGISTRY } from '../themes/registry'
import { useMultiplayerStore } from '../store/useMultiplayerStore'
import { useEnvironmentTheme } from '../hooks/useEnvironmentTheme'
import { useTheme } from './ThemeContext'
import { ThemeProvider } from './ThemeProvider'

function ThemeControls() {
  const { currentTheme, setTheme } = useTheme()
  const environment = useEnvironmentTheme()

  return (
    <>
      <output data-testid="active-theme">{currentTheme.id}</output>
      <output data-testid="environment-kind">{environment.environment.scene?.kind ?? 'classic'}</output>
      <button onClick={() => setTheme('monster-dungeon')}>Dungeon</button>
      <button onClick={() => setTheme('cyberpunk-cutline')}>Cyberpunk</button>
      <button onClick={() => setTheme('dungeon-castle')}>Legacy dungeon</button>
      <button onClick={() => setTheme('unknown-theme')}>Unknown</button>
    </>
  )
}

describe('ThemeProvider', () => {
  beforeEach(() => {
    localStorage.clear()
    useSettingsStore.setState({ themeId: defaultTheme.id })
    useMultiplayerStore.getState().reset()
  })

  afterEach(() => {
    localStorage.clear()
  })

  it.each([
    ['fantasy-earth', 'sunlit-glade-cel', 'woodland', 'woodland'],
    ['critter-forest', 'sunlit-glade-cel', 'woodland', 'woodland'],
    ['sunlit-glade', 'sunlit-glade-cel', 'woodland', 'woodland'],
    ['dungeon-castle', 'monster-dungeon', 'monster-dungeon', 'monster-dungeon'],
    ['neon-cyber-city', 'cyberpunk-cutline', 'cyberpunk', 'cyberpunk-alley'],
  ])('resolves stored %s to %s paint and environment without rewriting settings', (legacyId, canonicalId, skin, kind) => {
    useSettingsStore.setState({ themeId: legacyId })
    render(<ThemeProvider><ThemeControls /></ThemeProvider>)

    expect(screen.getByTestId('active-theme')).toHaveTextContent(canonicalId)
    expect(screen.getByTestId('environment-kind')).toHaveTextContent(kind)
    expect(document.documentElement.dataset.theme).toBe(canonicalId)
    expect(document.documentElement.dataset.uiSkin).toBe(skin)
    expect(document.documentElement.style.getPropertyValue('--color-surface')).toBe(
      THEME_REGISTRY.find(theme => theme.id === canonicalId)!.tokens.colors.surface,
    )
    expect(useSettingsStore.getState().themeId).toBe(legacyId)
    expect(JSON.parse(localStorage.getItem('dicesuki-settings')!).state.themeId).toBe(legacyId)
  })

  it('resolves remote legacy settings live and keeps unknown settings on Classic', () => {
    render(<ThemeProvider><ThemeControls /></ThemeProvider>)

    act(() => useSettingsStore.setState({ themeId: 'neon-cyber-city' }))
    expect(screen.getByTestId('active-theme')).toHaveTextContent('cyberpunk-cutline')
    expect(document.documentElement.dataset.uiSkin).toBe('cyberpunk')
    expect(screen.getByTestId('environment-kind')).toHaveTextContent('cyberpunk-alley')
    expect(useSettingsStore.getState().themeId).toBe('neon-cyber-city')

    act(() => useSettingsStore.setState({ themeId: 'unknown-remote-theme' }))
    expect(screen.getByTestId('active-theme')).toHaveTextContent('default')
    expect(document.documentElement.dataset.uiSkin).toBe('classic')
    expect(screen.getByTestId('environment-kind')).toHaveTextContent('classic')
    expect(useSettingsStore.getState().themeId).toBe('unknown-remote-theme')
  })

  it('retains legacy and unrelated ownership records when granting current worlds', () => {
    const savedIds = ['default', 'fantasy-earth', 'critter-forest', 'dungeon-castle', 'neon-cyber-city', 'unreleased-owned-theme']
    localStorage.setItem('dicesuki-owned-themes', JSON.stringify(savedIds))

    render(<ThemeProvider><ThemeControls /></ThemeProvider>)

    expect(JSON.parse(localStorage.getItem('dicesuki-owned-themes')!)).toEqual([
      ...savedIds,
      'sunlit-glade-cel',
      'cyberpunk-cutline',
      'monster-dungeon',
    ])
  })

  it('accepts an owned legacy action as a canonical selection but refuses unknown actions', () => {
    render(<ThemeProvider><ThemeControls /></ThemeProvider>)

    fireEvent.click(screen.getByRole('button', { name: 'Legacy dungeon' }))
    expect(screen.getByTestId('active-theme')).toHaveTextContent('monster-dungeon')
    expect(useSettingsStore.getState().themeId).toBe('monster-dungeon')

    fireEvent.click(screen.getByRole('button', { name: 'Unknown' }))
    expect(screen.getByTestId('active-theme')).toHaveTextContent('monster-dungeon')
    expect(useSettingsStore.getState().themeId).toBe('monster-dungeon')
  })

  it.each(THEME_REGISTRY)('publishes $id paint, font and effect roles without changing theme authority', (theme) => {
    useSettingsStore.setState({ themeId: theme.id })
    render(<ThemeProvider><ThemeControls /></ThemeProvider>)
    const root = document.documentElement
    expect(root.dataset.theme).toBe(theme.id)
    expect(root.style.getPropertyValue('--font-family-primary')).toBe(theme.tokens.typography.fontFamily.primary)
    expect(root.style.getPropertyValue('--font-family-mono')).toBe(theme.tokens.typography.fontFamily.mono)
    expect(root.style.getPropertyValue('--border-radius-md')).toBe(theme.tokens.effects.borderRadius.md)
    expect(root.style.getPropertyValue('--gradient-primary')).toBe(theme.tokens.effects.gradients.primary)
    expect(root.style.getPropertyValue('--color-surface')).toBe(theme.tokens.colors.surface)
    expect(root.style.getPropertyValue('--color-on-accent')).toBe(theme.tokens.colors.onAccent)
    const skins: Record<string, string> = {
      'sunlit-glade-cel': 'woodland',
      'cyberpunk-cutline': 'cyberpunk',
      'monster-dungeon': 'monster-dungeon',
    }
    expect(root.dataset.uiSkin).toBe(skins[theme.id] ?? 'classic')
    expect(screen.getByTestId('active-theme')).toHaveTextContent(theme.id)
  })

  it('applies each selected theme immediately', () => {
    render(
      <ThemeProvider>
        <ThemeControls />
      </ThemeProvider>
    )

    fireEvent.click(screen.getByRole('button', { name: 'Dungeon' }))

    expect(screen.getByTestId('active-theme')).toHaveTextContent('monster-dungeon')
    expect(document.documentElement.style.getPropertyValue('--color-background')).not.toBe('')

    fireEvent.click(screen.getByRole('button', { name: 'Cyberpunk' }))

    expect(screen.getByTestId('active-theme')).toHaveTextContent('cyberpunk-cutline')
  })
})
