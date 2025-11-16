import { DiceIcon } from '../../icons/DiceIcon'
import type { DiceShape } from '../../../lib/geometries'

interface DicePoolProps {
  onDiceSelect?: (type: DiceShape) => void
}

/**
 * Dice palette - shows all available dice types
 */
export function DicePool({ onDiceSelect }: DicePoolProps) {
  const diceTypes: DiceShape[] = ['d4', 'd6', 'd8', 'd10', 'd12', 'd20']

  return (
    <div className="flex flex-col gap-3">
      <h3 className="text-sm font-semibold" style={{ color: 'var(--color-text-primary)' }}>
        Dice Palette
      </h3>
      <div className="grid grid-cols-4 gap-2 p-3 rounded-lg" style={{ backgroundColor: 'var(--color-surface)' }}>
        {diceTypes.map((type) => (
          <button
            key={type}
            onClick={() => onDiceSelect?.(type)}
            className="flex flex-col items-center gap-1 p-2 rounded-lg transition-all hover:scale-105"
            style={{
              backgroundColor: 'var(--color-background)',
              border: '2px solid var(--color-border)',
            }}
          >
            <DiceIcon type={type} size={48} />
            <span className="text-xs font-medium" style={{ color: 'var(--color-text-secondary)' }}>
              {type.toUpperCase()}
            </span>
          </button>
        ))}
      </div>
    </div>
  )
}
