import { useId, useMemo, useState } from 'react'
import { nanoid } from 'nanoid'
import { DicePool } from './DicePool'
import { DiceEntryCard } from './DiceEntryCard'
import { RollDicePicker } from './RollDicePicker'
import { useInventoryStore } from '../../../store/useInventoryStore'
import {
  calculateSavedRollRange,
  formatDiceEntry,
  formatSavedRoll,
  isSuccessCountingRoll,
} from '../../../lib/diceHelpers'
import { ROLL_DICE_CAPACITY_MESSAGE, ROOM_DICE_CAPACITY } from '../../../config/roomCapacity'
import { PERCENTILE_ONES_SHAPE } from '../../../lib/percentileRolls'
import {
  createAnonymousRollSource,
  createSpecificDieRollSource,
  getRollDiceCount,
  getSpecificDieIds,
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
  const [nameTouched, setNameTouched] = useState(false)
  // Which entry the dice picker is open for, by entry id. Held here rather than
  // inside the card so the dialog is a sibling of the whole builder — a card
  // deep in the scrolling list is a poor host for a full-screen overlay.
  const [pickerEntryId, setPickerEntryId] = useState<string | null>(null)
  const ownedDice = useInventoryStore((state) => state.dice)

  const fieldPrefix = useId()
  const nameFieldId = `${fieldPrefix}-name`
  const nameErrorId = `${fieldPrefix}-name-error`
  const descriptionFieldId = `${fieldPrefix}-description`
  const capacityMessageId = `${fieldPrefix}-capacity`
  const successModeMessageId = `${fieldPrefix}-success-mode`

  const inventoryDiceById = useMemo(() => {
    const map = new Map<string, InventoryDie>()
    for (const die of ownedDice) {
      map.set(die.id, die)
    }
    return map
  }, [ownedDice])

  const handleAddDice = (type: DiceShape, quantity = 1) => {
    const newEntry: DiceEntry = withRollSources({
      id: nanoid(),
      type,
      quantity,
      perDieBonus: 0,
    }, [createAnonymousRollSource(quantity)])
    setDice([...dice, newEntry])
  }

  // Percentile (d100): each die is a d10tens + d10 PAIR combined to 1-100. The
  // entry keeps `type: 'd10'` (the ones half) and carries the additive
  // `percentile` flag — see src/lib/percentileRolls.ts.
  const handleAddPercentile = (quantity = 1) => {
    const newEntry: DiceEntry = withRollSources({
      id: nanoid(),
      type: PERCENTILE_ONES_SHAPE,
      quantity,
      perDieBonus: 0,
      percentile: true,
    }, [createAnonymousRollSource(quantity)])
    setDice([...dice, newEntry])
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
    setPickerEntryId((openId) => (openId === dice[index]?.id ? null : openId))
  }

  const pickerEntryIndex = pickerEntryId === null
    ? -1
    : dice.findIndex((entry) => entry.id === pickerEntryId)
  const pickerEntry = pickerEntryIndex === -1 ? null : dice[pickerEntryIndex]

  // One inventory die is one physical die, so the picker must know which dice
  // the roll's OTHER entries have already claimed.
  const pinnedElsewhere = useMemo(() => {
    if (!pickerEntry) return new Set<string>()
    return new Set(
      dice
        .filter((entry) => entry.id !== pickerEntry.id)
        .flatMap(getSpecificDieIds),
    )
  }, [dice, pickerEntry])

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

  // Validation. The roll-wide dice total is what the room actually spawns, so it
  // is the value bounded by ROOM_DICE_CAPACITY (per-entry counts are unbounded).
  const totalDiceCount = getRollDiceCount(dice)
  const isOverCapacity = totalDiceCount > ROOM_DICE_CAPACITY
  const isNameMissing = name.trim().length === 0
  const isDiceMissing = dice.length === 0
  // Stay quiet on a pristine form, then surface what is still required as soon
  // as the user engages with any part of the builder.
  const showRequirements = nameTouched || name.length > 0 || dice.length > 0
  const nameError = showRequirements && isNameMissing ? 'Roll name is required' : null
  const diceError = showRequirements && isDiceMissing ? 'Add at least one die to this roll' : null
  const capacityError = isOverCapacity
    ? `${ROLL_DICE_CAPACITY_MESSAGE}. This roll uses ${totalDiceCount}.`
    : null
  // Success counting is a property of the whole roll (`isSuccessCountingRoll`),
  // not of one entry: as soon as any entry counts successes the total becomes a
  // count of successes, and the summing entries plus the flat bonus are
  // discarded. Rather than let that happen silently, a mixed roll is invalid.
  const isSuccessModeMixed = isSuccessCountingRoll(previewRoll)
    && dice.some((entry) => entry.countSuccesses === undefined)
  const successModeError = isSuccessModeMixed
    ? 'This roll mixes counting successes with adding dice up, so it has no single '
      + 'total. Count successes on every entry, or on none of them.'
    : null
  const canSave = !isNameMissing && !isDiceMissing && !isOverCapacity && !isSuccessModeMixed

  const handleSave = () => {
    setNameTouched(true)
    if (!canSave) return

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

  return (
    <div className="flex flex-col gap-4 h-full overflow-y-auto pb-20 lg:pb-4">
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_22rem] lg:items-start lg:gap-6">
        {/* Left column: identity, dice sources, and the roll's entries */}
        <div className="flex flex-col gap-4 min-w-0" data-testid="roll-builder-compose-column">
          {/* Roll identity fields */}
          <div className="flex flex-col gap-3">
            <div className="flex flex-col gap-1">
              <label
                htmlFor={nameFieldId}
                className="text-xs font-semibold uppercase tracking-wide"
                style={{ color: 'var(--color-text-secondary)' }}
              >
                Roll name
              </label>
              <input
                id={nameFieldId}
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                onBlur={() => setNameTouched(true)}
                placeholder="e.g. Greatsword Attack"
                aria-invalid={nameError ? true : undefined}
                aria-describedby={nameError ? nameErrorId : undefined}
                className="field-focus-ring w-full px-3 py-2 rounded-lg text-base font-semibold placeholder:font-normal placeholder:text-[color:var(--color-text-muted)]"
                style={{
                  backgroundColor: 'var(--color-surface)',
                  color: 'var(--color-text-primary)',
                  border: `1px solid ${nameError ? 'var(--color-error)' : 'var(--color-border)'}`,
                }}
              />
              {nameError && (
                <p id={nameErrorId} className="text-xs" style={{ color: 'var(--color-error)' }}>
                  {nameError}
                </p>
              )}
            </div>

            <div className="flex flex-col gap-1">
              <label
                htmlFor={descriptionFieldId}
                className="text-xs font-semibold uppercase tracking-wide"
                style={{ color: 'var(--color-text-secondary)' }}
              >
                Description
              </label>
              <textarea
                id={descriptionFieldId}
                rows={2}
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="What this roll is for (optional)"
                className="field-focus-ring w-full px-3 py-2 rounded-lg text-sm resize-y placeholder:text-[color:var(--color-text-muted)]"
                style={{
                  backgroundColor: 'var(--color-surface)',
                  color: 'var(--color-text-primary)',
                  border: '1px solid var(--color-border)',
                }}
              />
            </div>
          </div>

          {/* Dice Pool */}
          <DicePool onDiceSelect={handleAddDice} onPercentileSelect={handleAddPercentile} />

          {/* Added Dice. Which physical dice fill an entry is decided in the
              per-entry picker, not from a standing grid of owned dice — the
              builder assembles the roll, the picker casts it (PO (g)). */}
          <div className="flex flex-col gap-2">
            <div className="flex items-center justify-between gap-2">
              <h3 className="text-sm font-semibold" style={{ color: 'var(--color-text-primary)' }}>
                Your Roll
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

            {/* Announced once, when the roll crosses the cap. The changing
                count is deliberately kept out of the live region so typing a
                quantity does not interrupt a screen reader on every keystroke. */}
            <p className="sr-only" aria-live="polite">
              {isOverCapacity ? ROLL_DICE_CAPACITY_MESSAGE : ''}
            </p>

            {capacityError && (
              <p
                id={capacityMessageId}
                data-testid="roll-capacity-error"
                className="text-sm px-3 py-2 rounded-lg"
                style={{
                  backgroundColor: 'rgba(239, 68, 68, 0.14)',
                  border: '1px solid rgba(239, 68, 68, 0.4)',
                  color: '#fecaca',
                }}
              >
                {capacityError}
              </p>
            )}

            {successModeError && (
              <p
                id={successModeMessageId}
                data-testid="roll-success-mode-error"
                className="text-sm px-3 py-2 rounded-lg"
                style={{
                  backgroundColor: 'rgba(239, 68, 68, 0.14)',
                  border: '1px solid rgba(239, 68, 68, 0.4)',
                  color: '#fecaca',
                }}
              >
                {successModeError}
              </p>
            )}

            {dice.length > 0 ? (
              dice.map((entry, index) => (
                <DiceEntryCard
                  key={entry.id}
                  entry={entry}
                  onUpdate={(updated) => handleUpdateDice(index, updated)}
                  onRemove={() => handleRemoveDice(index)}
                  inventoryDiceById={inventoryDiceById}
                  onOpenPicker={() => setPickerEntryId(entry.id)}
                  isOverCapacity={isOverCapacity}
                  capacityMessageId={isOverCapacity ? capacityMessageId : undefined}
                  isSuccessModeMixed={isSuccessModeMixed}
                  successModeMessageId={isSuccessModeMixed ? successModeMessageId : undefined}
                />
              ))
            ) : (
              <p
                className="text-sm"
                style={{ color: diceError ? 'var(--color-error)' : 'var(--color-text-muted)' }}
              >
                {diceError ?? 'Pick dice above to start building this roll.'}
              </p>
            )}
          </div>
        </div>

        {/* Right column: totals and actions. Sticky on desktop so the preview
            and Save stay in view while the entry list scrolls. */}
        <div
          className="flex flex-col gap-4 min-w-0 lg:sticky lg:top-0"
          data-testid="roll-builder-summary-column"
        >
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
                aria-label="Decrease flat bonus"
              >
                −
              </button>
              <input
                type="number"
                value={flatBonus}
                onChange={(e) => setFlatBonus(parseInt(e.target.value) || 0)}
                aria-label="Flat bonus"
                className="field-focus-ring flex-1 min-w-0 h-9 text-center rounded font-semibold text-lg"
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
                aria-label="Increase flat bonus"
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
                color: 'var(--color-on-accent)',
              }}
            >
              <div className="text-sm font-semibold opacity-90">Preview</div>
              <div className="text-2xl font-bold break-words">
                {formula}
              </div>
              {/* Exploding leaves the top of the range open, so it is shown as
                  `max+` rather than a bound the roll can never exceed. */}
              <div className="text-sm opacity-90">
                {`Range: ${preview.min} - ${preview.max}${preview.open ? '+' : ''}`}
              </div>
              <div className="text-xs opacity-90">
                {totalDiceCount} of {ROOM_DICE_CAPACITY} dice
              </div>
            </div>
          )}

          {/* Action buttons — a fixed bar on mobile, in the sticky column at lg */}
          <div
            className="fixed bottom-0 left-0 right-0 p-4 flex gap-2 lg:static lg:p-0"
            style={{ backgroundColor: 'var(--color-background)' }}
          >
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
              disabled={!canSave}
              aria-describedby={
                [
                  isOverCapacity ? capacityMessageId : null,
                  isSuccessModeMixed ? successModeMessageId : null,
                ].filter(Boolean).join(' ') || undefined
              }
              className="flex-1 py-3 px-4 rounded-lg font-semibold transition-all disabled:opacity-50"
              style={{
                backgroundColor: 'var(--color-accent)',
                color: 'var(--color-on-accent)',
              }}
            >
              {initialRoll ? 'Update' : 'Save'} Roll
            </button>
          </div>
        </div>
      </div>

      {pickerEntry && (
        <RollDicePicker
          entry={pickerEntry}
          entryLabel={formatDiceEntry(pickerEntry)}
          ownedDice={ownedDice}
          pinnedElsewhere={pinnedElsewhere}
          onChange={(updated) => handleUpdateDice(pickerEntryIndex, updated)}
          onClose={() => setPickerEntryId(null)}
        />
      )}
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
