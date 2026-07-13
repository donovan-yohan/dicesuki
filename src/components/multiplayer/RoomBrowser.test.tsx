import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { ThemeContext } from '../../contexts/ThemeContext'
import { defaultTheme } from '../../themes/tokens'
import type { UsePublicRoomsResult } from '../../hooks/usePublicRooms'
import { RoomBrowser } from './RoomBrowser'

const navigateMock = vi.hoisted(() => vi.fn())
vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom')
  return { ...actual, useNavigate: () => navigateMock }
})

const usePublicRoomsMock = vi.hoisted(() => vi.fn())
vi.mock('../../hooks/usePublicRooms', () => ({
  usePublicRooms: () => usePublicRoomsMock(),
}))

function result(overrides: Partial<UsePublicRoomsResult> = {}): UsePublicRoomsResult {
  return {
    rooms: [],
    page: 0,
    pageSize: 20,
    total: 0,
    isLoading: false,
    error: null,
    refresh: vi.fn(),
    nextPage: vi.fn(),
    prevPage: vi.fn(),
    hasNextPage: false,
    hasPrevPage: false,
    ...overrides,
  }
}

function renderBrowser() {
  return render(
    <ThemeContext.Provider
      value={{
        currentTheme: defaultTheme,
        setTheme: vi.fn(),
        availableThemes: [defaultTheme],
        ownedThemes: [defaultTheme.id],
        purchaseTheme: vi.fn(async () => true),
      }}
    >
      <RoomBrowser />
    </ThemeContext.Provider>,
  )
}

describe('RoomBrowser', () => {
  beforeEach(() => {
    navigateMock.mockReset()
    usePublicRoomsMock.mockReset()
  })

  it('renders public rooms with name, theme, and player count', () => {
    usePublicRoomsMock.mockReturnValue(
      result({
        rooms: [
          { roomId: 'abc123', name: 'Poker Night', playerCount: 3, themeId: 'neon' },
          { roomId: 'xyz789', name: null, playerCount: 1, themeId: null },
        ],
        total: 2,
      }),
    )
    renderBrowser()

    expect(screen.getByText('Poker Night')).toBeInTheDocument()
    expect(screen.getByText('neon')).toBeInTheDocument()
    expect(screen.getByText(/3 players/)).toBeInTheDocument()
    // Unnamed room falls back to its id.
    expect(screen.getByText('xyz789')).toBeInTheDocument()
    expect(screen.getByText(/1 player$/)).toBeInTheDocument()
  })

  it('navigates to the room on Join', () => {
    usePublicRoomsMock.mockReturnValue(
      result({
        rooms: [{ roomId: 'abc123', name: 'Poker Night', playerCount: 3, themeId: null }],
        total: 1,
      }),
    )
    renderBrowser()

    fireEvent.click(screen.getByRole('button', { name: 'Join Poker Night' }))
    expect(navigateMock).toHaveBeenCalledWith('/room/abc123')
  })

  it('shows an empty state when there are no public rooms', () => {
    usePublicRoomsMock.mockReturnValue(result())
    renderBrowser()

    expect(screen.getByTestId('room-browser-empty')).toBeInTheDocument()
    expect(screen.getByText(/No public rooms right now/)).toBeInTheDocument()
  })

  it('surfaces a load error', () => {
    usePublicRoomsMock.mockReturnValue(result({ error: 'Could not load public rooms: boom' }))
    renderBrowser()

    expect(screen.getByRole('alert')).toHaveTextContent('Could not load public rooms: boom')
  })

  it('paginates via next/prev when more pages exist', () => {
    const nextPage = vi.fn()
    usePublicRoomsMock.mockReturnValue(
      result({
        rooms: [{ roomId: 'r1', name: null, playerCount: 1, themeId: null }],
        total: 40,
        hasNextPage: true,
        nextPage,
      }),
    )
    renderBrowser()

    fireEvent.click(screen.getByRole('button', { name: 'Next' }))
    expect(nextPage).toHaveBeenCalled()
  })
})
