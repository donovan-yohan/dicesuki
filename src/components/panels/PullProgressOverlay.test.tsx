import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { PullProgressOverlay } from './PullProgressOverlay'

const preparation = {
  sessionId: '00000000-0000-4000-8000-000000000001',
  bannerVersionId: 'standard-banner@1',
  pullCount: 1 as const,
  heldAmount: 1,
  preparedAt: new Date(Date.now() - 1_000).toISOString(),
  expiresAt: new Date(Date.now() + 60_000).toISOString(),
  commitmentScheme: 'sha256',
  commitmentRoot: 'a'.repeat(64),
  rngScheme: 'hmac',
}

describe('PullProgressOverlay accessibility', () => {
  it('traps focus, cancels safely on Escape, and restores prior focus', () => {
    const onCancel = vi.fn()
    const trigger = document.createElement('button')
    document.body.appendChild(trigger)
    trigger.focus()
    const { unmount } = render(
      <PullProgressOverlay
        mode="hold"
        preparation={preparation}
        onRevealNow={vi.fn()}
        onCancel={onCancel}
        onExpired={vi.fn()}
      />,
    )
    expect(screen.getByRole('button', { name: 'Reveal now' })).toHaveFocus()
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(onCancel).toHaveBeenCalledOnce()
    unmount()
    expect(trigger).toHaveFocus()
    trigger.remove()
  })

  it('does not allow Escape to race an in-flight cancellation', () => {
    const onCancel = vi.fn()
    render(
      <PullProgressOverlay
        mode="hold"
        preparation={preparation}
        cancelling
        onRevealNow={vi.fn()}
        onCancel={onCancel}
        onExpired={vi.fn()}
      />,
    )
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(onCancel).not.toHaveBeenCalled()
  })

  it('keeps focus in place while using the latest parent onCancel callback', () => {
    const firstOnCancel = vi.fn()
    const nextOnCancel = vi.fn()
    const { rerender } = render(
      <PullProgressOverlay
        mode="hold"
        preparation={preparation}
        onRevealNow={vi.fn()}
        onCancel={firstOnCancel}
        onExpired={vi.fn()}
      />,
    )
    const cancelButton = screen.getByRole('button', { name: 'Cancel pull' })
    cancelButton.focus()

    rerender(
      <PullProgressOverlay
        mode="hold"
        preparation={preparation}
        onRevealNow={vi.fn()}
        onCancel={nextOnCancel}
        onExpired={vi.fn()}
      />,
    )

    expect(cancelButton).toHaveFocus()
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(firstOnCancel).not.toHaveBeenCalled()
    expect(nextOnCancel).toHaveBeenCalledOnce()
  })
})
