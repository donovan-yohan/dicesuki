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

  it('separates local solo and public multiplayer room actions', () => {
    const createPublicRoom = vi.fn()
    const createLocalSoloRoom = vi.fn()
    useCreateRoomMock
      .mockReturnValueOnce(roomHook({ createRoom: createPublicRoom }))
      .mockReturnValueOnce(roomHook({ createRoom: createLocalSoloRoom }))

    render(<SettingsPanel isOpen onClose={vi.fn()} />)

    fireEvent.click(screen.getByRole('button', { name: /open local solo room/i }))
    fireEvent.click(screen.getByRole('button', { name: /create multiplayer room/i }))

    expect(useCreateRoomMock).toHaveBeenNthCalledWith(1, { themeId: null })
    expect(useCreateRoomMock).toHaveBeenNthCalledWith(2, { mode: 'local-loopback', solo: true })
    expect(createLocalSoloRoom).toHaveBeenCalledOnce()
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

  it('shows actionable local loopback startup guidance when readiness fails', () => {
    useCreateRoomMock
      .mockReturnValueOnce(roomHook())
      .mockReturnValueOnce(roomHook({
        error: {
          kind: 'unavailable',
          title: 'Room server unavailable',
          message: 'Local loopback room server is not reachable at http://127.0.0.1:8080.',
          command: 'npm run dev:local-room',
        },
      }))

    render(<SettingsPanel isOpen onClose={vi.fn()} />)

    expect(screen.getByRole('alert')).toHaveTextContent('Room server unavailable')
    expect(screen.getByRole('alert')).toHaveTextContent('npm run dev:local-room')
  })
})
