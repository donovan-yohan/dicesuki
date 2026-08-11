/**
 * Dice Toolbar Component
 *
 * A compact game-HUD rail for spawning owned dice, opening favorite dice, and
 * exposing the trash drop target for active table dice.
 */

import { AnimatePresence, motion, useIsPresent } from 'framer-motion'
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { ReactNode, RefObject } from 'react'
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

const labelForType = (type: DiceShape): string =>
  ALL_DICE_TYPES.find(entry => entry.type === type)?.label ?? type.toUpperCase()

/**
 * One definition of the empty-favourites copy, read by both the visible hint and
 * the rail's live region. Two hand-kept copies of the same sentence would drift,
 * and a reader hearing one sentence while the screen shows another is worse than
 * either alone.
 */
const favoritesEmptyHint = (label: string): string =>
  `No favorite ${label} dice yet. Star dice in the Inventory panel to keep them one tap away here.`

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

  /**
   * Close whatever the ★ opened whenever the rail is dismissed. Without this the
   * hint's full-screen tap catcher outlives the rail twice over: once through
   * the ~0.5s exit animation, where it sits above the bottom sheet that replaced
   * the rail and eats its first tap, and again when `Scene` auto-restores the
   * rail after an overlay closes and the unrequested hint comes back with it.
   */
  useEffect(() => {
    if (!isOpen) setActiveFavoriteType(null)
  }, [isOpen])

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
   * Favourites are the rail's only inventory-derived content. A player has an
   * unlimited supply of basic dice (`lib/basicDice.ts`), so every type is always
   * present, always enabled, and carries no owned-count — tapping spawns an
   * owned die when one is free and a basic one when none is.
   */
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

  /**
   * The empty-favourites hint's copy, mirrored into the rail's live region.
   *
   * The hint itself cannot be the live region: it is portalled in with its text
   * already inside, and a region inserted together with its content is the one
   * shape screen readers reliably do NOT announce. The region below is instead
   * mounted with the rail — in the accessibility tree well before any ★ is
   * tapped — so writing into it is a change the reader picks up.
   */
  const activeFavorites = activeFavoriteType ? favoriteDiceByType.get(activeFavoriteType) : undefined
  const liveHint = activeFavoriteType && !activeFavorites?.length
    ? favoritesEmptyHint(labelForType(activeFavoriteType))
    : ''

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
          <p
            className="sr-only"
            role="status"
            aria-live="polite"
            data-testid="dice-toolbar-live-region"
          >
            {liveHint}
          </p>

          {/* The negative margin widens only the scroll box, so the ★ sub-buttons
              that overhang each slot are not clipped while the slots themselves
              stay on the same x. */}
          <div
            data-testid="dice-toolbar-scroll"
            className="-mx-2 flex min-h-0 flex-1 flex-col items-center gap-3 overflow-y-auto overscroll-contain px-2 py-2"
            style={{ scrollbarWidth: 'none' }}
          >
          {ALL_DICE_TYPES.map(({ type, label }, index) => {
            const favorites = favoriteDiceByType.get(type) ?? []
            const isFavoriteOpen = activeFavoriteType === type

            return (
              <DiceQuickSlot
                key={type}
                type={type}
                label={label}
                favorites={favorites}
                index={index}
                isFavoriteOpen={isFavoriteOpen}
                onAdd={() => onAddDice(type)}
                onToggleFavorites={() => setActiveFavoriteType(isFavoriteOpen ? null : type)}
                onCloseFavorites={() => setActiveFavoriteType(null)}
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
              delay: ALL_DICE_TYPES.length * 0.05,
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
              delay: (ALL_DICE_TYPES.length + 1) * 0.05,
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
  favorites: InventoryDie[]
  index: number
  isFavoriteOpen: boolean
  onAdd: () => void
  onToggleFavorites: () => void
  onCloseFavorites: () => void
  onSpawnFavorite: (die: InventoryDie) => void
}

function DiceQuickSlot({
  type,
  label,
  favorites,
  index,
  isFavoriteOpen,
  onAdd,
  onToggleFavorites,
  onCloseFavorites,
  onSpawnFavorite,
}: DiceQuickSlotProps) {
  const reduceMotion = shouldReduceMotion()
  const { currentTheme } = useTheme()
  // While the rail plays its exit animation, `AnimatePresence` keeps rendering
  // the element tree it captured at removal — parent state no longer reaches
  // it. Without this the hint's full-screen tap catcher would linger over
  // whatever replaced the rail and eat its first tap.
  const isPresent = useIsPresent()
  const accentColor = currentTheme.tokens.colors.accent
  const surfaceColor = currentTheme.tokens.colors.surface
  const hasFavorites = favorites.length > 0
  const slotRef = useRef<HTMLDivElement>(null)
  // No count: the supply is effectively unlimited, so the only thing a number
  // could tell the player is which of two indistinguishable dice they get.
  const actionLabel = `Add ${label} — your owned dice first, then unlimited basics`
  // A noun, not a Show/Hide verb: `aria-expanded` already reports the open
  // state, and the verb form went stale on the empty branch (it kept saying
  // "Show" while the hint was on screen). The native tooltip keeps the verb —
  // it is sighted-only and has no `aria-expanded` equivalent to lean on.
  const favoritesLabel = `Favorite ${label} dice${hasFavorites ? '' : ' (none yet)'}`
  const favoritesTitle = `${isFavoriteOpen ? 'Hide' : 'Show'} favorite ${label} dice`
  const favoritesPanelId = `quick-slot-favorites-${type}`
  // The panel only exists while the slot is present; advertising it through the
  // rail's exit animation would leave `aria-controls` pointing at nothing.
  const isPanelOpen = isFavoriteOpen && isPresent

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
      >
        <span>{label}</span>
      </motion.button>

      {/* Always present, favourites or not: the ★ is where favourites live, and
          a control that appears only once you already know about the feature
          cannot teach it. Empty types open the hint instead of the tray.

          The testid is deliberately NOT under the `dice-quick-slot-` prefix —
          `hud-layout.spec.ts` measures every element matching that prefix as a
          rail slot, and a star answering to it would silently double the count. */}
      <button
        type="button"
        onClick={(event) => {
          event.stopPropagation()
          onToggleFavorites()
        }}
        className="absolute -right-2 -bottom-2 z-[72] flex h-6 w-6 items-center justify-center rounded-full text-[11px] font-bold shadow-lg"
        style={{
          backgroundColor: isFavoriteOpen ? currentTheme.tokens.colors.dice.highlight : surfaceColor,
          // The empty state is a declared token, not an opacity multiplier: the
          // rail floats over the live 3D table, and dimming would composite the
          // glyph against the scene where no contrast pairing can model it.
          color: isFavoriteOpen
            ? surfaceColor
            : hasFavorites
              ? accentColor
              : currentTheme.tokens.colors.text.muted,
          border: `2px solid ${accentColor}`,
        }}
        aria-label={favoritesLabel}
        title={favoritesTitle}
        aria-expanded={isPanelOpen}
        aria-controls={isPanelOpen ? favoritesPanelId : undefined}
        data-testid={`quick-slot-star-${type}`}
        data-has-favorites={hasFavorites}
      >
        ★
      </button>

      {isPanelOpen && (
        hasFavorites ? (
          <FavoriteDiceFlyout
            anchorRef={slotRef}
            dice={favorites}
            label={label}
            panelId={favoritesPanelId}
            onSpawn={onSpawnFavorite}
          />
        ) : (
          <FavoriteDiceEmptyHint
            anchorRef={slotRef}
            label={label}
            panelId={favoritesPanelId}
            onDismiss={onCloseFavorites}
          />
        )
      )}
    </motion.div>
  )
}

/**
 * Track the slot's on-screen position so a portalled flyout can sit beside it.
 * `null` until the first layout pass, which is also the signal not to render.
 */
function useFlyoutAnchor(anchorRef: RefObject<HTMLElement | null>) {
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

  return anchor
}

/**
 * The shared chrome for anything the ★ opens — one definition of the tinted
 * panel, so the favourites tray and its empty state cannot drift apart.
 *
 * Named for the quick slot to keep it distinct from `panels/FlyoutPanel.tsx`,
 * the unrelated full-height slide-in panel.
 */
function QuickSlotFlyoutPanel({
  anchor,
  ariaLabel,
  className = '',
  id,
  onClick,
  role,
  testId,
  children,
}: {
  anchor: { top: number; left: number }
  ariaLabel?: string
  className?: string
  id?: string
  onClick?: () => void
  role?: string
  testId?: string
  children: ReactNode
}) {
  const { currentTheme } = useTheme()

  return (
    <motion.div
      className={`fixed overflow-hidden rounded-lg shadow-xl ${className}`.trim()}
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
      aria-label={ariaLabel}
      id={id}
      onClick={onClick}
      role={role}
      data-testid={testId}
    >
      {children}
    </motion.div>
  )
}

/**
 * Rendered into `document.body` because the rail is a scroll container on short
 * viewports, and an in-tree flyout would be clipped by its overflow.
 *
 * Deliberately has no tap-anywhere catcher, unlike its empty state: this one
 * holds spawn targets, so swallowing the tap that lands on a die would cost the
 * player the action they came for. It closes on spawn or on the ★.
 */
function FavoriteDiceFlyout({
  anchorRef,
  dice,
  label,
  panelId,
  onSpawn,
}: {
  anchorRef: RefObject<HTMLElement | null>
  dice: InventoryDie[]
  label: string
  panelId: string
  onSpawn: (die: InventoryDie) => void
}) {
  const { currentTheme } = useTheme()
  const hostRef = useRef<HTMLDivElement>(null)
  const slotRefs = useRef<Map<string, HTMLElement>>(new Map())
  const anchor = useFlyoutAnchor(anchorRef)

  if (!anchor || typeof document === 'undefined') return null

  return createPortal(
    <QuickSlotFlyoutPanel
      anchor={anchor}
      // "tray", so the panel does not share an accessible name with the ★ that
      // opens it — two nodes answering to "Favorite D20 dice" is ambiguous to
      // read out and ambiguous to query.
      ariaLabel={`Favorite ${label} dice tray`}
      className="z-40"
      id={panelId}
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
    </QuickSlotFlyoutPanel>,
    document.body,
  )
}

/**
 * What the ★ says when a type has no favourites yet. It occupies the tray's own
 * position so the control always resolves to something, and any tap anywhere
 * dismisses it — a hint the player did not ask for must never need aiming at to
 * get rid of.
 */
function FavoriteDiceEmptyHint({
  anchorRef,
  label,
  panelId,
  onDismiss,
}: {
  anchorRef: RefObject<HTMLElement | null>
  label: string
  panelId: string
  onDismiss: () => void
}) {
  const { currentTheme } = useTheme()
  const anchor = useFlyoutAnchor(anchorRef)

  if (!anchor || typeof document === 'undefined') return null

  return createPortal(
    <>
      {/* A plain div, matching BottomSheet's backdrop: a <button> here would
          take mouse focus off the ★ on the way to unmounting itself, stranding
          the keyboard user at <body>. Keyboard closes with the ★ toggle, which
          `aria-expanded` describes; this only exists so a stray tap counts as
          "dismiss" instead of falling through to the table. */}
      <div
        aria-hidden="true"
        onClick={onDismiss}
        className="fixed inset-0 z-[71]"
        data-testid="favorite-dice-hint-backdrop"
      />
      {/* No `role="status"` and no `aria-label` here: this panel is portalled in
          with its copy already inside, which is precisely the live region a
          reader will not announce, and an atomic region with a name gets read as
          its name — dropping the actionable half. The rail owns the live region
          instead; this is the sighted rendering of the same sentence. */}
      <QuickSlotFlyoutPanel
        anchor={anchor}
        // Above the catcher, so the hint the catcher exists for stays readable.
        className="z-[72]"
        id={panelId}
        onClick={onDismiss}
        testId="favorite-dice-empty-hint"
      >
        <p
          className="p-3 text-xs leading-snug"
          style={{ color: currentTheme.tokens.colors.text.primary }}
        >
          {favoritesEmptyHint(label)}
        </p>
      </QuickSlotFlyoutPanel>
    </>,
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
