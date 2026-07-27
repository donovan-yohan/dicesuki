import { render, screen } from '@testing-library/react'
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
  it('renders Stars, Dust, standard tickets, and nonzero premium tickets for ShopPanel', () => {
    renderBalanceSummary()

    expect(screen.getByTestId('wallet-stars')).toHaveTextContent('660')
    expect(screen.getByTestId('wallet-dust')).toHaveTextContent('12')
    expect(screen.getByTestId('wallet-standard-rolls')).toHaveTextContent('4')
    expect(screen.getByTestId('wallet-premium-rolls')).toHaveTextContent('2')
  })

  it('omits zero premium tickets and announces stale balances', () => {
    renderBalanceSummary({ premiumTickets: 0, stale: true })

    expect(screen.queryByTestId('wallet-premium-rolls')).not.toBeInTheDocument()
    expect(screen.getByRole('status')).toHaveTextContent(/balances may be stale/i)
  })
})
