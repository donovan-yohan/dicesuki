/**
 * Focus and dismissal for a modal dialog opened from INSIDE another overlay.
 *
 * `BottomSheet` runs its own Escape/Tab handling on `document`, and yields the
 * moment a nested `[role="dialog"][aria-modal="true"]` is mounted. That yield is
 * only safe if the nested dialog then does the job itself — a nested dialog that
 * declares `aria-modal` but handles nothing leaves Escape dead and lets Tab walk
 * out onto the page behind it. This hook is that other half of the contract, and
 * it exists once so the two nested dialogs cannot drift apart.
 *
 * It provides:
 * - focus moved into the dialog on open, and restored to the opener on close;
 * - a Tab trap scoped to the dialog, STOPPED so the host sheet's trap never
 *   sees it and cannot pull focus back behind us;
 * - Escape, likewise stopped, so one Escape dismisses one dialog;
 * - backdrop dismissal that requires the press AND the release on the backdrop.
 */

import { useCallback, useEffect, useRef } from 'react'
import type { KeyboardEvent as ReactKeyboardEvent, MouseEvent as ReactMouseEvent, RefObject } from 'react'

/** Focusable descendants — the same selector `BottomSheet` traps with. */
export const DIALOG_FOCUSABLE_SELECTOR = [
  'button:not([disabled])',
  '[href]',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(',')

export interface NestedDialogProps<T extends HTMLElement> {
  /** Attach to the dialog element (the one carrying `role="dialog"`). */
  dialogRef: RefObject<T | null>
  /** Attach to the dialog element: owns Escape and Tab, and stops both. */
  onKeyDown: (event: ReactKeyboardEvent<T>) => void
  /** Spread onto the backdrop element that wraps the dialog. */
  backdropProps: {
    role: 'presentation'
    onMouseDown: (event: ReactMouseEvent<HTMLElement>) => void
    onMouseUp: (event: ReactMouseEvent<HTMLElement>) => void
    onClick: (event: ReactMouseEvent<HTMLElement>) => void
  }
}

export function useNestedDialog<T extends HTMLElement>(onClose: () => void): NestedDialogProps<T> {
  const dialogRef = useRef<T | null>(null)
  const previouslyFocusedRef = useRef<HTMLElement | null>(null)
  // Read through a ref so a caller passing a fresh closure each render does not
  // re-run the focus effect and steal focus back on every keystroke.
  const onCloseRef = useRef(onClose)
  onCloseRef.current = onClose

  useEffect(() => {
    previouslyFocusedRef.current = document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null
    const dialog = dialogRef.current
    const frame = window.requestAnimationFrame(() => {
      const first = dialog?.querySelector<HTMLElement>(DIALOG_FOCUSABLE_SELECTOR)
      ;(first ?? dialog)?.focus()
    })

    return () => {
      window.cancelAnimationFrame(frame)
      previouslyFocusedRef.current?.focus()
      previouslyFocusedRef.current = null
    }
  }, [])

  const onKeyDown = useCallback((event: ReactKeyboardEvent<T>) => {
    if (event.key === 'Escape') {
      event.preventDefault()
      event.stopPropagation()
      onCloseRef.current()
      return
    }

    if (event.key !== 'Tab') return
    const dialog = dialogRef.current
    if (!dialog) return

    event.stopPropagation()
    const focusable = Array.from(dialog.querySelectorAll<HTMLElement>(DIALOG_FOCUSABLE_SELECTOR))
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
  }, [])

  /**
   * Backdrop dismissal needs BOTH halves of the gesture on the backdrop.
   *
   * Checking the `click` target alone is not enough: when a press starts on the
   * backdrop and the release lands inside the dialog, the browser fires `click`
   * on their nearest common ancestor — the backdrop — so the dialog would be
   * dismissed by a gesture that ended inside it. Recording press and release
   * separately is what distinguishes a real backdrop tap from a stray click the
   * backdrop merely received, which also covers a tile being re-rendered out
   * from under the cursor and a drag-select that ends outside the dialog.
   */
  const pressedOnBackdropRef = useRef(false)
  const releasedOnBackdropRef = useRef(false)

  const onMouseDown = useCallback((event: ReactMouseEvent<HTMLElement>) => {
    pressedOnBackdropRef.current = event.target === event.currentTarget
    releasedOnBackdropRef.current = false
  }, [])

  const onMouseUp = useCallback((event: ReactMouseEvent<HTMLElement>) => {
    releasedOnBackdropRef.current = event.target === event.currentTarget
  }, [])

  const onClick = useCallback(() => {
    const dismissed = pressedOnBackdropRef.current && releasedOnBackdropRef.current
    pressedOnBackdropRef.current = false
    releasedOnBackdropRef.current = false
    if (dismissed) onCloseRef.current()
  }, [])

  return {
    dialogRef,
    onKeyDown,
    backdropProps: { role: 'presentation', onMouseDown, onMouseUp, onClick },
  }
}
