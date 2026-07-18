import { act, renderHook } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { DEFAULT_TTL_MS, useCheckoutStatus } from './useCheckoutStatus'

/**
 * A fake Supabase client that counts status reads and captures the realtime
 * callback, so a test can drive an order and observe exactly how the hook
 * watches it (poll cadence, subscription teardown, TTL quiescence).
 */
function makeClient(currentDbStatus: () => string | null) {
  let realtimeCb: ((payload: { new?: { status?: string | null } | null }) => void) | null = null
  let fetchCount = 0
  const removeChannel = vi.fn()
  const channelSpy = vi.fn()
  const channel = {
    on: (_e: string, _f: unknown, cb: typeof realtimeCb) => {
      realtimeCb = cb
      return channel
    },
    subscribe: () => channel,
  }
  const client = {
    from: () => ({
      select: () => ({
        eq: () => ({
          maybeSingle: async () => {
            fetchCount += 1
            const status = currentDbStatus()
            return { data: status ? { status } : null, error: null }
          },
        }),
      }),
    }),
    channel: (...args: unknown[]) => {
      channelSpy(...args)
      return channel
    },
    removeChannel,
  } as unknown as SupabaseClient

  return {
    client,
    getFetchCount: () => fetchCount,
    removeChannel,
    channelSpy,
    push: (status: string) => realtimeCb?.({ new: { status } }),
  }
}

async function advance(ms: number) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms)
  })
}

describe('useCheckoutStatus bounded watching', () => {
  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it('backs off the poll cadence (4s → 8s → 15s → 30s, capped)', async () => {
    vi.useFakeTimers()
    const { client, getFetchCount } = makeClient(() => 'pending')

    const { unmount } = renderHook(() => useCheckoutStatus('ext-poll', { client }))

    // Initial fetch fires immediately.
    expect(getFetchCount()).toBe(1)

    // No poll before the first 4s step.
    await advance(3999)
    expect(getFetchCount()).toBe(1)
    await advance(1) // t=4000 → poll #1
    expect(getFetchCount()).toBe(2)

    // Next step is 8s, not another 4s.
    await advance(7999) // t=11999
    expect(getFetchCount()).toBe(2)
    await advance(1) // t=12000 → poll #2
    expect(getFetchCount()).toBe(3)

    await advance(15000) // t=27000 → poll #3
    expect(getFetchCount()).toBe(4)

    await advance(30000) // t=57000 → poll #4 (30s cap)
    expect(getFetchCount()).toBe(5)

    await advance(30000) // t=87000 → poll #5 (cap holds)
    expect(getFetchCount()).toBe(6)

    unmount()
  })

  it('stops polling and unsubscribes once the order is terminal', async () => {
    vi.useFakeTimers()
    const { client, getFetchCount, removeChannel, push } = makeClient(() => 'pending')

    const { unmount } = renderHook(() => useCheckoutStatus('ext-terminal', { client }))
    expect(getFetchCount()).toBe(1)

    await advance(4000) // one poll while pending
    expect(getFetchCount()).toBe(2)

    // Terminal flip via realtime must tear the whole watcher down.
    act(() => push('fulfilled'))
    expect(removeChannel).toHaveBeenCalledTimes(1)

    const countAtTerminal = getFetchCount()
    await advance(120000) // long past several backoff steps
    expect(getFetchCount()).toBe(countAtTerminal) // no further polls

    unmount()
  })

  it('goes quiescent immediately when mounted past its TTL (no network, no subscription)', () => {
    const { client, getFetchCount, channelSpy } = makeClient(() => 'pending')
    const createdAt = Date.now() - (DEFAULT_TTL_MS + 1000)

    const { result } = renderHook(() =>
      useCheckoutStatus('ext-stale', { client, createdAt }),
    )

    expect(result.current.expired).toBe(true)
    expect(result.current.loading).toBe(false)
    expect(getFetchCount()).toBe(0)
    expect(channelSpy).not.toHaveBeenCalled()
  })

  it('expires after the TTL elapses, stopping poll + subscription', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-01-01T00:00:00Z'))
    const { client, getFetchCount, removeChannel } = makeClient(() => 'pending')
    const createdAt = Date.now()
    const ttlMs = 20000

    const { result, unmount } = renderHook(() =>
      useCheckoutStatus('ext-ttl', { client, createdAt, ttlMs }),
    )
    expect(result.current.expired).toBe(false)

    await advance(4000) // still watching, one poll
    expect(getFetchCount()).toBe(2)

    await advance(20000) // crosses the 20s TTL
    expect(result.current.expired).toBe(true)
    expect(removeChannel).toHaveBeenCalledTimes(1)

    const countAtExpiry = getFetchCount()
    await advance(120000)
    expect(getFetchCount()).toBe(countAtExpiry) // no polling after expiry

    unmount()
  })

  it('does not apply a TTL when no createdAt is supplied (foreground watch)', async () => {
    vi.useFakeTimers()
    const { client, getFetchCount } = makeClient(() => 'pending')

    const { result, unmount } = renderHook(() =>
      useCheckoutStatus('ext-no-ttl', { client }),
    )

    // Well past the default 30-min TTL — but with no createdAt the hook keeps
    // watching (poll count keeps climbing, never expired).
    await advance(DEFAULT_TTL_MS + 60000)
    expect(result.current.expired).toBe(false)
    expect(getFetchCount()).toBeGreaterThan(2)

    unmount()
  })
})
