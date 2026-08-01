import { useState } from 'react'
import { DiceIconWithNumber } from '../../icons/DiceIconWithNumber'
import type { DiceEntry } from '../../../types/savedRolls'
import type { InventoryDie } from '../../../types/inventory'
import { formatDiceEntry } from '../../../lib/diceHelpers'
import {
  getDiceEntrySourceQuantity,
  normalizeRollSources,
  withNormalizedRollSources,
} from '../../../lib/rollSources'

interface DiceEntryCardProps {
  entry: DiceEntry
  onUpdate: (entry: DiceEntry) => void
  onRemove: () => void
  inventoryDiceById?: Map<string, InventoryDie>
}

/**
 * Card showing a single dice entry in the roll builder
 * Allows editing quantity, bonuses, and advanced options
 */
export function DiceEntryCard({ entry, onUpdate, onRemove, inventoryDiceById }: DiceEntryCardProps) {
  const [showAdvanced, setShowAdvanced] = useState(false)
  // While the numeric field is being typed into it owns the displayed text, so
  // partial input ("" on its way to "12") is not clobbered by the clamp.
  const [quantityDraft, setQuantityDraft] = useState<string | null>(null)

  // Per-entry floor is 1; the roll-wide ROOM_DICE_CAPACITY ceiling is validated
  // in RollBuilder, which is the only place that can see every entry's total.
  const commitQuantity = (nextQuantity: number) => {
    onUpdate(withNormalizedRollSources({
      ...entry,
      quantity: Math.max(1, Math.floor(nextQuantity)),
    }))
  }

  const handleQuantityChange = (delta: number) => {
    setQuantityDraft(null)
    commitQuantity(getDiceEntrySourceQuantity(entry) + delta)
  }

  const handleQuantityInput = (rawValue: string) => {
    const digits = rawValue.replace(/[^0-9]/g, '')
    setQuantityDraft(digits)

    const parsed = Number.parseInt(digits, 10)
    if (Number.isInteger(parsed) && parsed >= 1) {
      commitQuantity(parsed)
    }
  }

  const handleQuantityBlur = () => {
    if (quantityDraft !== null) {
      const parsed = Number.parseInt(quantityDraft, 10)
      if (!Number.isInteger(parsed) || parsed < 1) {
        commitQuantity(1)
      }
    }
    setQuantityDraft(null)
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
            value={quantityDraft ?? String(quantity)}
            onChange={(event) => handleQuantityInput(event.target.value)}
            onFocus={(event) => event.currentTarget.select()}
            onBlur={handleQuantityBlur}
            className="field-focus-ring w-12 h-8 text-center rounded font-semibold"
            style={{
              backgroundColor: 'var(--color-background)',
              color: 'var(--color-text-primary)',
              border: '1px solid var(--color-border)',
            }}
            aria-label={`${entry.type.toUpperCase()} quantity`}
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
