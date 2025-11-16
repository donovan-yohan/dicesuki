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
  rollButtonRollingVariants,
  shouldReduceMotion,
} from '../../animations/ui-transitions'
import { useThemedAsset } from '../../hooks/useThemedAsset'

interface CenterRollButtonProps {
  onClick: () => void
  disabled?: boolean
  isRolling: boolean
}

export function CenterRollButton({
  onClick,
  disabled = false,
  isRolling,
}: CenterRollButtonProps) {
  const { getIcon, hasAsset } = useThemedAsset()
  const rollIcon = getIcon('roll')

  const reduceMotion = shouldReduceMotion()

  return (
    <motion.button
      onClick={onClick}
      disabled={disabled}
      className="absolute rounded-full flex items-center justify-center cursor-pointer disabled:cursor-not-allowed transition-opacity"
      style={{
        // Size - smaller to match new nav
        width: '70px',
        height: '70px',
        // Centering - use margin instead of transform to avoid conflicts
        left: '50%',
        marginLeft: '-35px', // Half of width
        // Elevated above nav (nav is 56px tall, positioned at bottom-4 which is 16px)
        // Button center should align with nav center: 16px + (56px/2) = 44px from bottom
        // Minus half button height: 44px - 35px = 9px
        bottom: '9px',
        // Theming
        backgroundColor: 'var(--color-accent)',
        color: 'var(--color-text-primary)',
        boxShadow: 'var(--shadow-md)', // Simple shadow, no glow
        zIndex: 45, // Above nav bar (40)
      }}
      // Animations - only on interaction
      variants={
        disabled
          ? rollButtonDisabledVariants
          : isRolling
          ? rollButtonRollingVariants
          : undefined
      }
      initial="idle"
      animate={disabled ? 'disabled' : isRolling && !reduceMotion ? 'spinning' : 'idle'}
      whileTap={!disabled && !reduceMotion ? buttonPressScale : undefined}
      // Accessibility
      aria-label={isRolling ? 'Rolling dice' : disabled ? 'Cannot roll' : 'Roll dice'}
      title={isRolling ? 'Rolling...' : disabled ? 'Add dice to roll' : 'Roll Dice'}
    >
      {/* Icon or Text */}
      {hasAsset(rollIcon) ? (
        <img
          src={rollIcon || undefined}
          alt="Roll"
          className="w-8 h-8"
          style={{
            filter: disabled ? 'grayscale(100%)' : 'none',
          }}
        />
      ) : (
        <span className="text-sm font-bold select-none uppercase tracking-wider">
          {isRolling ? 'Rolling' : 'Roll'}
        </span>
      )}
    </motion.button>
  )
}
