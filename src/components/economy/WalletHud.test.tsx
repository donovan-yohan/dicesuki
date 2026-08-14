import { render, screen, within } from '@testing-library/react'
import type { ComponentProps } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { ThemeContext } from '../../contexts/ThemeContext'
import { defaultTheme } from '../../themes/tokens'
import { WalletBalanceSummary } from './WalletHud'

function renderBalanceSummary(props: Partial<ComponentProps<typeof WalletBalanceSummary>> = {}) {
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
      <WalletBalanceSummary
        stars={660}
        dust={12}
        standardTickets={4}
        premiumTickets={2}
        {...props}
      />
    </ThemeContext.Provider>,
  )
}

describe('WalletBalanceSummary', () => {
  it('groups available balances in one labelled wallet region with currency glyphs', () => {
    renderBalanceSummary({ stars: 19_840 })

    const wallet = screen.getByRole('region', { name: 'Wallet balances' })
    const balances = within(wallet).getByRole('list', { name: 'Available balances' })

    expect(within(balances).getAllByRole('listitem')).toHaveLength(4)
    expect(within(balances).getByTestId('wallet-stars')).toHaveTextContent((19_840).toLocaleString())
    expect(within(balances).getByTestId('wallet-dust')).toHaveTextContent('12')
    expect(within(balances).getByTestId('wallet-standard-rolls')).toHaveTextContent('4')
    expect(within(balances).getByTestId('wallet-premium-rolls')).toHaveTextContent('2')
    expect(
      within(balances).getByRole('listitem', { name: 'Standard rolls: 4' }),
    ).toHaveTextContent('Rolls')
    expect(wallet.querySelector('[data-currency-kind="stars"]')).toBeInTheDocument()
    expect(wallet.querySelector('[data-currency-kind="dust"]')).toBeInTheDocument()
    expect(wallet.querySelectorAll('[data-currency-kind="roll"]')).toHaveLength(2)
  })

  it('keeps the three base balances when premium tickets are zero and announces stale data', () => {
    renderBalanceSummary({ premiumTickets: 0, stale: true })

    expect(screen.getAllByRole('listitem')).toHaveLength(3)
    expect(screen.queryByTestId('wallet-premium-rolls')).not.toBeInTheDocument()
    expect(screen.getByRole('status')).toHaveAttribute('aria-live', 'polite')
    expect(screen.getByRole('status')).toHaveTextContent(/balances may be stale/i)
  })
})
