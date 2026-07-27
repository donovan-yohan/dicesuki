import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ThemeContext } from '../../contexts/ThemeContext'
import {
  claimLunarDailyStars,
  LunarPassClaimError,
} from '../../lib/lunarPass'
import { isPaymentsEnabled } from '../../lib/paymentsConfig'
import {
  type LunarSubscriptionSnapshot,
  WalletConversionError,
} from '../../lib/walletBalances'
import { useAuthStore } from '../../store/useAuthStore'
import { useWalletStore } from '../../store/useWalletStore'
import { defaultTheme } from '../../themes/tokens'
import { LUNAR_PASS_OFFER } from './lunarPassOffer'
import { ShopPanel } from './ShopPanel'

vi.mock('../../lib/lunarPass', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../lib/lunarPass')>()),
  claimLunarDailyStars: vi.fn(),
}))

vi.mock('../../lib/paymentsConfig', () => ({
  isPaymentsEnabled: vi.fn(() => false),
}))

vi.mock('./PullBannerScreen', () => ({
  PullBannerScreen: () => (
    <section data-testid="pull-banner-screen">Pull banners</section>
  ),
}))

const receipt = {
  walletLedgerEntryId: 1,
  rollTicketLedgerEntryId: 2,
  rollCount: 1,
  starsDebited: 160,
  promotionalStarsBalanceAfter: 160,
  standardRollTicketsCredited: 1,
  standardRollQuantityAfter: 2,
}

const lunarReceipt = {
  id: 4,
  userId: 'user-1',
  subscriptionId: 'sub-1',
  utcDay: new Date().toISOString().slice(0, 10),
  creditedStars: 90 as const,
  walletLedgerEntryId: 8,
  claimedAt: new Date().toISOString(),
  alreadyClaimed: false,
}

const originalRefresh = useWalletStore.getState().refresh

function renderShop(initialTab: 'shop' | 'banners' = 'shop', onClose = vi.fn()) {
  return render(
    <ThemeContext.Provider
      value={{
        currentTheme: defaultTheme,
        setTheme: vi.fn(),
        availableThemes: [defaultTheme],
        ownedThemes: [defaultTheme.id],
        purchaseTheme: vi.fn(async () => true),
      }}
    >
      <ShopPanel isOpen onClose={onClose} initialTab={initialTab} />
    </ThemeContext.Provider>,
  )
}

function setSignedInWallet(stars = 320) {
  useAuthStore.setState({ status: 'authenticated' })
  useWalletStore.setState({
    userId: 'user-1',
    wallet: { stars: { promotional: stars }, dust: { earned: 5 } },
    tickets: { standard_roll: 1, premium_roll: 0 },
    subscription: null,
    stale: false,
  })
}

function setSubscription(
  status: LunarSubscriptionSnapshot['status'],
  dates: Pick<LunarSubscriptionSnapshot, 'dateNextCharge' | 'dateEnd'>,
) {
  useWalletStore.setState({
    subscription: {
      subscriptionId: 'sub-1',
      status,
      planId: 'plan-1',
      productId: 'lunar-pass',
      ...dates,
    },
  })
}

describe('ShopPanel', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(isPaymentsEnabled).mockReturnValue(false)
    vi.mocked(claimLunarDailyStars).mockResolvedValue(lunarReceipt)
    useAuthStore.setState({ status: 'guest', user: null, profile: null })
    useWalletStore.getState().resetOnSignOut()
    useWalletStore.setState({ refresh: originalRefresh })
  })

  it('gives guests the same full-screen shell with the wallet block auth-gated', async () => {
    const onClose = vi.fn()
    const signIn = vi.fn()
    useAuthStore.setState({ signInWithDiscord: signIn })
    renderShop('banners', onClose)

    // One shell, one close affordance, and Escape — same as for members.
    const dialog = screen.getByRole('dialog', { name: 'Shop' })
    expect(dialog).toHaveAttribute('aria-modal', 'true')
    expect(screen.getByTestId('pull-banner-screen')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Close Banners' })).not.toBeInTheDocument()

    // Account data is gated; the shell around it is not.
    expect(screen.queryByLabelText('Wallet balances')).not.toBeInTheDocument()

    // The wallet tab is live for guests and offers sign-in instead of a dead control.
    fireEvent.click(screen.getByRole('tab', { name: /wallet & bundles/i }))
    expect(screen.getByRole('tabpanel', { name: /wallet & bundles/i })).toBeInTheDocument()
    expect(screen.queryByLabelText('Roll quantity')).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /sign in with discord/i }))
    expect(signIn).toHaveBeenCalledOnce()

    await waitFor(() => expect(screen.getByRole('button', { name: 'Close Shop' })).toBeInTheDocument())
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(onClose).toHaveBeenCalledOnce()
  })

  it('keeps authenticated balances in the shop header instead of a table overlay', () => {
    setSignedInWallet(320)
    useWalletStore.setState({
      wallet: { stars: { promotional: 320, paid: 20 }, dust: { earned: 5 } },
      tickets: { standard_roll: 1, premium_roll: 2 },
    })
    renderShop()

    const wallet = screen.getByLabelText('Wallet balances')
    expect(within(wallet).getByTestId('wallet-stars')).toHaveTextContent('340')
    expect(within(wallet).getByTestId('wallet-dust')).toHaveTextContent('5')
    expect(within(wallet).getByTestId('wallet-standard-rolls')).toHaveTextContent('1')
    expect(within(wallet).getByTestId('wallet-premium-rolls')).toHaveTextContent('2')
  })

  it('uses one full-screen shop surface while tabbing between wallet and banners', () => {
    const onClose = vi.fn()
    setSignedInWallet()
    renderShop('banners', onClose)

    expect(screen.getByRole('dialog', { name: 'Shop' })).toBeInTheDocument()
    expect(screen.getByTestId('pull-banner-screen')).toBeInTheDocument()
    expect(screen.getByLabelText('Wallet balances')).toBeInTheDocument()
    const walletTab = screen.getByRole('tab', { name: /wallet & bundles/i })
    fireEvent.click(walletTab)
    const walletPanel = screen.getByRole('tabpanel', { name: /wallet & bundles/i })
    expect(walletTab).toHaveAttribute('aria-controls', walletPanel.id)
    expect(screen.getByRole('heading', { name: 'Stars → standard rolls' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Close Shop' }))
    expect(onClose).toHaveBeenCalledOnce()
  })

  it('focuses the dialog, closes with Escape, and restores the prior focus', async () => {
    setSignedInWallet()
    const onClose = vi.fn()
    const opener = document.createElement('button')
    document.body.append(opener)
    opener.focus()

    const { unmount } = renderShop('shop', onClose)
    const close = screen.getByRole('button', { name: 'Close Shop' })
    await waitFor(() => expect(close).toHaveFocus())

    fireEvent.keyDown(document, { key: 'Escape' })
    expect(onClose).toHaveBeenCalledOnce()

    unmount()
    expect(opener).toHaveFocus()
    opener.remove()
  })

  it('yields Escape and Tab to any nested modal dialog', () => {
    setSignedInWallet()
    const onClose = vi.fn()
    renderShop('shop', onClose)

    const nestedModal = document.createElement('section')
    nestedModal.setAttribute('role', 'dialog')
    nestedModal.setAttribute('aria-modal', 'true')
    screen.getByRole('dialog', { name: 'Shop' }).append(nestedModal)

    fireEvent.keyDown(document, { key: 'Escape' })
    expect(onClose).not.toHaveBeenCalled()

    const tabEvent = new KeyboardEvent('keydown', { key: 'Tab', cancelable: true })
    document.dispatchEvent(tabEvent)
    expect(tabEvent.defaultPrevented).toBe(false)
  })

  it('bounds the quantity to affordable rolls and disables conversion at zero balance', () => {
    setSignedInWallet(320)
    renderShop()

    const quantity = screen.getByLabelText('Roll quantity')
    const increase = screen.getByRole('button', { name: /increase roll quantity/i })
    const decrease = screen.getByRole('button', { name: /decrease roll quantity/i })

    expect(quantity).toHaveTextContent('1')
    expect(decrease).toBeDisabled()
    fireEvent.click(increase)
    expect(quantity).toHaveTextContent('2')
    expect(increase).toBeDisabled()

    act(() => {
      useWalletStore.setState({
        wallet: { stars: { promotional: 0 }, dust: { earned: 5 } },
      })
    })
    expect(screen.getByRole('button', { name: /convert 160 stars/i })).toBeDisabled()
  })

  it('guards double-clicks and shows pending then success state', async () => {
    setSignedInWallet()
    let resolveConversion: ((value: typeof receipt) => void) | undefined
    const convert = vi.fn(() => new Promise<typeof receipt>(resolve => {
      resolveConversion = resolve
    }))
    useWalletStore.setState({ convertStarsToStandardRoll: convert })
    renderShop()

    const convertButton = screen.getByRole('button', { name: /convert 160 stars/i })
    fireEvent.click(convertButton)
    fireEvent.click(convertButton)

    expect(convert).toHaveBeenCalledOnce()
    expect(screen.getByRole('button', { name: /converting/i })).toBeDisabled()

    resolveConversion?.(receipt)
    await waitFor(() => {
      expect(screen.getByText(/converted 1 roll.*balances updated/i)).toBeInTheDocument()
    })
    expect(screen.getByText(
      /converted 1 roll.*balances updated/i,
    )).toHaveAttribute('aria-live', 'polite')
  })

  it('caps a highly funded wallet at the RPC maximum of 100 rolls', async () => {
    setSignedInWallet(16_160)
    const convert = vi.fn().mockResolvedValue({
      ...receipt,
      rollCount: 100,
      starsDebited: 16_000,
    })
    useWalletStore.setState({ convertStarsToStandardRoll: convert })
    renderShop()

    expect(screen.getByText(/up to 100 rolls/i)).toBeInTheDocument()
    const increase = screen.getByRole('button', { name: /increase roll quantity/i })
    for (let count = 1; count < 105; count += 1) {
      fireEvent.click(increase)
    }

    expect(screen.getByLabelText('Roll quantity')).toHaveTextContent('100')
    expect(increase).toBeDisabled()
    fireEvent.click(screen.getByRole('button', { name: /convert 16000 stars/i }))

    await waitFor(() => {
      expect(convert).toHaveBeenCalledOnce()
    })
    expect(convert).toHaveBeenCalledWith(100)
  })

  it('maps typed insufficient-funds conversion failures to friendly copy', async () => {
    setSignedInWallet()
    useWalletStore.setState({
      convertStarsToStandardRoll: vi.fn().mockRejectedValue(
        new WalletConversionError(
          'balance check failed inside convert_stars_to_standard_roll',
          'insufficient_funds',
          '22003',
        ),
      ),
    })
    renderShop()

    fireEvent.click(screen.getByRole('button', { name: /convert 160 stars/i }))

    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent(
        "You don't have enough Stars for that conversion.",
      )
    })
    expect(screen.queryByText(
      /balance check failed inside convert_stars_to_standard_roll/i,
    )).not.toBeInTheDocument()
    expect(screen.getByRole('alert')).not.toHaveAttribute('aria-live', 'polite')
  })

  it('shows the six PO-locked bundles as disabled coming-soon cards only while payments are off', () => {
    setSignedInWallet()
    renderShop()

    const bundles = screen.getByRole('region', { name: /star bundles/i })
    expect(within(bundles).getAllByRole('button', { name: /coming soon/i })).toHaveLength(6)
    expect(within(bundles).getByRole('button', {
      name: /handful: 60 stars for \$0\.49/i,
    })).toBeDisabled()
    expect(within(bundles).getByRole('button', {
      name: /hoard: 8080 stars for \$49\.99/i,
    })).toBeDisabled()
  })

  it('single-sources the locked §3.1 Lunar offer values', () => {
    expect(LUNAR_PASS_OFFER).toEqual({
      priceUsd: 2.99,
      purchaseStars: 300,
      dailyStars: 90,
      monthlyStars: 3000,
    })
  })

  it.each([
    ['none', false, null, 'offer'],
    ['none', true, null, 'offer'],
    ['active', false, {
      status: 'active',
      dateNextCharge: '2999-01-01T00:00:00Z',
      dateEnd: null,
    }, 'claim'],
    ['active', true, {
      status: 'active',
      dateNextCharge: '2999-01-01T00:00:00Z',
      dateEnd: null,
    }, 'claim'],
    ['non-renewing', false, {
      status: 'non_renewing',
      dateNextCharge: '2999-01-01T00:00:00Z',
      dateEnd: null,
    }, 'claim'],
    ['non-renewing', true, {
      status: 'non_renewing',
      dateNextCharge: '2999-01-01T00:00:00Z',
      dateEnd: null,
    }, 'claim'],
    ['canceled future', false, {
      status: 'canceled',
      dateNextCharge: null,
      dateEnd: '2999-01-01T00:00:00Z',
    }, 'claim'],
    ['canceled future', true, {
      status: 'canceled',
      dateNextCharge: null,
      dateEnd: '2999-01-01T00:00:00Z',
    }, 'claim'],
    ['canceled past', false, {
      status: 'canceled',
      dateNextCharge: null,
      dateEnd: '2000-01-01T00:00:00Z',
    }, 'offer'],
    ['canceled past', true, {
      status: 'canceled',
      dateNextCharge: null,
      dateEnd: '2000-01-01T00:00:00Z',
    }, 'offer'],
  ] as const)(
    'maps %s with payments=%s and snapshot=%s to the %s state',
    (_label, paymentsEnabled, subscription, expected) => {
      vi.mocked(isPaymentsEnabled).mockReturnValue(paymentsEnabled)
      setSignedInWallet()
      if (subscription) {
        setSubscription(subscription.status, subscription)
      }
      renderShop()

      if (expected === 'claim') {
        expect(screen.getByRole('button', { name: /claim 90 stars/i })).toBeEnabled()
        expect(screen.getByLabelText(/daily lunar stars/i)).toBeInTheDocument()
        expect(screen.queryByRole('button', {
          name: /subscribe to lunar pass/i,
        })).not.toBeInTheDocument()
      } else {
        expect(screen.getByText('$2.99 / month')).toBeInTheDocument()
        expect(screen.getByRole('button', {
          name: paymentsEnabled
            ? /subscribe to lunar pass, unavailable/i
            : /subscribe to lunar pass, coming soon/i,
        })).toBeDisabled()
        expect(screen.queryByLabelText(/daily lunar stars/i)).not.toBeInTheDocument()
      }
    },
  )

  it('keeps an active subscription entitled when its optional renewal date is malformed', () => {
    setSignedInWallet()
    setSubscription('active', {
      dateNextCharge: 'not-a-date',
      dateEnd: null,
    })
    renderShop()

    expect(screen.getByText('Active')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /claim 90 stars/i })).toBeEnabled()
  })

  it('returns a bounded subscription to the offer at its strict entitlement boundary', () => {
    vi.useFakeTimers()
    try {
      vi.setSystemTime(new Date('2026-07-31T23:59:59.000Z'))
      setSignedInWallet()
      setSubscription('non_renewing', {
        dateNextCharge: '2026-08-01T00:00:00.000Z',
        dateEnd: null,
      })
      renderShop()

      expect(screen.getByRole('button', { name: /claim 90 stars/i })).toBeEnabled()
      act(() => {
        vi.advanceTimersByTime(1001)
      })
      expect(screen.getByRole('button', {
        name: /subscribe to lunar pass, coming soon/i,
      })).toBeDisabled()
    } finally {
      vi.useRealTimers()
    }
  })

  it('shows renewal/end dates and provider-managed cancellation copy', () => {
    setSignedInWallet()
    setSubscription('active', {
      dateNextCharge: '2999-01-01T00:00:00Z',
      dateEnd: null,
    })
    const { rerender } = renderShop()

    expect(screen.getByText(/active · renews jan 1, 2999/i)).toBeInTheDocument()
    expect(screen.getByText(/manage or cancel.*payment provider/i)).toBeInTheDocument()

    act(() => {
      setSubscription('non_renewing', {
        dateNextCharge: '2999-01-02T00:00:00Z',
        dateEnd: null,
      })
    })
    rerender(
      <ThemeContext.Provider
        value={{
          currentTheme: defaultTheme,
          setTheme: vi.fn(),
          availableThemes: [defaultTheme],
          ownedThemes: [defaultTheme.id],
          purchaseTheme: vi.fn(async () => true),
        }}
      >
        <ShopPanel isOpen onClose={vi.fn()} />
      </ThemeContext.Provider>,
    )
    expect(screen.getByText(/ends jan 2, 2999/i)).toBeInTheDocument()
  })

  it('places auto-renewal and cancellation disclosure beside the dormant offer', () => {
    setSignedInWallet()
    renderShop()

    expect(screen.getByText(
      /automatically renews monthly at \$2\.99 until canceled.*cancel anytime.*payment provider/i,
    )).toBeInTheDocument()
  })

  it('claims once, reconciles balances once, and shows the UTC reset state', async () => {
    const refreshBalances = vi.fn().mockResolvedValue(undefined)
    useWalletStore.setState({ refresh: refreshBalances })
    setSignedInWallet()
    setSubscription('active', {
      dateNextCharge: '2999-01-01T00:00:00Z',
      dateEnd: null,
    })
    renderShop()

    fireEvent.click(screen.getByRole('button', { name: /claim 90 stars/i }))

    await waitFor(() => {
      expect(screen.getByText('✓ 90 Stars claimed.')).toBeInTheDocument()
    })
    expect(screen.getByText(/resets at 00:00 utc \(in \d+h \d+m\)/i)).toBeInTheDocument()
    expect(claimLunarDailyStars).toHaveBeenCalledOnce()
    expect(refreshBalances).toHaveBeenCalledOnce()
  })

  it('maps an already-claimed receipt to claimed-today state', async () => {
    const refreshBalances = vi.fn().mockResolvedValue(undefined)
    vi.mocked(claimLunarDailyStars).mockResolvedValue({
      ...lunarReceipt,
      alreadyClaimed: true,
    })
    useWalletStore.setState({ refresh: refreshBalances })
    setSignedInWallet()
    setSubscription('active', {
      dateNextCharge: '2999-01-01T00:00:00Z',
      dateEnd: null,
    })
    renderShop()

    fireEvent.click(screen.getByRole('button', { name: /claim 90 stars/i }))

    await waitFor(() => {
      expect(screen.getByText('✓ Already claimed today.')).toBeInTheDocument()
    })
    expect(refreshBalances).toHaveBeenCalledOnce()
  })

  it('maps a typed not-entitled claim failure to friendly copy', async () => {
    vi.mocked(claimLunarDailyStars).mockRejectedValue(
      new LunarPassClaimError(
        'membership lookup failed inside claim_lunar_daily_stars',
        'not_entitled',
        '55000',
      ),
    )
    setSignedInWallet()
    setSubscription('active', {
      dateNextCharge: '2999-01-01T00:00:00Z',
      dateEnd: null,
    })
    renderShop()

    fireEvent.click(screen.getByRole('button', { name: /claim 90 stars/i }))

    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent(
        "An active Lunar Pass is needed to claim today's Stars.",
      )
    })
    expect(screen.queryByText(
      /membership lookup failed inside claim_lunar_daily_stars/i,
    )).not.toBeInTheDocument()
    expect(screen.getByRole('alert')).not.toHaveAttribute('aria-live', 'polite')
  })

  it('guards the Lunar daily claim against double taps', async () => {
    let resolveClaim: ((value: typeof lunarReceipt) => void) | undefined
    vi.mocked(claimLunarDailyStars).mockReturnValue(new Promise(resolve => {
      resolveClaim = resolve
    }))
    useWalletStore.setState({ refresh: vi.fn().mockResolvedValue(undefined) })
    setSignedInWallet()
    setSubscription('active', {
      dateNextCharge: '2999-01-01T00:00:00Z',
      dateEnd: null,
    })
    renderShop()

    const claimButton = screen.getByRole('button', { name: /claim 90 stars/i })
    fireEvent.click(claimButton)
    fireEvent.click(claimButton)

    expect(claimLunarDailyStars).toHaveBeenCalledOnce()
    expect(screen.getByRole('button', { name: /claiming/i })).toBeDisabled()

    resolveClaim?.(lunarReceipt)
    await waitFor(() => {
      expect(screen.getByText(/✓ 90 stars claimed/i)).toBeInTheDocument()
    })
  })

  it('ignores an old account claim completion after the wallet scope changes', async () => {
    let resolveClaim: ((value: typeof lunarReceipt) => void) | undefined
    const refreshBalances = vi.fn().mockResolvedValue(undefined)
    vi.mocked(claimLunarDailyStars).mockReturnValue(new Promise(resolve => {
      resolveClaim = resolve
    }))
    useWalletStore.setState({ refresh: refreshBalances })
    setSignedInWallet()
    setSubscription('active', {
      dateNextCharge: '2999-01-01T00:00:00Z',
      dateEnd: null,
    })
    renderShop()

    fireEvent.click(screen.getByRole('button', { name: /claim 90 stars/i }))
    expect(screen.getByRole('button', { name: /claiming/i })).toBeDisabled()

    act(() => {
      useWalletStore.setState({
        userId: 'user-2',
        subscription: {
          subscriptionId: 'sub-2',
          status: 'active',
          planId: 'plan-1',
          productId: 'lunar-pass',
          dateNextCharge: '2999-01-01T00:00:00Z',
          dateEnd: null,
        },
      })
    })
    expect(screen.getByRole('button', { name: /claim 90 stars/i })).toBeEnabled()

    await act(async () => {
      resolveClaim?.(lunarReceipt)
      await Promise.resolve()
    })

    expect(screen.getByRole('button', { name: /claim 90 stars/i })).toBeEnabled()
    expect(screen.queryByText(/✓ .*claimed/i)).not.toBeInTheDocument()
    expect(refreshBalances).not.toHaveBeenCalled()
  })

  it('clears claimed state at the exact next UTC boundary from the receipt day', async () => {
    vi.useFakeTimers()
    try {
      vi.setSystemTime(new Date('2026-07-31T23:59:59.500Z'))
      const refreshBalances = vi.fn().mockResolvedValue(undefined)
      vi.mocked(claimLunarDailyStars).mockResolvedValue({
        ...lunarReceipt,
        utcDay: '2026-07-31',
        claimedAt: '2026-07-31T23:59:59.500Z',
      })
      useWalletStore.setState({ refresh: refreshBalances })
      setSignedInWallet()
      setSubscription('active', {
        dateNextCharge: '2999-01-01T00:00:00Z',
        dateEnd: null,
      })
      renderShop()

      await act(async () => {
        fireEvent.click(screen.getByRole('button', { name: /claim 90 stars/i }))
        await Promise.resolve()
        await Promise.resolve()
      })
      expect(screen.getByText(/✓ 90 stars claimed/i)).toBeInTheDocument()

      act(() => {
        vi.advanceTimersByTime(499)
      })
      expect(screen.getByText(/✓ 90 stars claimed/i)).toBeInTheDocument()

      act(() => {
        vi.advanceTimersByTime(1)
      })
      expect(screen.getByRole('button', { name: /claim 90 stars/i })).toBeEnabled()
      expect(screen.queryByText(/✓ 90 stars claimed/i)).not.toBeInTheDocument()
    } finally {
      vi.useRealTimers()
    }
  })
})
