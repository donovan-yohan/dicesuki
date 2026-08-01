import { DiceIcon } from '../../icons/DiceIcon'
import type { DiceShape } from '../../../lib/geometries'

interface DicePoolProps {
  onDiceSelect?: (type: DiceShape, quantity?: number) => void
  /**
   * Add a percentile (d100) entry: each die is a `d10tens` + `d10` PAIR combined
   * into one 1–100 result. Separate from `onDiceSelect` because d100 is not a
   * `DiceShape` — see `src/lib/percentileRolls.ts`.
   */
  onPercentileSelect?: (quantity?: number) => void
}

/**
 * Dice palette - shows all available dice types
 */
export function DicePool({ onDiceSelect, onPercentileSelect }: DicePoolProps) {
  const diceTypes: DiceShape[] = ['d4', 'd6', 'd8', 'd10', 'd12', 'd20']
  const quickQuantities = [1, 4, 8]

  return (
    <div className="flex flex-col gap-3">
      <h3 className="text-sm font-semibold" style={{ color: 'var(--color-text-primary)' }}>
        Quick Dice
      </h3>
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 p-3 rounded-lg" style={{ backgroundColor: 'var(--color-surface)' }}>
        {diceTypes.map((type) => (
          <div
            key={type}
            className="flex flex-col items-center gap-2 p-2 rounded-lg"
            style={{
              backgroundColor: 'var(--color-background)',
              border: '2px solid var(--color-border)',
            }}
          >
            <DiceIcon type={type} size={48} />
            <span className="text-xs font-medium" style={{ color: 'var(--color-text-secondary)' }}>
              {type.toUpperCase()}
            </span>
            <div className="grid grid-cols-3 gap-1 w-full" aria-label={`${type.toUpperCase()} quantity shortcuts`}>
              {quickQuantities.map((quantity) => (
                <button
                  key={quantity}
                  type="button"
                  onClick={() => onDiceSelect?.(type, quantity)}
                  className="h-8 rounded text-xs font-bold transition-all hover:scale-105"
                  style={{
                    backgroundColor: quantity === 1 ? 'var(--color-accent)' : 'rgba(255, 255, 255, 0.08)',
                    color: quantity === 1 ? '#ffffff' : 'var(--color-text-primary)',
                    border: quantity === 1 ? 'none' : '1px solid var(--color-border)',
                  }}
                  aria-label={`Add ${quantity} ${type.toUpperCase()} ${quantity === 1 ? 'die' : 'dice'}`}
                >
                  +{quantity}
                </button>
              ))}
            </div>
          </div>
        ))}

        {/* Percentile (d100): one tens die + one ones d10, combined to 1-100. */}
        {onPercentileSelect && (
          <div
            key="d100"
            className="flex flex-col items-center gap-2 p-2 rounded-lg"
            style={{
              backgroundColor: 'var(--color-background)',
              border: '2px solid var(--color-border)',
            }}
          >
            <DiceIcon type="d10tens" size={48} />
            <span className="text-xs font-medium" style={{ color: 'var(--color-text-secondary)' }}>
              D100
            </span>
            <div className="grid grid-cols-3 gap-1 w-full" aria-label="D100 quantity shortcuts">
              {quickQuantities.map((quantity) => (
                <button
                  key={quantity}
                  type="button"
                  onClick={() => onPercentileSelect(quantity)}
                  className="h-8 rounded text-xs font-bold transition-all hover:scale-105"
                  style={{
                    backgroundColor: quantity === 1 ? 'var(--color-accent)' : 'rgba(255, 255, 255, 0.08)',
                    color: quantity === 1 ? '#ffffff' : 'var(--color-text-primary)',
                    border: quantity === 1 ? 'none' : '1px solid var(--color-border)',
                  }}
                  aria-label={`Add ${quantity} D100 ${quantity === 1 ? 'roll' : 'rolls'}`}
                >
                  +{quantity}
                </button>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
