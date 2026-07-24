import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const getSupabaseClientMock = vi.hoisted(() => vi.fn())
const isSupabaseConfiguredMock = vi.hoisted(() => vi.fn(() => true))
vi.mock('./supabaseClient', () => ({
  getSupabaseClient: getSupabaseClientMock,
  isSupabaseConfigured: isSupabaseConfiguredMock,
}))

import {
  __resetDataSyncForTests,
  startSync,
  type SyncTarget,
} from './dataSync'
import { useWalletStore } from '../store/useWalletStore'

function makeFakeClient() {
  const rpc = vi.fn().mockResolvedValue({ data: null, error: null })
  const from = vi.fn((table: string) => {
    let mode: 'select' | 'upsert' = 'select'
    const builder: Record<string, unknown> = {
      select: vi.fn(() => builder),
      eq: vi.fn(() => builder),
      is: vi.fn(() => builder),
      upsert: vi.fn(() => {
        mode = 'upsert'
        return builder
      }),
      maybeSingle: vi.fn(async () => mode === 'upsert'
        ? { data: { updated_at: new Date().toISOString() }, error: null }
        : { data: null, error: null }),
    }
    void table
    return builder
  })
  return { client: { from, rpc } as never, from }
}

function target(): SyncTarget {
  return {
    table: 'settings',
    getPayload: () => ({ v: 1, themeId: 'default' }),
    applyPayload: () => {},
    subscribe: () => () => {},
  }
}

describe('dataSync Slice 13 wiring', () => {
  beforeEach(() => {
    localStorage.clear()
    __resetDataSyncForTests()
  })

  afterEach(() => {
    __resetDataSyncForTests()
  })

  it('reads catalog, entitlements, copies, wallet, tickets, and subscription on sign-in', async () => {
    const fake = makeFakeClient()

    await startSync('user-1', { client: fake.client, targets: [target()] })

    const tables = fake.from.mock.calls.map(([table]) => table)
    expect(tables).toEqual(expect.arrayContaining([
      'catalog_items',
      'catalog_asset_versions',
      'user_entitlements',
      'dice_copies',
      'wallet_balances',
      'roll_ticket_balances',
      'user_subscriptions',
    ]))
    expect(useWalletStore.getState().userId).toBe('user-1')
  })
})
