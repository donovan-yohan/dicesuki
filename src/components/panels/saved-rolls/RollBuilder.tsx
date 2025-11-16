import { useState } from 'react'
import { nanoid } from 'nanoid'
import { DicePool } from './DicePool'
import { DiceEntryCard } from './DiceEntryCard'
import type { DiceEntry, SavedRoll } from '../../../types/savedRolls'
import type { DiceShape } from '../../../lib/geometries'

interface RollBuilderProps {
  initialRoll?: SavedRoll
  onSave: (roll: Omit<SavedRoll, 'id' | 'createdAt'>) => void
  onCancel: () => void
}

/**
 * Main roll builder component
 * Allows users to create custom dice rolls with bonuses
 */
export function RollBuilder({ initialRoll, onSave, onCancel }: RollBuilderProps) {
  const [name, setName] = useState(initialRoll?.name || '')
  const [description, setDescription] = useState(initialRoll?.description || '')
  const [dice, setDice] = useState<DiceEntry[]>(initialRoll?.dice || [])
  const [flatBonus, setFlatBonus] = useState(initialRoll?.flatBonus || 0)

  const handleAddDice = (type: DiceShape) => {
    const newEntry: DiceEntry = {
      id: nanoid(),
      type,
      quantity: 1,
      perDieBonus: 0,
    }
    setDice([...dice, newEntry])
  }

  const handleUpdateDice = (index: number, entry: DiceEntry) => {
    const newDice = [...dice]
    newDice[index] = entry
    setDice(newDice)
  }

  const handleRemoveDice = (index: number) => {
    setDice(dice.filter((_, i) => i !== index))
  }

  const handleSave = () => {
    if (!name.trim()) {
      alert('Please enter a name for this roll')
      return
    }

    if (dice.length === 0) {
      alert('Please add at least one die')
      return
    }

    onSave({
      name: name.trim(),
      description: description.trim() || undefined,
      dice,
      flatBonus,
      isFavorite: initialRoll?.isFavorite,
      tags: initialRoll?.tags,
      damageType: initialRoll?.damageType,
    })
  }

  // Calculate preview range
  const getPreviewRange = () => {
    if (dice.length === 0) return { min: 0, max: 0, avg: 0 }

    let min = flatBonus
    let max = flatBonus
    let avg = flatBonus

    dice.forEach((entry) => {
      const diceMin = entry.quantity * (1 + entry.perDieBonus)
      const diceMax = entry.quantity * (parseInt(entry.type.substring(1)) + entry.perDieBonus)
      const diceAvg = entry.quantity * ((parseInt(entry.type.substring(1)) + 1) / 2 + entry.perDieBonus)

      min += diceMin
      max += diceMax
      avg += diceAvg
    })

    return { min, max, avg: Math.round(avg * 10) / 10 }
  }

  const preview = getPreviewRange()

  return (
    <div className="flex flex-col gap-4 h-full overflow-y-auto pb-20">
      {/* Header */}
      <div className="flex flex-col gap-2">
        <input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Roll name (e.g., 'Greatsword Attack')"
          className="text-xl font-bold px-3 py-2 rounded"
          style={{
            backgroundColor: 'var(--color-surface)',
            color: 'var(--color-text-primary)',
            border: '2px solid var(--color-border)',
          }}
        />
        <input
          type="text"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="Description (optional)"
          className="text-sm px-3 py-2 rounded"
          style={{
            backgroundColor: 'var(--color-surface)',
            color: 'var(--color-text-secondary)',
            border: '1px solid var(--color-border)',
          }}
        />
      </div>

      {/* Dice Pool */}
      <DicePool onDiceSelect={handleAddDice} />

      {/* Added Dice */}
      {dice.length > 0 && (
        <div className="flex flex-col gap-2">
          <h3 className="text-sm font-semibold" style={{ color: 'var(--color-text-primary)' }}>
            Your Roll
          </h3>
          {dice.map((entry, index) => (
            <DiceEntryCard
              key={entry.id}
              entry={entry}
              onUpdate={(updated) => handleUpdateDice(index, updated)}
              onRemove={() => handleRemoveDice(index)}
            />
          ))}
        </div>
      )}

      {/* Flat Bonus */}
      <div
        className="flex flex-col gap-2 p-3 rounded-lg"
        style={{
          backgroundColor: 'var(--color-surface)',
          border: '2px solid var(--color-border)',
        }}
      >
        <label className="text-sm font-semibold" style={{ color: 'var(--color-text-primary)' }}>
          Flat Bonus
        </label>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setFlatBonus(flatBonus - 1)}
            className="w-9 h-9 rounded flex items-center justify-center font-bold text-lg transition-all"
            style={{
              backgroundColor: 'var(--color-background)',
              color: 'var(--color-text-primary)',
            }}
          >
            −
          </button>
          <input
            type="number"
            value={flatBonus}
            onChange={(e) => setFlatBonus(parseInt(e.target.value) || 0)}
            className="flex-1 h-9 text-center rounded font-semibold text-lg"
            style={{
              backgroundColor: 'var(--color-background)',
              color: 'var(--color-text-primary)',
              border: '1px solid var(--color-border)',
            }}
          />
          <button
            onClick={() => setFlatBonus(flatBonus + 1)}
            className="w-9 h-9 rounded flex items-center justify-center font-bold text-lg transition-all"
            style={{
              backgroundColor: 'var(--color-background)',
              color: 'var(--color-text-primary)',
            }}
          >
            +
          </button>
        </div>
      </div>

      {/* Preview */}
      {dice.length > 0 && (
        <div
          className="flex flex-col gap-2 p-4 rounded-lg"
          style={{
            backgroundColor: 'var(--color-accent)',
            color: 'white',
          }}
        >
          <div className="text-sm font-semibold opacity-90">Preview</div>
          <div className="text-2xl font-bold">
            {dice.map((entry, i) => (
              <span key={entry.id}>
                {i > 0 && ' + '}
                {entry.quantity}{entry.type}
                {entry.perDieBonus !== 0 && `(${entry.perDieBonus > 0 ? '+' : ''}${entry.perDieBonus})`}
              </span>
            ))}
            {flatBonus !== 0 && ` ${flatBonus > 0 ? '+' : ''}${flatBonus}`}
          </div>
          <div className="text-sm opacity-90">
            Range: {preview.min} - {preview.max} (avg: {preview.avg})
          </div>
        </div>
      )}

      {/* Action buttons */}
      <div className="fixed bottom-0 left-0 right-0 p-4 flex gap-2" style={{ backgroundColor: 'var(--color-background)' }}>
        <button
          onClick={onCancel}
          className="flex-1 py-3 px-4 rounded-lg font-semibold transition-all"
          style={{
            backgroundColor: 'var(--color-surface)',
            color: 'var(--color-text-primary)',
            border: '2px solid var(--color-border)',
          }}
        >
          Cancel
        </button>
        <button
          onClick={handleSave}
          disabled={!name.trim() || dice.length === 0}
          className="flex-1 py-3 px-4 rounded-lg font-semibold transition-all disabled:opacity-50"
          style={{
            backgroundColor: 'var(--color-accent)',
            color: 'white',
          }}
        >
          {initialRoll ? 'Update' : 'Save'} Roll
        </button>
      </div>
    </div>
  )
}
