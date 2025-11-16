/**
 * BottomSheet Component
 *
 * Mobile-friendly bottom sheet panel with drag-to-dismiss.
 * Similar to FlyoutPanel but slides up from bottom.
 */

import { motion, AnimatePresence, useMotionValue, useTransform, PanInfo } from 'framer-motion'
import { ReactNode, useRef } from 'react'
import { shouldReduceMotion } from '../../animations/ui-transitions'

interface BottomSheetProps {
  isOpen: boolean
  onClose: () => void
  title: string
  height?: string // e.g., "80vh", "600px"
  children: ReactNode
  showHandle?: boolean // Show drag handle at top
}

export function BottomSheet({
  isOpen,
  onClose,
  title,
  height = '80vh',
  children,
  showHandle = true,
}: BottomSheetProps) {
  const reduceMotion = shouldReduceMotion()
  const containerRef = useRef<HTMLDivElement>(null)
  const y = useMotionValue(0)

  // Transform opacity based on drag distance
  const opacity = useTransform(y, [0, 300], [1, 0])

  const sheetVariants = {
    hidden: {
      y: '100%',
      opacity: 0,
    },
    visible: {
      y: 0,
      opacity: 1,
      transition: {
        type: 'spring' as const,
        damping: 30,
        stiffness: 300,
      },
    },
    exit: {
      y: '100%',
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
            animate={reduceMotion ? 'visible' : 'visible'}
            exit={reduceMotion ? 'hidden' : 'exit'}
            onClick={onClose}
          />

          {/* Bottom Sheet */}
          <motion.div
            ref={containerRef}
            className="fixed bottom-0 left-0 right-0 z-50 flex flex-col overflow-hidden rounded-t-3xl"
            style={{
              height,
              maxHeight: '90vh',
              backgroundColor: 'var(--color-surface)',
              boxShadow: '0 -4px 20px rgba(0, 0, 0, 0.3)',
              y,
              opacity,
            }}
            variants={sheetVariants}
            initial="hidden"
            animate={reduceMotion ? 'visible' : 'visible'}
            exit={reduceMotion ? 'hidden' : 'exit'}
            drag="y"
            dragConstraints={{ top: 0, bottom: 0 }}
            dragElastic={{ top: 0, bottom: 0.5 }}
            onDragEnd={handleDragEnd}
          >
            {/* Drag Handle */}
            {showHandle && (
              <div className="flex justify-center py-2 cursor-grab active:cursor-grabbing">
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
                borderColor: 'rgba(251, 146, 60, 0.2)',
                backgroundColor: 'rgba(0, 0, 0, 0.2)',
              }}
            >
              <h2
                className="text-xl font-bold"
                style={{ color: 'var(--color-text-primary)' }}
              >
                {title}
              </h2>
              <button
                onClick={onClose}
                className="w-8 h-8 flex items-center justify-center rounded-full transition-all"
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
            <div className="flex-1 overflow-y-auto p-6">
              {children}
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  )
}
