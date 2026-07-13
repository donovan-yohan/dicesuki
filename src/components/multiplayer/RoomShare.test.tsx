import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { ThemeContext } from '../../contexts/ThemeContext'
import { useMultiplayerStore } from '../../store/useMultiplayerStore'
import { defaultTheme } from '../../themes/tokens'
import { RoomShare } from './RoomShare'

function renderShare() {
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
      <RoomShare />
    </ThemeContext.Provider>,
  )
}

describe('RoomShare', () => {
  beforeEach(() => {
    useMultiplayerStore.setState({ roomId: 'ROOM42' })
    // Pin a stable origin for the canonical URL.
    window.history.replaceState({}, '', '/room/ROOM42')
  })

  afterEach(() => {
    vi.restoreAllMocks()
    // @ts-expect-error cleanup test override
    delete navigator.clipboard
    // @ts-expect-error cleanup test override
    delete navigator.share
    useMultiplayerStore.getState().reset()
  })

  it('renders copy, share, and QR-toggle controls', () => {
    renderShare()
    expect(screen.getByTestId('room-share-copy')).toBeInTheDocument()
    expect(screen.getByTestId('room-share-share')).toBeInTheDocument()
    expect(screen.getByTestId('room-share-qr-toggle')).toBeInTheDocument()
  })

  it('renders nothing when there is no room id', () => {
    useMultiplayerStore.setState({ roomId: null })
    const { container } = renderShare()
    expect(container.querySelector('[data-testid="room-share"]')).toBeNull()
  })

  it('copies the canonical room link on Copy', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true })

    renderShare()
    fireEvent.click(screen.getByTestId('room-share-copy'))

    await waitFor(() => {
      expect(writeText).toHaveBeenCalledWith(
        `${window.location.origin}/room/ROOM42`,
      )
    })
    expect(await screen.findByText('Link copied!')).toBeInTheDocument()
  })

  it('toggles the QR code into view', () => {
    renderShare()
    expect(screen.queryByTestId('room-qr')).toBeNull()
    fireEvent.click(screen.getByTestId('room-share-qr-toggle'))
    expect(screen.getByTestId('room-qr')).toBeInTheDocument()
  })

  it('labels the share button for native share when supported', () => {
    Object.defineProperty(navigator, 'share', { value: vi.fn(), configurable: true })
    renderShare()
    expect(screen.getByTestId('room-share-share')).toHaveTextContent('Share')
  })
})
