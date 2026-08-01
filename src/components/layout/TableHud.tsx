/**
 * Table HUD (Layout A)
 *
 * The chrome that sits on top of the dice canvas: the 5-slot bottom nav (with
 * its elevated roll button), the top corner icons, the permanent bottom-left
 * control cluster, and the dice toolbar rail.
 *
 * Extracted from `Scene` so the HUD can be asserted against a rendered DOM
 * rather than against the source text of `Scene.tsx`.
 */

import type { DiceShape } from '../../types/diceShape'
import { BottomNav } from './BottomNav'
import { CornerIcon } from './CornerIcon'
import { DiceToolbar } from './DiceToolbar'
import { HUD_LAYOUT } from './hudLayout'
import { UIToggleMini } from './UIToggleMini'

export interface TableHudProps {
  /** False once the player hides the UI; only the eye survives. */
  isUIVisible: boolean
  /**
   * True while a full-screen or modal overlay owns the screen. The bottom-left
   * cluster is suppressed so it can neither paint over nor steal taps from the
   * overlay. Hiding the UI closes every overlay, so "UI hidden" and "overlay
   * open" are mutually exclusive and the eye is always reachable.
   */
  isOverlayOpen: boolean
  isMobile: boolean
  motionMode: boolean
  showShop: boolean
  isDiceManagerOpen: boolean
  canRoll: boolean
  onToggleUIVisibility: () => void
  onOpenDiceManager: () => void
  onOpenSavedRolls: () => void
  onOpenHistory: () => void
  onOpenPlayerPanel: () => void
  onOpenSettings: () => void
  onOpenShop: () => void
  onRotateView: () => void
  onToggleMotion: () => void
  onRoll: () => void
  onAddDice: (type: DiceShape, inventoryDieId?: string) => void
  onClearAllDice: () => void
  onOpenInventory: () => void
}

export function TableHud({
  isUIVisible,
  isOverlayOpen,
  isMobile,
  motionMode,
  showShop,
  isDiceManagerOpen,
  canRoll,
  onToggleUIVisibility,
  onOpenDiceManager,
  onOpenSavedRolls,
  onOpenHistory,
  onOpenPlayerPanel,
  onOpenSettings,
  onOpenShop,
  onRotateView,
  onToggleMotion,
  onRoll,
  onAddDice,
  onClearAllDice,
  onOpenInventory,
}: TableHudProps) {
  // One rule, encoded once: the permanent bottom-left cluster (rotate, motion,
  // eye) only exists when no overlay owns the screen.
  const showControlCluster = !isOverlayOpen

  return (
    <>
      {isUIVisible && (
        <>
          {/* Bottom navigation bar, including the elevated centre roll button. */}
          <BottomNav
            isVisible
            onOpenDiceManager={onOpenDiceManager}
            onOpenSavedRolls={onOpenSavedRolls}
            onOpenHistory={onOpenHistory}
            onOpenPlayerPanel={onOpenPlayerPanel}
            onRoll={onRoll}
            rollDisabled={!canRoll}
            diceManagerOpen={isDiceManagerOpen}
          />

          {/* Top-Left Corner: Settings */}
          <CornerIcon
            position="top-left"
            onClick={onOpenSettings}
            label="Settings"
            isVisible
          >
            ⚙️
          </CornerIcon>

          {/* Top-right shop hub keeps the existing payments/conversion gate. */}
          {showShop && (
            <CornerIcon
              position="top-right"
              onClick={onOpenShop}
              label="Shop"
              isVisible
            >
              🛍️
            </CornerIcon>
          )}

          {showControlCluster && (
            <button
              type="button"
              onClick={onRotateView}
              className="fixed left-4 z-40 flex items-center justify-center rounded-full transition-all hover:scale-105"
              style={bottomLeftControlStyle(HUD_LAYOUT.rotate.bottom)}
              aria-label="Rotate view 90 degrees"
              title="Rotate my view 90°"
              data-testid="rotate-view-button"
            >
              🔄
            </button>
          )}
          {showControlCluster && isMobile && (
            <button
              type="button"
              onClick={onToggleMotion}
              className="fixed left-4 z-40 flex items-center justify-center rounded-full transition-all hover:scale-105"
              style={{
                ...bottomLeftControlStyle(HUD_LAYOUT.motion.bottom),
                // Active state swaps the fill to accent, so the label has to
                // swap with it — text.primary is not legible on every accent.
                backgroundColor: motionMode ? 'var(--color-accent)' : 'var(--color-surface)',
                color: motionMode ? 'var(--color-on-accent)' : 'var(--color-text-primary)',
              }}
              aria-label="Motion Mode"
              title="Motion Mode"
              aria-pressed={motionMode}
            >
              PHYS
            </button>
          )}

          <DiceToolbar
            isOpen={isDiceManagerOpen}
            onAddDice={onAddDice}
            onClearAllDice={onClearAllDice}
            onOpenInventory={onOpenInventory}
          />
        </>
      )}

      {/*
        Permanent UI toggle / hide-UI eye. It survives hiding the UI, and is
        suppressed only while an overlay owns the screen — the two states can
        never coincide, so the eye is never unreachable.
      */}
      {showControlCluster && (
        <UIToggleMini onClick={onToggleUIVisibility} isVisible={isUIVisible} />
      )}
    </>
  )
}

function bottomLeftControlStyle(bottom: number) {
  return {
    bottom: `${bottom}px`,
    width: `${HUD_LAYOUT.rotate.size}px`,
    height: `${HUD_LAYOUT.rotate.size}px`,
    backgroundColor: 'var(--color-surface)',
    color: 'var(--color-text-primary)',
    boxShadow: 'var(--shadow-md)',
    opacity: 0.7,
  } as const
}
