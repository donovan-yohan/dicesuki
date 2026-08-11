import { afterEach, describe, expect, it, vi } from 'vitest'
import { preflightRoom } from './roomPreflight'
import { COLDSTART_DEADLINE_MS, COLDSTART_PHASE2_AT_MS } from './coldStartWait'

function useStagedFakeTimers() {
  vi.useFakeTimers({ toFake: ['performance', 'setTimeout', 'clearTimeout'] })
}

describe('preflightRoom staged cold-start wait', () => {
  const httpUrl = 'https://rooms.example.com'

  afterEach(() => {
    vi.useRealTimers()
  })

  it('polls through a transient 503 then succeeds', async () => {
    useStagedFakeTimers()
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce({ ok: false, status: 503 } as Response)
      .mockResolvedValueOnce({ ok: true, status: 200 } as Response)
    const onProgress = vi.fn()

    const promise = preflightRoom(httpUrl, 'ROOM42', { fetchImpl, onProgress })
    await vi.advanceTimersByTimeAsync(5_000)

    await expect(promise).resolves.toBe('ok')
    expect(fetchImpl).toHaveBeenCalledTimes(2)
    expect(onProgress).toHaveBeenCalled()
    // Phase 1 is the ordinary "checking" UI — no cold-start copy this early.
    expect(onProgress.mock.calls.every(([p]) => p.phase === 'connecting')).toBe(true)
  })

  it('treats a per-attempt timeout as still-waking, not as a hard failure', async () => {
    useStagedFakeTimers()
    // A cold container that accepts the connection and never answers: the fetch
    // only settles when its abort signal fires.
    const fetchImpl = vi.fn<typeof fetch>().mockImplementation((_url, init) =>
      new Promise((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')))
      }),
    )

    const promise = preflightRoom(httpUrl, 'ROOM42', { fetchImpl })
    await vi.advanceTimersByTimeAsync(COLDSTART_PHASE2_AT_MS + 10_000)

    // Still polling well past the point the old 2.5s-retry policy gave up.
    expect(fetchImpl.mock.calls.length).toBeGreaterThan(1)

    await vi.advanceTimersByTimeAsync(COLDSTART_DEADLINE_MS)
    await expect(promise).resolves.toBe('server-down')
  })

  it('reports server-down only after the full deadline', async () => {
    useStagedFakeTimers()
    const fetchImpl = vi.fn<typeof fetch>().mockRejectedValue(new Error('network down'))

    const promise = preflightRoom(httpUrl, 'ROOM42', { fetchImpl })
    let settled = false
    void promise.then(() => { settled = true })

    await vi.advanceTimersByTimeAsync(COLDSTART_DEADLINE_MS - 10_000)
    expect(settled).toBe(false)

    await vi.advanceTimersByTimeAsync(20_000)
    await expect(promise).resolves.toBe('server-down')
  })

  it('treats 404 as room-gone without polling', async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue({ ok: false, status: 404 } as Response)

    const result = await preflightRoom(httpUrl, 'ROOM42', { fetchImpl })

    expect(result).toBe('room-gone')
    expect(fetchImpl).toHaveBeenCalledTimes(1)
  })

  it('does not poll a non-transient status (e.g. HTTP 500)', async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue({ ok: false, status: 500 } as Response)

    const result = await preflightRoom(httpUrl, 'ROOM42', { fetchImpl })

    expect(result).toBe('server-down')
    expect(fetchImpl).toHaveBeenCalledTimes(1)
  })

  it('resolves to aborted when the caller cancels the wait', async () => {
    useStagedFakeTimers()
    const controller = new AbortController()
    const fetchImpl = vi.fn<typeof fetch>().mockRejectedValue(new Error('network down'))

    const promise = preflightRoom(httpUrl, 'ROOM42', { fetchImpl, signal: controller.signal })
    await vi.advanceTimersByTimeAsync(4_000)
    controller.abort()
    await vi.advanceTimersByTimeAsync(2_000)

    await expect(promise).resolves.toBe('aborted')
  })
})
