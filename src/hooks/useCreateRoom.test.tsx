import { act, renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useCreateRoom } from './useCreateRoom'

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
    vi.useFakeTimers()
    vi.stubGlobal('fetch', vi.fn<typeof fetch>().mockRejectedValue(new TypeError('Failed to fetch')))

    const { result } = renderHook(() => useCreateRoom())

    await act(async () => {
      const pending = result.current.createRoom()
      // Public readiness retries a down server through cold starts (#109); flush
      // all backoff waits so the error surfaces without a real 10s wall wait.
      await vi.runAllTimersAsync()
      await pending
    })
    vi.useRealTimers()

    expect(navigateMock).not.toHaveBeenCalled()
    expect(result.current.error).toMatchObject({
      kind: 'unavailable',
      command: null,
    })
  })
})
