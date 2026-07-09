/**
 * Dice Toolbar Component
 *
 * A compact game-HUD rail for adding dice, cycling favorite inventory dice, and
 * removing active dice through the trash drop target.
 */

import { AnimatePresence, motion } from 'framer-motion'
import { useMemo, useState } from 'react'
import type { DragEvent } from 'react'

import { buttonPressScale, shouldReduceMotion } from '../../animations/ui-transitions'
import { useTheme } from '../../contexts/ThemeContext'
import { parseRollTrayDieDragPayload } from '../../lib/rollTrayDrag'
import { useDiceManagerStore } from '../../store/useDiceManagerStore'
import { useDragStore } from '../../store/useDragStore'
import { useInventoryStore } from '../../store/useInventoryStore'
import type { DiceShape } from '../../types/diceShape'
import type { InventoryDie } from '../../types/inventory'

interface DiceToolbarProps {
  isOpen: boolean
  onAddGenericDie: (type: DiceShape) => void
  onAddSpecificDie: (type: DiceShape, inventoryDieId: string) => void
  onRemoveDie: (id: string) => void
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

export function DiceToolbar({
  isOpen,
  onAddGenericDie,
  onAddSpecificDie,
  onRemoveDie,
  onOpenInventory,
}: DiceToolbarProps) {
  const reduceMotion = shouldReduceMotion()
  const { dice: inventoryDice } = useInventoryStore()
  const diceOnTable = useDiceManagerStore(state => state.dice)
  const [favoriteSlotByType, setFavoriteSlotByType] = useState<Partial<Record<DiceShape, number>>>({})

  const availableDiceTypes = useMemo(() => {
    const ownedCounts = new Map<DiceShape, number>()
    inventoryDice.forEach(die => {
      ownedCounts.set(die.type, (ownedCounts.get(die.type) ?? 0) + 1)
    })

    const inUseCounts = new Map<DiceShape, number>()
    diceOnTable.forEach(tableDie => {
      if (tableDie.inventoryDieId) {
        inUseCounts.set(tableDie.type, (inUseCounts.get(tableDie.type) ?? 0) + 1)
      }
    })

    return ALL_DICE_TYPES
      .filter(({ type }) => ownedCounts.has(type))
      .map(({ type, label }) => {
        const owned = ownedCounts.get(type) ?? 0
        const inUse = inUseCounts.get(type) ?? 0
        return {
          type,
          label,
          available: owned - inUse,
          total: owned,
        }
      })
  }, [diceOnTable, inventoryDice])

  const favoriteDiceByType = useMemo(() => {
    const inUseInventoryIds = new Set(
      diceOnTable
        .map(tableDie => tableDie.inventoryDieId)
        .filter((inventoryDieId): inventoryDieId is string => Boolean(inventoryDieId)),
    )
    const grouped = new Map<DiceShape, InventoryDie[]>()

    for (const die of inventoryDice) {
      if (!die.isFavorite || inUseInventoryIds.has(die.id)) continue
      const favoriteDice = grouped.get(die.type) ?? []
      favoriteDice.push(die)
      grouped.set(die.type, favoriteDice)
    }

    grouped.forEach((favoriteDice) => {
      favoriteDice.sort((a, b) => b.acquiredAt - a.acquiredAt || a.name.localeCompare(b.name))
    })

    return grouped
  }, [diceOnTable, inventoryDice])

  const cycleFavorite = (type: DiceShape, direction: -1 | 1) => {
    const favorites = favoriteDiceByType.get(type) ?? []
    if (favorites.length === 0) return

    setFavoriteSlotByType((currentSlots) => {
      const slotCount = favorites.length + 1
      const currentSlot = currentSlots[type] ?? 0
      const nextSlot = (currentSlot + direction + slotCount) % slotCount
      return {
        ...currentSlots,
        [type]: nextSlot,
      }
    })
  }

  return (
    <AnimatePresence>
      {isOpen && (
        <motion.div
          className="fixed left-2 z-[65] flex flex-col gap-3 sm:left-4"
          style={{
            bottom: '80px',
          }}
        >
          {availableDiceTypes.map(({ type, label, available }, index) => {
            const favorites = favoriteDiceByType.get(type) ?? []
            const selectedSlot = favoriteSlotByType[type] ?? 0
            const selectedFavorite = selectedSlot > 0 ? favorites[selectedSlot - 1] : undefined

            return (
              <DiceQuickSlot
                key={type}
                type={type}
                label={label}
                count={available}
                favoriteCount={favorites.length}
                selectedFavorite={selectedFavorite}
                index={index}
                disabled={available === 0 && !selectedFavorite}
                onAdd={() => {
                  if (selectedFavorite) {
                    onAddSpecificDie(type, selectedFavorite.id)
                  } else {
                    onAddGenericDie(type)
                  }
                }}
                onCycleLeft={() => cycleFavorite(type, -1)}
                onCycleRight={() => cycleFavorite(type, 1)}
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
            id="trash-drop-zone"
            initial={!reduceMotion ? { x: -100, opacity: 0 } : { opacity: 0 }}
            animate={!reduceMotion ? { x: 0, opacity: 1 } : { opacity: 1 }}
            exit={!reduceMotion ? { x: -100, opacity: 0 } : { opacity: 0 }}
            transition={{
              duration: 0.3,
              delay: (availableDiceTypes.length + 1) * 0.05,
              ease: 'easeOut',
            }}
          >
            <TrashButton onRemoveDie={onRemoveDie} />
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
  favoriteCount: number
  selectedFavorite?: InventoryDie
  index: number
  disabled?: boolean
  onAdd: () => void
  onCycleLeft: () => void
  onCycleRight: () => void
}

function DiceQuickSlot({
  type,
  label,
  count,
  favoriteCount,
  selectedFavorite,
  index,
  disabled = false,
  onAdd,
  onCycleLeft,
  onCycleRight,
}: DiceQuickSlotProps) {
  const reduceMotion = shouldReduceMotion()
  const { currentTheme } = useTheme()
  const accentColor = currentTheme.tokens.colors.accent
  const surfaceColor = currentTheme.tokens.colors.surface
  const hasFavorites = favoriteCount > 0
  const title = selectedFavorite
    ? `Add ${selectedFavorite.name}`
    : `Add generic ${label}`

  return (
    <motion.div
      className="flex items-center gap-1"
      initial={!reduceMotion ? { x: -100, opacity: 0 } : { opacity: 0 }}
      animate={!reduceMotion ? { x: 0, opacity: 1 } : { opacity: 1 }}
      exit={!reduceMotion ? { x: -100, opacity: 0 } : { opacity: 0 }}
      transition={{
        duration: 0.3,
        delay: index * 0.05,
        ease: 'easeOut',
      }}
    >
      <FavoriteCycleButton
        direction="left"
        disabled={!hasFavorites}
        onClick={onCycleLeft}
        label={`Previous favorite ${label}`}
      />
      <motion.button
        type="button"
        onClick={disabled ? undefined : onAdd}
        disabled={disabled}
        className="relative flex flex-col items-center justify-center rounded-xl text-sm font-bold"
        style={{
          width: '48px',
          height: '48px',
          backgroundColor: disabled ? `${accentColor}40` : selectedFavorite ? currentTheme.tokens.colors.dice.highlight : accentColor,
          border: selectedFavorite ? `2px solid ${accentColor}` : 'none',
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
        aria-label={title}
        title={title}
        data-testid={`dice-quick-slot-${type}`}
      >
        <span>{label}</span>
        {selectedFavorite && (
          <span
            className="absolute bottom-0 right-0 flex items-center justify-center rounded-full text-[10px] font-bold"
            style={{
              width: '18px',
              height: '18px',
              backgroundColor: surfaceColor,
              color: accentColor,
              border: `2px solid ${accentColor}`,
              transform: 'translate(25%, 25%)',
            }}
            aria-hidden="true"
          >
            ★
          </span>
        )}
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
      <FavoriteCycleButton
        direction="right"
        disabled={!hasFavorites}
        onClick={onCycleRight}
        label={`Next favorite ${label}`}
      />
    </motion.div>
  )
}

interface FavoriteCycleButtonProps {
  direction: 'left' | 'right'
  disabled: boolean
  onClick: () => void
  label: string
}

function FavoriteCycleButton({ direction, disabled, onClick, label }: FavoriteCycleButtonProps) {
  const { currentTheme } = useTheme()

  return (
    <button
      type="button"
      onClick={disabled ? undefined : onClick}
      disabled={disabled}
      className="flex h-8 w-5 items-center justify-center rounded-md text-xs font-bold transition-colors disabled:opacity-0"
      style={{
        backgroundColor: 'rgba(31, 41, 55, 0.72)',
        color: currentTheme.tokens.colors.text.primary,
        border: `1px solid ${currentTheme.tokens.colors.text.muted}`,
      }}
      aria-label={label}
      title={label}
      tabIndex={disabled ? -1 : 0}
    >
      {direction === 'left' ? '<' : '>'}
    </button>
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

function TrashButton({ onRemoveDie }: { onRemoveDie: (id: string) => void }) {
  const reduceMotion = shouldReduceMotion()
  const draggedDiceId = useDragStore((state) => state.draggedDiceId)
  const setDraggedDiceId = useDragStore((state) => state.setDraggedDiceId)
  const isDragging = draggedDiceId !== null
  const { currentTheme } = useTheme()
  const trashColor = '#ef4444'

  const handleDrop = (event: DragEvent<HTMLButtonElement>) => {
    event.preventDefault()
    const trayDieId = parseRollTrayDieDragPayload(event.dataTransfer)
      ?? event.dataTransfer.getData('text/plain')

    if (trayDieId) {
      onRemoveDie(trayDieId)
    }
    setDraggedDiceId(null)
  }

  return (
    <motion.button
      type="button"
      onDragOver={(event) => {
        event.preventDefault()
        event.dataTransfer.dropEffect = 'move'
      }}
      onDrop={handleDrop}
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
      aria-label={isDragging ? 'Drop die to remove from tray' : 'Trash drop zone'}
      title={isDragging ? 'Drop die here to remove it from the table' : 'Trash drop zone'}
    >
      🗑️
    </motion.button>
  )
}
