import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ThemeContext } from '../../contexts/ThemeContext'
import { isPaymentsEnabled } from '../../lib/paymentsConfig'
import { useAuthStore } from '../../store/useAuthStore'
import { defaultTheme } from '../../themes/tokens'
import { BottomNav } from './BottomNav'

vi.mock('../../lib/paymentsConfig', () => ({
  isPaymentsEnabled: vi.fn(() => false),
}))

function renderNav(onOpenShop = vi.fn()) {
  render(
    <ThemeContext.Provider
      value={{
        currentTheme: defaultTheme,
        setTheme: vi.fn(),
        availableThemes: [defaultTheme],
        ownedThemes: [defaultTheme.id],
        purchaseTheme: vi.fn(async () => true),
      }}
    >
      <BottomNav
        isVisible
        onToggleUI={vi.fn()}
        onOpenDiceManager={vi.fn()}
        onOpenHistory={vi.fn()}
        onOpenShop={onOpenShop}
        isMobile={false}
      />
    </ThemeContext.Provider>,
  )
  return onOpenShop
}

describe('BottomNav shop entry', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    useAuthStore.setState({ status: 'guest', user: null, profile: null })
  })

  it.each([false, true])(
    'keeps the shop hidden for guests when payments enabled is %s',
    (paymentsEnabled) => {
      vi.mocked(isPaymentsEnabled).mockReturnValue(paymentsEnabled)
      renderNav()
      expect(screen.queryByRole('button', { name: 'Shop' })).not.toBeInTheDocument()
    },
  )

  it.each([false, true])(
    'shows the free conversion shop for signed-in users when payments enabled is %s',
    (paymentsEnabled) => {
      vi.mocked(isPaymentsEnabled).mockReturnValue(paymentsEnabled)
      useAuthStore.setState({ status: 'authenticated' })
      const onOpenShop = renderNav()

      fireEvent.click(screen.getByRole('button', { name: 'Shop' }))
      expect(onOpenShop).toHaveBeenCalledOnce()
    },
  )
})
