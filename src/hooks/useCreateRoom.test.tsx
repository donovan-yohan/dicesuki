import { act, renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useCreateRoom } from './useCreateRoom'
import {
  COLDSTART_DEADLINE_MS,
  COLDSTART_PHASE2_AT_MS,
  COLDSTART_WAKING_BODY,
} from '../lib/coldStartWait'

function useStagedFakeTimers() {
  vi.useFakeTimers({ toFake: ['performance', 'setTimeout', 'clearTimeout'] })
}

const navigateMock = vi.hoisted(() => vi.fn())

vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom')
  return {
    ...actual,
    useNavigate: () => navigateMock,
  }
})

function jsonResponse(body: unknown, init: { ok?: boolean; status?: number } = {}): Response {
  return {
    ok: init.ok ?? true,
    status: init.status ?? 200,
    json: async () => body,
  } as Response
}

describe('useCreateRoom', () => {
  beforeEach(() => {
    navigateMock.mockReset()
    vi.restoreAllMocks()
  })

  it('checks readiness, creates a room, and navigates to it', async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(jsonResponse({ status: 'ok', instanceId: 'srv123' }))
      .mockResolvedValueOnce(jsonResponse({ roomId: 'ABC123' }, { status: 201 }))
    vi.stubGlobal('fetch', fetchMock)

    const { result } = renderHook(() => useCreateRoom())

    await act(async () => {
      await result.current.createRoom()
    })

    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      'http://localhost:8080/health',
      expect.objectContaining({ method: 'GET' }),
    )
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      'http://localhost:8080/api/rooms',
      { method: 'POST' },
    )
    expect(navigateMock).toHaveBeenCalledWith('/room/ABC123')
    expect(result.current.error).toBeNull()
  })

  it('carries a chosen room theme to the room via the theme query param', async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(jsonResponse({ status: 'ok', instanceId: 'srv123' }))
      .mockResolvedValueOnce(jsonResponse({ roomId: 'ABC123' }, { status: 201 }))
    vi.stubGlobal('fetch', fetchMock)

    const { result } = renderHook(() => useCreateRoom({ themeId: 'neon-cyber-city' }))

    await act(async () => {
      await result.current.createRoom()
    })

    expect(navigateMock).toHaveBeenCalledWith('/room/ABC123?theme=neon-cyber-city')
  })

  it('omits the theme param when no theme is chosen', async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(jsonResponse({ status: 'ok', instanceId: 'srv123' }))
      .mockResolvedValueOnce(jsonResponse({ roomId: 'ABC123' }, { status: 201 }))
    vi.stubGlobal('fetch', fetchMock)

    const { result } = renderHook(() => useCreateRoom({ themeId: null }))

    await act(async () => {
      await result.current.createRoom()
    })

    expect(navigateMock).toHaveBeenCalledWith('/room/ABC123')
  })

  it('keeps users on the panel with an actionable port-conflict error', async () => {
    // A wrong /health payload is non-retryable, so this returns immediately.
    vi.stubGlobal('fetch', vi.fn<typeof fetch>().mockResolvedValue(
      jsonResponse({ status: 'ok' }),
    ))

    const { result } = renderHook(() => useCreateRoom())

    await act(async () => {
      await result.current.createRoom()
    })

    expect(navigateMock).not.toHaveBeenCalled()
    expect(result.current.error).toMatchObject({
      kind: 'port-conflict',
      command: null,
    })
  })

  it('keeps users on the panel with an actionable unavailable-server error', async () => {
    useStagedFakeTimers()
    vi.stubGlobal('fetch', vi.fn<typeof fetch>().mockRejectedValue(new TypeError('Failed to fetch')))

    const { result } = renderHook(() => useCreateRoom())

    await act(async () => {
      const pending = result.current.createRoom()
      // The staged wait rides out the full ~3 minute cold-start budget before
      // admitting defeat; flush it so the error surfaces without a wall wait.
      await vi.advanceTimersByTimeAsync(COLDSTART_DEADLINE_MS + 10_000)
      await pending
    })
    vi.useRealTimers()

    expect(navigateMock).not.toHaveBeenCalled()
    expect(result.current.error).toMatchObject({
      kind: 'unavailable',
      command: null,
    })
  })

  it('stays on the plain checking phase for the first 30s, then admits the server is waking', async () => {
    useStagedFakeTimers()
    // Health never answers until we let it; every probe is a cold-start blip.
    vi.stubGlobal('fetch', vi.fn<typeof fetch>().mockResolvedValue(
      jsonResponse({}, { ok: false, status: 503 }),
    ))

    const { result } = renderHook(() => useCreateRoom())

    let pending: Promise<void> | undefined
    await act(async () => {
      pending = result.current.createRoom()
      await vi.advanceTimersByTimeAsync(COLDSTART_PHASE2_AT_MS - 2_000)
    })
    expect(result.current.phase).toBe('checking')
    expect(result.current.wakingMessage).toBeNull()

    await act(async () => {
      await vi.advanceTimersByTimeAsync(3_000)
    })
    expect(result.current.phase).toBe('waking')
    expect(result.current.wakingMessage).toBe(COLDSTART_WAKING_BODY)
    expect(result.current.waitElapsedSeconds).toBeGreaterThanOrEqual(30)

    await act(async () => {
      await vi.advanceTimersByTimeAsync(COLDSTART_DEADLINE_MS)
      await pending
    })
    vi.useRealTimers()
    expect(result.current.error).toMatchObject({ kind: 'unavailable' })
  })

  it('auto-continues into creation the moment a waking server answers', async () => {
    useStagedFakeTimers()
    const wakesAt = performance.now() + COLDSTART_PHASE2_AT_MS + 15_000
    const fetchMock = vi.fn<typeof fetch>().mockImplementation(async (url) => {
      if (String(url).endsWith('/api/rooms')) return jsonResponse({ roomId: 'ABC123' }, { status: 201 })
      return performance.now() >= wakesAt
        ? jsonResponse({ status: 'ok', instanceId: 'srv123' })
        : jsonResponse({}, { ok: false, status: 503 })
    })
    vi.stubGlobal('fetch', fetchMock)

    const { result } = renderHook(() => useCreateRoom())

    await act(async () => {
      const pending = result.current.createRoom()
      // Well short of the 3-minute deadline: no extra click, no hard error.
      await vi.advanceTimersByTimeAsync(COLDSTART_PHASE2_AT_MS + 25_000)
      await pending
    })
    vi.useRealTimers()

    expect(result.current.error).toBeNull()
    expect(navigateMock).toHaveBeenCalledWith('/room/ABC123')
  })

  it('drops a superseded attempt instead of letting it navigate or clobber the phase', async () => {
    useStagedFakeTimers()
    const onRoomCreated = vi.fn()
    // The first attempt clears health and reaches the (slow) create POST; by the
    // time that POST answers, a second createRoom() has taken over the panel.
    let releaseCreate: ((response: Response) => void) | undefined
    let healthIsUp = true
    vi.stubGlobal('fetch', vi.fn<typeof fetch>().mockImplementation(async (url) => {
      if (String(url).endsWith('/api/rooms')) {
        return new Promise<Response>((resolve) => { releaseCreate = resolve })
      }
      return healthIsUp
        ? jsonResponse({ status: 'ok', instanceId: 'srv123' })
        : jsonResponse({}, { ok: false, status: 503 })
    }))

    const { result } = renderHook(() => useCreateRoom({ onRoomCreated }))

    let first: Promise<void> | undefined
    let second: Promise<void> | undefined
    await act(async () => {
      first = result.current.createRoom()
      await vi.advanceTimersByTimeAsync(0)
    })
    expect(result.current.phase).toBe('creating')

    // Re-entry: the second attempt supersedes the first and starts its own wait.
    healthIsUp = false
    await act(async () => {
      second = result.current.createRoom()
      await vi.advanceTimersByTimeAsync(1_000)
    })

    // The stale POST finally answers. It must not stash carry state for a room
    // the user is no longer creating, and must not navigate out from under the
    // live attempt.
    await act(async () => {
      releaseCreate!(jsonResponse({ roomId: 'STALE' }, { status: 201 }))
      await first
      await vi.advanceTimersByTimeAsync(1_000)
    })
    expect(onRoomCreated).not.toHaveBeenCalled()
    expect(navigateMock).not.toHaveBeenCalled()
    // ...and the superseded `finally` must not have returned the panel to idle.
    expect(result.current.isCreating).toBe(true)

    await act(async () => {
      await vi.advanceTimersByTimeAsync(COLDSTART_PHASE2_AT_MS + 5_000)
    })
    expect(result.current.phase).toBe('waking')

    await act(async () => {
      await vi.advanceTimersByTimeAsync(COLDSTART_DEADLINE_MS)
      await second
    })
    vi.useRealTimers()
    expect(result.current.phase).toBe('idle')
    expect(result.current.error).toMatchObject({ kind: 'unavailable' })
  })

  it('does not update state after unmount mid-wait', async () => {
    useStagedFakeTimers()
    vi.stubGlobal('fetch', vi.fn<typeof fetch>().mockRejectedValue(new TypeError('Failed to fetch')))
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})

    const { result, unmount } = renderHook(() => useCreateRoom())

    let pending: Promise<void> | undefined
    await act(async () => {
      pending = result.current.createRoom()
      await vi.advanceTimersByTimeAsync(5_000)
    })

    unmount()
    await act(async () => {
      await vi.advanceTimersByTimeAsync(COLDSTART_DEADLINE_MS + 10_000)
      await pending
    })
    vi.useRealTimers()

    // React logs an "update on unmounted component" style error if we leaked a
    // setState; the abort must have stopped the wait instead.
    expect(consoleError).not.toHaveBeenCalled()
  })
})
