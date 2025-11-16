/**
 * UI Toggle Mini Component
 *
 * Minimal button shown in bottom-left when UI is hidden.
 * Allows user to restore the full UI.
 */

import { motion } from 'framer-motion'
import { useThemedAsset } from '../../hooks/useThemedAsset'
import {
  miniToggleVariants,
  buttonPressScale,
  shouldReduceMotion,
} from '../../animations/ui-transitions'

interface UIToggleMiniProps {
  onClick: () => void
  isVisible: boolean // Controls fade in/out
}

export function UIToggleMini({ onClick, isVisible }: UIToggleMiniProps) {
  const { getIcon, hasAsset } = useThemedAsset()
  const toggleIcon = getIcon('uiToggle')
  const reduceMotion = shouldReduceMotion()

  return (
    <motion.button
      onClick={onClick}
      className="fixed bottom-4 left-4 z-10 flex items-center justify-center rounded-full transition-all"
      style={{
        width: '48px',
        height: '48px',
        backgroundColor: 'var(--color-surface)',
        color: 'var(--color-text-primary)',
        boxShadow: 'var(--shadow-md)',
        // Semi-transparent when showing
        opacity: 0.7,
      }}
      // Animations
      variants={miniToggleVariants}
      initial="hide"
      animate={reduceMotion ? (isVisible ? 'hide' : 'show') : isVisible ? 'hide' : 'show'}
      whileHover={
        !reduceMotion
          ? {
              opacity: 1,
              scale: 1.05,
            }
          : { opacity: 1 }
      }
      whileTap={!reduceMotion ? buttonPressScale : undefined}
      // Accessibility
      aria-label="Show UI"
      title="Show UI"
    >
      {hasAsset(toggleIcon) ? (
        <img src={toggleIcon} alt="Show UI" className="w-6 h-6" />
      ) : (
        <span className="text-xl">👁️</span>
      )}
    </motion.button>
  )
}
