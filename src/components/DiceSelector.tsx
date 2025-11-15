import { DiceShape } from '../lib/geometries'

interface DiceSelectorProps {
  selectedShape: DiceShape
  onShapeChange: (shape: DiceShape) => void
}

/**
 * Dice Shape Selector Component
 *
 * Allows user to select which type of dice to roll
 * Shows all available dice types with visual representation
 */
export function DiceSelector({ selectedShape, onShapeChange }: DiceSelectorProps) {
  const diceTypes: { shape: DiceShape; label: string; emoji: string }[] = [
    { shape: 'd4', label: 'D4', emoji: '▲' },
    { shape: 'd6', label: 'D6', emoji: '⬛' },
    { shape: 'd8', label: 'D8', emoji: '◆' },
    { shape: 'd12', label: 'D12', emoji: '⬢' },
    { shape: 'd20', label: 'D20', emoji: '◉' },
  ]

  return (
    <div className="fixed top-4 left-1/2 transform -translate-x-1/2 z-20 bg-black bg-opacity-75 rounded-lg p-2 flex gap-2">
      {diceTypes.map(({ shape, label, emoji }) => (
        <button
          key={shape}
          onClick={() => onShapeChange(shape)}
          className={`px-3 py-2 rounded transition-all ${
            selectedShape === shape
              ? 'bg-orange-600 text-white scale-110'
              : 'bg-gray-700 text-gray-300 hover:bg-gray-600'
          }`}
        >
          <div className="text-2xl">{emoji}</div>
          <div className="text-xs font-bold">{label}</div>
        </button>
      ))}
    </div>
  )
}
