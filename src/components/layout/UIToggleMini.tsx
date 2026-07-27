/**
 * UI Toggle Mini Component
 *
 * Permanent eye button in the bottom-left control cluster.
 * It remains available when the surrounding UI is hidden.
 */

import { motion } from 'framer-motion'
import { useTheme } from '../../contexts/ThemeContext'
import { hasAsset } from '../../lib/themeHelpers'
import { HUD_LAYOUT } from './hudLayout'
import {
  buttonPressScale,
  shouldReduceMotion,
} from '../../animations/ui-transitions'

interface UIToggleMiniProps {
  onClick: () => void
  isVisible: boolean
}

export function UIToggleMini({ onClick, isVisible }: UIToggleMiniProps) {
  const { currentTheme } = useTheme()
  const toggleIcon = currentTheme.assets.icons.uiToggle
  const reduceMotion = shouldReduceMotion()
  const label = isVisible ? 'Hide UI' : 'Show UI'

  return (
    <motion.button
      onClick={onClick}
      className="fixed left-4 z-40 flex items-center justify-center rounded-full transition-all"
      style={{
        bottom: `${HUD_LAYOUT.eye.bottom}px`,
        width: `${HUD_LAYOUT.eye.size}px`,
        height: `${HUD_LAYOUT.eye.size}px`,
        backgroundColor: 'var(--color-surface)',
        color: 'var(--color-text-primary)',
        boxShadow: 'var(--shadow-md)',
        // Semi-transparent when showing
        opacity: 0.7,
      }}
      initial={false}
      animate={{ opacity: 0.7 }}
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
      aria-label={label}
      title={label}
    >
      {hasAsset(toggleIcon) ? (
        <img src={toggleIcon} alt={label} className="w-6 h-6" />
      ) : (
        <span className="text-xl">👁️</span>
      )}
    </motion.button>
  )
}
