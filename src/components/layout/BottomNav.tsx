/**
 * Bottom Navigation Bar Component
 *
 * Main navigation bar with 5 buttons:
 * 1. Dice Manager
 * 2. Saved Rolls
 * 3. Roll Button (center, elevated)
 * 4. Roll History
 * 5. Players / Room
 */

import { motion } from 'framer-motion'
import {
  buttonPressScale,
  navBarVariants,
  shouldReduceMotion,
} from '../../animations/ui-transitions'
import { useTheme } from '../../contexts/ThemeContext'
import { ThemeIcon } from '../icons/ThemeIcon'
import { CenterRollButton } from './CenterRollButton'

interface BottomNavProps {
  isVisible: boolean
  onOpenDiceManager: () => void
  onOpenSavedRolls: () => void
  onOpenHistory: () => void
  onOpenPlayerPanel: () => void
  onRoll: () => void
  rollDisabled?: boolean
  diceManagerOpen?: boolean
}

export function BottomNav({
  isVisible,
  onOpenDiceManager,
  onOpenSavedRolls,
  onOpenHistory,
  onOpenPlayerPanel,
  onRoll,
  rollDisabled = false,
  diceManagerOpen = false,
}: BottomNavProps) {
  const { currentTheme } = useTheme()
  const getIcon = (name: keyof typeof currentTheme.assets.icons) => currentTheme.assets.icons[name]
  const reduceMotion = shouldReduceMotion()
  return (
    <motion.nav
      className="fixed bottom-4 left-4 right-4 z-40 flex items-center justify-between px-3 md:px-6"
      style={{
        height: '56px',
        backgroundColor: 'rgba(31, 41, 55, 0.7)', // Semi-transparent surface
        backdropFilter: 'blur(10px)',
        WebkitBackdropFilter: 'blur(10px)',
        boxShadow: '0 4px 20px rgba(0, 0, 0, 0.3), 0 0 0 1px rgba(249, 135, 151, 0.3)',
        borderRadius: '28px', // Fully rounded pill shape
        border: '1px solid rgba(249, 135, 151, 0.2)',
      }}
      // Animations
      variants={navBarVariants}
      initial="show"
      animate={reduceMotion ? 'show' : isVisible ? 'show' : 'hide'}
    >
      {/* Left Section: Dice Manager + Saved Rolls */}
      <div className="flex items-center gap-3 md:gap-4 flex-1 justify-between">
        {/* Button 1: Dice Manager */}
        <NavButton
          onClick={onOpenDiceManager}
          label="Manage Dice"
          navItem="Dice Manager"
          icon={getIcon('dice') || 'DICE'}
          active={diceManagerOpen}
        />

        {/* Button 2: Saved Rolls */}
        <NavButton
          onClick={onOpenSavedRolls}
          label="My Dice Rolls"
          navItem="Saved Rolls"
          icon={getIcon('savedRolls') || '📋'}
        />
      </div>

      {/* Center Section: the real elevated Roll button, centred on the rail. */}
      <div className="flex-1 flex justify-center">
        <div style={{ width: '70px' }} />
        <CenterRollButton onClick={onRoll} disabled={rollDisabled} />
      </div>

      {/* Right Section: Roll History + Players / Room */}
      <div className="flex items-center gap-3 md:gap-4 flex-1 justify-between">
        {/* Button 4: Roll History */}
        <NavButton
          onClick={onOpenHistory}
          label="Roll History"
          navItem="Roll History"
          icon={getIcon('history') || 'HIST'}
        />

        {/* Button 5: Players / Room */}
        <NavButton
          onClick={onOpenPlayerPanel}
          label="Room Players"
          navItem="Players/Room"
          icon={getIcon('profile') || '👥'}
        />
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
  navItem?: string
  icon: string // URL or emoji
  active?: boolean
}

function NavButton({ onClick, label, navItem = label, icon, active = false }: NavButtonProps) {
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
          ? 'rgba(249, 135, 151, 0.25)'
          : 'rgba(255, 255, 255, 0.05)',
        color: active ? 'var(--color-accent)' : 'var(--color-text-secondary)',
      }}
      whileHover={
        !reduceMotion
          ? {
              backgroundColor: active
                ? 'rgba(249, 135, 151, 0.35)'
                : 'rgba(255, 255, 255, 0.15)',
              scale: 1.08,
            }
          : undefined
      }
      whileTap={!reduceMotion ? buttonPressScale : undefined}
      aria-label={label}
      title={label}
      data-nav-item={navItem}
    >
      {/* Icon - just use the icon directly (emojis already provided as fallback) */}
      <div className="text-xs font-bold">
        {isImage ? <ThemeIcon src={icon} label={label} className="w-5 h-5" /> : icon}
      </div>
    </motion.button>
  )
}
