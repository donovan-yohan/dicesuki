import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { MemoryRouter, Route, Routes } from 'react-router-dom'

import { MultiplayerRoom } from './MultiplayerRoom'
import { useMultiplayerStore } from '../../store/useMultiplayerStore'
import { usePlayerIdentityStore, DEFAULT_PLAYER_COLOR } from '../../store/usePlayerIdentityStore'
import { useAuthStore } from '../../store/useAuthStore'
import { saveRoomSession } from '../../lib/roomSession'
import {
  COLDSTART_DEADLINE_MS,
  COLDSTART_PHASE2_AT_MS,
  COLDSTART_WAKING_TITLE,
} from '../../lib/coldStartWait'

/** Fakes the wait's clock and its sleeps together (Frontend-ADR-004). */
function useStagedFakeTimers() {
  vi.useFakeTimers({ toFake: ['performance', 'setTimeout', 'clearTimeout'] })
}

/** Minimal WebSocket stand-in so `connect()` never opens a real socket. */
class StubSocket {
  static OPEN = 1
  readyState = 0
  onopen = null
  onmessage = null
  onerror = null
  onclose = null
  send() {}
  close() {}
}

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
    vi.useRealTimers()
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

  it('preflights and resumes the saved session for this exact room route', async () => {
    saveRoomSession({
      roomId: 'ROOM42',
      displayName: 'Merry',
      color: '#123456',
      reconnectToken: '12345678-1234-4234-9234-123456789abc',
    })
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, status: 200 }))
    vi.stubGlobal('WebSocket', StubSocket)

    renderRoom()

    await waitFor(() => {
      expect(useMultiplayerStore.getState().lastJoin).toMatchObject({
        roomId: 'ROOM42',
        displayName: 'Merry',
        token: '12345678-1234-4234-9234-123456789abc',
      })
    })
  })

  it('keeps the plain checking copy for 30s, then switches to cold-start copy', async () => {
    useStagedFakeTimers()
    // 503 for the whole wait: a sleeping Render container, not a dead server.
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 503 }))
    renderRoom()

    fireEvent.change(screen.getByPlaceholderText('Display name'), { target: { value: 'Sam' } })
    fireEvent.click(screen.getByText('Join'))

    await act(async () => {
      await vi.advanceTimersByTimeAsync(COLDSTART_PHASE2_AT_MS - 2_000)
    })
    // Phase 1: ordinary connecting UI, no alarming copy, no error.
    expect(screen.queryByTestId('join-waking-notice')).toBeNull()
    expect(screen.queryByTestId('join-preflight-notice')).toBeNull()
    expect(screen.getByText('Checking…')).toBeInTheDocument()

    await act(async () => {
      await vi.advanceTimersByTimeAsync(3_000)
    })
    // Phase 2: honest cold-start copy plus an elapsed hint.
    const notice = screen.getByTestId('join-waking-notice')
    expect(notice).toHaveTextContent(COLDSTART_WAKING_TITLE)
    expect(notice).toHaveTextContent('Free hosting naps when idle')
    expect(notice).toHaveTextContent(/\d+s elapsed/)
    expect(screen.queryByTestId('join-preflight-notice')).toBeNull()
  })

  it('joins automatically when the server wakes mid phase 2, with no extra click', async () => {
    useStagedFakeTimers()
    vi.stubGlobal('WebSocket', StubSocket)
    const wakesAt = performance.now() + COLDSTART_PHASE2_AT_MS + 15_000
    vi.stubGlobal('fetch', vi.fn().mockImplementation(async () =>
      performance.now() >= wakesAt ? { ok: true, status: 200 } : { ok: false, status: 503 },
    ))
    renderRoom()

    fireEvent.change(screen.getByPlaceholderText('Display name'), { target: { value: 'Sam' } })
    fireEvent.click(screen.getByText('Join'))

    await act(async () => {
      await vi.advanceTimersByTimeAsync(COLDSTART_PHASE2_AT_MS + 25_000)
    })

    expect(useMultiplayerStore.getState().lastJoin).toMatchObject({ roomId: 'ROOM42', displayName: 'Sam' })
    expect(screen.queryByTestId('join-preflight-notice')).toBeNull()
  })

  it('counts a per-attempt timeout as still-waking rather than a hard failure', async () => {
    useStagedFakeTimers()
    // A cold container that accepts the connection and never answers: each probe
    // only settles when its own abort budget expires.
    vi.stubGlobal('fetch', vi.fn().mockImplementation((_url: string, init?: RequestInit) =>
      new Promise((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () =>
          reject(new DOMException('Aborted', 'AbortError')),
        )
      }),
    ))
    renderRoom()

    fireEvent.change(screen.getByPlaceholderText('Display name'), { target: { value: 'Sam' } })
    fireEvent.click(screen.getByText('Join'))

    await act(async () => {
      await vi.advanceTimersByTimeAsync(COLDSTART_PHASE2_AT_MS + 20_000)
    })

    expect(screen.getByTestId('join-waking-notice')).toBeInTheDocument()
    expect(screen.queryByTestId('join-preflight-notice')).toBeNull()
  })

  it('does not update state after unmounting mid-wait', async () => {
    useStagedFakeTimers()
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 503 }))
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
    const { unmount } = renderRoom()

    fireEvent.change(screen.getByPlaceholderText('Display name'), { target: { value: 'Sam' } })
    fireEvent.click(screen.getByText('Join'))
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5_000)
    })

    unmount()
    await act(async () => {
      await vi.advanceTimersByTimeAsync(COLDSTART_DEADLINE_MS + 10_000)
    })

    expect(consoleError).not.toHaveBeenCalled()
  })

  it('shows the cold-start server-down copy after the full staged wait', async () => {
    useStagedFakeTimers()
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')))
    renderRoom()

    fireEvent.change(screen.getByPlaceholderText('Display name'), { target: { value: 'Sam' } })
    fireEvent.click(screen.getByText('Join'))

    await act(async () => {
      await vi.advanceTimersByTimeAsync(COLDSTART_DEADLINE_MS + 10_000)
    })

    expect(screen.getByTestId('join-preflight-notice')).toHaveTextContent(
      "Can't reach the room server",
    )
    expect(useMultiplayerStore.getState().connectionStatus).toBe('disconnected')
  })

  it('shows the host-supplied removal reason on the join surface', () => {
    useMultiplayerStore.setState({
      connectionStatus: 'disconnected',
      removedFromRoomNotice: 'The host removed you from the room.',
    })
    renderRoom()
    expect(screen.getByTestId('removed-from-room-notice')).toHaveTextContent(
      'The host removed you from the room.',
    )
  })
})

describe('MultiplayerRoom join-phase server errors (#264)', () => {
  beforeEach(() => {
    useMultiplayerStore.getState().reset()
    usePlayerIdentityStore.setState({ displayName: '', color: DEFAULT_PLAYER_COLOR })
    useAuthStore.setState({ status: 'guest' })
    localStorage.clear()
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  /**
   * Join a room and land on the "preparing your room" loader, exactly where the
   * bug left players stranded: socket open, `room_state` not yet received.
   */
  async function joinIntoLoadingState() {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, status: 200 }))
    vi.stubGlobal('WebSocket', StubSocket)
    vi.spyOn(console, 'error').mockImplementation(() => {})
    renderRoom()

    fireEvent.change(screen.getByPlaceholderText('Display name'), { target: { value: 'Sam' } })
    fireEvent.click(screen.getByText('Join'))

    await waitFor(() => {
      expect(useMultiplayerStore.getState().lastJoin).toMatchObject({ roomId: 'ROOM42' })
    })
    // The join form is gone: only the branded loader is on screen.
    await waitFor(() => {
      expect(screen.queryByPlaceholderText('Display name')).toBeNull()
    })
  }

  /** Deliver a server `error` on the still-open, not-yet-joined socket. */
  function rejectJoin(code: string, message: string) {
    act(() => {
      useMultiplayerStore.setState({ connectionStatus: 'connected', localPlayerId: null })
      useMultiplayerStore.getState().handleServerMessage({ type: 'error', code, message })
    })
  }

  it('resolves the loader into stale-session copy when the token is rejected', async () => {
    await joinIntoLoadingState()

    rejectJoin('AUTH_INVALID', 'Authentication token is invalid or expired')

    const notice = await screen.findByTestId('join-auth-notice')
    expect(notice).toHaveTextContent('Your session has expired')
    expect(notice).toHaveTextContent('Sign out and sign back in')
    // Distinct from room-gone / server-down, and retryable.
    expect(screen.queryByTestId('join-preflight-notice')).toBeNull()
    expect(screen.getByText('Try Again')).toBeInTheDocument()
  })

  it('asks an unauthenticated player to sign in, with no sign-out to offer', async () => {
    // AUTH_REQUIRED is the opposite problem from a stale token: there is no
    // session to discard, so "sign out" would be a dead end.
    const signOut = vi.fn().mockResolvedValue(undefined)
    useAuthStore.setState({ status: 'authenticated', signOut })
    await joinIntoLoadingState()

    rejectJoin('AUTH_REQUIRED', 'Authentication required to join this room')

    const notice = await screen.findByTestId('join-auth-notice')
    expect(notice).toHaveTextContent('Sign in to join this room')
    expect(notice).not.toHaveTextContent('Your session has expired')
    expect(screen.queryByTestId('join-auth-sign-out')).toBeNull()
    expect(screen.getByText('Try Again')).toBeInTheDocument()
  })

  it('resolves the loader for a generic error code too, rather than spinning', async () => {
    await joinIntoLoadingState()

    rejectJoin('ROOM_FULL', 'Room is full (8/8 players)')

    const notice = await screen.findByTestId('join-connection-notice')
    expect(notice).toHaveTextContent('Connection failed')
    expect(notice).toHaveTextContent('Room is full (8/8 players)')
    expect(screen.queryByTestId('join-auth-notice')).toBeNull()
  })

  it('retries the join from the error state', async () => {
    await joinIntoLoadingState()
    rejectJoin('AUTH_REQUIRED', 'Authentication required to join this room')
    await screen.findByTestId('join-auth-notice')
    // failJoin parked the connection: socket dropped, auto-reconnect suppressed.
    expect(useMultiplayerStore.getState().socket).toBeNull()
    expect(useMultiplayerStore.getState().intentionalDisconnect).toBe(true)

    fireEvent.click(screen.getByText('Try Again'))

    await waitFor(() => {
      expect(useMultiplayerStore.getState().connectionErrorCode).toBeNull()
      expect(useMultiplayerStore.getState().lastJoin).toMatchObject({ roomId: 'ROOM42' })
    })
    const state = useMultiplayerStore.getState()
    // Not just cleared state: a socket is genuinely being opened again, and the
    // suppression failJoin set is lifted so a later drop can auto-reconnect.
    expect(state.intentionalDisconnect).toBe(false)
    expect(state.socket).not.toBeNull()
    expect(state.connectionStatus).toBe('connecting')
    expect(screen.queryByTestId('join-auth-notice')).toBeNull()
  })

  it('offers sign-out only to a signed-in player', async () => {
    const signOut = vi.fn().mockResolvedValue(undefined)
    useAuthStore.setState({ status: 'authenticated', signOut })
    await joinIntoLoadingState()

    rejectJoin('AUTH_INVALID', 'Authentication token is invalid or expired: InvalidAlgorithm')

    fireEvent.click(await screen.findByTestId('join-auth-sign-out'))
    expect(signOut).toHaveBeenCalled()
  })

  it('hides the sign-out affordance for a guest', async () => {
    await joinIntoLoadingState()

    rejectJoin('AUTH_INVALID', 'Authentication token is invalid or expired')

    await screen.findByTestId('join-auth-notice')
    expect(screen.queryByTestId('join-auth-sign-out')).toBeNull()
  })
})
