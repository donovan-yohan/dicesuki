/**
 * Dice Toolbar Component
 *
 * A compact game-HUD rail for spawning owned dice, opening favorite dice, and
 * exposing the trash drop target for active table dice.
 */

import { AnimatePresence, motion } from 'framer-motion'
import { useMemo, useRef, useState } from 'react'

import { buttonPressScale, shouldReduceMotion } from '../../animations/ui-transitions'
import { useTheme } from '../../contexts/ThemeContext'
import { useDiceManagerStore } from '../../store/useDiceManagerStore'
import { useDragStore } from '../../store/useDragStore'
import { useInventoryStore } from '../../store/useInventoryStore'
import { useMultiplayerStore } from '../../store/useMultiplayerStore'
import type { DiceShape } from '../../types/diceShape'
import type { InventoryDie } from '../../types/inventory'
import { SharedInventoryDicePreviewCanvas } from '../panels/SharedInventoryDicePreviewCanvas'

interface DiceToolbarProps {
  isOpen: boolean
  onAddDice: (type: DiceShape, inventoryDieId?: string) => void
  onOpenInventory: () => void
}

const ALL_DICE_TYPES: Array<{ type: DiceShape; label: string }> = [
  { type: 'd4', label: 'D4' },
  { type: 'd6', label: 'D6' },
  { type: 'd8', label: 'D8' },
  { type: 'd10', label: 'D10' },
  { type: 'd12', label: 'D12' },
  { type: 'd20', label: 'D20' },
]

export function DiceToolbar({ isOpen, onAddDice, onOpenInventory }: DiceToolbarProps) {
  const reduceMotion = shouldReduceMotion()
  const { dice: inventoryDice } = useInventoryStore()
  const localDiceOnTable = useDiceManagerStore(state => state.dice)
  const multiplayerDiceOnTable = useMultiplayerStore(state => state.dice)
  const localPlayerId = useMultiplayerStore(state => state.localPlayerId)
  const pendingInventoryDieIds = useMultiplayerStore(state => state.pendingInventoryDieIds)
  const [activeFavoriteType, setActiveFavoriteType] = useState<DiceShape | null>(null)

  const unavailableInventoryIds = useMemo(() => {
    const ids = new Set<string>()

    localDiceOnTable.forEach(die => {
      if (die.inventoryDieId) ids.add(die.inventoryDieId)
    })

    multiplayerDiceOnTable.forEach(die => {
      if (localPlayerId && die.ownerId !== localPlayerId) return
      if (die.presentation?.inventoryDieId) ids.add(die.presentation.inventoryDieId)
    })

    pendingInventoryDieIds.forEach(id => ids.add(id))

    return ids
  }, [localDiceOnTable, localPlayerId, multiplayerDiceOnTable, pendingInventoryDieIds])

  const availableDiceTypes = useMemo(() => {
    const ownedDiceByType = new Map<DiceShape, InventoryDie[]>()
    inventoryDice.forEach(die => {
      const ownedDice = ownedDiceByType.get(die.type) ?? []
      ownedDice.push(die)
      ownedDiceByType.set(die.type, ownedDice)
    })

    return ALL_DICE_TYPES
      .filter(({ type }) => ownedDiceByType.has(type))
      .map(({ type, label }) => {
        const ownedDice = ownedDiceByType.get(type) ?? []
        return {
          type,
          label,
          available: ownedDice.filter(die => !unavailableInventoryIds.has(die.id)).length,
        }
      })
  }, [inventoryDice, unavailableInventoryIds])

  const favoriteDiceByType = useMemo(() => {
    const grouped = new Map<DiceShape, InventoryDie[]>()

    for (const die of inventoryDice) {
      if (!die.isFavorite || unavailableInventoryIds.has(die.id)) continue
      const favoriteDice = grouped.get(die.type) ?? []
      favoriteDice.push(die)
      grouped.set(die.type, favoriteDice)
    }

    grouped.forEach((favoriteDice) => {
      favoriteDice.sort((a, b) => b.acquiredAt - a.acquiredAt || a.name.localeCompare(b.name))
    })

    return grouped
  }, [inventoryDice, unavailableInventoryIds])

  return (
    <AnimatePresence>
      {isOpen && (
        <motion.div
          className="fixed left-4 z-[65] flex w-12 flex-col items-center gap-3"
          style={{
            bottom: '80px',
          }}
        >
          {availableDiceTypes.map(({ type, label, available }, index) => {
            const favorites = favoriteDiceByType.get(type) ?? []
            const isFavoriteOpen = activeFavoriteType === type

            return (
              <DiceQuickSlot
                key={type}
                type={type}
                label={label}
                count={available}
                favorites={favorites}
                index={index}
                isFavoriteOpen={isFavoriteOpen}
                disabled={available === 0}
                onAdd={() => onAddDice(type)}
                onToggleFavorites={() => setActiveFavoriteType(isFavoriteOpen ? null : type)}
                onSpawnFavorite={(die) => {
                  onAddDice(die.type, die.id)
                  setActiveFavoriteType(null)
                }}
              />
            )
          })}

          <motion.div
            initial={!reduceMotion ? { x: -100, opacity: 0 } : { opacity: 0 }}
            animate={!reduceMotion ? { x: 0, opacity: 1 } : { opacity: 1 }}
            exit={!reduceMotion ? { x: -100, opacity: 0 } : { opacity: 0 }}
            transition={{
              duration: 0.3,
              delay: availableDiceTypes.length * 0.05,
              ease: 'easeOut',
            }}
          >
            <InventoryButton onClick={onOpenInventory} />
          </motion.div>

          <motion.div
            className="mt-1"
            initial={!reduceMotion ? { x: -100, opacity: 0 } : { opacity: 0 }}
            animate={!reduceMotion ? { x: 0, opacity: 1 } : { opacity: 1 }}
            exit={!reduceMotion ? { x: -100, opacity: 0 } : { opacity: 0 }}
            transition={{
              duration: 0.3,
              delay: (availableDiceTypes.length + 1) * 0.05,
              ease: 'easeOut',
            }}
          >
            <TrashButton />
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}

interface DiceQuickSlotProps {
  type: DiceShape
  label: string
  count: number
  favorites: InventoryDie[]
  index: number
  isFavoriteOpen: boolean
  disabled?: boolean
  onAdd: () => void
  onToggleFavorites: () => void
  onSpawnFavorite: (die: InventoryDie) => void
}

function DiceQuickSlot({
  type,
  label,
  count,
  favorites,
  index,
  isFavoriteOpen,
  disabled = false,
  onAdd,
  onToggleFavorites,
  onSpawnFavorite,
}: DiceQuickSlotProps) {
  const reduceMotion = shouldReduceMotion()
  const { currentTheme } = useTheme()
  const accentColor = currentTheme.tokens.colors.accent
  const surfaceColor = currentTheme.tokens.colors.surface
  const hasFavorites = favorites.length > 0

  return (
    <motion.div
      className="relative h-12 w-12"
      initial={!reduceMotion ? { x: -100, opacity: 0 } : { opacity: 0 }}
      animate={!reduceMotion ? { x: 0, opacity: 1 } : { opacity: 1 }}
      exit={!reduceMotion ? { x: -100, opacity: 0 } : { opacity: 0 }}
      transition={{
        duration: 0.3,
        delay: index * 0.05,
        ease: 'easeOut',
      }}
    >
      <motion.button
        type="button"
        onClick={disabled ? undefined : onAdd}
        disabled={disabled}
        className="relative flex h-12 w-12 flex-col items-center justify-center rounded-xl text-sm font-bold"
        style={{
          backgroundColor: disabled ? `${accentColor}40` : accentColor,
          border: 'none',
          color: disabled ? `${surfaceColor}60` : surfaceColor,
          cursor: disabled ? 'not-allowed' : 'pointer',
          opacity: disabled ? 0.5 : 1,
        }}
        whileHover={
          !reduceMotion && !disabled
            ? {
                backgroundColor: currentTheme.tokens.colors.dice.highlight,
                scale: 1.08,
                transition: { duration: 0.15 },
              }
            : undefined
        }
        whileTap={!reduceMotion && !disabled ? buttonPressScale : undefined}
        aria-label={disabled ? `No ${label} available` : `Add random ${label} from inventory (${count} available)`}
        title={disabled ? `No ${label} available` : `Add random owned ${label}`}
        data-testid={`dice-quick-slot-${type}`}
      >
        <span>{label}</span>
        <span
          className="absolute right-0 top-0 flex items-center justify-center rounded-full text-xs font-bold"
          style={{
            width: '18px',
            height: '18px',
            backgroundColor: surfaceColor,
            color: accentColor,
            border: `2px solid ${accentColor}`,
            transform: 'translate(25%, -25%)',
          }}
          aria-hidden="true"
        >
          {count}
        </span>
      </motion.button>

      {hasFavorites && (
        <button
          type="button"
          onClick={(event) => {
            event.stopPropagation()
            onToggleFavorites()
          }}
          className="absolute -right-2 -bottom-2 z-[72] flex h-6 w-6 items-center justify-center rounded-full text-[11px] font-bold shadow-lg"
          style={{
            backgroundColor: isFavoriteOpen ? currentTheme.tokens.colors.dice.highlight : surfaceColor,
            color: isFavoriteOpen ? surfaceColor : accentColor,
            border: `2px solid ${accentColor}`,
          }}
          aria-label={`${isFavoriteOpen ? 'Hide' : 'Show'} favorite ${label} dice`}
          title={`${isFavoriteOpen ? 'Hide' : 'Show'} favorite ${label} dice`}
        >
          ★
        </button>
      )}

      {isFavoriteOpen && (
        <FavoriteDiceFlyout
          dice={favorites}
          label={label}
          onSpawn={onSpawnFavorite}
        />
      )}
    </motion.div>
  )
}

function FavoriteDiceFlyout({
  dice,
  label,
  onSpawn,
}: {
  dice: InventoryDie[]
  label: string
  onSpawn: (die: InventoryDie) => void
}) {
  const { currentTheme } = useTheme()
  const hostRef = useRef<HTMLDivElement>(null)
  const slotRefs = useRef<Map<string, HTMLElement>>(new Map())

  return (
    <motion.div
      className="absolute left-[60px] top-1/2 z-[70] -translate-y-1/2 overflow-hidden rounded-lg shadow-xl"
      style={{
        width: 'min(328px, calc(100vw - 92px))',
        backgroundColor: 'rgba(31, 41, 55, 0.92)',
        border: `1px solid ${currentTheme.tokens.colors.accent}`,
        backdropFilter: 'blur(12px)',
        WebkitBackdropFilter: 'blur(12px)',
      }}
      initial={{ opacity: 0, x: -8, scale: 0.96 }}
      animate={{ opacity: 1, x: 0, scale: 1 }}
      exit={{ opacity: 0, x: -8, scale: 0.96 }}
      transition={{ duration: 0.16 }}
      aria-label={`Favorite ${label} dice`}
    >
      <div ref={hostRef} className="relative">
        <SharedInventoryDicePreviewCanvas dice={dice} hostRef={hostRef} slotRefs={slotRefs} />
        <div className="relative flex gap-2 overflow-x-auto p-2">
          {dice.map(die => (
            <button
              key={die.id}
              type="button"
              onClick={() => onSpawn(die)}
              className="relative h-14 w-14 shrink-0 overflow-hidden rounded-md"
              style={{
                backgroundColor: 'rgba(0, 0, 0, 0.28)',
                border: `1px solid ${currentTheme.tokens.colors.accent}`,
              }}
              aria-label={`Add favorite ${die.name}`}
              title={die.name}
            >
              <span
                ref={(element) => {
                  if (element) {
                    slotRefs.current.set(die.id, element)
                  } else {
                    slotRefs.current.delete(die.id)
                  }
                }}
                data-testid="favorite-dice-preview"
                className="absolute inset-1"
              />
            </button>
          ))}
        </div>
      </div>
    </motion.div>
  )
}

function InventoryButton({ onClick }: { onClick: () => void }) {
  const reduceMotion = shouldReduceMotion()
  const { currentTheme } = useTheme()

  return (
    <motion.button
      type="button"
      onClick={onClick}
      className="flex h-12 w-12 items-center justify-center rounded-xl text-xs font-bold"
      style={{
        backgroundColor: 'rgba(31, 41, 55, 0.9)',
        color: currentTheme.tokens.colors.text.primary,
        border: `1px solid ${currentTheme.tokens.colors.accent}`,
      }}
      whileHover={!reduceMotion ? { scale: 1.08 } : undefined}
      whileTap={!reduceMotion ? buttonPressScale : undefined}
      aria-label="Open full dice inventory"
      title="Open full dice inventory"
    >
      INV
    </motion.button>
  )
}

function TrashButton() {
  const reduceMotion = shouldReduceMotion()
  const draggedDiceId = useDragStore((state) => state.draggedDiceId)
  const isDragging = draggedDiceId !== null
  const { currentTheme } = useTheme()
  const trashColor = '#ef4444'

  return (
    <motion.button
      id="trash-drop-zone"
      type="button"
      className="flex h-12 w-12 cursor-pointer items-center justify-center rounded-xl transition-all"
      style={{
        backgroundColor: isDragging ? `${trashColor}cc` : `${trashColor}99`,
        border: `2px dashed ${isDragging ? trashColor : `${trashColor}bb`}`,
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
              backgroundColor: `${trashColor}bb`,
              scale: 1.08,
            }
          : undefined
      }
      aria-label={isDragging ? 'Drop die to remove from table' : 'Trash drop zone'}
      title={isDragging ? 'Drop die here to remove it from the table' : 'Trash drop zone'}
    >
      🗑️
    </motion.button>
  )
}
