import { useEffect, useMemo, useRef, useState } from 'react'
import type { PullPrepareReceipt } from '../../types/pull'

interface PullProgressOverlayProps {
  mode: 'sealing' | 'hold' | 'restoring'
  preparation?: PullPrepareReceipt
  error?: string | null
  cancelling?: boolean
  onRevealNow: () => void
  onCancel: () => void
  onExpired: () => void
}

export function PullProgressOverlay({
  mode,
  preparation,
  error,
  cancelling = false,
  onRevealNow,
  onCancel,
  onExpired,
}: PullProgressOverlayProps) {
  const dialogRef = useRef<HTMLDivElement>(null)
  const previouslyFocusedRef = useRef<HTMLElement | null>(null)
  const onCancelRef = useRef(onCancel)
  onCancelRef.current = onCancel
  const expiresAt = preparation ? Date.parse(preparation.expiresAt) : null
  const [now, setNow] = useState(Date.now())
  const secondsRemaining = expiresAt === null
    ? null
    : Math.max(0, Math.ceil((expiresAt - now) / 1000))

  useEffect(() => {
    if (mode !== 'hold' || expiresAt === null) return
    const timer = window.setInterval(() => setNow(Date.now()), 250)
    return () => window.clearInterval(timer)
  }, [expiresAt, mode])

  useEffect(() => {
    if (mode === 'hold' && secondsRemaining === 0) onExpired()
  }, [mode, onExpired, secondsRemaining])

  useEffect(() => {
    previouslyFocusedRef.current = document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null
    const dialog = dialogRef.current
    const selector = 'button:not([disabled]), [href], [tabindex]:not([tabindex="-1"])'
    ;(dialog?.querySelector<HTMLElement>(selector) ?? dialog)?.focus()
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && mode === 'hold' && !cancelling) {
        event.preventDefault()
        onCancelRef.current()
        return
      }
      if (event.key !== 'Tab' || !dialog) return
      const focusable = Array.from(dialog.querySelectorAll<HTMLElement>(selector))
      if (focusable.length === 0) {
        event.preventDefault()
        dialog.focus()
        return
      }
      const first = focusable[0]
      const last = focusable[focusable.length - 1]
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault()
        first.focus()
      }
    }
    document.addEventListener('keydown', handleKeyDown)
    return () => {
      document.removeEventListener('keydown', handleKeyDown)
      previouslyFocusedRef.current?.focus()
      previouslyFocusedRef.current = null
    }
  }, [cancelling, mode])

  const countdown = useMemo(() => {
    if (secondsRemaining === null) return null
    const minutes = Math.floor(secondsRemaining / 60)
    const seconds = secondsRemaining % 60
    return `${minutes}:${seconds.toString().padStart(2, '0')}`
  }, [secondsRemaining])

  return (
    <div
      className="fixed inset-0 z-[70] flex items-center justify-center p-5"
      style={{ backgroundColor: 'var(--color-background)' }}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="pull-progress-title"
        tabIndex={-1}
        className="w-full max-w-md text-center"
      >
        <h2 id="pull-progress-title" className="text-2xl font-bold">
          {mode === 'sealing'
            ? 'Sealing your pull…'
            : mode === 'restoring'
              ? 'Restoring your pull…'
              : 'Finishing your pull…'}
        </h2>
        {mode === 'hold' && countdown && (
          <p className="mt-4" aria-live="polite">
            Hold expires in {countdown}
          </p>
        )}
        {error && (
          <p role="alert" className="mt-3" style={{ color: 'var(--color-accent)' }}>
            Couldn&apos;t finish yet. Your hold is safe. {error}
          </p>
        )}
        {mode === 'hold' && (
          <div className="mt-6 grid gap-3">
            <button
              type="button"
              className="min-h-11 rounded-md px-4 font-bold"
              style={{
                color: 'var(--color-background)',
                backgroundColor: 'var(--color-accent)',
              }}
              onClick={onRevealNow}
              disabled={cancelling}
            >
              Reveal now
            </button>
            <button
              type="button"
              className="min-h-11 px-4"
              onClick={onCancel}
              disabled={cancelling}
            >
              {cancelling ? 'Cancelling…' : 'Cancel pull'}
            </button>
            <p className="text-sm" style={{ color: 'var(--color-text-secondary)' }}>
              Cancelling releases the hold. No rolls are spent.
            </p>
          </div>
        )}
      </div>
    </div>
  )
}
