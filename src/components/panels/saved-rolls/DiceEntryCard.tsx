import { useState } from 'react'
import { DiceIconWithNumber } from '../../icons/DiceIconWithNumber'
import type { DiceEntry } from '../../../types/savedRolls'

interface DiceEntryCardProps {
  entry: DiceEntry
  onUpdate: (entry: DiceEntry) => void
  onRemove: () => void
}

/**
 * Card showing a single dice entry in the roll builder
 * Allows editing quantity, bonuses, and advanced options
 */
export function DiceEntryCard({ entry, onUpdate, onRemove }: DiceEntryCardProps) {
  const [showAdvanced, setShowAdvanced] = useState(false)

  const handleQuantityChange = (delta: number) => {
    const newQuantity = Math.max(1, entry.quantity + delta)
    onUpdate({ ...entry, quantity: newQuantity })
  }

  const handleBonusChange = (bonus: number) => {
    onUpdate({ ...entry, perDieBonus: bonus })
  }

  // Display formula for this entry
  const getFormula = () => {
    const dieMax = entry.type.replace('d', '')
    if (entry.perDieBonus !== 0) {
      const sign = entry.perDieBonus > 0 ? '+' : ''
      return `${entry.quantity}d(${dieMax}${sign}${entry.perDieBonus})`
    }
    return `${entry.quantity}${entry.type}`
  }

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
        <DiceIconWithNumber type={entry.type} number={entry.quantity} size={40} />

        <div className="flex-1">
          <div className="text-lg font-bold" style={{ color: 'var(--color-text-primary)' }}>
            {getFormula()}
          </div>
        </div>

        {/* Quantity controls */}
        <div className="flex items-center gap-1">
          <button
            onClick={() => handleQuantityChange(-1)}
            disabled={entry.quantity <= 1}
            className="w-8 h-8 rounded flex items-center justify-center font-bold transition-all disabled:opacity-30"
            style={{
              backgroundColor: 'var(--color-background)',
              color: 'var(--color-text-primary)',
            }}
          >
            −
          </button>
          <span className="w-8 text-center font-semibold" style={{ color: 'var(--color-text-primary)' }}>
            {entry.quantity}
          </span>
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
            className="w-16 h-7 text-center rounded font-semibold"
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
