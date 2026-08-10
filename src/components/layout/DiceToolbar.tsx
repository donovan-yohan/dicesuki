/**
 * Dice Toolbar Component
 *
 * A compact game-HUD rail for spawning owned dice, opening favorite dice, and
 * exposing the trash drop target for active table dice.
 */

import { AnimatePresence, motion } from 'framer-motion'
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { RefObject } from 'react'
import { createPortal } from 'react-dom'

import { buttonPressScale, shouldReduceMotion } from '../../animations/ui-transitions'
import { useTheme } from '../../contexts/ThemeContext'
import { useDragStore } from '../../store/useDragStore'
import { useInventoryStore } from '../../store/useInventoryStore'
import { useMultiplayerStore } from '../../store/useMultiplayerStore'
import { TRASH_DROP_ZONE_ID } from '../../lib/trashDropZone'
import type { DiceShape } from '../../types/diceShape'
import type { InventoryDie } from '../../types/inventory'
import { SharedInventoryDicePreviewCanvas } from '../panels/SharedInventoryDicePreviewCanvas'
import { getDiceToolbarLane } from './hudLayout'

interface DiceToolbarProps {
  isOpen: boolean
  /**
   * Drives the rail's bottom anchor: the mobile-only motion toggle adds a slot
   * to the control cluster below it, so the rail sits one slot lower on desktop.
   */
  isMobile: boolean
  onAddDice: (type: DiceShape, inventoryDieId?: string) => void
  onClearAllDice: () => void
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

/**
 * Track the visual viewport height so the rail can be clamped to the space it
 * actually has. `visualViewport` follows mobile browser chrome collapsing,
 * which `innerHeight` does not.
 */
function useViewportHeight(): number {
  const [height, setHeight] = useState(() => (
    typeof window === 'undefined'
      ? 0
      : window.visualViewport?.height ?? window.innerHeight
  ))

  useEffect(() => {
    const update = () => setHeight(window.visualViewport?.height ?? window.innerHeight)
    update()

    window.addEventListener('resize', update)
    window.visualViewport?.addEventListener('resize', update)
    return () => {
      window.removeEventListener('resize', update)
      window.visualViewport?.removeEventListener('resize', update)
    }
  }, [])

  return height
}

export function DiceToolbar({ isOpen, isMobile, onAddDice, onClearAllDice, onOpenInventory }: DiceToolbarProps) {
  const reduceMotion = shouldReduceMotion()
  const viewportHeight = useViewportHeight()
  const railLane = getDiceToolbarLane(viewportHeight, isMobile)
  const { dice: inventoryDice } = useInventoryStore()
  const multiplayerDiceOnTable = useMultiplayerStore(state => state.dice)
  const localPlayerId = useMultiplayerStore(state => state.localPlayerId)
  const pendingInventoryDieIds = useMultiplayerStore(state => state.pendingInventoryDieIds)
  const [activeFavoriteType, setActiveFavoriteType] = useState<DiceShape | null>(null)

  const unavailableInventoryIds = useMemo(() => {
    const ids = new Set<string>()

    multiplayerDiceOnTable.forEach(die => {
      if (localPlayerId && die.ownerId !== localPlayerId) return
      if (die.presentation?.inventoryDieId) ids.add(die.presentation.inventoryDieId)
    })

    pendingInventoryDieIds.forEach(id => ids.add(id))

    return ids
  }, [localPlayerId, multiplayerDiceOnTable, pendingInventoryDieIds])

  /**
   * Every die type, always. A player has an unlimited supply of basic dice
   * (`lib/basicDice.ts`), so the rail never hides or disables a type — `available`
   * counts only the OWNED dice not already on the table, and tapping past that
   * count spawns a basic one.
   */
  const availableDiceTypes = useMemo(() => {
    const ownedDiceByType = new Map<DiceShape, InventoryDie[]>()
    inventoryDice.forEach(die => {
      const ownedDice = ownedDiceByType.get(die.type) ?? []
      ownedDice.push(die)
      ownedDiceByType.set(die.type, ownedDice)
    })

    return ALL_DICE_TYPES.map(({ type, label }) => {
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
          data-testid="dice-toolbar-rail"
          className="fixed left-4 z-40 flex w-12 flex-col"
          style={{
            // Keep the slide-out rail clear of the permanent bottom-left
            // rotate/motion/eye control cluster…
            bottom: `${railLane.bottom}px`,
            // …and clamp its top to the corner-icon clearance so short
            // viewports scroll the rail instead of pushing it off-screen.
            maxHeight: `${railLane.maxHeight}px`,
          }}
        >
          {/* The negative margin widens only the scroll box, so slot badges are
              not clipped while the slots themselves stay on the same x. */}
          <div
            data-testid="dice-toolbar-scroll"
            className="-mx-2 flex min-h-0 flex-1 flex-col items-center gap-3 overflow-y-auto overscroll-contain px-2 py-2"
            style={{ scrollbarWidth: 'none' }}
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
            <TrashButton onClick={onClearAllDice} />
          </motion.div>
          </div>
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
  onAdd: () => void
  onToggleFavorites: () => void
  onSpawnFavorite: (die: InventoryDie) => void
}

/**
 * The badge shows how many OWNED dice of the type are still off the table. At
 * zero it becomes ∞: there is nothing left to run out of, because the next tap
 * spawns a basic die.
 */
const INFINITE_BASICS_BADGE = '∞'

function DiceQuickSlot({
  type,
  label,
  count,
  favorites,
  index,
  isFavoriteOpen,
  onAdd,
  onToggleFavorites,
  onSpawnFavorite,
}: DiceQuickSlotProps) {
  const reduceMotion = shouldReduceMotion()
  const { currentTheme } = useTheme()
  const accentColor = currentTheme.tokens.colors.accent
  const surfaceColor = currentTheme.tokens.colors.surface
  const hasFavorites = favorites.length > 0
  const slotRef = useRef<HTMLDivElement>(null)
  const hasOwned = count > 0
  const actionLabel = hasOwned
    ? `Add random owned ${label} from inventory (${count} available)`
    : `Add a basic ${label} (unlimited)`

  return (
    <motion.div
      ref={slotRef}
      className="relative h-12 w-12 shrink-0"
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
        onClick={onAdd}
        className="relative flex h-12 w-12 flex-col items-center justify-center rounded-xl text-sm font-bold"
        style={{
          backgroundColor: accentColor,
          border: 'none',
          color: surfaceColor,
          cursor: 'pointer',
        }}
        whileHover={
          !reduceMotion
            ? {
                backgroundColor: currentTheme.tokens.colors.dice.highlight,
                scale: 1.08,
                transition: { duration: 0.15 },
              }
            : undefined
        }
        whileTap={!reduceMotion ? buttonPressScale : undefined}
        aria-label={actionLabel}
        title={actionLabel}
        data-testid={`dice-quick-slot-${type}`}
        data-owned-available={count}
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
          {hasOwned ? count : INFINITE_BASICS_BADGE}
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
          anchorRef={slotRef}
          dice={favorites}
          label={label}
          onSpawn={onSpawnFavorite}
        />
      )}
    </motion.div>
  )
}

/**
 * Rendered into `document.body` because the rail is a scroll container on short
 * viewports, and an in-tree flyout would be clipped by its overflow.
 */
function FavoriteDiceFlyout({
  anchorRef,
  dice,
  label,
  onSpawn,
}: {
  anchorRef: RefObject<HTMLElement | null>
  dice: InventoryDie[]
  label: string
  onSpawn: (die: InventoryDie) => void
}) {
  const { currentTheme } = useTheme()
  const hostRef = useRef<HTMLDivElement>(null)
  const slotRefs = useRef<Map<string, HTMLElement>>(new Map())
  const [anchor, setAnchor] = useState<{ top: number; left: number } | null>(null)

  useLayoutEffect(() => {
    const update = () => {
      const element = anchorRef.current
      if (!element) return
      const rect = element.getBoundingClientRect()
      setAnchor({ top: rect.top + rect.height / 2, left: rect.right + 12 })
    }

    update()
    window.addEventListener('resize', update)
    // Capture phase so the rail's own scrolling is tracked too.
    window.addEventListener('scroll', update, true)
    return () => {
      window.removeEventListener('resize', update)
      window.removeEventListener('scroll', update, true)
    }
  }, [anchorRef])

  if (!anchor || typeof document === 'undefined') return null

  return createPortal(
    <motion.div
      className="fixed z-40 overflow-hidden rounded-lg shadow-xl"
      style={{
        top: `${anchor.top}px`,
        left: `${anchor.left}px`,
        width: 'min(328px, calc(100vw - 92px))',
        backgroundColor: 'rgba(31, 41, 55, 0.92)',
        border: `1px solid ${currentTheme.tokens.colors.accent}`,
        backdropFilter: 'blur(12px)',
        WebkitBackdropFilter: 'blur(12px)',
      }}
      initial={{ opacity: 0, x: -8, y: '-50%', scale: 0.96 }}
      animate={{ opacity: 1, x: 0, y: '-50%', scale: 1 }}
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
    </motion.div>,
    document.body,
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

function TrashButton({ onClick }: { onClick: () => void }) {
  const reduceMotion = shouldReduceMotion()
  const draggedDiceId = useDragStore((state) => state.draggedDiceId)
  const isDragging = draggedDiceId !== null
  const { currentTheme } = useTheme()
  const trashColor = '#ef4444'

  return (
    <motion.button
      id={TRASH_DROP_ZONE_ID}
      type="button"
      onClick={onClick}
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
      aria-label={isDragging ? 'Drop die to remove from table' : 'Clear all dice'}
      title={isDragging ? 'Drop die here to remove it from the table' : 'Clear all dice'}
    >
      🗑️
    </motion.button>
  )
}
