import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useCreateRoom, type CreateRoomError } from '../../hooks/useCreateRoom'
import { SettingsPanel } from './SettingsPanel'

const navigateMock = vi.hoisted(() => vi.fn())
vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom')
  return { ...actual, useNavigate: () => navigateMock }
})

vi.mock('../../hooks/useHapticFeedback', () => ({
  useHapticFeedback: () => ({
    isEnabled: false,
    isSupported: false,
    setEnabled: vi.fn(),
  }),
}))

vi.mock('../../hooks/useCreateRoom', () => ({
  useCreateRoom: vi.fn(),
}))

vi.mock('./FlyoutPanel', () => ({
  FlyoutPanel: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}))

vi.mock('../ThemeSelector', () => ({
  ThemeSelector: () => null,
}))

vi.mock('./ArtistTestingPanel', () => ({
  ArtistTestingPanel: () => null,
}))

interface RoomHookState {
  isCreating?: boolean
  error?: CreateRoomError | null
  createRoom?: ReturnType<typeof useCreateRoom>['createRoom']
  clearError?: () => void
}

function roomHook(overrides: RoomHookState = {}): ReturnType<typeof useCreateRoom> {
  return {
    phase: overrides.isCreating ? 'checking' : 'idle',
    isCreating: overrides.isCreating ?? false,
    wakingMessage: null,
    error: overrides.error ?? null,
    createRoom: overrides.createRoom ?? vi.fn(async () => undefined),
    clearError: overrides.clearError ?? vi.fn(),
  }
}

describe('SettingsPanel room server actions', () => {
  const useCreateRoomMock = vi.mocked(useCreateRoom)

  beforeEach(() => {
    useCreateRoomMock.mockReset()
  })

  it('exposes only the public multiplayer create action (solo is the default route)', () => {
    const createPublicRoom = vi.fn()
    useCreateRoomMock.mockReturnValue(roomHook({ createRoom: createPublicRoom }))

    render(<SettingsPanel isOpen onClose={vi.fn()} />)

    // The retired local-loopback solo action is gone; solo now lives on `/`.
    expect(screen.queryByRole('button', { name: /open local solo room/i })).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: /create multiplayer room/i }))

    // The public-room hook is the only room hook, created with the chosen theme.
    expect(useCreateRoomMock).toHaveBeenCalledWith({ themeId: null })
    expect(createPublicRoom).toHaveBeenCalledOnce()
  })

  it('passes the theme chosen from the preview cards to the multiplayer room create hook', () => {
    useCreateRoomMock.mockReturnValue(roomHook())

    render(<SettingsPanel isOpen onClose={vi.fn()} />)

    // Default: no shared room theme picked.
    expect(useCreateRoomMock).toHaveBeenCalledWith({ themeId: null })

    // Act: host picks a theme preview card in the creation flow.
    fireEvent.click(screen.getByTestId('room-theme-card-neon-cyber-city'))

    // The public-room create hook now receives the chosen theme id.
    expect(useCreateRoomMock).toHaveBeenCalledWith({ themeId: 'neon-cyber-city' })
  })

  it('surfaces an actionable error when public room creation fails', () => {
    useCreateRoomMock.mockReturnValue(roomHook({
      error: {
        kind: 'unavailable',
        title: 'Room server unavailable',
        message: 'Public multiplayer server is not reachable at http://localhost:8080.',
        command: null,
      },
    }))

    render(<SettingsPanel isOpen onClose={vi.fn()} />)

    expect(screen.getByRole('alert')).toHaveTextContent('Room server unavailable')
    expect(screen.getByRole('alert')).toHaveTextContent('http://localhost:8080')
  })
})
