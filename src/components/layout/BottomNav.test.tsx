import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { ThemeContext } from '../../contexts/ThemeContext'
import { defaultTheme } from '../../themes/tokens'
import { BottomNav } from './BottomNav'

function renderNav() {
  const handlers = {
    onOpenDiceManager: vi.fn(),
    onOpenSavedRolls: vi.fn(),
    onOpenHistory: vi.fn(),
    onOpenPlayerPanel: vi.fn(),
  }

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
      <BottomNav isVisible {...handlers} />
    </ThemeContext.Provider>,
  )

  return handlers
}

describe('BottomNav Layout A', () => {
  it('keeps the exact five-slot order: Dice Manager, Saved Rolls, ROLL, History, Players', () => {
    renderNav()

    const nav = screen.getByRole('navigation')
    expect(Array.from(nav.querySelectorAll<HTMLElement>('[data-nav-item]')).map(item => item.dataset.navItem)).toEqual([
      'Dice Manager',
      'Saved Rolls',
      'ROLL',
      'Roll History',
      'Players/Room',
    ])
    expect(screen.queryByRole('button', { name: 'Shop' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Toggle UI' })).not.toBeInTheDocument()
  })

  it('routes each moved action through its matching callback', () => {
    const handlers = renderNav()

    fireEvent.click(screen.getByRole('button', { name: 'Manage Dice' }))
    fireEvent.click(screen.getByRole('button', { name: 'My Dice Rolls' }))
    fireEvent.click(screen.getByRole('button', { name: 'Roll History' }))
    fireEvent.click(screen.getByRole('button', { name: 'Room Players' }))

    expect(handlers.onOpenDiceManager).toHaveBeenCalledOnce()
    expect(handlers.onOpenSavedRolls).toHaveBeenCalledOnce()
    expect(handlers.onOpenHistory).toHaveBeenCalledOnce()
    expect(handlers.onOpenPlayerPanel).toHaveBeenCalledOnce()
  })
})
