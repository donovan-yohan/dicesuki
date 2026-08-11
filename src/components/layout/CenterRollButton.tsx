/**
 * Center Roll Button Component
 *
 * Large circular button in the center of the bottom nav.
 * Features elevated design, animations, and multiple states.
 */

import { motion } from 'framer-motion'
import {
  buttonPressScale,
  rollButtonDisabledVariants,
  shouldReduceMotion,
} from '../../animations/ui-transitions'
import { useTheme } from '../../contexts/ThemeContext'
import { hasAsset } from '../../lib/themeHelpers'
import { ThemeIcon } from '../icons/ThemeIcon'

interface CenterRollButtonProps {
  onClick: () => void
  disabled?: boolean
}

export function CenterRollButton({
  onClick,
  disabled = false,
}: CenterRollButtonProps) {
  const { currentTheme } = useTheme()
  const rollIcon = currentTheme.assets.icons.roll

  const reduceMotion = shouldReduceMotion()

  return (
    <motion.button
      onClick={onClick}
      disabled={disabled}
      className="absolute rounded-full flex items-center justify-center cursor-pointer disabled:cursor-not-allowed transition-opacity"
      data-nav-item="ROLL"
      style={{
        // Size - smaller to match new nav
        width: '70px',
        height: '70px',
        // Centred on the nav rail (its containing block) on both axes. Margins
        // rather than transforms, so framer-motion's tap scale cannot conflict.
        left: '50%',
        marginLeft: '-35px', // Half of width
        top: '50%',
        marginTop: '-35px', // Half of height
        // Theming
        backgroundColor: 'var(--color-accent)',
        // Label on an accent fill — `--color-text-primary` was 1.99:1 here.
        color: 'var(--color-on-accent)',
        boxShadow: 'var(--shadow-md)', // Simple shadow, no glow
        zIndex: 45, // Above nav bar (40)
      }}
      // Animations - only on interaction
      variants={disabled ? rollButtonDisabledVariants : undefined}
      initial="idle"
      animate={disabled ? 'disabled' : 'idle'}
      whileTap={!disabled && !reduceMotion ? buttonPressScale : undefined}
      // Accessibility
      aria-label={disabled ? 'Cannot roll' : 'Roll dice'}
      title={disabled ? 'Add dice to roll' : 'Roll Dice'}
    >
      {/* Icon or Text */}
      {hasAsset(rollIcon) ? (
        <ThemeIcon
          src={rollIcon}
          label="Roll"
          className="w-8 h-8"
          style={{
            // Bundled icons are `currentColor` (already `on-accent`); the
            // filter still matters for image-based theme packs.
            filter: disabled ? 'grayscale(100%)' : 'none',
          }}
        />
      ) : (
        <span className="text-sm font-bold select-none uppercase tracking-wider">
          Roll
        </span>
      )}
    </motion.button>
  )
}
