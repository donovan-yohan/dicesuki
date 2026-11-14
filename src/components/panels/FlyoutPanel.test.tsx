import { fireEvent, render, screen } from '@testing-library/react'
import { expect, it, vi } from 'vitest'
import { FlyoutPanel } from './FlyoutPanel'
it('provides a named Settings dialog, traps Tab and restores its opener on Escape', () => {
  const opener = document.createElement('button')
  document.body.append(opener)
  opener.focus()
  const close = vi.fn()
  const { rerender } = render(<FlyoutPanel manageFocus isOpen onClose={close} title="Settings"><button>Last action</button></FlyoutPanel>)
  const dialog = screen.getByRole('dialog', { name: 'Settings' })
  expect(dialog).toHaveAttribute('aria-modal', 'true')
  const last = screen.getByRole('button', { name: 'Last action' })
  last.focus()
  fireEvent.keyDown(document, { key: 'Tab' })
  expect(screen.getByRole('button', { name: 'Close panel' })).toHaveFocus()
  fireEvent.keyDown(document, { key: 'Escape' })
  expect(close).toHaveBeenCalledTimes(1)
  rerender(<FlyoutPanel manageFocus isOpen={false} onClose={close} title="Settings"><button>Last action</button></FlyoutPanel>)
  expect(opener).toHaveFocus()
  opener.remove()
})
