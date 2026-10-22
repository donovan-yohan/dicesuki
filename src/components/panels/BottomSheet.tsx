/**
 * BottomSheet Component
 *
 * Mobile-friendly bottom sheet panel with drag-to-dismiss.
 * Similar to FlyoutPanel but slides up from bottom.
 */

import { motion, AnimatePresence, PanInfo, useDragControls } from 'framer-motion'
import { ReactNode, useEffect, useId, useRef, useState } from 'react'
import { shouldReduceMotion } from '../../animations/ui-transitions'

interface BottomSheetProps {
  isOpen: boolean
  onClose: () => void
  title: string
  height?: string // e.g., "80vh", "600px"
  children: ReactNode
  showHandle?: boolean // Show drag handle at top
  /**
   * Extra classes for the sheet container, intended for desktop-only widening
   * (e.g. `lg:mx-auto lg:max-w-5xl`). The sheet is `fixed` with `left-0
   * right-0`, so `mx-auto` plus a `max-w-*` centers it without touching the
   * transform framer-motion animates. Mobile layout is unaffected.
   */
  desktopClassName?: string
  /** Panels entered from another sheet can restore to a durable HUD trigger. */
  returnFocus?: () => HTMLElement | null
  handleOnlyDrag?: boolean
  constrainToViewport?: boolean
}

export function BottomSheet({
  isOpen,
  onClose,
  title,
  height = '80vh',
  children,
  showHandle = true,
  desktopClassName = '',
  returnFocus,
  handleOnlyDrag = false,
  constrainToViewport = false,
}: BottomSheetProps) {
  const dragControls = useDragControls()
  const [viewport, setViewport] = useState<{ height: number; bottom: number } | null>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const titleId = useId()
  const previouslyFocusedRef = useRef<HTMLElement | null>(null)
  const onCloseRef = useRef(onClose)
  onCloseRef.current = onClose
  const returnFocusRef = useRef(returnFocus)
  returnFocusRef.current = returnFocus
  const reduceMotion = shouldReduceMotion()

  useEffect(() => {
    if (!isOpen || !constrainToViewport) return
    const update = () => {
      const view = window.visualViewport
      setViewport({ height: Math.min(window.innerHeight * 0.8, (view?.height ?? window.innerHeight) * 0.9), bottom: Math.max(0, window.innerHeight - (view?.height ?? window.innerHeight) - (view?.offsetTop ?? 0)) })
      const focused = document.activeElement
      if (focused instanceof HTMLElement && containerRef.current?.contains(focused)) focused.scrollIntoView({ block: 'nearest' })
    }
    update()
    window.visualViewport?.addEventListener('resize', update)
    window.visualViewport?.addEventListener('scroll', update)
    window.addEventListener('resize', update)
    return () => {
      window.visualViewport?.removeEventListener('resize', update)
      window.visualViewport?.removeEventListener('scroll', update)
      window.removeEventListener('resize', update)
    }
  }, [isOpen, constrainToViewport])

  useEffect(() => {
    if (!isOpen) return

    previouslyFocusedRef.current = document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null
    const sheet = containerRef.current
    const focusableSelector = [
      'button:not([disabled])',
      '[href]',
      'input:not([disabled])',
      'select:not([disabled])',
      'textarea:not([disabled])',
      'summary',
      '[tabindex]:not([tabindex="-1"])',
    ].join(',')
    const focusFirst = () => {
      // A retained detail or fast keyboard interaction may already have placed
      // focus inside the sheet before this frame. Do not steal it back.
      if (sheet?.contains(document.activeElement)) return
      const first = sheet?.querySelector<HTMLElement>(focusableSelector)
      ;(first ?? sheet)?.focus()
    }
    const animationFrame = window.requestAnimationFrame(focusFirst)

    const handleKeyDown = (event: KeyboardEvent) => {
      // A nested modal owns focus and Escape while it is open, so the sheet
      // yields both rather than closing out from under it and pulling focus
      // back behind it. Same rule ShopPanel already applies to its own nested
      // modals; without it one Escape dismisses two dialogs at once.
      if (sheet?.querySelector('[role="dialog"][aria-modal="true"]')) return

      if (event.key === 'Escape') {
        event.preventDefault()
        onCloseRef.current()
        return
      }
      if (event.key !== 'Tab' || !sheet) return

      const focusable = Array.from(
        sheet.querySelectorAll<HTMLElement>(focusableSelector),
      ).filter(node => !constrainToViewport || node.getClientRects().length > 0)
      if (focusable.length === 0) {
        event.preventDefault()
        sheet.focus()
        return
      }

      const first = focusable[0]
      const last = focusable[focusable.length - 1]
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && (document.activeElement === last || !sheet.contains(document.activeElement))) {
        event.preventDefault()
        first.focus()
      }
    }

    document.addEventListener('keydown', handleKeyDown)
    return () => {
      window.cancelAnimationFrame(animationFrame)
      document.removeEventListener('keydown', handleKeyDown)
      ;(returnFocusRef.current?.() ?? previouslyFocusedRef.current)?.focus()
      previouslyFocusedRef.current = null
    }
  }, [isOpen, constrainToViewport])

  const sheetVariants = {
    hidden: {
      y: '100%',
      opacity: 0,
    },
    visible: {
      y: 0,
      opacity: 1,
      transition: {
        duration: reduceMotion ? 0 : 0.3,
        ease: [0.4, 0, 0.2, 1] as const, // easeOut cubic bezier
      },
    },
    exit: {
      y: '100%',
      opacity: 0,
      transition: {
        duration: reduceMotion ? 0 : 0.2,
        ease: [0.4, 0, 1, 1] as const, // easeIn cubic bezier
      },
    },
  }

  const backdropVariants = {
    hidden: { opacity: 0 },
    visible: { opacity: 1 },
    exit: { opacity: 0 },
  }

  // Handle drag to dismiss
  function handleDragEnd(_event: MouseEvent | TouchEvent | PointerEvent, info: PanInfo) {
    const shouldClose = info.velocity.y > 500 || info.offset.y > 150
    if (shouldClose) {
      onClose()
    }
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
            animate="visible"
            exit="exit"
            onClick={onClose}
          />

          {/* Bottom Sheet */}
          <motion.div
            ref={containerRef}
            className={`fixed bottom-0 left-0 right-0 z-50 flex flex-col overflow-hidden rounded-t-3xl ${desktopClassName}`.trim()}
            role="dialog"
            aria-modal="true"
            aria-labelledby={titleId}
            tabIndex={-1}
            style={{
              height,
              ...(constrainToViewport && viewport ? { height: `${viewport.height}px`, bottom: `${viewport.bottom}px` } : {}),
              maxHeight: constrainToViewport ? '90dvh' : '90vh',
              backgroundColor: 'var(--color-surface)',
              boxShadow: '0 -4px 20px rgba(0, 0, 0, 0.3)',
            }}
            variants={sheetVariants}
            initial="hidden"
            animate="visible"
            exit="exit"
            drag={reduceMotion ? false : 'y'}
            dragControls={dragControls}
            dragListener={!handleOnlyDrag}
            dragConstraints={{ top: 0, bottom: 0 }}
            dragElastic={{ top: 0, bottom: 0.5 }}
            onDragEnd={handleDragEnd}
          >
            {/* Drag Handle */}
            {showHandle && (
              <div className="flex justify-center py-2 cursor-grab active:cursor-grabbing" style={handleOnlyDrag ? { touchAction: 'none' } : undefined} onPointerDown={handleOnlyDrag ? event => dragControls.start(event) : undefined}>
                <div
                  className="w-12 h-1 rounded-full"
                  style={{ backgroundColor: 'var(--color-text-muted)' }}
                />
              </div>
            )}

            {/* Header */}
            <div
              className="flex items-center justify-between px-6 py-4 border-b"
              style={{
                borderColor: 'rgba(249, 135, 151, 0.2)',
                backgroundColor: 'rgba(0, 0, 0, 0.2)',
              }}
            >
              <h2
                id={titleId}
                className="text-xl font-bold"
                style={{ color: 'var(--color-text-primary)' }}
              >
                {title}
              </h2>
              <button
                type="button"
                onClick={onClose}
                className="w-11 h-11 flex items-center justify-center rounded-full transition-all"
                style={{
                  backgroundColor: 'rgba(255, 255, 255, 0.1)',
                  color: 'var(--color-text-secondary)',
                }}
                aria-label="Close panel"
              >
                ✕
              </button>
            </div>

            {/* Content */}
            <div data-sheet-content className={`flex-1 min-h-0 overflow-y-auto p-6 ${constrainToViewport ? 'pb-[max(24px,env(safe-area-inset-bottom))]' : ''}`}>
              {children}
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  )
}
