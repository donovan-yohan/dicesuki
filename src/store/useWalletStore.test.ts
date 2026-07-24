import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  fetchWalletBalances: vi.fn(),
  fetchRollTicketBalances: vi.fn(),
  fetchLunarSubscription: vi.fn(),
  subscribeWalletBalances: vi.fn(() => vi.fn()),
  subscribeLunarSubscription: vi.fn(() => vi.fn()),
  convertStarsToStandardRoll: vi.fn(),
}))

vi.mock('../lib/walletBalances', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../lib/walletBalances')>()),
  ...mocks,
}))

import { useWalletStore } from './useWalletStore'

describe('useWalletStore', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    useWalletStore.getState().resetOnSignOut()
    mocks.fetchWalletBalances.mockResolvedValue({
      stars: { promotional: 320 },
      dust: { earned: 8 },
    })
    mocks.fetchRollTicketBalances.mockResolvedValue({
      standard_roll: 2,
      premium_roll: 1,
    })
    mocks.fetchLunarSubscription.mockResolvedValue({
      subscriptionId: 'sub-1',
      status: 'active',
      planId: 'plan-1',
      productId: 'lunar-pass',
      dateNextCharge: '2026-08-01T00:00:00Z',
      dateEnd: null,
    })
  })

  it('refreshes server-authoritative balances and subscription state', async () => {
    await useWalletStore.getState().refresh({} as never)
    expect(useWalletStore.getState()).toMatchObject({
      wallet: { stars: { promotional: 320 }, dust: { earned: 8 } },
      tickets: { standard_roll: 2, premium_roll: 1 },
      loading: false,
      stale: false,
      subscription: { productId: 'lunar-pass', status: 'active' },
    })
  })

  it('applies realtime snapshots and clears every server value on sign-out', () => {
    useWalletStore.getState().applyRealtime({
      wallet: { stars: { promotional: 9 }, dust: { earned: 4 } },
      tickets: { standard_roll: 7, premium_roll: 3 },
    })
    expect(useWalletStore.getState().stale).toBe(false)

    useWalletStore.getState().resetOnSignOut()
    expect(useWalletStore.getState()).toMatchObject({
      wallet: { stars: { promotional: 0 }, dust: { earned: 0 } },
      tickets: { standard_roll: 0, premium_roll: 0 },
      subscription: null,
      loading: false,
      stale: true,
      userId: null,
    })
  })

  it('refreshes the wallet after a successful conversion', async () => {
    mocks.convertStarsToStandardRoll.mockResolvedValue({
      walletLedgerEntryId: 1,
      rollTicketLedgerEntryId: 2,
      rollCount: 1,
      starsDebited: 160,
      promotionalStarsBalanceAfter: 160,
      standardRollTicketsCredited: 1,
      standardRollQuantityAfter: 3,
    })
    const receipt = await useWalletStore.getState().convertStarsToStandardRoll(1, {} as never)
    expect(receipt).toMatchObject({ rollCount: 1 })
    expect(mocks.fetchWalletBalances).toHaveBeenCalledOnce()
    expect(mocks.fetchRollTicketBalances).toHaveBeenCalledOnce()
  })

  it('coalesces double-click conversion calls into one in-flight RPC', async () => {
    let resolveConversion: ((value: {
      walletLedgerEntryId: number
      rollTicketLedgerEntryId: number
      rollCount: number
      starsDebited: number
      promotionalStarsBalanceAfter: number
      standardRollTicketsCredited: number
      standardRollQuantityAfter: number
    }) => void) | undefined
    mocks.convertStarsToStandardRoll.mockReturnValueOnce(new Promise(resolve => {
      resolveConversion = resolve
    }))

    const first = useWalletStore.getState().convertStarsToStandardRoll(1, {} as never)
    const second = useWalletStore.getState().convertStarsToStandardRoll(1, {} as never)
    expect(mocks.convertStarsToStandardRoll).toHaveBeenCalledOnce()

    resolveConversion?.({
      walletLedgerEntryId: 1,
      rollTicketLedgerEntryId: 2,
      rollCount: 1,
      starsDebited: 160,
      promotionalStarsBalanceAfter: 160,
      standardRollTicketsCredited: 1,
      standardRollQuantityAfter: 3,
    })
    await expect(Promise.all([first, second])).resolves.toEqual([
      expect.objectContaining({ walletLedgerEntryId: 1 }),
      expect.objectContaining({ walletLedgerEntryId: 1 }),
    ])
  })

  it('returns committed conversion truth and marks stale when reconciliation fails', async () => {
    mocks.convertStarsToStandardRoll.mockResolvedValue({
      walletLedgerEntryId: 1,
      rollTicketLedgerEntryId: 2,
      rollCount: 1,
      starsDebited: 160,
      promotionalStarsBalanceAfter: 160,
      standardRollTicketsCredited: 1,
      standardRollQuantityAfter: 3,
    })
    mocks.fetchWalletBalances.mockRejectedValueOnce(new Error('offline'))

    await expect(
      useWalletStore.getState().convertStarsToStandardRoll(1, {} as never),
    ).resolves.toMatchObject({
      promotionalStarsBalanceAfter: 160,
      standardRollQuantityAfter: 3,
    })
    await vi.waitFor(() => {
      expect(useWalletStore.getState()).toMatchObject({
        wallet: { stars: { promotional: 160 } },
        tickets: { standard_roll: 3 },
        stale: true,
      })
    })
  })

  it('discards delayed refresh and subscription reads after sign-out', async () => {
    let resolveWallet: ((value: {
      stars: { promotional: number }
      dust: { earned: number }
    }) => void) | undefined
    let resolveTickets: ((value: {
      standard_roll: number
      premium_roll: number
    }) => void) | undefined
    let resolveSubscription: ((value: {
      subscriptionId: string
      status: string
      planId: null
      productId: string
      dateNextCharge: null
      dateEnd: null
    }) => void) | undefined
    mocks.fetchWalletBalances.mockReturnValueOnce(new Promise(resolve => {
      resolveWallet = resolve
    }))
    mocks.fetchRollTicketBalances.mockReturnValueOnce(new Promise(resolve => {
      resolveTickets = resolve
    }))
    mocks.fetchLunarSubscription.mockReturnValueOnce(new Promise(resolve => {
      resolveSubscription = resolve
    }))

    const refresh = useWalletStore.getState().refresh({} as never)
    useWalletStore.getState().resetOnSignOut()
    resolveWallet?.({ stars: { promotional: 999 }, dust: { earned: 999 } })
    resolveTickets?.({ standard_roll: 999, premium_roll: 999 })
    resolveSubscription?.({
      subscriptionId: 'stale-subscription',
      status: 'active',
      planId: null,
      productId: 'lunar-pass',
      dateNextCharge: null,
      dateEnd: null,
    })
    await refresh

    expect(useWalletStore.getState()).toMatchObject({
      wallet: { stars: { promotional: 0 }, dust: { earned: 0 } },
      tickets: { standard_roll: 0, premium_roll: 0 },
      subscription: null,
      loading: false,
      stale: true,
      userId: null,
    })
  })

  it('does not let a delayed subscription read overwrite an account switch', async () => {
    let resolveSubscription: ((value: {
      subscriptionId: string
      status: string
      planId: null
      productId: string
      dateNextCharge: null
      dateEnd: null
    }) => void) | undefined
    mocks.fetchLunarSubscription.mockReturnValueOnce(new Promise(resolve => {
      resolveSubscription = resolve
    }))

    useWalletStore.getState().connectRealtime('user-1', {} as never)
    const subscriptionCalls = (
      mocks.subscribeLunarSubscription as unknown as {
        mock: { calls: Array<[string, () => void]> }
      }
    ).mock.calls
    const firstUserSubscriptionChange = subscriptionCalls[0][1]
    firstUserSubscriptionChange()
    useWalletStore.getState().connectRealtime('user-2', {} as never)

    resolveSubscription?.({
      subscriptionId: 'user-1-stale-subscription',
      status: 'active',
      planId: null,
      productId: 'lunar-pass',
      dateNextCharge: null,
      dateEnd: null,
    })
    await Promise.resolve()
    await Promise.resolve()

    expect(useWalletStore.getState()).toMatchObject({
      userId: 'user-2',
      subscription: null,
    })
  })

  it('returns a delayed committed conversion without mutating after sign-out', async () => {
    let resolveConversion: ((value: {
      walletLedgerEntryId: number
      rollTicketLedgerEntryId: number
      rollCount: number
      starsDebited: number
      promotionalStarsBalanceAfter: number
      standardRollTicketsCredited: number
      standardRollQuantityAfter: number
    }) => void) | undefined
    mocks.convertStarsToStandardRoll.mockReturnValueOnce(new Promise(resolve => {
      resolveConversion = resolve
    }))
    useWalletStore.getState().connectRealtime('user-1', {} as never)

    const conversion = useWalletStore.getState().convertStarsToStandardRoll(
      1,
      {} as never,
    )
    useWalletStore.getState().resetOnSignOut()
    resolveConversion?.({
      walletLedgerEntryId: 1,
      rollTicketLedgerEntryId: 2,
      rollCount: 1,
      starsDebited: 160,
      promotionalStarsBalanceAfter: 999,
      standardRollTicketsCredited: 1,
      standardRollQuantityAfter: 999,
    })

    await expect(conversion).resolves.toMatchObject({
      promotionalStarsBalanceAfter: 999,
      standardRollQuantityAfter: 999,
    })
    expect(useWalletStore.getState()).toMatchObject({
      wallet: { stars: { promotional: 0 }, dust: { earned: 0 } },
      tickets: { standard_roll: 0, premium_roll: 0 },
      userId: null,
      stale: true,
    })
    expect(mocks.fetchWalletBalances).not.toHaveBeenCalled()
    expect(mocks.fetchRollTicketBalances).not.toHaveBeenCalled()
  })
})
