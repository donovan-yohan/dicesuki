import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ThemeSelector } from './ThemeSelector'
import { ThemeContext, type ThemeContextValue } from '../contexts/ThemeContext'
import { useAuthStore } from '../store/useAuthStore'
import type { Theme } from '../themes/tokens'

/**
 * Priced themes are a storefront, so they obey the economy access flag.
 *
 * These cases are the behavioural counterpart to the source scan in
 * `src/components/economy/economyAccessGate.guard.test.ts`. They are written
 * against an UNOWNED priced theme, which the shipped `ThemeProvider` cannot
 * currently produce (it dev-grants every theme id) — that is exactly the point:
 * the gate has to be right before theme ownership becomes real, not after.
 */

const FREE_THEME = { id: 'default', name: 'Default', description: 'Free', price: 0 } as unknown as Theme
const PAID_THEME = { id: 'cozy-forest', name: 'Cozy Forest', description: 'Paid', price: 299 } as unknown as Theme

function renderSelector({
  economyAccess,
  ownedThemes = ['default'],
  purchaseTheme = vi.fn().mockResolvedValue(true),
}: {
  economyAccess: boolean
  ownedThemes?: string[]
  purchaseTheme?: ThemeContextValue['purchaseTheme']
}) {
  useAuthStore.setState({
    status: economyAccess ? 'authenticated' : 'guest',
    isConfigured: true,
    user: null,
    profile: null,
    economyAccess,
  })

  const value: ThemeContextValue = {
    currentTheme: FREE_THEME,
    setTheme: vi.fn().mockReturnValue(true),
    availableThemes: [FREE_THEME, PAID_THEME],
    ownedThemes,
    purchaseTheme,
  }

  render(
    <ThemeContext.Provider value={value}>
      <ThemeSelector isOpen onClose={vi.fn()} />
    </ThemeContext.Provider>,
  )
  return { purchaseTheme }
}

describe('ThemeSelector economy gate', () => {
  beforeEach(() => {
    useAuthStore.setState({
      status: 'guest',
      isConfigured: true,
      user: null,
      profile: null,
      economyAccess: false,
    })
  })

  it('shows no price and no purchase affordance to an un-flagged player', () => {
    renderSelector({ economyAccess: false })

    expect(screen.queryByText('$2.99')).not.toBeInTheDocument()
    expect(screen.queryByText(/click to purchase/i)).not.toBeInTheDocument()
  })

  it('hides an unowned priced theme entirely from an un-flagged player', () => {
    renderSelector({ economyAccess: false })

    expect(screen.queryByText('Cozy Forest')).not.toBeInTheDocument()
    // The free theme they do own is unaffected — this gate hides a storefront,
    // not the theme picker.
    expect(screen.getByText('Default')).toBeInTheDocument()
  })

  it('shows the price and purchase affordance to a flagged player', () => {
    renderSelector({ economyAccess: true })

    expect(screen.getByText('$2.99')).toBeInTheDocument()
    expect(screen.getByText(/click to purchase/i)).toBeInTheDocument()
    expect(screen.getByText('Cozy Forest')).toBeInTheDocument()
  })

  it('still lists an owned priced theme for an un-flagged player, with no price', () => {
    renderSelector({ economyAccess: false, ownedThemes: ['default', 'cozy-forest'] })

    expect(screen.getByText('Cozy Forest')).toBeInTheDocument()
    expect(screen.queryByText('$2.99')).not.toBeInTheDocument()
    expect(screen.getByText('Owned')).toBeInTheDocument()
  })

  it('never buys a PRICED theme for an un-flagged player', async () => {
    // Render the priced theme despite the gate by flipping access on, then
    // revoke it before clicking: proves the click handler itself refuses, not
    // just the rendering filter.
    const purchaseTheme = vi.fn().mockResolvedValue(true)
    renderSelector({ economyAccess: true, ownedThemes: [], purchaseTheme })
    useAuthStore.setState({ economyAccess: false })

    await userEvent.click(screen.getByText('Cozy Forest'))

    expect(purchaseTheme).not.toHaveBeenCalled()
  })

  it('still lets an un-flagged player select a FREE unowned theme', async () => {
    // `purchaseTheme` doubles as the free-theme grant path (price === 0 just
    // marks it owned). Themes are part of the un-flagged experience, so gating
    // this would lock a player out of a theme that costs nothing — the exact
    // over-reach an access-based gate causes and a price-based gate does not.
    const purchaseTheme = vi.fn().mockResolvedValue(true)
    renderSelector({ economyAccess: false, ownedThemes: [], purchaseTheme })

    await userEvent.click(screen.getByText('Default'))

    expect(purchaseTheme).toHaveBeenCalledWith('default')
  })

  it('calls purchaseTheme for a flagged player buying an unowned theme', async () => {
    const purchaseTheme = vi.fn().mockResolvedValue(true)
    renderSelector({ economyAccess: true, ownedThemes: ['default'], purchaseTheme })

    await userEvent.click(screen.getByText('Cozy Forest'))

    expect(purchaseTheme).toHaveBeenCalledWith('cozy-forest')
  })
})
