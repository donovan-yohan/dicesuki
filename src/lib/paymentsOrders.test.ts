import { describe, expect, it, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import {
  fetchOrderStatus,
  isTerminalStatus,
  mapDbStatusToUi,
  subscribeOrderStatus,
} from './paymentsOrders'

/** Fake client whose single-row read resolves to `result`. */
function makeReadClient(result: { data: unknown; error: unknown }) {
  const maybeSingle = vi.fn(async () => result)
  const eq = vi.fn(() => ({ maybeSingle }))
  const select = vi.fn(() => ({ eq }))
  const from = vi.fn(() => ({ select }))
  return { client: { from } as unknown as SupabaseClient, from, select, eq }
}

describe('mapDbStatusToUi', () => {
  it('maps the server state machine to UI states', () => {
    expect(mapDbStatusToUi('pending')).toBe('pending')
    expect(mapDbStatusToUi('paid')).toBe('confirming')
    expect(mapDbStatusToUi('fulfilled')).toBe('fulfilled')
    expect(mapDbStatusToUi('refunded')).toBe('refunded')
    expect(mapDbStatusToUi('canceled')).toBe('canceled')
  })

  it('maps unknown/absent values to "unknown"', () => {
    expect(mapDbStatusToUi(null)).toBe('unknown')
    expect(mapDbStatusToUi(undefined)).toBe('unknown')
    expect(mapDbStatusToUi('weird')).toBe('unknown')
  })
})

describe('isTerminalStatus', () => {
  it('treats settled states as terminal', () => {
    expect(isTerminalStatus('fulfilled')).toBe(true)
    expect(isTerminalStatus('refunded')).toBe(true)
    expect(isTerminalStatus('canceled')).toBe(true)
  })

  it('treats in-flight states as non-terminal', () => {
    expect(isTerminalStatus('pending')).toBe(false)
    expect(isTerminalStatus('confirming')).toBe(false)
    expect(isTerminalStatus('unknown')).toBe(false)
  })
})

describe('fetchOrderStatus', () => {
  it('reads the buyer own row and maps its status', async () => {
    const { client, from, eq } = makeReadClient({ data: { status: 'paid' }, error: null })
    const status = await fetchOrderStatus('ext-1', { client })
    expect(status).toBe('confirming')
    expect(from).toHaveBeenCalledWith('payment_orders')
    expect(eq).toHaveBeenCalledWith('external_id', 'ext-1')
  })

  it('returns null (keep waiting) when the row is not visible yet', async () => {
    const { client } = makeReadClient({ data: null, error: null })
    expect(await fetchOrderStatus('ext-1', { client })).toBeNull()
  })

  it('returns null on error rather than throwing', async () => {
    const { client } = makeReadClient({ data: null, error: { message: 'nope' } })
    expect(await fetchOrderStatus('ext-1', { client })).toBeNull()
  })

  it('returns null when no client is available', async () => {
    expect(await fetchOrderStatus('ext-1', { client: null })).toBeNull()
  })
})

describe('subscribeOrderStatus', () => {
  it('forwards realtime updates as mapped statuses and unsubscribes cleanly', () => {
    type RealtimeCb = (payload: { new?: { status?: string | null } | null }) => void
    let capturedCb: RealtimeCb = () => {}
    let onEvent = ''
    let onFilter: Record<string, unknown> = {}
    const removeChannel = vi.fn()

    // Model the exact chain: channel().on(...).subscribe() → handle passed to
    // removeChannel. No self-references, so tsc infers everything cleanly.
    const subscribed = { id: 'sub' }
    const afterOn = { subscribe: () => subscribed }
    const channelObj = {
      on: (event: string, filter: Record<string, unknown>, cb: RealtimeCb) => {
        onEvent = event
        onFilter = filter
        capturedCb = cb
        return afterOn
      },
    }
    const client = {
      channel: () => channelObj,
      removeChannel,
    } as unknown as SupabaseClient

    const onStatus = vi.fn()
    const unsubscribe = subscribeOrderStatus('ext-9', onStatus, { client })

    // The channel was filtered to this order's row.
    expect(onEvent).toBe('postgres_changes')
    expect(onFilter).toMatchObject({
      table: 'payment_orders',
      filter: 'external_id=eq.ext-9',
    })

    capturedCb({ new: { status: 'fulfilled' } })
    expect(onStatus).toHaveBeenCalledWith('fulfilled')

    unsubscribe()
    expect(removeChannel).toHaveBeenCalledWith(subscribed)
  })

  it('is a no-op when no client is available', () => {
    const onStatus = vi.fn()
    const unsubscribe = subscribeOrderStatus('ext', onStatus, { client: null })
    expect(() => unsubscribe()).not.toThrow()
    expect(onStatus).not.toHaveBeenCalled()
  })
})
