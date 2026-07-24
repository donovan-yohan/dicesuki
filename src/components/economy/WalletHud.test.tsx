import { act, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ThemeContext } from '../../contexts/ThemeContext'
import { useAuthStore } from '../../store/useAuthStore'
import { useWalletStore } from '../../store/useWalletStore'
import { defaultTheme } from '../../themes/tokens'
import { WalletHud } from './WalletHud'
import { getWalletHudLayoutBounds } from './walletHudLayout'

function renderHud() {
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
      <WalletHud />
    </ThemeContext.Provider>,
  )
}

describe('WalletHud', () => {
  beforeEach(() => {
    useAuthStore.setState({ status: 'guest', user: null, profile: null })
    useWalletStore.getState().resetOnSignOut()
  })

  it('hides for guests and before the authenticated wallet is initialized', () => {
    const guestRender = renderHud()
    expect(screen.queryByLabelText('Wallet')).not.toBeInTheDocument()
    guestRender.unmount()

    useAuthStore.setState({ status: 'authenticated' })
    renderHud()
    expect(screen.queryByLabelText('Wallet')).not.toBeInTheDocument()
  })

  it('renders Stars, Dust, standard tickets, and nonzero premium tickets', () => {
    useAuthStore.setState({ status: 'authenticated' })
    useWalletStore.setState({
      userId: 'user-1',
      wallet: {
        stars: { promotional: 640, paid: 20 },
        dust: { earned: 12 },
      },
      tickets: { standard_roll: 4, premium_roll: 2 },
      stale: false,
    })

    renderHud()

    expect(screen.getByTestId('wallet-stars')).toHaveTextContent('660')
    expect(screen.getByTestId('wallet-dust')).toHaveTextContent('12')
    expect(screen.getByTestId('wallet-standard-rolls')).toHaveTextContent('4')
    expect(screen.getByTestId('wallet-premium-rolls')).toHaveTextContent('2')
  })

  it('omits zero premium tickets and marks a previously fresh balance stale', () => {
    useAuthStore.setState({ status: 'authenticated' })
    useWalletStore.setState({
      userId: 'user-1',
      wallet: { stars: { promotional: 160 }, dust: { earned: 3 } },
      tickets: { standard_roll: 1, premium_roll: 0 },
      stale: false,
    })

    renderHud()

    expect(screen.queryByTestId('wallet-premium-rolls')).not.toBeInTheDocument()
    act(() => {
      useWalletStore.setState({ stale: true })
    })
    expect(screen.getByRole('status')).toHaveTextContent(/balances may be stale/i)
  })

  it('hides initial pending and failed loads, then retains a stale prior snapshot', async () => {
    useAuthStore.setState({ status: 'authenticated' })
    useWalletStore.setState({
      userId: 'user-1',
      loading: true,
      stale: true,
    })
    renderHud()

    expect(screen.queryByLabelText('Wallet')).not.toBeInTheDocument()

    act(() => {
      useWalletStore.setState({ loading: false, stale: true })
    })
    expect(screen.queryByLabelText('Wallet')).not.toBeInTheDocument()

    act(() => {
      useWalletStore.setState({
        wallet: { stars: { promotional: 480 }, dust: { earned: 9 } },
        tickets: { standard_roll: 3, premium_roll: 0 },
        loading: false,
        stale: false,
      })
    })
    await waitFor(() => {
      expect(screen.getByLabelText('Wallet')).toBeInTheDocument()
    })

    act(() => {
      useWalletStore.setState({ stale: true })
    })
    expect(screen.getByLabelText('Wallet')).toBeInTheDocument()
    expect(screen.getByRole('status')).toHaveTextContent(/balances may be stale/i)
  })

  it('keeps a narrow portrait HUD right of center and between core overlay lanes', () => {
    useAuthStore.setState({ status: 'authenticated' })
    useWalletStore.setState({
      userId: 'user-1',
      loading: false,
      stale: false,
    })
    renderHud()

    const wallet = screen.getByLabelText('Wallet')
    const unit = defaultTheme.tokens.spacing.unit
    const unitValue = Number.parseFloat(unit)
    const unitName = unit.slice(String(unitValue).length)
    const spacingUnitPx = unitValue * 16
    const viewport = { width: 320, height: 568 }
    const bounds = getWalletHudLayoutBounds(
      viewport.width,
      viewport.height,
      spacingUnitPx,
    )
    const resultRegionBottom = viewport.height * 0.4 + 32

    expect(bounds.left).toBeGreaterThan(viewport.width / 2)
    expect(bounds.right).toBeLessThanOrEqual(viewport.width)
    expect(bounds.top).toBeGreaterThan(resultRegionBottom)
    expect(bounds.bottomClearance).toBe(144)
    expect(bounds.bottom).toBe(424)
    expect(bounds.maxHeight).toBeGreaterThan(0)
    expect(bounds.zIndex).toBeLessThan(20)

    expect(wallet).toHaveAttribute('data-layout-slot', 'bottom-right-hud')
    expect(wallet.style.right).toBe(`calc(${unitValue * 4}${unitName})`)
    expect(wallet.style.bottom).toBe(`calc(${unitValue * 36}${unitName})`)
    expect(wallet.style.width).toBe(`calc(${unitValue * 34}${unitName})`)
    expect(wallet.style.maxWidth).toContain('50%')
    expect(wallet.style.maxHeight).toContain('60vh')
    expect(wallet.style.overflowY).toBe('auto')
    expect(wallet.style.zIndex).toBe('10')
    expect(wallet.style.transform).toBe('')
  })
})
