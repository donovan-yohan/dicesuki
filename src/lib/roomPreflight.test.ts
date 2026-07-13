import { describe, expect, it, vi } from 'vitest'
import { preflightRoom } from './roomPreflight'

describe('preflightRoom retry through cold starts (#109)', () => {
  const httpUrl = 'https://rooms.example.com'
  // Instant sleep so retry tests don't wait real backoff.
  const noSleep = async () => {}

  it('retries a transient 503 then succeeds', async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce({ ok: false, status: 503 } as Response)
      .mockResolvedValueOnce({ ok: true, status: 200 } as Response)
    const onRetry = vi.fn()

    const result = await preflightRoom(httpUrl, 'ROOM42', { fetchImpl, sleepImpl: noSleep, onRetry })

    expect(result).toBe('ok')
    expect(fetchImpl).toHaveBeenCalledTimes(2)
    expect(onRetry).toHaveBeenCalledTimes(1)
  })

  it('retries network errors then reports server-down after exhaustion', async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockRejectedValue(new Error('network down'))

    const result = await preflightRoom(httpUrl, 'ROOM42', {
      fetchImpl,
      sleepImpl: noSleep,
      maxRetries: 3,
    })

    expect(result).toBe('server-down')
    expect(fetchImpl).toHaveBeenCalledTimes(4)
  })

  it('treats 404 as room-gone without retrying', async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue({ ok: false, status: 404 } as Response)

    const result = await preflightRoom(httpUrl, 'ROOM42', { fetchImpl, sleepImpl: noSleep })

    expect(result).toBe('room-gone')
    expect(fetchImpl).toHaveBeenCalledTimes(1)
  })

  it('fast-fails with no retries when maxRetries is 0 (local loopback)', async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockRejectedValue(new Error('network down'))

    const result = await preflightRoom(httpUrl, 'ROOM42', {
      fetchImpl,
      sleepImpl: noSleep,
      maxRetries: 0,
    })

    expect(result).toBe('server-down')
    expect(fetchImpl).toHaveBeenCalledTimes(1)
  })
})
