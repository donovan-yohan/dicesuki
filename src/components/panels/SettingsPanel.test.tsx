import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { SettingsPanel } from './SettingsPanel'

vi.mock('../../hooks/useHapticFeedback', () => ({
  useHapticFeedback: () => ({
    isEnabled: false,
    isSupported: false,
    setEnabled: vi.fn(),
  }),
}))

vi.mock('./FlyoutPanel', () => ({
  FlyoutPanel: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}))

vi.mock('../ThemeSelector', () => ({
  ThemeSelector: () => null,
}))

vi.mock('./artist-tools/ArtistTestingPanel', () => ({
  ArtistTestingPanel: () => null,
}))

describe('SettingsPanel', () => {
  it('no longer hosts the multiplayer entry points (moved to the in-scene panel)', () => {
    render(<SettingsPanel isOpen onClose={vi.fn()} />)

    // Create/browse a server room now live in the PlayerPanel's solo controls.
    expect(screen.queryByRole('button', { name: /create multiplayer room/i })).toBeNull()
    expect(screen.queryByRole('button', { name: /browse public rooms/i })).toBeNull()
    // The creation-time room-theme picker went with them.
    expect(screen.queryByTestId('room-theme-card-neon-cyber-city')).toBeNull()
  })

  it('still exposes appearance and developer settings', () => {
    render(<SettingsPanel isOpen onClose={vi.fn()} />)

    expect(screen.getByRole('button', { name: /change theme/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /artist testing platform/i })).toBeInTheDocument()
  })
})
