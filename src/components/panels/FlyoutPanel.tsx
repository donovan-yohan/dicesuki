/**
 * FlyoutPanel Base Component
 *
 * Reusable slide-in panel with backdrop, theming, and animations.
 * Used for DiceManager, History, and Settings panels.
 */

import { motion, AnimatePresence } from 'framer-motion'
import { ReactNode, useEffect, useId, useRef } from 'react'
import { shouldReduceMotion } from '../../animations/ui-transitions'

interface FlyoutPanelProps {
  isOpen: boolean
  onClose: () => void
  title: string
  position?: 'left' | 'right'
  width?: string
  manageFocus?: boolean
  focusSuspended?: boolean
  children: ReactNode
}

export function FlyoutPanel({
  isOpen,
  onClose,
  title,
  position = 'left',
  width = '320px',
  children,
  manageFocus = false,
  focusSuspended = false,
}: FlyoutPanelProps) {
  const reduceMotion = shouldReduceMotion()
  const dialog = useRef<HTMLDivElement>(null)
  const titleId = useId()
  const closeRef = useRef(onClose)
  const suspendedRef = useRef(focusSuspended)
  closeRef.current = onClose
  suspendedRef.current = focusSuspended
  useEffect(() => {
    if (!isOpen || !manageFocus) return
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null
    const root = dialog.current
    root?.focus()
    const keydown = (event: KeyboardEvent) => {
      if (suspendedRef.current || root?.querySelector('[role="dialog"][aria-modal="true"]')) return
      if (event.key === 'Escape') { event.preventDefault(); closeRef.current(); return }
      if (event.key !== 'Tab' || !root) return
      const items = [...root.querySelectorAll<HTMLElement>('button:not([disabled]), a[href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex="0"]')]
      const first = items[0]
      const last = items[items.length - 1]
      if (!first) { event.preventDefault(); root.focus() }
      else if (event.shiftKey && (document.activeElement === first || document.activeElement === root)) { event.preventDefault(); last.focus() }
      else if (!event.shiftKey && (document.activeElement === last || !root.contains(document.activeElement))) { event.preventDefault(); first.focus() }
    }
    document.addEventListener('keydown', keydown)
    return () => { document.removeEventListener('keydown', keydown); if (opener?.isConnected) opener.focus() }
  }, [isOpen, manageFocus])

  const panelVariants = {
    hidden: {
      x: position === 'left' ? '-100%' : '100%',
      opacity: 0,
    },
    visible: {
      x: 0,
      opacity: 1,
      transition: {
        type: 'spring' as const,
        damping: 25,
        stiffness: 200,
      },
    },
    exit: {
      x: position === 'left' ? '-100%' : '100%',
      opacity: 0,
      transition: {
        duration: 0.2,
      },
    },
  }

  const backdropVariants = {
    hidden: { opacity: 0 },
    visible: { opacity: 1 },
    exit: { opacity: 0 },
  }

  return (
    <AnimatePresence>
      {isOpen && (
        <>
          {/* Backdrop */}
          <motion.div
            className="fixed inset-0 z-50"
            style={{
              backgroundColor: 'rgba(0, 0, 0, 0.6)',
              backdropFilter: 'blur(4px)',
              WebkitBackdropFilter: 'blur(4px)',
            }}
            variants={backdropVariants}
            initial="hidden"
            animate={reduceMotion ? 'visible' : 'visible'}
            exit={reduceMotion ? 'hidden' : 'exit'}
            onClick={onClose}
          />

          {/* Panel */}
          <motion.div
            ref={dialog}
            role={manageFocus ? 'dialog' : undefined}
            aria-modal={manageFocus ? true : undefined}
            aria-labelledby={manageFocus ? titleId : undefined}
            tabIndex={-1}
            className={`theme-panel fixed top-0 ${position === 'left' ? 'left-0' : 'right-0'} h-full z-50 flex flex-col overflow-hidden`}
            style={{
              width,
              maxWidth: '90vw',
              backgroundColor: 'var(--color-surface)',
              boxShadow: position === 'left'
                ? 'var(--ui-flyout-shadow-left)'
                : 'var(--ui-flyout-shadow-right)',
              color: 'var(--color-text-primary)',
              borderRight: position === 'left' ? '1px solid var(--color-accent)' : 'none',
              borderLeft: position === 'right' ? '1px solid var(--color-accent)' : 'none',
            }}
            variants={panelVariants}
            initial="hidden"
            animate={reduceMotion ? 'visible' : 'visible'}
            exit={reduceMotion ? 'hidden' : 'exit'}
          >
            {/* Header */}
            <div
              className="flex items-center justify-between px-6 py-4 border-b"
              style={{
                borderColor: 'var(--ui-border)',
                backgroundColor: 'var(--ui-inset)',
              }}
            >
              <h2 id={titleId}
                className="text-xl font-bold"
                style={{ color: 'var(--color-text-primary)' }}
              >
                {title}
              </h2>
              <button
                onClick={onClose}
                className="w-8 h-8 flex items-center justify-center rounded-full transition-all"
                style={{
                  backgroundColor: 'var(--ui-control-10)',
                  color: 'var(--color-text-secondary)',
                }}
                aria-label="Close panel"
              >
                ✕
              </button>
            </div>

            {/* Content */}
            <div className="flex-1 overflow-y-auto p-6">
              {children}
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  )
}
