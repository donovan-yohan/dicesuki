/**
 * Bottom Navigation Bar Component
 *
 * Main navigation bar with 5 buttons:
 * 1. UI Toggle (left)
 * 2. Dice Manager
 * 3. Roll Button (center, elevated)
 * 4. History
 * 5. Motion Toggle (mobile only, right)
 */

import { motion } from 'framer-motion'
import {
  buttonPressScale,
  navBarVariants,
  shouldReduceMotion,
} from '../../animations/ui-transitions'
import { useThemedAsset } from '../../hooks/useThemedAsset'

interface BottomNavProps {
  isVisible: boolean
  onToggleUI: () => void
  onOpenDiceManager: () => void
  onOpenHistory: () => void
  onToggleMotion?: () => void // Optional - mobile only
  isMobile: boolean
  motionModeActive?: boolean
}

export function BottomNav({
  isVisible,
  onToggleUI,
  onOpenDiceManager,
  onOpenHistory,
  onToggleMotion,
  isMobile,
  motionModeActive = false,
}: BottomNavProps) {
  const { getIcon } = useThemedAsset()
  const reduceMotion = shouldReduceMotion()

  return (
    <motion.nav
      className="fixed bottom-4 left-4 right-4 z-40 flex items-center justify-between px-3 md:px-6"
      style={{
        height: '56px',
        backgroundColor: 'rgba(31, 41, 55, 0.7)', // Semi-transparent surface
        backdropFilter: 'blur(10px)',
        WebkitBackdropFilter: 'blur(10px)',
        boxShadow: '0 4px 20px rgba(0, 0, 0, 0.3), 0 0 0 1px rgba(251, 146, 60, 0.3)',
        borderRadius: '28px', // Fully rounded pill shape
        border: '1px solid rgba(251, 146, 60, 0.2)',
      }}
      // Animations
      variants={navBarVariants}
      initial="show"
      animate={reduceMotion ? 'show' : isVisible ? 'show' : 'hide'}
    >
      {/* Left Section: UI Toggle + Dice Manager */}
      <div className="flex items-center gap-3 md:gap-4 flex-1 justify-between">
        {/* Button 1: UI Toggle */}
        <NavButton
          onClick={onToggleUI}
          label="Toggle UI"
          icon={getIcon('uiToggle') || '👁️'}
        />

        {/* Button 2: Dice Manager */}
        <NavButton
          onClick={onOpenDiceManager}
          label="Manage Dice"
          icon={getIcon('dice') || '🎲'}
        />
      </div>

      {/* Center Section: Roll Button (rendered separately - elevated) */}
      {/* This is just a spacer - actual button is in CenterRollButton component */}
      <div className="flex-1 flex justify-center">
        <div style={{ width: '70px' }} />
      </div>

      {/* Right Section: History + Motion Toggle */}
      <div className="flex items-center gap-3 md:gap-4 flex-1 justify-between">
        {/* Button 4: History */}
        <NavButton
          onClick={onOpenHistory}
          label="Roll History"
          icon={getIcon('history') || '📜'}
        />

        {/* Button 5: Motion Toggle */}
        {onToggleMotion && (
          <NavButton
            onClick={() => {
              console.log('Motion toggle clicked, current state:', motionModeActive)
              onToggleMotion()
            }}
            label={isMobile ? 'Motion Mode' : 'Device Motion'}
            icon="📱"
            active={motionModeActive}
          />
        )}
      </div>
    </motion.nav>
  )
}

// ============================================================================
// Nav Button Component
// ============================================================================

interface NavButtonProps {
  onClick: () => void
  label: string
  icon: string // URL or emoji
  active?: boolean
}

function NavButton({ onClick, label, icon, active = false }: NavButtonProps) {
  const reduceMotion = shouldReduceMotion()
  const isImage = icon.startsWith('/') || icon.startsWith('http')

  return (
    <motion.button
      onClick={onClick}
      className="flex items-center justify-center rounded-full transition-all"
      style={{
        width: '44px',
        height: '44px',
        backgroundColor: active
          ? 'rgba(251, 146, 60, 0.25)'
          : 'rgba(255, 255, 255, 0.05)',
        color: active ? 'var(--color-accent)' : 'var(--color-text-secondary)',
      }}
      whileHover={
        !reduceMotion
          ? {
              backgroundColor: active
                ? 'rgba(251, 146, 60, 0.35)'
                : 'rgba(255, 255, 255, 0.15)',
              scale: 1.08,
            }
          : undefined
      }
      whileTap={!reduceMotion ? buttonPressScale : undefined}
      aria-label={label}
      title={label}
    >
      {/* Icon - just use the icon directly (emojis already provided as fallback) */}
      <div className="text-xl">
        {isImage ? <img src={icon} alt={label} className="w-5 h-5" /> : icon}
      </div>
    </motion.button>
  )
}
