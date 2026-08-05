import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { MemoryRouter, Route, Routes } from 'react-router-dom'

import { MultiplayerRoom } from './MultiplayerRoom'
import { useMultiplayerStore } from '../../store/useMultiplayerStore'
import { usePlayerIdentityStore, DEFAULT_PLAYER_COLOR } from '../../store/usePlayerIdentityStore'
import type { EngineConfig } from '../../lib/multiplayerMessages'

vi.mock('../Scene', () => ({
  default: ({ onReady }: { onReady?: () => void }) => (
    <button type="button" data-testid="mock-scene" onClick={onReady}>
      Render first frame
    </button>
  ),
}))

function engineConfig(): EngineConfig {
  return { arenaHalfX: 4.5, arenaHalfZ: 8 } as unknown as EngineConfig
}

/**
 * Renders the room at a deep link. Scene is mocked so startup-gate tests can
 * control the first rendered frame without mounting WebGL.
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

  it('keeps the branded splash through room state and the first scene frame', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, status: 200 }))
    vi.stubGlobal('WebSocket', class {
      readyState = 0
      onopen = null
      onmessage = null
      onerror = null
      onclose = null
      send = vi.fn()
      close = vi.fn()
    })

    renderRoom()
    fireEvent.change(screen.getByPlaceholderText('Display name'), {
      target: { value: 'Sam' },
    })
    fireEvent.click(screen.getByText('Join'))

    await waitFor(() => {
      expect(screen.getByTestId('startup-splash')).toHaveAttribute('data-phase', 'multiplayer')
    })

    act(() => {
      useMultiplayerStore.setState({
        connectionStatus: 'connected',
        localPlayerId: null,
        engineConfig: null,
      })
    })
    expect(screen.getByTestId('startup-splash')).toHaveAttribute('data-phase', 'room')
    expect(screen.queryByTestId('mock-scene')).not.toBeInTheDocument()

    act(() => useMultiplayerStore.setState({ localPlayerId: 'player-1' }))
    expect(screen.queryByTestId('mock-scene')).not.toBeInTheDocument()

    act(() => useMultiplayerStore.setState({ engineConfig: engineConfig() }))
    expect(screen.getByTestId('mock-scene')).toBeInTheDocument()
    expect(screen.getByTestId('startup-splash')).toHaveAttribute('data-phase', 'rendering')

    fireEvent.click(screen.getByTestId('mock-scene'))
    expect(screen.getByTestId('startup-splash')).toHaveAttribute('data-phase', 'ready')
    await waitFor(() => {
      expect(screen.queryByTestId('startup-splash')).not.toBeInTheDocument()
    })
  })
})
