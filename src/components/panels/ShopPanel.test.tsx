import type { ReactNode } from 'react'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ThemeContext } from '../../contexts/ThemeContext'
import { isPaymentsEnabled } from '../../lib/paymentsConfig'
import { useAuthStore } from '../../store/useAuthStore'
import { useWalletStore } from '../../store/useWalletStore'
import { defaultTheme } from '../../themes/tokens'
import { ShopPanel } from './ShopPanel'

vi.mock('../../lib/paymentsConfig', () => ({
  isPaymentsEnabled: vi.fn(() => false),
}))

vi.mock('./BottomSheet', () => ({
  BottomSheet: ({ isOpen, children, title }: {
    isOpen: boolean
    children: ReactNode
    title: string
  }) => isOpen ? <section aria-label={title}>{children}</section> : null,
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

function renderShop() {
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
      <ShopPanel isOpen onClose={vi.fn()} />
    </ThemeContext.Provider>,
  )
}

function setSignedInWallet(stars = 320) {
  useAuthStore.setState({ status: 'authenticated' })
  useWalletStore.setState({
    userId: 'user-1',
    wallet: { stars: { promotional: stars }, dust: { earned: 5 } },
    tickets: { standard_roll: 1, premium_roll: 0 },
    stale: false,
  })
}

describe('ShopPanel', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(isPaymentsEnabled).mockReturnValue(false)
    useAuthStore.setState({ status: 'guest', user: null, profile: null })
    useWalletStore.getState().resetOnSignOut()
  })

  it('does not render for guests', () => {
    renderShop()
    expect(screen.queryByLabelText('Shop')).not.toBeInTheDocument()
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

  it('shows conversion failures inline', async () => {
    setSignedInWallet()
    useWalletStore.setState({
      convertStarsToStandardRoll: vi.fn().mockRejectedValue(new Error('Not enough Stars')),
    })
    renderShop()

    fireEvent.click(screen.getByRole('button', { name: /convert 160 stars/i }))

    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent('Not enough Stars')
    })
  })

  it('shows the six PO-locked bundles as disabled coming-soon cards only while payments are off', () => {
    setSignedInWallet()
    renderShop()

    expect(screen.getAllByRole('button', { name: /coming soon/i })).toHaveLength(6)
    expect(screen.getByRole('button', { name: /handful: 60 stars for \$0\.49/i })).toBeDisabled()
    expect(screen.getByRole('button', { name: /hoard: 8080 stars for \$49\.99/i })).toBeDisabled()
  })
})
