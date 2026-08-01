import { type KeyboardEvent, useState } from 'react'
import { DiceIconWithNumber } from '../../icons/DiceIconWithNumber'
import type { DiceEntry } from '../../../types/savedRolls'
import type { InventoryDie } from '../../../types/inventory'
import { formatDiceEntry } from '../../../lib/diceHelpers'
import {
  getDiceEntrySourceQuantity,
  normalizeRollSources,
  resizeRollSources,
} from '../../../lib/rollSources'

/** Widest count the quantity field accepts; the room cap is 30. */
const MAX_QUANTITY_DIGITS = 3

interface DiceEntryCardProps {
  entry: DiceEntry
  onUpdate: (entry: DiceEntry) => void
  onRemove: () => void
  inventoryDiceById?: Map<string, InventoryDie>
  /** True when the roll as a whole exceeds the room dice capacity. */
  isOverCapacity?: boolean
  /** Id of the builder's capacity message, for aria-describedby. */
  capacityMessageId?: string
}

/**
 * Card showing a single dice entry in the roll builder
 * Allows editing quantity, bonuses, and advanced options
 */
export function DiceEntryCard({
  entry,
  onUpdate,
  onRemove,
  inventoryDiceById,
  isOverCapacity = false,
  capacityMessageId,
}: DiceEntryCardProps) {
  const [showAdvanced, setShowAdvanced] = useState(false)
  // The draft owns the displayed text while the field is being typed into, and
  // is only committed on blur or Enter. Committing per keystroke would make
  // typing "12" pass through 1, and each pass-through would permanently drop
  // sources the user never asked to remove.
  const [quantityDraft, setQuantityDraft] = useState<string | null>(null)
  const [droppedDieNames, setDroppedDieNames] = useState<string[]>([])

  // Per-entry floor is 1; the roll-wide ROOM_DICE_CAPACITY ceiling is validated
  // in RollBuilder, which is the only place that can see every entry's total.
  const commitQuantity = (nextQuantity: number) => {
    const target = Math.max(1, Math.floor(nextQuantity))
    const { sources, droppedDieIds } = resizeRollSources(normalizeRollSources(entry), target)

    setDroppedDieNames(droppedDieIds.map(
      (dieId) => inventoryDiceById?.get(dieId)?.name ?? 'an owned die',
    ))

    onUpdate({
      ...entry,
      quantity: target,
      // Keep/drop is not editable here; a manual count change resets it so the
      // entry cannot keep a stale rollCount that outranks the new quantity.
      rollCount: undefined,
      sources,
    })
  }

  const handleQuantityChange = (delta: number) => {
    setQuantityDraft(null)
    commitQuantity(getDiceEntrySourceQuantity(entry) + delta)
  }

  const handleQuantityInput = (rawValue: string) => {
    setQuantityDraft(rawValue.replace(/[^0-9]/g, '').slice(0, MAX_QUANTITY_DIGITS))
  }

  /** Commit the draft, or revert to the committed value if it is unusable. */
  const commitQuantityDraft = () => {
    if (quantityDraft === null) return

    const parsed = Number.parseInt(quantityDraft, 10)
    if (Number.isInteger(parsed) && parsed >= 1) {
      commitQuantity(parsed)
    }
    setQuantityDraft(null)
  }

  const handleQuantityKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Enter') {
      event.preventDefault()
      commitQuantityDraft()
      return
    }

    // Escape is only ours while a draft is in flight, where it means "abandon
    // what I typed". The panel listens for Escape on `document` to close the
    // sheet, so swallowing it unconditionally would trap the user in the
    // builder; letting it bubble when there is no draft keeps sheet-close the
    // expected behaviour.
    if (event.key === 'Escape' && quantityDraft !== null) {
      event.preventDefault()
      event.stopPropagation()
      setQuantityDraft(null)
    }
  }

  const handleBonusChange = (bonus: number) => {
    onUpdate({ ...entry, perDieBonus: bonus })
  }

  // Display formula for this entry
  const getFormula = () => {
    return formatDiceEntry(entry)
  }

  const sourceLabels = getSourceLabels(entry, inventoryDiceById)
  const quantity = getDiceEntrySourceQuantity(entry)

  return (
    <div
      className="flex flex-col gap-2 p-3 rounded-lg"
      style={{
        backgroundColor: 'var(--color-surface)',
        border: '2px solid var(--color-border)',
      }}
    >
      {/* Main row: dice icon, formula, controls */}
      <div className="flex items-center gap-3">
        <DiceIconWithNumber type={entry.type} number={quantity} size={40} />

        <div className="flex-1">
          <div className="text-lg font-bold" style={{ color: 'var(--color-text-primary)' }}>
            {getFormula()}
          </div>
          {sourceLabels.length > 0 && (
            <div className="flex flex-wrap gap-1 mt-1">
              {sourceLabels.map((source) => (
                <span
                  key={source.key}
                  className="text-[11px] px-2 py-0.5 rounded-full"
                  style={{
                    backgroundColor: source.isMissing
                      ? 'rgba(239, 68, 68, 0.18)'
                      : 'rgba(249, 135, 151, 0.16)',
                    color: source.isMissing ? '#fca5a5' : 'var(--color-accent)',
                    border: source.isMissing
                      ? '1px solid rgba(239, 68, 68, 0.35)'
                      : '1px solid rgba(249, 135, 151, 0.25)',
                  }}
                >
                  {source.label}
                </span>
              ))}
            </div>
          )}
        </div>

        {/* Quantity controls */}
        <div className="flex items-center gap-1">
          <button
            onClick={() => handleQuantityChange(-1)}
            disabled={quantity <= 1}
            className="w-8 h-8 rounded flex items-center justify-center font-bold transition-all disabled:opacity-30"
            style={{
              backgroundColor: 'var(--color-background)',
              color: 'var(--color-text-primary)',
            }}
          >
            −
          </button>
          <input
            type="text"
            inputMode="numeric"
            pattern="[0-9]*"
            maxLength={MAX_QUANTITY_DIGITS}
            value={quantityDraft ?? String(quantity)}
            onChange={(event) => handleQuantityInput(event.target.value)}
            onFocus={(event) => event.currentTarget.select()}
            onBlur={commitQuantityDraft}
            onKeyDown={handleQuantityKeyDown}
            className="field-focus-ring w-12 h-8 text-center rounded font-semibold"
            style={{
              backgroundColor: 'var(--color-background)',
              color: 'var(--color-text-primary)',
              border: `1px solid ${isOverCapacity ? 'var(--color-error)' : 'var(--color-border)'}`,
            }}
            aria-label={`${entry.type.toUpperCase()} quantity`}
            aria-invalid={isOverCapacity ? true : undefined}
            aria-describedby={isOverCapacity ? capacityMessageId : undefined}
          />
          <button
            onClick={() => handleQuantityChange(1)}
            className="w-8 h-8 rounded flex items-center justify-center font-bold transition-all"
            style={{
              backgroundColor: 'var(--color-background)',
              color: 'var(--color-text-primary)',
            }}
          >
            +
          </button>
        </div>

        {/* Remove button */}
        <button
          onClick={onRemove}
          className="w-8 h-8 rounded flex items-center justify-center transition-all"
          style={{
            backgroundColor: 'var(--color-error)',
            color: 'white',
          }}
        >
          🗑️
        </button>
      </div>

      {/* Owned dice dropped by a shrink. Not an alert: the edit succeeded, but
          losing a specific die is destructive enough to have to be named. */}
      {droppedDieNames.length > 0 && (
        <p
          role="status"
          className="text-xs px-2 py-1 rounded"
          style={{
            backgroundColor: 'rgba(249, 135, 151, 0.12)',
            color: 'var(--color-text-secondary)',
            border: '1px solid rgba(249, 135, 151, 0.25)',
          }}
        >
          Removed from this roll: {droppedDieNames.join(', ')}
        </p>
      )}

      {/* Per-die bonus */}
      <div className="flex items-center gap-2">
        <label className="text-sm font-medium" style={{ color: 'var(--color-text-secondary)' }}>
          Bonus per die:
        </label>
        <div className="flex items-center gap-1">
          <button
            onClick={() => handleBonusChange(entry.perDieBonus - 1)}
            className="w-7 h-7 rounded flex items-center justify-center text-sm font-bold transition-all"
            style={{
              backgroundColor: 'var(--color-background)',
              color: 'var(--color-text-primary)',
            }}
          >
            −
          </button>
          <input
            type="number"
            value={entry.perDieBonus}
            onChange={(e) => handleBonusChange(parseInt(e.target.value) || 0)}
            aria-label={`${entry.type.toUpperCase()} bonus per die`}
            className="field-focus-ring w-16 h-7 text-center rounded font-semibold"
            style={{
              backgroundColor: 'var(--color-background)',
              color: 'var(--color-text-primary)',
              border: '1px solid var(--color-border)',
            }}
          />
          <button
            onClick={() => handleBonusChange(entry.perDieBonus + 1)}
            className="w-7 h-7 rounded flex items-center justify-center text-sm font-bold transition-all"
            style={{
              backgroundColor: 'var(--color-background)',
              color: 'var(--color-text-primary)',
            }}
          >
            +
          </button>
        </div>
      </div>

      {/* Advanced options toggle */}
      <button
        onClick={() => setShowAdvanced(!showAdvanced)}
        className="text-xs font-medium text-left transition-all"
        style={{ color: 'var(--color-accent)' }}
      >
        {showAdvanced ? '▼' : '▶'} Advanced Options
      </button>

      {/* Advanced options panel */}
      {showAdvanced && (
        <div className="flex flex-col gap-2 p-2 rounded" style={{ backgroundColor: 'var(--color-background)' }}>
          <div className="text-xs" style={{ color: 'var(--color-text-secondary)' }}>
            Advanced mechanics coming soon:
          </div>
          <div className="text-xs opacity-50" style={{ color: 'var(--color-text-secondary)' }}>
            • Advantage/Disadvantage (keep highest/lowest)
            • Exploding dice (re-roll on max)
            • Re-roll (GWF, Halfling Luck)
            • Success counting (Shadowrun, WoD)
            • Min/Max constraints
          </div>
        </div>
      )}
    </div>
  )
}

function getSourceLabels(
  entry: DiceEntry,
  inventoryDiceById: Map<string, InventoryDie> | undefined,
) {
  return normalizeRollSources(entry).map((source, index) => {
    if (source.kind === 'anonymous') {
      return {
        key: `anonymous-${index}`,
        label: `${source.quantity} generic`,
        isMissing: false,
      }
    }

    const die = inventoryDiceById?.get(source.dieId)
    return {
      key: source.dieId,
      label: die ? die.name : 'Missing owned die',
      isMissing: !die,
    }
  })
}
