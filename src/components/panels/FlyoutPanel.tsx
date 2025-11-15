/**
 * FlyoutPanel Base Component
 *
 * Reusable slide-in panel with backdrop, theming, and animations.
 * Used for DiceManager, History, and Settings panels.
 */

import { motion, AnimatePresence } from 'framer-motion'
import { ReactNode } from 'react'
import { shouldReduceMotion } from '../../animations/ui-transitions'

interface FlyoutPanelProps {
  isOpen: boolean
  onClose: () => void
  title: string
  position?: 'left' | 'right'
  width?: string
  children: ReactNode
}

export function FlyoutPanel({
  isOpen,
  onClose,
  title,
  position = 'left',
  width = '320px',
  children,
}: FlyoutPanelProps) {
  const reduceMotion = shouldReduceMotion()

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
            className={`fixed top-0 ${position === 'left' ? 'left-0' : 'right-0'} h-full z-50 flex flex-col overflow-hidden`}
            style={{
              width,
              maxWidth: '90vw',
              backgroundColor: 'var(--color-surface)',
              boxShadow: position === 'left'
                ? '4px 0 20px rgba(0, 0, 0, 0.3)'
                : '-4px 0 20px rgba(0, 0, 0, 0.3)',
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
