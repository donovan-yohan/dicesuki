import { type DragEvent, useMemo, useState } from 'react'
import { nanoid } from 'nanoid'
import { DicePool } from './DicePool'
import { DiceEntryCard } from './DiceEntryCard'
import { useInventoryStore } from '../../../store/useInventoryStore'
import { calculateSavedRollRange, formatSavedRoll } from '../../../lib/diceHelpers'
import { parseInventoryDieDragPayload } from '../../../lib/inventoryDrag'
import {
  createAnonymousRollSource,
  createSpecificDieRollSource,
  withNormalizedRollSources,
  withRollSources,
} from '../../../lib/rollSources'
import type { DiceEntry, SavedRoll } from '../../../types/savedRolls'
import type { InventoryDie } from '../../../types/inventory'
import type { DiceShape } from '../../../lib/geometries'
import type { TableDieSummary } from '../../../types/tableDice'

interface RollBuilderProps {
  initialRoll?: SavedRoll
  tableDice?: TableDieSummary[]
  onSave: (roll: Omit<SavedRoll, 'id' | 'createdAt'>) => void
  onCancel: () => void
}

/**
 * Main roll builder component
 * Allows users to create custom dice rolls with bonuses
 */
export function RollBuilder({ initialRoll, tableDice = [], onSave, onCancel }: RollBuilderProps) {
  const [name, setName] = useState(initialRoll?.name || '')
  const [description, setDescription] = useState(initialRoll?.description || '')
  const [dice, setDice] = useState<DiceEntry[]>(initialRoll?.dice || [])
  const [flatBonus, setFlatBonus] = useState(initialRoll?.flatBonus || 0)
  const [ownedDiceFilter, setOwnedDiceFilter] = useState<DiceShape | 'all'>('all')
  const [isDropActive, setIsDropActive] = useState(false)
  const ownedDice = useInventoryStore((state) => state.dice)

  const inventoryDiceById = useMemo(() => {
    const map = new Map<string, InventoryDie>()
    for (const die of ownedDice) {
      map.set(die.id, die)
    }
    return map
  }, [ownedDice])

  const visibleOwnedDice = useMemo(() => {
    return [...ownedDice]
      .filter((die) => ownedDiceFilter === 'all' || die.type === ownedDiceFilter)
      .sort((a, b) => {
        if (a.isFavorite !== b.isFavorite) return a.isFavorite ? -1 : 1
        return (b.lastRolledAt ?? b.acquiredAt) - (a.lastRolledAt ?? a.acquiredAt)
      })
      .slice(0, 12)
  }, [ownedDice, ownedDiceFilter])

  const handleAddDice = (type: DiceShape, quantity = 1) => {
    const newEntry: DiceEntry = withRollSources({
      id: nanoid(),
      type,
      quantity,
      perDieBonus: 0,
    }, [createAnonymousRollSource(quantity)])
    setDice([...dice, newEntry])
  }

  const handleAddSpecificDie = (die: InventoryDie) => {
    const newEntry: DiceEntry = withRollSources({
      id: nanoid(),
      type: die.type,
      quantity: 1,
      perDieBonus: 0,
    }, [createSpecificDieRollSource(die.id)])
    setDice([...dice, newEntry])
  }

  const handleAddSpecificDieById = (dieId: string) => {
    const die = inventoryDiceById.get(dieId)
    if (die) {
      handleAddSpecificDie(die)
    }
  }

  const handleAddTableDice = () => {
    const tableEntries = createEntriesFromTableDice(tableDice, inventoryDiceById)
    if (tableEntries.length === 0) return
    setDice([...dice, ...tableEntries])
  }

  const handleUpdateDice = (index: number, entry: DiceEntry) => {
    const newDice = [...dice]
    newDice[index] = withNormalizedRollSources(entry)
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

  const handleDrop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault()
    setIsDropActive(false)

    const payload = parseInventoryDieDragPayload(event.dataTransfer)
    if (!payload) return

    handleAddSpecificDieById(payload.inventoryDieId)
  }

  const previewRoll: SavedRoll = {
    id: initialRoll?.id ?? 'preview',
    name: name.trim() || 'Unsaved roll',
    description: description.trim() || undefined,
    dice,
    flatBonus,
    createdAt: initialRoll?.createdAt ?? Date.now(),
    isFavorite: initialRoll?.isFavorite,
    tags: initialRoll?.tags,
    damageType: initialRoll?.damageType,
  }

  const preview = calculateSavedRollRange(previewRoll)
  const formula = formatSavedRoll(previewRoll)
  const diceTypes: Array<DiceShape | 'all'> = ['all', 'd4', 'd6', 'd8', 'd10', 'd12', 'd20']

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

      {/* Owned Dice */}
      <div
        className="flex flex-col gap-3 p-3 rounded-lg"
        style={{
          backgroundColor: 'var(--color-surface)',
          border: isDropActive ? '2px solid var(--color-accent)' : '2px solid var(--color-border)',
        }}
        onDragOver={(event) => {
          event.preventDefault()
          setIsDropActive(true)
        }}
        onDragLeave={() => setIsDropActive(false)}
        onDrop={handleDrop}
        data-testid="roll-builder-owned-drop-zone"
      >
        <div className="flex items-center justify-between gap-2">
          <h3 className="text-sm font-semibold" style={{ color: 'var(--color-text-primary)' }}>
            Owned Dice
          </h3>
          {tableDice.length > 0 && (
            <button
              type="button"
              onClick={handleAddTableDice}
              className="h-8 px-3 rounded text-xs font-semibold"
              style={{
                backgroundColor: 'rgba(249, 135, 151, 0.16)',
                color: 'var(--color-accent)',
                border: '1px solid rgba(249, 135, 151, 0.28)',
              }}
            >
              Add Table ({tableDice.length})
            </button>
          )}
        </div>

        <div className="flex gap-1 overflow-x-auto pb-1" aria-label="Owned dice type filters">
          {diceTypes.map((type) => (
            <button
              key={type}
              type="button"
              onClick={() => setOwnedDiceFilter(type)}
              className="h-8 px-3 rounded-full text-xs font-semibold whitespace-nowrap"
              style={{
                backgroundColor: ownedDiceFilter === type
                  ? 'var(--color-accent)'
                  : 'rgba(255, 255, 255, 0.08)',
                color: ownedDiceFilter === type ? '#ffffff' : 'var(--color-text-secondary)',
                border: ownedDiceFilter === type ? 'none' : '1px solid var(--color-border)',
              }}
              aria-pressed={ownedDiceFilter === type}
            >
              {type === 'all' ? 'All' : type.toUpperCase()}
            </button>
          ))}
        </div>

        {visibleOwnedDice.length > 0 ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            {visibleOwnedDice.map((die) => (
              <button
                key={die.id}
                type="button"
                onClick={() => handleAddSpecificDie(die)}
                className="min-h-14 rounded p-2 text-left transition-all hover:scale-[1.01]"
                style={{
                  backgroundColor: 'var(--color-background)',
                  color: 'var(--color-text-primary)',
                  border: '1px solid var(--color-border)',
                }}
                aria-label={`Add ${die.name} to roll`}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="font-semibold text-sm truncate">{die.name}</span>
                  <span
                    className="text-[11px] px-2 py-0.5 rounded-full uppercase"
                    style={{
                      backgroundColor: 'rgba(249, 135, 151, 0.16)',
                      color: 'var(--color-accent)',
                    }}
                  >
                    {die.type}
                  </span>
                </div>
                <div className="mt-1 text-xs capitalize truncate" style={{ color: 'var(--color-text-muted)' }}>
                  {die.rarity} · {die.setId}
                </div>
              </button>
            ))}
          </div>
        ) : (
          <div className="text-sm" style={{ color: 'var(--color-text-muted)' }}>
            No owned dice match this filter.
          </div>
        )}
      </div>

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
              inventoryDiceById={inventoryDiceById}
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
            {formula}
          </div>
          <div className="text-sm opacity-90">
            Range: {preview.min} - {preview.max}
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

function createEntriesFromTableDice(
  tableDice: TableDieSummary[],
  inventoryDiceById: Map<string, InventoryDie>,
): DiceEntry[] {
  const genericCounts = new Map<DiceShape, number>()
  const specificEntries: DiceEntry[] = []

  for (const die of tableDice) {
    if (die.inventoryDieId && inventoryDiceById.has(die.inventoryDieId)) {
      specificEntries.push(withRollSources({
        id: nanoid(),
        type: die.type,
        quantity: 1,
        perDieBonus: 0,
      }, [createSpecificDieRollSource(die.inventoryDieId)]))
      continue
    }

    genericCounts.set(die.type, (genericCounts.get(die.type) ?? 0) + 1)
  }

  const genericEntries = Array.from(genericCounts.entries()).map(([type, quantity]) =>
    withRollSources({
      id: nanoid(),
      type,
      quantity,
      perDieBonus: 0,
    }, [createAnonymousRollSource(quantity)])
  )

  return [...genericEntries, ...specificEntries]
}
