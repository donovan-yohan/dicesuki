/**
 * Dice Toolbar Component
 *
 * A compact slide-out column of icon buttons for dice management.
 * Replaces the heavy DiceManagerPanel flyout with a simpler, more accessible UI.
 */

import { motion, AnimatePresence } from 'framer-motion'
import { useMemo } from 'react'
import { buttonPressScale, shouldReduceMotion } from '../../animations/ui-transitions'
import { useDiceManagerStore } from '../../store/useDiceManagerStore'
import { useDragStore } from '../../store/useDragStore'
import { useInventoryStore } from '../../store/useInventoryStore'
import { useTheme } from '../../contexts/ThemeContext'
import { DiceShape } from '../../lib/geometries'

interface DiceToolbarProps {
  isOpen: boolean
  onAddDice: (type: string) => void
  onClearAll: () => void
}

const ALL_DICE_TYPES: Array<{ type: DiceShape; label: string }> = [
  { type: 'd4', label: 'D4' },
  { type: 'd6', label: 'D6' },
  { type: 'd8', label: 'D8' },
  { type: 'd10', label: 'D10' },
  { type: 'd12', label: 'D12' },
  { type: 'd20', label: 'D20' },
]

export function DiceToolbar({ isOpen, onAddDice, onClearAll }: DiceToolbarProps) {
  const reduceMotion = shouldReduceMotion()
  const { dice: inventoryDice } = useInventoryStore()
  const diceOnTable = useDiceManagerStore(state => state.dice)

  // Get available dice types (owned - in use)
  const availableDiceTypes = useMemo(() => {
    // Count owned dice by type
    const ownedCounts = new Map<DiceShape, number>()
    inventoryDice.forEach(die => {
      const currentCount = ownedCounts.get(die.type) || 0
      ownedCounts.set(die.type, currentCount + 1)
    })

    // Count in-use dice by type
    const inUseCounts = new Map<DiceShape, number>()
    diceOnTable.forEach(tableDie => {
      if (tableDie.inventoryDieId) {
        const currentCount = inUseCounts.get(tableDie.type) || 0
        inUseCounts.set(tableDie.type, currentCount + 1)
      }
    })

    // Calculate available counts - show all owned types even if 0 available
    return ALL_DICE_TYPES
      .filter(({ type }) => ownedCounts.has(type))
      .map(({ type, label }) => {
        const owned = ownedCounts.get(type) || 0
        const inUse = inUseCounts.get(type) || 0
        return {
          type,
          label,
          available: owned - inUse,
          total: owned
        }
      })
  }, [inventoryDice, diceOnTable])

  return (
    <AnimatePresence>
      {isOpen && (
        <motion.div
          className="fixed left-4 z-30 flex flex-col gap-3"
          style={{
            bottom: '80px', // Position above bottom nav (56px nav + 24px gap)
          }}
        >
          {/* Dice Type Buttons - Show all owned types, disable if none available */}
          {availableDiceTypes.map(({ type, label, available }, index) => (
            <DiceButton
              key={type}
              onClick={() => onAddDice(type)}
              label={label}
              count={available}
              index={index}
              disabled={available === 0}
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
              delay: availableDiceTypes.length * 0.05, // Animate after all dice buttons
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
  count: number
  index: number
  disabled?: boolean
}

function DiceButton({ onClick, label, count, index, disabled = false }: DiceButtonProps) {
  const reduceMotion = shouldReduceMotion()
  const { currentTheme } = useTheme()
  const accentColor = currentTheme.tokens.colors.accent
  const surfaceColor = currentTheme.tokens.colors.surface

  return (
    <motion.button
      onClick={disabled ? undefined : onClick}
      disabled={disabled}
      className="flex flex-col items-center justify-center rounded-xl font-bold text-sm relative"
      style={{
        width: '48px',
        height: '48px',
        backgroundColor: disabled ? `${accentColor}40` : accentColor, // Reduced opacity when disabled
        border: 'none',
        color: disabled ? `${surfaceColor}60` : surfaceColor, // Reduced opacity when disabled
        cursor: disabled ? 'not-allowed' : 'pointer',
        opacity: disabled ? 0.5 : 1,
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
        !reduceMotion && !disabled
          ? {
              backgroundColor: currentTheme.tokens.colors.dice.highlight, // Theme dice highlight on hover
              scale: 1.1,
              transition: { duration: 0.15 }, // Fast hover transition
            }
          : undefined
      }
      whileTap={!reduceMotion && !disabled ? buttonPressScale : undefined}
      aria-label={disabled ? `No ${label} available` : `Add ${label} (${count} available)`}
      title={disabled ? `No ${label} available` : `Add ${label} (${count} available)`}
    >
      <span>{label}</span>
      {/* Count badge */}
      <span
        className="absolute top-0 right-0 flex items-center justify-center text-xs font-bold rounded-full"
        style={{
          width: '18px',
          height: '18px',
          backgroundColor: surfaceColor,
          color: accentColor,
          border: `2px solid ${accentColor}`,
          transform: 'translate(25%, -25%)'
        }}
      >
        {count}
      </span>
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
