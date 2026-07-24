import type { SupabaseClient } from '@supabase/supabase-js'
import { describe, expect, it, vi } from 'vitest'
import {
  claimLunarDailyStars,
  LUNAR_DAILY_STAR_AMOUNT,
  LunarPassClaimError,
  type LunarDailyStarsReceipt,
} from './lunarPass'

const row = {
  id: 41,
  user_id: '24000000-0000-4000-8000-000000000001',
  subscription_id: 'lunar-subscription',
  utc_day: '2030-01-15',
  credited_stars: 90,
  wallet_ledger_entry_id: 73,
  claimed_at: '2030-01-15T12:34:56.000Z',
}

function clientWith(options: {
  previous?: unknown
  historyError?: { message: string; code?: string } | null
  rpcData?: unknown
  rpcError?: { message: string; code?: string } | null
}) {
  const limit = vi.fn(async () => ({
    data: options.previous === undefined ? [] : options.previous,
    error: options.historyError ?? null,
  }))
  const order = vi.fn(() => ({ limit }))
  const select = vi.fn(() => ({ order }))
  const from = vi.fn(() => ({ select }))
  const rpc = vi.fn(async () => ({
    data: options.rpcData === undefined ? row : options.rpcData,
    error: options.rpcError ?? null,
  }))
  return {
    client: { from, rpc } as unknown as SupabaseClient,
    from,
    select,
    order,
    limit,
    rpc,
  }
}

describe('claimLunarDailyStars', () => {
  it('calls the self-only RPC and projects its strict immutable receipt', async () => {
    const { client, from, select, order, limit, rpc } = clientWith({
      rpcData: [row],
    })

    await expect(claimLunarDailyStars(client)).resolves.toEqual({
      id: 41,
      userId: '24000000-0000-4000-8000-000000000001',
      subscriptionId: 'lunar-subscription',
      utcDay: '2030-01-15',
      creditedStars: LUNAR_DAILY_STAR_AMOUNT,
      walletLedgerEntryId: 73,
      claimedAt: '2030-01-15T12:34:56.000Z',
      alreadyClaimed: false,
    } satisfies LunarDailyStarsReceipt)
    expect(from).toHaveBeenCalledWith('lunar_daily_star_claims')
    expect(select).toHaveBeenCalledWith('id')
    expect(order).toHaveBeenCalledWith('utc_day', { ascending: false })
    expect(limit).toHaveBeenCalledWith(1)
    expect(rpc).toHaveBeenCalledOnce()
    expect(rpc).toHaveBeenCalledWith('claim_lunar_daily_stars')
  })

  it('discriminates an immutable same-day replay by its prior receipt id', async () => {
    const { client } = clientWith({
      previous: [{ id: row.id }],
      rpcData: row,
    })

    await expect(claimLunarDailyStars(client)).resolves.toMatchObject({
      id: row.id,
      alreadyClaimed: true,
    })
  })

  it('does not mistake the prior UTC-day receipt for a new claim replay', async () => {
    const { client } = clientWith({
      previous: [{ id: row.id - 1 }],
      rpcData: row,
    })

    await expect(claimLunarDailyStars(client)).resolves.toMatchObject({
      id: row.id,
      alreadyClaimed: false,
    })
  })

  it.each([
    ['55000', 'not_entitled'],
    ['28000', 'unauthenticated'],
    ['42501', 'unauthenticated'],
    ['PGRST301', 'unauthenticated'],
    ['XX000', 'rpc_failure'],
  ] as const)('maps backend SQLSTATE %s to %s', async (code, kind) => {
    const { client } = clientWith({
      rpcData: null,
      rpcError: { message: 'claim rejected', code },
    })

    await expect(claimLunarDailyStars(client)).rejects.toMatchObject({
      name: 'LunarPassClaimError',
      operation: 'claim_lunar_daily_stars',
      kind,
      code,
      message: 'claim_lunar_daily_stars failed: claim rejected',
    } satisfies Partial<LunarPassClaimError>)
  })

  it('maps explicit missing configuration without touching a backend', async () => {
    await expect(claimLunarDailyStars(null)).rejects.toMatchObject({
      name: 'LunarPassClaimError',
      operation: 'claim_lunar_daily_stars',
      kind: 'not_configured',
    } satisfies Partial<LunarPassClaimError>)
  })

  it('wraps receipt-history and RPC transport failures with operation context', async () => {
    const historyFailure = clientWith({
      historyError: { message: 'history unavailable', code: 'XX001' },
    })
    await expect(claimLunarDailyStars(historyFailure.client)).rejects.toMatchObject({
      kind: 'rpc_failure',
      code: 'XX001',
    })
    expect(historyFailure.rpc).not.toHaveBeenCalled()

    const rpc = vi.fn(async () => {
      throw new Error('offline')
    })
    const transportFailure = clientWith({})
    ;(transportFailure.client as unknown as { rpc: typeof rpc }).rpc = rpc
    await expect(claimLunarDailyStars(transportFailure.client)).rejects.toThrow(
      'claim_lunar_daily_stars failed: offline',
    )
  })

  it.each([
    null,
    [],
    [row, row],
    { ...row, id: 0 },
    { ...row, credited_stars: 89 },
    { ...row, utc_day: '2030-02-30' },
    { ...row, claimed_at: 'not-a-timestamp' },
    { ...row, claimed_at: '2030-01-16T00:00:00Z' },
    { ...row, wallet_ledger_entry_id: -1 },
  ])('fails closed on malformed receipt %#', async rpcData => {
    const { client } = clientWith({ rpcData })
    await expect(claimLunarDailyStars(client)).rejects.toMatchObject({
      name: 'LunarPassClaimError',
      kind: 'rpc_failure',
    })
  })

  it('fails closed when receipt-history discrimination is malformed', async () => {
    const { client, rpc } = clientWith({ previous: null })
    await expect(claimLunarDailyStars(client)).rejects.toThrow(
      /malformed receipt history/,
    )
    expect(rpc).not.toHaveBeenCalled()
  })
})
