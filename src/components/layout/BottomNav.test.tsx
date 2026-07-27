import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { ThemeContext } from '../../contexts/ThemeContext'
import { defaultTheme } from '../../themes/tokens'
import { BottomNav } from './BottomNav'

function renderNav(rollDisabled = false) {
  const handlers = {
    onOpenDiceManager: vi.fn(),
    onOpenSavedRolls: vi.fn(),
    onOpenHistory: vi.fn(),
    onOpenPlayerPanel: vi.fn(),
    onRoll: vi.fn(),
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
      <BottomNav isVisible rollDisabled={rollDisabled} {...handlers} />
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

  it('fills the ROLL slot with the real roll button centred between Saved Rolls and Roll History', () => {
    const handlers = renderNav()

    const nav = screen.getByRole('navigation')
    const roll = screen.getByRole('button', { name: 'Roll dice' })

    // The ROLL slot is the actual button, not a spacer standing in for it.
    expect(nav.querySelector('[data-nav-item="ROLL"]')).toBe(roll)
    expect(roll.tagName).toBe('BUTTON')
    fireEvent.click(roll)
    expect(handlers.onRoll).toHaveBeenCalledOnce()

    // Its centre-x is the nav's centre-x: left 50% of the nav, pulled back by
    // half its own width. jsdom has no layout engine, so the geometry is
    // asserted from the resolved box; e2e/hud-layout.spec.ts measures the real
    // centre-x ordering in a browser at every supported viewport.
    expect(roll.className).toContain('absolute')
    expect(roll.style.left).toBe('50%')
    expect(roll.style.width).toBe('70px')
    expect(roll.style.marginLeft).toBe('-35px')
    expect(roll.style.top).toBe('50%')
    expect(roll.style.marginTop).toBe('-35px')

    // Saved Rolls sits in the leading flex group, Roll History in the trailing
    // one, so the centred button falls between them.
    const groups = Array.from(nav.children)
    const savedRolls = screen.getByRole('button', { name: 'My Dice Rolls' })
    const history = screen.getByRole('button', { name: 'Roll History' })
    expect(groups.findIndex(group => group.contains(savedRolls))).toBe(0)
    expect(groups.findIndex(group => group.contains(roll))).toBe(1)
    expect(groups.findIndex(group => group.contains(history))).toBe(2)
  })

  it('disables the roll button when the table is empty', () => {
    const handlers = renderNav(true)

    const roll = screen.getByRole('button', { name: 'Cannot roll' })
    expect(roll).toBeDisabled()
    fireEvent.click(roll)
    expect(handlers.onRoll).not.toHaveBeenCalled()
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
