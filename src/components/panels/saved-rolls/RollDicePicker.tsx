/**
 * Roll dice picker
 *
 * The builder assembles the ROLL; this dialog decides which physical dice fill
 * it. It is the only place owned dice are chosen, replacing the always-visible
 * "Owned Dice" grid the builder used to carry (PO decision (g), 2026-07-28).
 *
 * ## Slots, not counts
 * An entry of N dice has N SLOTS. A slot is either PINNED to one owned die or
 * left to AUTO fill — owned-first, then a basic die once the player's dice of
 * that type run out (`spawnEntry` in `src/lib/savedRollExecution.ts`). Pinning
 * never changes N: it only decides which die lands in a slot the entry already
 * had, so the room-capacity rules the builder enforces cannot move underneath
 * it. With every slot pinned the remaining tiles go disabled rather than
 * silently growing the entry.
 *
 * ## Percentile entries
 * A d100 is a `d10tens` + `d10` pair, and no player can own a tens die — it is
 * always a plain engine die (`expandDiceEntrySpawns`). The ONES half is an
 * ordinary owned d10, so pinning IS meaningful here and is offered, with copy
 * naming which half the pin applies to.
 *
 * ## One WebGL context
 * Tiles show the same animated 3D previews as the inventory, drawn by a SINGLE
 * `SharedInventoryDicePreviewCanvas` scissored across the grid. A per-tile
 * canvas would blow the browser's WebGL context limit on a large collection.
 */

import { useCallback, useId, useMemo, useRef, useState } from 'react'

import { useNestedDialog } from '../../../hooks/useNestedDialog'
import { SharedInventoryDicePreviewCanvas } from '../SharedInventoryDicePreviewCanvas'
import { RARITY_ACCENT_COLORS } from '../../../lib/rarityColor'
import { isPercentileEntry } from '../../../lib/percentileRolls'
import {
  getEntrySlotSummary,
  getSpecificDieIds,
  pinDieToEntry,
  unpinDieFromEntry,
} from '../../../lib/rollSources'
import type { DiceEntry } from '../../../types/savedRolls'
import type { DieRarity, InventoryDie } from '../../../types/inventory'

/**
 * The inventory's rarity accent, as a value the picker can use without a theme
 * provider. `getRarityColor` reads the theme only to resolve `common` to
 * `text.secondary`; the CSS variable is the same colour and tracks a live theme
 * switch, so this needs no context and the dialog renders standalone.
 */
function rarityAccent(rarity: DieRarity): string {
  return rarity === 'common'
    ? 'var(--color-text-secondary)'
    : RARITY_ACCENT_COLORS[rarity]
}

/**
 * Tiles rendered before "Show more". Each tile drives one 3D preview in the
 * shared canvas, and every visible preview is transformed and scissor-rendered
 * every frame — an unbounded grid drops the dialog to single-digit fps on a
 * large collection. Matches `InventoryPanel`'s own batch size.
 */
const VISIBLE_DICE_BATCH_SIZE = 24

interface RollDicePickerProps {
  /** The entry being composed. */
  entry: DiceEntry
  /** How the entry reads in the builder ("6d20"), for the dialog title. */
  entryLabel: string
  /** The player's whole collection; the picker filters it to the entry's type. */
  ownedDice: readonly InventoryDie[]
  /**
   * Dice pinned by OTHER entries of the same roll. One inventory die is one
   * physical die, so a second entry claiming it would quietly spawn a basic —
   * those tiles are offered as already-spoken-for rather than pinnable.
   */
  pinnedElsewhere?: ReadonlySet<string>
  onChange: (entry: DiceEntry) => void
  onClose: () => void
}

export function RollDicePicker({
  entry,
  entryLabel,
  ownedDice,
  pinnedElsewhere,
  onChange,
  onClose,
}: RollDicePickerProps) {
  // Focus, Escape, Tab and backdrop dismissal are the contract every dialog
  // nested inside a BottomSheet owes it (see `useNestedDialog`).
  const { dialogRef, onKeyDown, backdropProps } = useNestedDialog<HTMLDivElement>(onClose)
  const previewHostRef = useRef<HTMLDivElement>(null)
  const previewSlotRefs = useRef<Map<string, HTMLElement>>(new Map())
  const [visibleCount, setVisibleCount] = useState(VISIBLE_DICE_BATCH_SIZE)
  const titleId = useId()
  const summaryId = useId()

  const isPercentile = isPercentileEntry(entry)
  const typeLabel = isPercentile ? 'D100' : entry.type.toUpperCase()
  const summary = getEntrySlotSummary(entry)
  const pinnedHere = useMemo(() => new Set(getSpecificDieIds(entry)), [entry])

  // Favourites first, then most recently rolled — the same ordering the
  // inventory uses, so a die is where the player last saw it.
  const candidates = useMemo(() => {
    return ownedDice
      .filter((die) => die.type === entry.type)
      .sort((a, b) => {
        if (a.isFavorite !== b.isFavorite) return a.isFavorite ? -1 : 1
        return (b.lastRolledAt ?? b.acquiredAt) - (a.lastRolledAt ?? a.acquiredAt)
      })
  }, [ownedDice, entry.type])

  const visibleDice = useMemo(
    () => candidates.slice(0, visibleCount),
    [candidates, visibleCount],
  )
  const hiddenCount = candidates.length - visibleDice.length

  // Thumbnailed managed assets render as images, so only the procedural dice
  // need a 3D slot — mirroring `InventoryPanel`. Scoped to the VISIBLE batch:
  // the shared canvas builds a geometry+material entry per die it is handed,
  // so feeding it the whole collection would pay the cost the batching exists
  // to avoid.
  const proceduralPreviewDice = useMemo(
    () => visibleDice.filter((die) => !die.customAsset?.thumbnailUrl),
    [visibleDice],
  )

  const registerPreviewSlot = useCallback((dieId: string, element: HTMLElement | null) => {
    if (element) previewSlotRefs.current.set(dieId, element)
    else previewSlotRefs.current.delete(dieId)
  }, [])

  const handleToggle = (die: InventoryDie, isPinned: boolean) => {
    onChange(isPinned ? unpinDieFromEntry(entry, die.id) : pinDieToEntry(entry, die.id))
  }

  return (
    <div
      className="fixed inset-0 z-[70] flex items-end justify-center bg-theme-bg/70 p-0 sm:items-center sm:p-4"
      {...backdropProps}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={summaryId}
        tabIndex={-1}
        data-testid="roll-dice-picker"
        className="flex max-h-[92vh] w-full max-w-4xl flex-col overflow-hidden rounded-t-2xl sm:rounded-2xl"
        style={{
          backgroundColor: 'var(--color-surface)',
          color: 'var(--color-text-primary)',
          border: '1px solid var(--color-border)',
          boxShadow: '0 24px 80px rgba(0, 0, 0, 0.5)',
        }}
        onClick={(event) => event.stopPropagation()}
        onKeyDown={onKeyDown}
      >
        {/* Header */}
        <div
          className="flex items-start justify-between gap-3 border-b px-4 py-3 sm:px-5"
          style={{ borderColor: 'var(--color-border)' }}
        >
          <div className="min-w-0">
            <h3 id={titleId} className="text-lg font-bold">
              {`Choose ${typeLabel} dice`}
            </h3>
            <p
              id={summaryId}
              data-testid="roll-dice-picker-summary"
              className="mt-0.5 text-sm"
              style={{ color: 'var(--color-text-secondary)' }}
            >
              {`${entryLabel} — ${summary.pinned} pinned, ${summary.auto} auto`}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full transition-all"
            style={{
              backgroundColor: 'rgba(255, 255, 255, 0.1)',
              color: 'var(--color-text-secondary)',
            }}
            aria-label="Close dice picker"
          >
            ✕
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-4 py-4 sm:px-5">
          {/* What an unpinned slot does, said once rather than per tile. */}
          <p className="text-xs leading-snug" style={{ color: 'var(--color-text-muted)' }}>
            Pinned dice always roll. Every other slot fills itself with any free
            die you own of this type, then with basic dice.
          </p>

          {isPercentile && (
            <p
              data-testid="roll-dice-picker-percentile-notice"
              className="mt-3 rounded px-2 py-1.5 text-xs"
              style={{
                backgroundColor: 'rgba(249, 135, 151, 0.12)',
                color: 'var(--color-text-secondary)',
                border: '1px solid rgba(249, 135, 151, 0.25)',
              }}
            >
              A d100 rolls as a tens + ones pair. Pinning applies to the ONES die
              — the tens die reads 00–90 and is always a plain die, so there is
              nothing to own.
            </p>
          )}

          {candidates.length === 0 ? (
            <p
              data-testid="roll-dice-picker-empty"
              className="mt-6 text-sm"
              style={{ color: 'var(--color-text-muted)' }}
            >
              {`You do not own any ${entry.type.toUpperCase()} yet, so this entry rolls basic dice.`}
            </p>
          ) : (
            <div ref={previewHostRef} className="relative mt-4">
              {proceduralPreviewDice.length > 0 && (
                <SharedInventoryDicePreviewCanvas
                  dice={proceduralPreviewDice}
                  hostRef={previewHostRef}
                  slotRefs={previewSlotRefs}
                />
              )}
              <div className="relative grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
                {visibleDice.map((die) => {
                  const isPinned = pinnedHere.has(die.id)
                  const isElsewhere = pinnedElsewhere?.has(die.id) ?? false
                  const isFull = summary.auto === 0
                  const disabled = !isPinned && (isElsewhere || isFull)
                  const rarityColor = rarityAccent(die.rarity)

                  return (
                    <button
                      key={die.id}
                      type="button"
                      aria-pressed={isPinned}
                      disabled={disabled}
                      onClick={() => handleToggle(die, isPinned)}
                      data-testid="roll-dice-picker-tile"
                      data-die-id={die.id}
                      data-pinned={isPinned ? 'true' : 'false'}
                      className="group relative overflow-hidden rounded-lg p-2 text-left transition-all disabled:opacity-45"
                      style={{
                        backgroundColor: 'var(--color-background)',
                        // Selection is carried by a thick accent OUTLINE as well
                        // as the "Pinned" badge below, so it survives both
                        // greyscale and a colour-blind reading.
                        border: `1px solid ${isPinned ? 'var(--color-accent)' : 'var(--color-border)'}`,
                        outline: isPinned ? '3px solid var(--color-accent)' : 'none',
                        outlineOffset: '-1px',
                      }}
                      aria-label={
                        isPinned
                          ? `Unpin ${die.name}`
                          : isElsewhere
                            ? `${die.name} is already pinned to another entry`
                            : isFull
                              ? `${die.name} — every slot in this entry is already pinned`
                              : `Pin ${die.name}`
                      }
                    >
                      <div
                        className="relative aspect-square w-full overflow-hidden rounded"
                        style={{
                          backgroundColor: 'rgba(0, 0, 0, 0.28)',
                          border: `1px solid ${rarityColor}`,
                        }}
                      >
                        {die.customAsset?.thumbnailUrl ? (
                          <img
                            src={die.customAsset.thumbnailUrl}
                            alt=""
                            loading="lazy"
                            decoding="async"
                            className="absolute inset-0 h-full w-full object-cover"
                          />
                        ) : (
                          <div
                            ref={(element) => registerPreviewSlot(die.id, element)}
                            data-testid="roll-dice-picker-preview"
                            data-preview-id={die.id}
                            aria-hidden="true"
                            className="absolute inset-0"
                          />
                        )}
                      </div>

                      <div className="mt-2 truncate text-xs font-semibold">{die.name}</div>
                      <div className="truncate text-[11px] capitalize" style={{ color: rarityColor }}>
                        {die.rarity}
                      </div>

                      {/* Text, not just the outline: the selected state has to
                          survive a greyscale render. */}
                      <span
                        className="mt-1 inline-block rounded-full px-2 py-0.5 text-[11px] font-bold"
                        style={
                          isPinned
                            ? {
                              backgroundColor: 'var(--color-accent)',
                              color: 'var(--color-on-accent)',
                            }
                            : {
                              backgroundColor: 'transparent',
                              color: 'var(--color-text-muted)',
                              border: '1px solid var(--color-border)',
                            }
                        }
                      >
                        {isPinned ? '✓ Pinned' : isElsewhere ? 'In another entry' : 'Auto'}
                      </span>
                    </button>
                  )
                })}
              </div>

              {hiddenCount > 0 && (
                <div className="flex justify-center pt-3">
                  <button
                    type="button"
                    onClick={() => setVisibleCount((count) => count + VISIBLE_DICE_BATCH_SIZE)}
                    data-testid="roll-dice-picker-show-more"
                    className="rounded-md px-5 py-2 text-sm font-semibold transition-colors"
                    style={{
                      backgroundColor: 'var(--color-surface)',
                      color: 'var(--color-text-primary)',
                      border: '1px solid var(--color-border)',
                    }}
                  >
                    {`Show ${Math.min(VISIBLE_DICE_BATCH_SIZE, hiddenCount)} More`}
                  </button>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Footer */}
        <div
          className="flex items-center justify-between gap-3 border-t px-4 py-3 sm:px-5"
          style={{ borderColor: 'var(--color-border)' }}
        >
          <p className="text-xs" style={{ color: 'var(--color-text-muted)' }}>
            {summary.auto === 0
              ? 'Every slot in this entry is pinned.'
              : `${summary.auto} of ${summary.total} ${summary.total === 1 ? 'die' : 'dice'} left on auto.`}
          </p>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg px-5 py-2.5 text-sm font-semibold transition-all"
            style={{
              backgroundColor: 'var(--color-accent)',
              color: 'var(--color-on-accent)',
            }}
          >
            Done
          </button>
        </div>
      </div>
    </div>
  )
}
