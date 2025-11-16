/**
 * Dice Toolbar Component
 *
 * A compact slide-out column of icon buttons for dice management.
 * Replaces the heavy DiceManagerPanel flyout with a simpler, more accessible UI.
 */

import { motion, AnimatePresence } from 'framer-motion'
import { buttonPressScale, shouldReduceMotion } from '../../animations/ui-transitions'
import { useDragStore } from '../../store/useDragStore'
import { useTheme } from '../../contexts/ThemeContext'

interface DiceToolbarProps {
  isOpen: boolean
  onAddDice: (type: string) => void
  onClearAll: () => void
}

const DICE_TYPES = [
  { type: 'd4', label: 'D4' },
  { type: 'd6', label: 'D6' },
  { type: 'd8', label: 'D8' },
  { type: 'd10', label: 'D10' },
  { type: 'd12', label: 'D12' },
  { type: 'd20', label: 'D20' },
]

export function DiceToolbar({ isOpen, onAddDice, onClearAll }: DiceToolbarProps) {
  const reduceMotion = shouldReduceMotion()

  return (
    <AnimatePresence>
      {isOpen && (
        <motion.div
          className="fixed left-4 z-30 flex flex-col gap-3"
          style={{
            bottom: '80px', // Position above bottom nav (56px nav + 24px gap)
          }}
        >
          {/* Dice Type Buttons - Staggered waterfall animation */}
          {DICE_TYPES.map(({ type, label }, index) => (
            <DiceButton
              key={type}
              onClick={() => onAddDice(type)}
              label={label}
              index={index}
            />
          ))}

          {/* Trash Button - Separated with some spacing */}
          <motion.div
            className="mt-2"
            id="trash-drop-zone"
            initial={!reduceMotion ? { x: -100, opacity: 0 } : { opacity: 0 }}
            animate={!reduceMotion ? { x: 0, opacity: 1 } : { opacity: 1 }}
            exit={!reduceMotion ? { x: -100, opacity: 0 } : { opacity: 0 }}
            transition={{
              duration: 0.3,
              delay: DICE_TYPES.length * 0.05, // Animate after all dice buttons
              ease: 'easeOut',
            }}
          >
            <TrashButton onClearAll={onClearAll} />
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}

// ============================================================================
// Dice Button Component
// ============================================================================

interface DiceButtonProps {
  onClick: () => void
  label: string
  index: number
}

function DiceButton({ onClick, label, index }: DiceButtonProps) {
  const reduceMotion = shouldReduceMotion()
  const { currentTheme } = useTheme()
  const accentColor = currentTheme.tokens.colors.accent
  const surfaceColor = currentTheme.tokens.colors.surface

  return (
    <motion.button
      onClick={onClick}
      className="flex items-center justify-center rounded-xl font-bold text-sm"
      style={{
        width: '48px',
        height: '48px',
        backgroundColor: accentColor, // Theme accent color
        border: 'none',
        color: surfaceColor, // Theme surface for contrast
      }}
      // Staggered slide-in animation from left
      initial={!reduceMotion ? { x: -100, opacity: 0 } : { opacity: 0 }}
      animate={!reduceMotion ? { x: 0, opacity: 1 } : { opacity: 1 }}
      exit={!reduceMotion ? { x: -100, opacity: 0 } : { opacity: 0 }}
      transition={{
        duration: 0.3,
        delay: index * 0.05, // Stagger by 50ms per button
        ease: 'easeOut',
      }}
      whileHover={
        !reduceMotion
          ? {
              backgroundColor: currentTheme.tokens.colors.dice.highlight, // Theme dice highlight on hover
              scale: 1.1,
              transition: { duration: 0.15 }, // Fast hover transition
            }
          : undefined
      }
      whileTap={!reduceMotion ? buttonPressScale : undefined}
      aria-label={`Add ${label}`}
      title={`Add ${label}`}
    >
      {label}
    </motion.button>
  )
}

// ============================================================================
// Trash Button Component
// ============================================================================

interface TrashButtonProps {
  onClearAll: () => void
}

function TrashButton({ onClearAll }: TrashButtonProps) {
  const reduceMotion = shouldReduceMotion()
  const draggedDiceId = useDragStore((state) => state.draggedDiceId)
  const isDragging = draggedDiceId !== null
  const { currentTheme } = useTheme()

  // Use a red color for trash - fallback to a standard red if theme doesn't define it
  const trashColor = '#ef4444' // red-500

  const handleClick = () => {
    // Only clear all if not currently dragging (click to clear all)
    if (!isDragging) {
      console.log('[TrashButton] Clearing all dice')
      onClearAll()
    }
  }

  return (
    <motion.button
      onClick={handleClick}
      className="flex items-center justify-center rounded-xl transition-all cursor-pointer"
      style={{
        width: '48px',
        height: '48px',
        backgroundColor: isDragging ? `${trashColor}cc` : `${trashColor}99`, // Opacity variants
        border: `2px dashed ${isDragging ? `${trashColor}` : `${trashColor}bb`}`,
        color: currentTheme.tokens.colors.text.primary,
        fontSize: '24px',
      }}
      animate={
        !reduceMotion && isDragging
          ? {
              scale: [1, 1.15, 1],
            }
          : undefined
      }
      transition={{
        scale: {
          duration: 0.6,
          repeat: Infinity,
          ease: 'easeInOut',
        },
      }}
      whileHover={
        !reduceMotion
          ? {
              backgroundColor: `${trashColor}bb`, // Brighter on hover
              scale: 1.1,
            }
          : undefined
      }
      aria-label={isDragging ? "Drop dice to delete" : "Click to clear all dice"}
      title={isDragging ? "Drop dice here to delete" : "Click to clear all dice"}
    >
      🗑️
    </motion.button>
  )
}
