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

interface BottomNavProps {
  isVisible: boolean
  onOpenDiceManager: () => void
  onOpenSavedRolls: () => void
  onOpenHistory: () => void
  onOpenPlayerPanel: () => void
  diceManagerOpen?: boolean
}

export function BottomNav({
  isVisible,
  onOpenDiceManager,
  onOpenSavedRolls,
  onOpenHistory,
  onOpenPlayerPanel,
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
          icon="📋"
        />
      </div>

      {/* Center Section: Roll Button (rendered separately - elevated) */}
      {/* This is just a spacer - actual button is in CenterRollButton component */}
      <div className="flex-1 flex justify-center" data-nav-item="ROLL">
        <div style={{ width: '70px' }} />
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
          icon="👥"
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
        {isImage ? <img src={icon} alt={label} className="w-5 h-5" /> : icon}
      </div>
    </motion.button>
  )
}
