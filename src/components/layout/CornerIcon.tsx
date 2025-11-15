/**
 * Corner Icon Component
 *
 * Reusable component for top-left and top-right corner icons.
 * Animated, themed, and supports custom content.
 */

import { motion } from 'framer-motion'
import { ReactNode } from 'react'
import {
  topLeftIconVariants,
  topRightIconVariants,
  buttonHoverScale,
  buttonPressScale,
  shouldReduceMotion,
} from '../../animations/ui-transitions'

interface CornerIconProps {
  position: 'top-left' | 'top-right'
  onClick: () => void
  label: string
  isVisible: boolean
  children: ReactNode // Icon content (emoji, img, svg, etc.)
}

export function CornerIcon({ position, onClick, label, isVisible, children }: CornerIconProps) {
  const reduceMotion = shouldReduceMotion()

  // Select animation variants based on position
  const variants = position === 'top-left' ? topLeftIconVariants : topRightIconVariants

  // Position styles
  const positionStyles =
    position === 'top-left'
      ? { top: '1rem', left: '1rem' }
      : { top: '1rem', right: '1rem' }

  return (
    <motion.button
      onClick={onClick}
      className="fixed z-30 flex items-center justify-center rounded-lg transition-all"
      style={{
        ...positionStyles,
        width: 'clamp(48px, 10vw, 56px)',
        height: 'clamp(48px, 10vw, 56px)',
        backgroundColor: 'var(--color-surface)',
        color: 'var(--color-text-primary)',
        boxShadow: 'var(--shadow-md)',
        borderRadius: 'var(--border-radius-md)',
      }}
      // Animations
      variants={variants}
      initial="show"
      animate={reduceMotion ? 'show' : isVisible ? 'show' : 'hide'}
      whileHover={!reduceMotion ? buttonHoverScale : undefined}
      whileTap={!reduceMotion ? buttonPressScale : undefined}
      // Accessibility
      aria-label={label}
      title={label}
    >
      <div className="text-2xl md:text-3xl">{children}</div>
    </motion.button>
  )
}
