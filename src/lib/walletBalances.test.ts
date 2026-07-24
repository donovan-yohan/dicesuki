import { afterEach, describe, expect, it, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import {
  convertStarsToStandardRoll,
  fetchLunarSubscription,
  fetchRollTicketBalances,
  fetchWalletBalances,
  LUNAR_PASS_PRODUCT_ID,
  subscribeLunarSubscription,
  subscribeWalletBalances,
  WalletConversionError,
} from './walletBalances'

function queryResult(data: unknown, error: unknown = null) {
  return {
    select: () => Promise.resolve({ data, error }),
  }
}

describe('wallet balance readers', () => {
  it('validates and projects wallet buckets and ticket types', async () => {
    const client = {
      from: (table: string) => table === 'wallet_balances'
        ? queryResult([
            { currency_id: 'stars', balance_bucket: 'promotional', current_balance: 640 },
            { currency_id: 'stars', balance_bucket: 'paid', current_balance: 12 },
            { currency_id: 'dust', balance_bucket: 'earned', current_balance: 9 },
          ])
        : queryResult([
            { roll_type: 'standard_roll', current_quantity: 4 },
            { roll_type: 'premium_roll', current_quantity: 2 },
          ]),
    } as unknown as SupabaseClient

    await expect(fetchWalletBalances(client)).resolves.toEqual({
      stars: { promotional: 640, paid: 12 },
      dust: { earned: 9 },
    })
    await expect(fetchRollTicketBalances(client)).resolves.toEqual({
      standard_roll: 4,
      premium_roll: 2,
    })
  })

  it('fails closed on malformed or duplicate balance rows', async () => {
    const malformed = {
      from: () => queryResult([
        { currency_id: 'stars', balance_bucket: 'promotional', current_balance: -1 },
      ]),
    } as unknown as SupabaseClient
    await expect(fetchWalletBalances(malformed)).rejects.toThrow(/malformed integer/)

    const duplicate = {
      from: () => queryResult([
        { roll_type: 'standard_roll', current_quantity: 1 },
        { roll_type: 'standard_roll', current_quantity: 2 },
      ]),
    } as unknown as SupabaseClient
    await expect(fetchRollTicketBalances(duplicate)).rejects.toThrow(/duplicate/)
  })
})

describe('wallet balance watcher', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it('initially fetches, refreshes from either table, polls, and unsubscribes', async () => {
    vi.useFakeTimers()
    const callbacks: Array<() => void> = []
    const removeChannel = vi.fn()
    let walletFetches = 0
    const channel = {
      on: (_event: string, _filter: unknown, callback: () => void) => {
        callbacks.push(callback)
        return channel
      },
      subscribe: () => channel,
    }
    const client = {
      from: (table: string) => {
        if (table === 'wallet_balances') {
          walletFetches += 1
          return queryResult([
            {
              currency_id: 'stars',
              balance_bucket: 'promotional',
              current_balance: walletFetches,
            },
          ])
        }
        return queryResult([
          { roll_type: 'standard_roll', current_quantity: 3 },
        ])
      },
      channel: vi.fn(() => channel),
      removeChannel,
    } as unknown as SupabaseClient
    const onChange = vi.fn()

    const unsubscribe = subscribeWalletBalances('user-1', onChange, client)
    await vi.advanceTimersByTimeAsync(0)
    expect(onChange).toHaveBeenLastCalledWith({
      wallet: { stars: { promotional: 1 }, dust: { earned: 0 } },
      tickets: { standard_roll: 3, premium_roll: 0 },
    })

    callbacks[0]()
    await vi.advanceTimersByTimeAsync(0)
    expect(onChange).toHaveBeenCalledTimes(2)

    await vi.advanceTimersByTimeAsync(4000)
    expect(onChange).toHaveBeenCalledTimes(3)

    unsubscribe()
    expect(removeChannel).toHaveBeenCalledWith(channel)
    await vi.advanceTimersByTimeAsync(120000)
    expect(onChange).toHaveBeenCalledTimes(3)
  })

  it('queues exactly one follow-up refresh when signals arrive mid-fetch', async () => {
    let resolveFirstWallet: ((value: {
      data: unknown
      error: null
    }) => void) | undefined
    const callbacks: Array<() => void> = []
    const channel = {
      on: (_event: string, _filter: unknown, callback: () => void) => {
        callbacks.push(callback)
        return channel
      },
      subscribe: () => channel,
    }
    let walletFetches = 0
    const client = {
      from: (table: string) => {
        if (table === 'wallet_balances') {
          walletFetches += 1
          if (walletFetches === 1) {
            return {
              select: () => new Promise(resolve => {
                resolveFirstWallet = resolve
              }),
            }
          }
          return queryResult([{
            currency_id: 'stars',
            balance_bucket: 'promotional',
            current_balance: walletFetches,
          }])
        }
        return queryResult([
          { roll_type: 'standard_roll', current_quantity: walletFetches },
        ])
      },
      channel: () => channel,
      removeChannel: vi.fn(),
    } as unknown as SupabaseClient
    const onChange = vi.fn()

    const unsubscribe = subscribeWalletBalances('user-1', onChange, client)
    callbacks[0]()
    callbacks[1]()
    callbacks[0]()
    expect(walletFetches).toBe(1)

    resolveFirstWallet?.({
      data: [{
        currency_id: 'stars',
        balance_bucket: 'promotional',
        current_balance: 1,
      }],
      error: null,
    })
    await vi.waitFor(() => {
      expect(walletFetches).toBe(2)
      expect(onChange).toHaveBeenCalledTimes(2)
    })
    unsubscribe()
  })

  it('keeps the polling fallback alive past the former watcher TTL', async () => {
    vi.useFakeTimers()
    const removeChannel = vi.fn()
    const channel = {
      on: () => channel,
      subscribe: () => channel,
    }
    let walletFetches = 0
    const client = {
      from: (table: string) => {
        if (table === 'wallet_balances') {
          walletFetches += 1
          return queryResult([])
        }
        return queryResult([])
      },
      channel: () => channel,
      removeChannel,
    } as unknown as SupabaseClient

    const unsubscribe = subscribeWalletBalances('user-1', vi.fn(), client)
    await vi.advanceTimersByTimeAsync(30 * 60 * 1000 + 1)

    expect(walletFetches).toBeGreaterThan(1)
    expect(removeChannel).not.toHaveBeenCalled()
    unsubscribe()
    expect(removeChannel).toHaveBeenCalledWith(channel)
  })
})

describe('Stars conversion', () => {
  it('returns the strict two-ledger receipt', async () => {
    const rpc = vi.fn(async () => ({
      data: [{
        wallet_ledger_entry_id: 10,
        roll_ticket_ledger_entry_id: 11,
        roll_count: 2,
        stars_debited: 320,
        promotional_stars_balance_after: 80,
        standard_roll_tickets_credited: 2,
        standard_roll_quantity_after: 7,
      }],
      error: null,
    }))
    await expect(
      convertStarsToStandardRoll(2, { rpc } as unknown as SupabaseClient),
    ).resolves.toMatchObject({
      rollCount: 2,
      starsDebited: 320,
      standardRollQuantityAfter: 7,
    })
    expect(rpc).toHaveBeenCalledWith('convert_stars_to_standard_roll', {
      p_roll_count: 2,
      p_idempotency_key: expect.stringMatching(/^client:/),
    })
  })

  it('maps insufficient funds and invalid input to typed errors', async () => {
    const rpc = vi.fn(async () => ({
      data: null,
      error: { message: 'insufficient promotional Stars', code: '22003' },
    }))
    await expect(
      convertStarsToStandardRoll(1, { rpc } as unknown as SupabaseClient),
    ).rejects.toMatchObject({
      name: 'WalletConversionError',
      kind: 'insufficient_funds',
      code: '22003',
    } satisfies Partial<WalletConversionError>)
    await expect(convertStarsToStandardRoll(0, { rpc } as never)).rejects.toMatchObject({
      kind: 'invalid_request',
      code: '22023',
    })
  })

  it('maps an unclassified backend SQLSTATE to rpc_failure', async () => {
    const rpc = vi.fn(async () => ({
      data: null,
      error: { message: 'backend unavailable', code: 'XX000' },
    }))
    await expect(
      convertStarsToStandardRoll(1, { rpc } as unknown as SupabaseClient),
    ).rejects.toMatchObject({
      name: 'WalletConversionError',
      kind: 'rpc_failure',
      code: 'XX000',
    } satisfies Partial<WalletConversionError>)
  })

  it('retries a transport timeout once with the same idempotency key', async () => {
    const rpc = vi.fn()
      .mockRejectedValueOnce(new Error('request timed out'))
      .mockResolvedValueOnce({
        data: [{
          wallet_ledger_entry_id: 10,
          roll_ticket_ledger_entry_id: 11,
          roll_count: 1,
          stars_debited: 160,
          promotional_stars_balance_after: 80,
          standard_roll_tickets_credited: 1,
          standard_roll_quantity_after: 7,
        }],
        error: null,
      })

    await expect(
      convertStarsToStandardRoll(1, { rpc } as unknown as SupabaseClient),
    ).resolves.toMatchObject({ rollCount: 1 })
    expect(rpc).toHaveBeenCalledTimes(2)
    const firstKey = rpc.mock.calls[0][1].p_idempotency_key
    const retryKey = rpc.mock.calls[1][1].p_idempotency_key
    expect(firstKey).toMatch(/^client:/)
    expect(retryKey).toBe(firstKey)
  })
})

describe('Lunar subscription filtering', () => {
  it('filters the fetched subscription snapshot to the canonical product id', async () => {
    const eq = vi.fn(async () => ({
      data: [{
        subscription_id: 'sub-lunar',
        status: 'active',
        plan_id: 'plan-lunar',
        product_id: LUNAR_PASS_PRODUCT_ID,
        date_next_charge: '2026-08-01T00:00:00Z',
        date_end: null,
      }],
      error: null,
    }))
    const select = vi.fn(() => ({ eq }))
    const client = {
      from: vi.fn(() => ({ select })),
    } as unknown as SupabaseClient

    await expect(fetchLunarSubscription(client)).resolves.toMatchObject({
      subscriptionId: 'sub-lunar',
      productId: LUNAR_PASS_PRODUCT_ID,
    })
    expect(eq).toHaveBeenCalledWith('product_id', LUNAR_PASS_PRODUCT_ID)
  })

  it('ignores realtime events for every non-Lunar product', () => {
    let callback: ((payload: {
      eventType?: string
      new?: { product_id?: string }
      old?: { product_id?: string }
    }) => void) | undefined
    const channel = {
      on: (_event: string, _filter: unknown, cb: typeof callback) => {
        callback = cb
        return channel
      },
      subscribe: () => channel,
    }
    const onChange = vi.fn()
    const client = {
      channel: () => channel,
      removeChannel: vi.fn(),
    } as unknown as SupabaseClient
    const stop = subscribeLunarSubscription('user-1', onChange, client)

    callback?.({ new: { product_id: 'future-pass' } })
    expect(onChange).not.toHaveBeenCalled()
    callback?.({ new: { product_id: LUNAR_PASS_PRODUCT_ID } })
    expect(onChange).toHaveBeenCalledOnce()
    callback?.({ eventType: 'DELETE', old: {} })
    expect(onChange).toHaveBeenCalledTimes(2)
    stop()
  })
})
