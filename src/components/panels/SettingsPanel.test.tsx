import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ThemeProvider } from '../../contexts/ThemeProvider'
import { useAuthStore } from '../../store/useAuthStore'
import { useSettingsStore } from '../../store/useSettingsStore'
import { useMultiplayerStore } from '../../store/useMultiplayerStore'
import { MemoryRouter } from 'react-router-dom'
import { SettingsPanel } from './SettingsPanel'

vi.mock('../../hooks/useHapticFeedback', () => ({
  useHapticFeedback: () => ({
    isEnabled: false,
    isSupported: true,
    setEnabled: vi.fn(),
  }),
}))

function SettingsJourney() {
  const [open, setOpen] = useState(false)
  return (
    <>
      <button onClick={() => setOpen(true)}>Open Settings</button>
      <SettingsPanel isOpen={open} onClose={() => setOpen(false)} />
    </>
  )
}

describe('SettingsPanel', () => {
  beforeEach(() => {
    localStorage.clear()
    useAuthStore.setState({ isConfigured: false, status: 'guest', economyAccess: false })
    useSettingsStore.setState({ themeId: 'default' })
    useMultiplayerStore.getState().reset()
  })

  it('hands keyboard ownership to the real picker and restores each opener on Escape', async () => {
    const user = userEvent.setup()
    render(<MemoryRouter><ThemeProvider><SettingsJourney /></ThemeProvider></MemoryRouter>)
    const opener = screen.getByRole('button', { name: 'Open Settings' })
    await user.tab()
    expect(opener).toHaveFocus()
    await user.keyboard('{Enter}')
    const settings = screen.getByRole('dialog', { name: 'Settings' })
    expect(settings).toHaveFocus()
    await user.tab()
    expect(screen.getByRole('button', { name: 'Close panel' })).toHaveFocus()
    await user.tab()
    const changeTheme = screen.getByRole('button', { name: /Change Theme/ })
    expect(changeTheme).toHaveFocus()
    await user.keyboard('{Enter}')

    const picker = screen.getByRole('dialog', { name: 'Select Theme' })
    expect(picker).toHaveAttribute('aria-modal', 'true')
    expect(settings).not.toHaveAttribute('aria-modal', 'true')
    expect(settings).toHaveAttribute('inert')
    expect(document.querySelectorAll('[aria-modal="true"]')).toHaveLength(1)
    const close = within(picker).getByRole('button', { name: 'Close theme selector' })
    await waitFor(() => expect(close).toHaveFocus())
    const themes = within(picker).getAllByRole('button').slice(1)
    await user.tab({ shift: true })
    expect(themes[themes.length - 1]).toHaveFocus()
    await user.tab()
    expect(close).toHaveFocus()
    for (const theme of themes) {
      await user.tab()
      expect(theme).toHaveFocus()
    }
    await user.tab()
    expect(close).toHaveFocus()
    expect(screen.getByRole('button', { name: 'Toggle haptic feedback' })).not.toHaveFocus()

    await user.keyboard('{Escape}')
    expect(screen.queryByRole('dialog', { name: 'Select Theme' })).not.toBeInTheDocument()
    expect(settings).toHaveAttribute('aria-modal', 'true')
    expect(settings).not.toHaveAttribute('inert')
    expect(changeTheme).toHaveFocus()
    await user.tab()
    expect(screen.getByRole('button', { name: 'Toggle haptic feedback' })).toHaveFocus()
    await user.keyboard('{Escape}')
    expect(opener).toHaveFocus()
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Settings' })).not.toBeInTheDocument())
  })

  const renderSettingsPanel = () => render(
    <MemoryRouter>
      <ThemeProvider><SettingsPanel isOpen onClose={vi.fn()} /></ThemeProvider>
    </MemoryRouter>,
  )

  it('keeps App install help in the existing Settings panel', () => {
    renderSettingsPanel()
    expect(screen.getByRole('heading', { name: 'App' })).toBeInTheDocument()
  })

  it('no longer hosts the multiplayer entry points (moved to the in-scene panel)', () => {
    renderSettingsPanel()

    // Create/browse a server room now live in the PlayerPanel's solo controls.
    expect(screen.queryByRole('button', { name: /create multiplayer room/i })).toBeNull()
    expect(screen.queryByRole('button', { name: /browse public rooms/i })).toBeNull()
    // The creation-time room-theme picker went with them.
    expect(screen.queryByTestId('room-theme-card-neon-cyber-city')).toBeNull()
  })

  it('exposes appearance settings without the retired artist upload entry point', () => {
    renderSettingsPanel()

    expect(screen.getByRole('button', { name: /change theme/i })).toBeInTheDocument()
    expect(screen.queryByText(/artist testing platform/i)).toBeNull()
    expect(screen.queryByText(/upload and test custom dice models/i)).toBeNull()
  })
})
