/**
 * Dice Toolbar Component
 *
 * A compact slide-out column of icon buttons for dice management.
 * Replaces the heavy DiceManagerPanel flyout with a simpler, more accessible UI.
 */

import { motion, AnimatePresence } from 'framer-motion'
import { buttonPressScale, shouldReduceMotion } from '../../animations/ui-transitions'
import { useDragStore } from '../../store/useDragStore'

interface DiceToolbarProps {
  isOpen: boolean
  onAddDice: (type: string) => void
}

const DICE_TYPES = [
  { type: 'd4', label: 'D4', icon: '▲' },
  { type: 'd6', label: 'D6', icon: '⬛' },
  { type: 'd8', label: 'D8', icon: '◆' },
  { type: 'd10', label: 'D10', icon: '🔟' },
  { type: 'd12', label: 'D12', icon: '⬢' },
  { type: 'd20', label: 'D20', icon: '◉' },
]

export function DiceToolbar({ isOpen, onAddDice }: DiceToolbarProps) {
  const reduceMotion = shouldReduceMotion()

  return (
    <AnimatePresence>
      {isOpen && (
        <motion.div
          className="fixed left-4 top-1/2 z-30 flex flex-col gap-2"
          style={{
            transform: 'translateY(-50%)',
          }}
          initial={!reduceMotion ? { x: -100, opacity: 0 } : { opacity: 0 }}
          animate={!reduceMotion ? { x: 0, opacity: 1 } : { opacity: 1 }}
          exit={!reduceMotion ? { x: -100, opacity: 0 } : { opacity: 0 }}
          transition={{ duration: 0.2, ease: 'easeOut' }}
        >
          {/* Dice Type Buttons */}
          <div
            className="flex flex-col gap-2 p-2 rounded-2xl"
            style={{
              backgroundColor: 'rgba(31, 41, 55, 0.8)',
              backdropFilter: 'blur(10px)',
              WebkitBackdropFilter: 'blur(10px)',
              border: '1px solid rgba(251, 146, 60, 0.2)',
              boxShadow: '0 4px 20px rgba(0, 0, 0, 0.3)',
            }}
          >
            {DICE_TYPES.map(({ type, label, icon }) => (
              <DiceButton
                key={type}
                onClick={() => onAddDice(type)}
                icon={icon}
                label={label}
              />
            ))}
          </div>

          {/* Trash Button - Separated with some spacing */}
          <div
            className="p-2 rounded-2xl"
            style={{
              backgroundColor: 'rgba(31, 41, 55, 0.8)',
              backdropFilter: 'blur(10px)',
              WebkitBackdropFilter: 'blur(10px)',
              border: '1px solid rgba(239, 68, 68, 0.2)',
              boxShadow: '0 4px 20px rgba(0, 0, 0, 0.3)',
            }}
            id="trash-drop-zone"
          >
            <TrashButton />
          </div>
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
  icon: string
  label: string
}

function DiceButton({ onClick, icon, label }: DiceButtonProps) {
  const reduceMotion = shouldReduceMotion()

  return (
    <motion.button
      onClick={onClick}
      className="flex items-center justify-center rounded-xl transition-all"
      style={{
        width: '48px',
        height: '48px',
        backgroundColor: 'rgba(251, 146, 60, 0.15)',
        border: '1px solid rgba(251, 146, 60, 0.3)',
        color: 'var(--color-accent)',
        fontSize: '24px',
      }}
      whileHover={
        !reduceMotion
          ? {
              backgroundColor: 'rgba(251, 146, 60, 0.25)',
              scale: 1.1,
            }
          : undefined
      }
      whileTap={!reduceMotion ? buttonPressScale : undefined}
      aria-label={`Add ${label}`}
      title={`Add ${label}`}
    >
      {icon}
    </motion.button>
  )
}

// ============================================================================
// Trash Button Component
// ============================================================================

function TrashButton() {
  const reduceMotion = shouldReduceMotion()
  const draggedDiceId = useDragStore((state) => state.draggedDiceId)
  const isDragging = draggedDiceId !== null

  return (
    <motion.div
      className="flex items-center justify-center rounded-xl transition-all"
      style={{
        width: '48px',
        height: '48px',
        backgroundColor: isDragging ? 'rgba(239, 68, 68, 0.35)' : 'rgba(239, 68, 68, 0.15)',
        border: isDragging ? '2px dashed rgba(239, 68, 68, 0.8)' : '2px dashed rgba(239, 68, 68, 0.4)',
        color: isDragging ? '#ff6b6b' : '#ef4444',
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
              backgroundColor: 'rgba(239, 68, 68, 0.25)',
              scale: 1.1,
            }
          : undefined
      }
      aria-label="Delete dice (drag dice here)"
      title="Drag dice here to delete"
    >
      🗑️
    </motion.div>
  )
}
