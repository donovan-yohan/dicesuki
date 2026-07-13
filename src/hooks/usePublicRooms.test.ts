import { act, renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { usePublicRooms } from './usePublicRooms'

function jsonResponse(body: unknown, init: { ok?: boolean; status?: number } = {}): Response {
  return {
    ok: init.ok ?? true,
    status: init.status ?? 200,
    json: async () => body,
  } as Response
}

const page = (rooms: unknown[], total: number, p = 0, pageSize = 20) => ({
  rooms,
  page: p,
  pageSize,
  total,
})

describe('usePublicRooms', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  it('fetches and exposes the first page of public rooms', async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      jsonResponse(page([{ roomId: 'abc', name: 'Cool', playerCount: 2, themeId: 'neon' }], 1)),
    )
    vi.stubGlobal('fetch', fetchMock)

    const { result } = renderHook(() => usePublicRooms())

    await waitFor(() => expect(result.current.isLoading).toBe(false))
    expect(result.current.rooms).toHaveLength(1)
    expect(result.current.total).toBe(1)
    // First request hits the listing endpoint with page/pageSize params.
    expect(fetchMock).toHaveBeenCalledTimes(1)
    const url = fetchMock.mock.calls[0][0] as string
    expect(url).toContain('/api/rooms?')
    expect(url).toContain('page=0')
  })

  it('advances pages and refetches', async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(jsonResponse(page([{ roomId: 'a' }, { roomId: 'b' }], 3, 0, 2)))
      .mockResolvedValueOnce(jsonResponse(page([{ roomId: 'c' }], 3, 1, 2)))
    vi.stubGlobal('fetch', fetchMock)

    const { result } = renderHook(() => usePublicRooms({ pageSize: 2 }))
    await waitFor(() => expect(result.current.rooms).toHaveLength(2))
    expect(result.current.hasNextPage).toBe(true)

    act(() => result.current.nextPage())
    await waitFor(() => expect(result.current.page).toBe(1))
    await waitFor(() => expect(result.current.rooms).toHaveLength(1))
    expect(result.current.rooms[0].roomId).toBe('c')
  })

  it('sets an error message on a failed request', async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValue(jsonResponse({}, { ok: false, status: 500 }))
    vi.stubGlobal('fetch', fetchMock)

    const { result } = renderHook(() => usePublicRooms())

    await waitFor(() => expect(result.current.error).not.toBeNull())
    expect(result.current.error).toContain('Could not load public rooms')
    expect(result.current.rooms).toHaveLength(0)
  })
})
