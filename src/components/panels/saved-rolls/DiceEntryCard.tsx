import { type KeyboardEvent, useId, useState } from 'react'
import { DiceIconWithNumber } from '../../icons/DiceIconWithNumber'
import type { DiceEntry, KeepMode, QuickPreset, RollSource } from '../../../types/savedRolls'
import type { InventoryDie } from '../../../types/inventory'
import {
  KEEP_MODE_DEFAULT,
  applyQuickPreset,
  formatDiceEntry,
  getDiceEntryBadges,
  getEntryMax,
  hasKeepDrop,
} from '../../../lib/diceHelpers'
import { isPercentileEntry } from '../../../lib/percentileRolls'
import { MAX_EXPLOSION_WAVES, getExplodeFace } from '../../../lib/savedRollPlan'
import {
  getDiceEntrySourceQuantity,
  getRollSourceQuantity,
  normalizeRollSources,
  resizeRollSources,
} from '../../../lib/rollSources'

/** Widest count the quantity field accepts; the room cap is 30. */
const MAX_QUANTITY_DIGITS = 3

/** Presets in the order a D&D player reaches for them. */
const QUICK_PRESETS: ReadonlyArray<{ preset: QuickPreset; label: string }> = [
  { preset: 'advantage', label: 'Advantage' },
  { preset: 'disadvantage', label: 'Disadvantage' },
  { preset: 'elvenAccuracy', label: 'Elven Accuracy' },
  { preset: 'gwf', label: 'Great Weapon Fighting' },
  { preset: 'luck', label: 'Halfling Luck' },
]

/**
 * The presets that only move the rolled/kept counts.
 *
 * These are exactly the presets a percentile entry can honour: `gwf` and `luck`
 * set a REROLL, which `createSavedRollPlan` strips from a percentile entry
 * (you cannot reroll half a pair), so offering them there would be a button
 * that silently does nothing.
 */
const KEEP_DROP_PRESETS: ReadonlySet<QuickPreset> = new Set<QuickPreset>([
  'advantage',
  'disadvantage',
  'elvenAccuracy',
])

const SECTION_CLASS = 'flex flex-col gap-2 p-2 rounded min-w-0'
const SECTION_STYLE = {
  backgroundColor: 'var(--color-surface)',
  border: '1px solid var(--color-border)',
} as const
const CHECKBOX_LABEL_CLASS = 'flex items-center gap-2 text-sm font-semibold cursor-pointer'
const NUMBER_FIELD_CLASS = 'field-focus-ring w-16 h-8 px-2 text-center rounded font-semibold text-sm'
const FIELD_STYLE = {
  backgroundColor: 'var(--color-background)',
  color: 'var(--color-text-primary)',
  border: '1px solid var(--color-border)',
} as const
const HELPER_CLASS = 'text-[11px] leading-snug'
const HELPER_STYLE = { color: 'var(--color-text-muted)' } as const
const INLINE_LABEL_CLASS = 'text-xs'
const INLINE_LABEL_STYLE = { color: 'var(--color-text-secondary)' } as const

function clampToRange(value: number, min: number, max: number): number {
  const ceiling = Math.max(min, max)
  return Math.min(Math.max(Math.floor(value), min), ceiling)
}

/** How many GENERIC dice a source list holds; owned dice are counted by name. */
function countGenericDice(sources: readonly RollSource[]): number {
  return sources.reduce(
    (total, source) => total + (source.kind === 'anonymous' ? getRollSourceQuantity(source) : 0),
    0,
  )
}

/** "1 generic die" / "3 generic dice" — a count the notice can read out loud. */
function formatGenericLoss(count: number): string {
  return `${count} generic ${count === 1 ? 'die' : 'dice'}`
}

interface AdvancedNumberFieldProps {
  /**
   * The field's accessible name. These strings are addressed verbatim by
   * `e2e/roll-advanced.spec.ts`, so they are passed in whole rather than
   * assembled here.
   */
  label: string
  /** The committed value, shown whenever the field is not mid-edit. */
  value: number | undefined
  min: number
  max: number
  /** True when an empty field is meaningful ("no limit"), as for min/max. */
  allowEmpty?: boolean
  /**
   * Called once per commit with the typed integer (or `undefined` for a
   * cleared field). Clamping belongs to the caller, which owns the entry and
   * therefore the real bounds.
   */
  onCommit: (value: number | undefined) => void
}

/**
 * One advanced numeric field, with the draft-commit contract every numeric
 * control in this card shares.
 *
 * A committed-on-keystroke field rewrites itself while it is being typed into:
 * the first digit of "10" commits as 1, is clamped, and is written back to the
 * input, so the second digit lands on the clamped text instead ("3" + "0" =
 * 30 → clamped to the die maximum). The draft owns the displayed text until
 * the user says they are done — blur or Enter — and only that commit clamps.
 * Escape abandons the draft.
 */
function AdvancedNumberField({
  label,
  value,
  min,
  max,
  allowEmpty = false,
  onCommit,
}: AdvancedNumberFieldProps) {
  const [draft, setDraft] = useState<string | null>(null)

  /** Commit the draft, or revert to the committed value if it is unusable. */
  const commitDraft = () => {
    if (draft === null) return

    const trimmed = draft.trim()
    setDraft(null)

    if (trimmed === '') {
      if (allowEmpty) onCommit(undefined)
      return
    }

    const parsed = Number.parseInt(trimmed, 10)
    if (Number.isInteger(parsed)) onCommit(parsed)
  }

  const handleKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Enter') {
      event.preventDefault()
      commitDraft()
      return
    }

    // Escape is only ours while a draft is in flight, where it means "abandon
    // what I typed". The panel listens for Escape on `document` to close the
    // sheet, so swallowing it unconditionally would trap the user in the
    // builder; letting it bubble when there is no draft keeps sheet-close the
    // expected behaviour.
    if (event.key === 'Escape' && draft !== null) {
      event.preventDefault()
      event.stopPropagation()
      setDraft(null)
    }
  }

  return (
    <input
      type="number"
      min={min}
      max={max}
      value={draft ?? value ?? ''}
      onChange={(event) => setDraft(event.target.value)}
      onFocus={(event) => event.currentTarget.select()}
      onBlur={commitDraft}
      onKeyDown={handleKeyDown}
      aria-label={label}
      className={NUMBER_FIELD_CLASS}
      style={FIELD_STYLE}
    />
  )
}

interface DiceEntryCardProps {
  entry: DiceEntry
  onUpdate: (entry: DiceEntry) => void
  onRemove: () => void
  inventoryDiceById?: Map<string, InventoryDie>
  /**
   * Open the dice picker for this entry. The die preview and formula are the
   * affordance — "click into the entry to choose its dice" (PO (g)) — so the
   * card exposes the intent and the builder owns the dialog.
   */
  onOpenPicker?: () => void
  /** True when the roll as a whole exceeds the room dice capacity. */
  isOverCapacity?: boolean
  /** Id of the builder's capacity message, for aria-describedby. */
  capacityMessageId?: string
  /**
   * True when the roll mixes success-counting entries with summing ones, which
   * has no coherent total. The offending affordance is this checkbox on every
   * card — the mix is a whole-roll condition and any card can resolve it.
   */
  isSuccessModeMixed?: boolean
  /** Id of the builder's success-mode message, for aria-describedby. */
  successModeMessageId?: string
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
  onOpenPicker,
  isOverCapacity = false,
  capacityMessageId,
  isSuccessModeMixed = false,
  successModeMessageId,
}: DiceEntryCardProps) {
  const detailPrefix = useId()
  const badgesId = `${detailPrefix}-badges`
  const sourcesId = `${detailPrefix}-sources`
  const [showAdvanced, setShowAdvanced] = useState(false)
  // The draft owns the displayed text while the field is being typed into, and
  // is only committed on blur or Enter. Committing per keystroke would make
  // typing "12" pass through 1, and each pass-through would permanently drop
  // sources the user never asked to remove.
  const [quantityDraft, setQuantityDraft] = useState<string | null>(null)
  // What the last commit removed from the entry, already phrased for the notice:
  // owned dice by name, then the generic dice as a single tallied phrase.
  const [removedDiceLabels, setRemovedDiceLabels] = useState<string[]>([])

  // A percentile entry rolls a d10tens+d10 PAIR but reads as a single d100 —
  // every user-facing string (including assistive labels) uses that name.
  const isPercentile = isPercentileEntry(entry)
  const typeLabel = isPercentile ? 'D100' : entry.type.toUpperCase()
  // A percentile entry keeps only the presets it can actually honour, so no
  // button on this card is ever a no-op (see KEEP_DROP_PRESETS).
  const visiblePresets = isPercentile
    ? QUICK_PRESETS.filter(({ preset }) => KEEP_DROP_PRESETS.has(preset))
    : QUICK_PRESETS
  // Per-ENTRY ceiling: a d100 tops out at 100, not the 90 of its tens half.
  const dieMax = getEntryMax(entry)
  const sourceLabels = getSourceLabels(entry, inventoryDiceById)
  const badges = getDiceEntryBadges(entry)
  // Sources always total the ROLLED count, which is what the room spawns.
  const rolledCount = getDiceEntrySourceQuantity(entry)
  const keepDropOn = entry.rollCount !== undefined
  const keepMode: KeepMode = entry.keepMode ?? KEEP_MODE_DEFAULT
  // `entry.type`, not the entry ceiling: exploding is never available for a
  // percentile entry (the section is hidden and `createSavedRollPlan` strips
  // it), so the shape's own max is always the right trigger here.
  const explodeTrigger = entry.exploding ? getExplodeFace(entry.type, entry.exploding) : dieMax

  /**
   * Single write path for the entry, keeping its three counts in agreement.
   *
   * `quantity` is the KEEP count, `rollCount` the ROLLED count, and the source
   * list must always total the rolled count — that total is exactly how many
   * physical dice the room spawns. `next` states the intent (a `rollCount` of
   * `undefined` means "keep everything you roll"); this resolves the rolled
   * count from it, resizes the sources to match, and clamps the keep count so
   * an entry can never claim to keep more dice than it rolls.
   */
  const commitEntry = (next: DiceEntry) => {
    const rolled = Math.max(1, Math.floor(next.rollCount ?? next.quantity))
    const before = normalizeRollSources(entry)
    const { sources, droppedDieIds } = resizeRollSources(before, rolled)
    const keepsSome = next.rollCount !== undefined
    const keep = keepsSome ? clampToRange(next.quantity, 1, rolled) : rolled

    // `resizeRollSources` only reports the SPECIFIC owned dice it had to drop,
    // so the generic loss is measured here by comparing the two source lists.
    // Shedding four generic dice is no less of a surprise than shedding a named
    // one — applying Advantage to a 6-dice entry must not silently bin four.
    const genericLoss = countGenericDice(before) - countGenericDice(sources)

    setRemovedDiceLabels([
      ...droppedDieIds.map((dieId) => inventoryDiceById?.get(dieId)?.name ?? 'an owned die'),
      ...(genericLoss > 0 ? [formatGenericLoss(genericLoss)] : []),
    ])

    onUpdate({
      ...next,
      quantity: keep,
      rollCount: keepsSome ? rolled : undefined,
      keepMode: keepsSome ? next.keepMode ?? KEEP_MODE_DEFAULT : undefined,
      sources,
    })
  }

  // Per-entry floor is 1; the roll-wide ROOM_DICE_CAPACITY ceiling is validated
  // in RollBuilder, which is the only place that can see every entry's total.
  const commitQuantity = (nextRolledCount: number) => {
    const target = Math.max(1, Math.floor(nextRolledCount))

    // This field is the ROLLED count. Keep/drop is editable in Advanced
    // Options, so a manual count change preserves the keep policy rather than
    // discarding it; the keep count only moves when it would otherwise outrank
    // the new rolled count.
    commitEntry(hasKeepDrop(entry)
      ? { ...entry, rollCount: target, quantity: Math.min(entry.quantity, target) }
      : { ...entry, rollCount: undefined, quantity: target })
  }

  const handleQuantityChange = (delta: number) => {
    setQuantityDraft(null)
    commitQuantity(rolledCount + delta)
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
    // Clear any "Removed from this roll" notice: it described a previous count
    // change, and leaving it up next to an unrelated edit reads as if THIS edit
    // dropped dice.
    setRemovedDiceLabels([])
    onUpdate({ ...entry, perDieBonus: bonus })
  }

  /**
   * Presets speak in keep/roll terms, so they route through the same commit as
   * every other control: `advantage`/`elvenAccuracy` grow the rolled count and
   * the sources with it, while `gwf`/`luck` only set a reroll and must leave
   * the rolled count exactly where it was.
   */
  const handleQuickPreset = (preset: QuickPreset) => {
    commitEntry(applyQuickPreset(entry, preset))
  }

  const handleKeepDropToggle = (enabled: boolean) => {
    if (!enabled) {
      commitEntry({ ...entry, rollCount: undefined, keepMode: undefined, quantity: rolledCount })
      return
    }

    // Dropping one die is the useful default (it is what advantage does); the
    // rolled count stays put so enabling the policy never spawns extra dice.
    commitEntry({
      ...entry,
      rollCount: rolledCount,
      quantity: Math.max(1, rolledCount - 1),
      keepMode,
    })
  }

  const handleKeepModeChange = (mode: KeepMode) => {
    commitEntry({ ...entry, keepMode: mode })
  }

  const handleKeepCountCommit = (value: number | undefined) => {
    if (value === undefined) return
    commitEntry({ ...entry, quantity: clampToRange(value, 1, rolledCount) })
  }

  const handleExplodingToggle = (enabled: boolean) => {
    commitEntry({ ...entry, exploding: enabled ? { on: 'max' } : undefined })
  }

  const handleExplodingTriggerCommit = (raw: number | undefined) => {
    if (raw === undefined) return

    // Store the die's own maximum as `'max'` so the entry keeps meaning "on a
    // max face" if it is ever retyped as another die.
    const value = clampToRange(raw, 1, dieMax)
    commitEntry({
      ...entry,
      exploding: { ...entry.exploding, on: value === dieMax ? 'max' : value },
    })
  }

  const handleRerollToggle = (enabled: boolean) => {
    commitEntry({
      ...entry,
      reroll: enabled ? { condition: 'lessOrEqual', value: 1, maxRerolls: 1 } : undefined,
    })
  }

  const handleRerollValueCommit = (raw: number | undefined) => {
    if (raw === undefined) return

    const value = clampToRange(raw, 1, dieMax)
    // The field is an "at or below" threshold, so moving it commits that
    // comparison. An unchanged value is left alone so Halfling Luck's
    // equivalent `= 1` survives a no-op edit.
    const condition = entry.reroll && value === entry.reroll.value
      ? entry.reroll.condition
      : 'lessOrEqual'
    commitEntry({ ...entry, reroll: { condition, value, maxRerolls: 1 } })
  }

  // A cleared clamp means "no limit", so `undefined` is a legitimate commit
  // here rather than an unusable draft.
  const handleMinimumCommit = (raw: number | undefined) => {
    commitEntry({
      ...entry,
      minimum: raw === undefined ? undefined : clampToRange(raw, 1, entry.maximum ?? dieMax),
    })
  }

  const handleMaximumCommit = (raw: number | undefined) => {
    commitEntry({
      ...entry,
      maximum: raw === undefined ? undefined : clampToRange(raw, entry.minimum ?? 1, dieMax),
    })
  }

  const handleSuccessToggle = (enabled: boolean) => {
    commitEntry({
      ...entry,
      countSuccesses: enabled ? { targetNumber: Math.max(2, dieMax - 1) } : undefined,
    })
  }

  const handleSuccessTargetCommit = (raw: number | undefined) => {
    if (raw === undefined) return
    commitEntry({
      ...entry,
      countSuccesses: { ...entry.countSuccesses, targetNumber: clampToRange(raw, 1, dieMax) },
    })
  }

  // Display formula for this entry
  const getFormula = () => {
    return formatDiceEntry(entry)
  }

  /**
   * The entry's identity: which die, how many, what it does, and which of its
   * slots are pinned to owned dice. This whole block is the picker affordance
   * when the builder supplies one, so "click into the entry" reaches the same
   * dialog whether the player aims at the die, the formula or a source chip.
   */
  const entrySummary = (
    <>
      {/* A percentile entry is a d10tens+d10 PAIR — show the % die, not a plain d10. */}
      <DiceIconWithNumber
        type={isPercentile ? 'd10tens' : entry.type}
        number={rolledCount}
        size={40}
      />

      <div className="flex-1 min-w-0 text-left">
        <div className="text-lg font-bold" style={{ color: 'var(--color-text-primary)' }}>
          {getFormula()}
        </div>
        {/* Mechanics at a glance. The formula already spells out the notation;
            these read as plain labels for the mechanics it encodes. */}
        {badges.length > 0 && (
          <div id={badgesId} className="flex flex-wrap gap-1 mt-1">
            {badges.map((badge) => (
              <span
                key={badge}
                className="text-[11px] px-2 py-0.5 rounded-full font-semibold"
                style={{
                  backgroundColor: 'var(--color-background)',
                  color: 'var(--color-text-secondary)',
                  border: '1px solid var(--color-border)',
                }}
              >
                {badge}
              </span>
            ))}
          </div>
        )}
        {sourceLabels.length > 0 && (
          <div id={sourcesId} className="flex flex-wrap gap-1 mt-1">
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
        {/* Choosing owned dice used to be a standing grid in the builder. Now
            that it lives behind this card, the card has to SAY so — an
            affordance nobody can see is a feature nobody can reach. */}
        {onOpenPicker && (
          <span
            className="mt-1 inline-block text-[11px] font-semibold"
            style={{ color: 'var(--color-accent)' }}
          >
            Choose dice ›
          </span>
        )}
      </div>
    </>
  )

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
        {onOpenPicker ? (
          <button
            type="button"
            onClick={onOpenPicker}
            aria-haspopup="dialog"
            aria-label={`Choose dice for ${getFormula()}`}
            // The label NAMES the control; the mechanics badges and source
            // chips are its description. Without this they are inside the
            // button and an accessible name overrides its contents, so a
            // screen reader would announce "Choose dice for 4d20 kh1" and
            // silently drop "Advantage" and which owned dice are pinned.
            aria-describedby={
              [
                badges.length > 0 ? badgesId : null,
                sourceLabels.length > 0 ? sourcesId : null,
              ].filter(Boolean).join(' ') || undefined
            }
            data-testid="dice-entry-picker-trigger"
            className="field-focus-ring flex flex-1 items-center gap-3 min-w-0 rounded-lg p-1 -m-1 text-left transition-all"
          >
            {entrySummary}
          </button>
        ) : (
          <div className="flex flex-1 items-center gap-3 min-w-0">{entrySummary}</div>
        )}

        {/* Quantity controls */}
        <div className="flex items-center gap-1">
          <button
            onClick={() => handleQuantityChange(-1)}
            disabled={rolledCount <= 1}
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
            value={quantityDraft ?? String(rolledCount)}
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
            aria-label={`${typeLabel} quantity`}
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

      {/* Dice a shrink had to give up — owned ones by name, generic ones by
          count. Not an alert: the edit succeeded, but losing dice the user did
          not ask to lose is destructive enough to have to be spelled out. */}
      {removedDiceLabels.length > 0 && (
        <p
          role="status"
          className="text-xs px-2 py-1 rounded"
          style={{
            backgroundColor: 'rgba(249, 135, 151, 0.12)',
            color: 'var(--color-text-secondary)',
            border: '1px solid rgba(249, 135, 151, 0.25)',
          }}
        >
          Removed from this roll: {removedDiceLabels.join(', ')}
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
            aria-label={`${typeLabel} bonus per die`}
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
        aria-expanded={showAdvanced}
      >
        {showAdvanced ? '▼' : '▶'} Advanced Options
      </button>

      {/* Advanced options panel. One stacked column on a phone; two on desktop,
          where the card sits in the builder's wide compose column. */}
      {showAdvanced && (
        <div
          className="flex flex-col gap-3 p-2 rounded"
          style={{ backgroundColor: 'var(--color-background)' }}
        >
          {/* A d100 is a d10tens+d10 PAIR combined into one 1-100 result, so the
              mechanics that add or replace HALF a pair cannot apply to it: there
              is no such thing as exploding or rerolling a lone tens die. Keep/
              drop is different — it keeps and drops whole PAIRS, which the
              scoring plan already does — and clamps and success counting work on
              the combined value, so all three stay. */}
          {isPercentile && (
            <p
              data-testid="percentile-advanced-notice"
              className="text-xs px-2 py-1.5 rounded"
              style={{
                backgroundColor: 'rgba(249, 135, 151, 0.12)',
                color: 'var(--color-text-secondary)',
                border: '1px solid rgba(249, 135, 151, 0.25)',
              }}
            >
              A d100 rolls as a tens + ones pair, so exploding and reroll are not
              available for it — there is no way to explode or reroll half a pair.
              Keep/drop, min/max and success counting all apply to the combined
              1-100 result.
            </p>
          )}

          {/* Quick presets. A percentile entry only gets the keep/drop ones —
              the reroll-based presets would be stripped by the scoring plan. */}
          <div className="flex flex-col gap-1.5">
            <span
              className="text-[11px] font-semibold uppercase tracking-wide"
              style={{ color: 'var(--color-text-muted)' }}
            >
              Quick presets
            </span>
            <div className="flex flex-wrap gap-1.5">
              {visiblePresets.map(({ preset, label }) => (
                <button
                  key={preset}
                  type="button"
                  onClick={() => handleQuickPreset(preset)}
                  aria-label={`Apply ${label} to ${typeLabel}`}
                  className="h-8 px-3 rounded-full text-xs font-semibold whitespace-nowrap transition-all"
                  style={{
                    backgroundColor: 'var(--color-surface)',
                    color: 'var(--color-text-primary)',
                    border: '1px solid var(--color-border)',
                  }}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>

          <div className="grid grid-cols-1 gap-2 lg:grid-cols-2">
            {/* Keep / drop. Available for a percentile entry too: the plan keeps
                and drops whole tens+ones PAIRS. */}
            <div className={SECTION_CLASS} style={SECTION_STYLE}>
              <label className={CHECKBOX_LABEL_CLASS} style={{ color: 'var(--color-text-primary)' }}>
                <input
                  type="checkbox"
                  checked={keepDropOn}
                  onChange={(event) => handleKeepDropToggle(event.target.checked)}
                  aria-label={`Keep only some ${typeLabel} dice`}
                  className="w-4 h-4"
                  style={{ accentColor: 'var(--color-accent)' }}
                />
                Keep / drop
              </label>

              {keepDropOn ? (
                <>
                  <div className="flex flex-wrap items-center gap-2">
                    <span className={INLINE_LABEL_CLASS} style={INLINE_LABEL_STYLE}>
                      Keep the
                    </span>
                    <select
                      value={keepMode}
                      onChange={(event) => handleKeepModeChange(event.target.value as KeepMode)}
                      aria-label={`${typeLabel} keep mode`}
                      className="field-focus-ring h-8 px-2 rounded text-sm font-semibold"
                      style={FIELD_STYLE}
                    >
                      <option value="highest">best</option>
                      <option value="lowest">worst</option>
                    </select>
                    <AdvancedNumberField
                      label={`${typeLabel} dice to keep`}
                      value={entry.quantity}
                      min={1}
                      max={rolledCount}
                      onCommit={handleKeepCountCommit}
                    />
                  </div>
                  <p className={HELPER_CLASS} style={HELPER_STYLE}>
                    {`Roll ${rolledCount}, keep ${keepMode === 'lowest' ? 'worst' : 'best'} ${entry.quantity}`}
                  </p>
                </>
              ) : (
                <p className={HELPER_CLASS} style={HELPER_STYLE}>
                  Roll more dice than you score, then keep only the best or worst of them.
                </p>
              )}
            </div>

            {/* Exploding and reroll both replace or add HALF a percentile pair,
                which is not a result — hidden there, and stripped by
                `createSavedRollPlan` if a legacy entry carries them. */}
            {!isPercentile && (<>
            {/* Exploding */}
            <div className={SECTION_CLASS} style={SECTION_STYLE}>
              <label className={CHECKBOX_LABEL_CLASS} style={{ color: 'var(--color-text-primary)' }}>
                <input
                  type="checkbox"
                  checked={entry.exploding !== undefined}
                  onChange={(event) => handleExplodingToggle(event.target.checked)}
                  aria-label={`Exploding ${typeLabel} dice`}
                  className="w-4 h-4"
                  style={{ accentColor: 'var(--color-accent)' }}
                />
                Exploding
              </label>

              {entry.exploding && (
                <div className="flex flex-wrap items-center gap-2">
                  <span className={INLINE_LABEL_CLASS} style={INLINE_LABEL_STYLE}>
                    Explodes on
                  </span>
                  <AdvancedNumberField
                    label={`${typeLabel} explodes on`}
                    value={explodeTrigger}
                    min={1}
                    max={dieMax}
                    onCommit={handleExplodingTriggerCommit}
                  />
                  <span className={INLINE_LABEL_CLASS} style={INLINE_LABEL_STYLE}>
                    exactly
                  </span>
                </div>
              )}

              <p className={HELPER_CLASS} style={HELPER_STYLE}>
                {`Each die that hits the trigger spawns one more die — up to ${MAX_EXPLOSION_WAVES} extra waves, and only while the table has room.`}
              </p>
            </div>

            {/* Reroll */}
            <div className={SECTION_CLASS} style={SECTION_STYLE}>
              <label className={CHECKBOX_LABEL_CLASS} style={{ color: 'var(--color-text-primary)' }}>
                <input
                  type="checkbox"
                  checked={entry.reroll !== undefined}
                  onChange={(event) => handleRerollToggle(event.target.checked)}
                  aria-label={`Reroll low ${typeLabel} dice`}
                  className="w-4 h-4"
                  style={{ accentColor: 'var(--color-accent)' }}
                />
                Reroll low rolls
              </label>

              {entry.reroll && (
                <div className="flex flex-wrap items-center gap-2">
                  <span className={INLINE_LABEL_CLASS} style={INLINE_LABEL_STYLE}>
                    Reroll at or below
                  </span>
                  <AdvancedNumberField
                    label={`${typeLabel} reroll at or below`}
                    value={entry.reroll.value}
                    min={1}
                    max={dieMax}
                    onCommit={handleRerollValueCommit}
                  />
                </div>
              )}

              <p className={HELPER_CLASS} style={HELPER_STYLE}>
                Each qualifying die is rerolled once and the replacement stands, even if it lands lower.
              </p>
            </div>
            </>)}

            {/* Min / max clamps */}
            <div className={SECTION_CLASS} style={SECTION_STYLE}>
              <span className="text-sm font-semibold" style={{ color: 'var(--color-text-primary)' }}>
                Min / max
              </span>

              <div className="flex flex-wrap items-center gap-2">
                <span className={INLINE_LABEL_CLASS} style={INLINE_LABEL_STYLE}>
                  Min
                </span>
                <AdvancedNumberField
                  label={`${typeLabel} minimum value`}
                  value={entry.minimum}
                  min={1}
                  max={dieMax}
                  allowEmpty
                  onCommit={handleMinimumCommit}
                />
                <span className={INLINE_LABEL_CLASS} style={INLINE_LABEL_STYLE}>
                  Max
                </span>
                <AdvancedNumberField
                  label={`${typeLabel} maximum value`}
                  value={entry.maximum}
                  min={1}
                  max={dieMax}
                  allowEmpty
                  onCommit={handleMaximumCommit}
                />
              </div>

              <p className={HELPER_CLASS} style={HELPER_STYLE}>
                A face below the minimum counts as the minimum, and a face above the maximum counts
                as the maximum. Leave a field blank for no limit.
              </p>
            </div>

            {/* Success counting */}
            <div className={SECTION_CLASS} style={SECTION_STYLE}>
              <label className={CHECKBOX_LABEL_CLASS} style={{ color: 'var(--color-text-primary)' }}>
                <input
                  type="checkbox"
                  checked={entry.countSuccesses !== undefined}
                  onChange={(event) => handleSuccessToggle(event.target.checked)}
                  aria-label={`Count ${typeLabel} successes`}
                  aria-invalid={isSuccessModeMixed ? true : undefined}
                  aria-describedby={isSuccessModeMixed ? successModeMessageId : undefined}
                  className="w-4 h-4"
                  style={{ accentColor: 'var(--color-accent)' }}
                />
                Count successes
              </label>

              {entry.countSuccesses && (
                <div className="flex flex-wrap items-center gap-2">
                  <span className={INLINE_LABEL_CLASS} style={INLINE_LABEL_STYLE}>
                    Success on
                  </span>
                  <AdvancedNumberField
                    label={`${typeLabel} success on or above`}
                    value={entry.countSuccesses.targetNumber}
                    min={1}
                    max={dieMax}
                    onCommit={handleSuccessTargetCommit}
                  />
                  <span className={INLINE_LABEL_CLASS} style={INLINE_LABEL_STYLE}>
                    or above
                  </span>
                </div>
              )}

              <p className={HELPER_CLASS} style={HELPER_STYLE}>
                Results are counted, not summed: every kept die at or above the target scores one
                success, and the roll&apos;s flat bonus is ignored.
              </p>
            </div>
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
