import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { BottomSheet } from './BottomSheet'

describe('BottomSheet accessibility', () => {
  it('exposes a modal dialog, closes on Escape, and restores focus', () => {
    const onClose = vi.fn()
    const trigger = document.createElement('button')
    trigger.textContent = 'Open'
    document.body.appendChild(trigger)
    trigger.focus()

    const { unmount } = render(
      <BottomSheet isOpen onClose={onClose} title="Rates">
        <button type="button">First action</button>
        <button type="button">Last action</button>
      </BottomSheet>,
    )

    const dialog = screen.getByRole('dialog', { name: 'Rates' })
    expect(dialog).toHaveAttribute('aria-modal', 'true')
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(onClose).toHaveBeenCalledOnce()

    unmount()
    expect(trigger).toHaveFocus()
    trigger.remove()
  })

  it('keeps focus in place when a parent rerender replaces onClose', async () => {
    const firstOnClose = vi.fn()
    const nextOnClose = vi.fn()
    const { rerender } = render(
      <BottomSheet isOpen onClose={firstOnClose} title="Rates">
        <button type="button">First action</button>
        <button type="button">Last action</button>
      </BottomSheet>,
    )
    const lastAction = screen.getByRole('button', { name: 'Last action' })
    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Close panel' })).toHaveFocus()
    })
    lastAction.focus()

    rerender(
      <BottomSheet isOpen onClose={nextOnClose} title="Rates">
        <button type="button">First action</button>
        <button type="button">Last action</button>
      </BottomSheet>,
    )

    expect(lastAction).toHaveFocus()
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(firstOnClose).not.toHaveBeenCalled()
    expect(nextOnClose).toHaveBeenCalledOnce()
  })
})
