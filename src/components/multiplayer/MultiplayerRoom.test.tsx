import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { MemoryRouter, Route, Routes } from 'react-router-dom'

import { MultiplayerRoom } from './MultiplayerRoom'
import { useMultiplayerStore } from '../../store/useMultiplayerStore'
import { usePlayerIdentityStore, DEFAULT_PLAYER_COLOR } from '../../store/usePlayerIdentityStore'

/**
 * Renders the room at a deep link. We stay on the join form (disconnected) for
 * every assertion so the 3D <Scene> never mounts and no real WebSocket opens.
 */
function renderRoom(path = '/room/ROOM42') {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/room/:roomId" element={<MultiplayerRoom />} />
        <Route path="/" element={<div>home</div>} />
      </Routes>
    </MemoryRouter>,
  )
}

describe('MultiplayerRoom join deep-link flow (#78)', () => {
  beforeEach(() => {
    useMultiplayerStore.getState().reset()
    usePlayerIdentityStore.setState({ displayName: '', color: DEFAULT_PLAYER_COLOR })
    localStorage.clear()
  })

  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  it('pre-fills the name from the remembered identity', () => {
    usePlayerIdentityStore.setState({ displayName: 'Frodo', color: '#3B82F6' })
    renderRoom()
    expect(screen.getByPlaceholderText('Display name')).toHaveValue('Frodo')
  })

  it('shows a room-gone notice when the room 404s, without connecting', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 404 }))
    renderRoom()

    fireEvent.change(screen.getByPlaceholderText('Display name'), {
      target: { value: 'Sam' },
    })
    fireEvent.click(screen.getByText('Join'))

    const notice = await screen.findByTestId('join-preflight-notice')
    expect(notice).toHaveTextContent('This room is no longer available')
    // Never transitioned into a connecting state.
    expect(useMultiplayerStore.getState().connectionStatus).toBe('disconnected')
  })

  it('shows a server-down notice when the room server is unreachable', async () => {
    // A non-transient status (500) is not retried, so preflight fails fast and
    // this stays deterministic without waiting out the cold-start backoff (#109).
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 500 }))
    renderRoom()

    fireEvent.change(screen.getByPlaceholderText('Display name'), {
      target: { value: 'Sam' },
    })
    fireEvent.click(screen.getByText('Join'))

    const notice = await screen.findByTestId('join-preflight-notice')
    expect(notice).toHaveTextContent("Can't reach the room server")
  })

  it('remembers the entered name/color across the join attempt', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 404 }))
    renderRoom()

    fireEvent.change(screen.getByPlaceholderText('Display name'), {
      target: { value: '  Pippin  ' },
    })
    fireEvent.click(screen.getByText('Join'))

    await waitFor(() => {
      expect(usePlayerIdentityStore.getState().displayName).toBe('Pippin')
    })
  })
})
