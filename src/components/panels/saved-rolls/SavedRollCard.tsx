import { SavedRoll } from '../../../types/savedRolls'
import { formatSavedRoll, calculateSavedRollRange, getDiceEntryBadges } from '../../../lib/diceHelpers'

interface Props {
  roll: SavedRoll
  onRoll: (roll: SavedRoll) => void
  onEdit: (roll: SavedRoll) => void
  onDelete: (roll: SavedRoll) => void
  onToggleFavorite: (roll: SavedRoll) => void
  onDuplicate?: (roll: SavedRoll) => void
  onMove?: (roll: SavedRoll) => void
  describedBy?: string
  disabled?: boolean
}
const secondary = 'field-focus-ring min-h-11 min-w-11 rounded-lg px-2 py-2 text-sm bg-theme-bg text-theme-text'
export function SavedRollCard({ roll, onRoll, onEdit, onDelete, onToggleFavorite, onDuplicate, onMove, describedBy, disabled = false }: Props) {
  const formula = formatSavedRoll(roll)
  const range = calculateSavedRollRange(roll)
  const badges = roll.dice.flatMap(getDiceEntryBadges)
  return <article data-roll-id={roll.id} className="min-w-0 rounded-xl border border-theme-border bg-theme-surface p-2 space-y-2 [overflow-wrap:anywhere]">
    <button type="button" onClick={() => onRoll(roll)} disabled={disabled} aria-describedby={describedBy} aria-label={`Roll ${roll.name}`} className="field-focus-ring min-h-[88px] w-full rounded-lg bg-theme-bg p-3 text-left text-theme-text active:translate-y-px motion-reduce:transform-none disabled:opacity-50 disabled:cursor-not-allowed">
      <span className="block text-xs text-theme-text-secondary">Roll</span><span className="block font-semibold text-sm">{roll.name}</span>
      <span className="block font-mono text-sm text-theme-accent">{formula}</span>
    </button>
    <p className="text-xs text-theme-text-secondary">Range: {range.min}-{range.max}{range.open ? '+' : ''}</p>
    {roll.description && <p className="text-xs text-theme-text-muted">{roll.description}</p>}
    {badges.length > 0 && <p className="text-xs text-theme-text-secondary">{badges.join(' · ')}</p>}
    {!!roll.tags?.length && <p className="text-xs text-theme-text-muted">{roll.tags.join(' · ')}</p>}
    <div className="flex flex-wrap gap-1 items-start">
      <button type="button" onClick={() => onToggleFavorite(roll)} className={secondary} aria-label={roll.isFavorite ? 'Remove from favorites' : 'Add to favorites'} aria-pressed={!!roll.isFavorite}>{roll.isFavorite ? '★' : '☆'}</button>
      <details className="min-w-0 flex-1"><summary className={`${secondary} cursor-pointer`} aria-label={`More actions for ${roll.name}`}>More</summary>
        <div className="flex flex-col gap-1 mt-1">
          <button type="button" className={secondary} onClick={() => onEdit(roll)} aria-label="Edit roll">Edit</button>
          {onDuplicate && <button type="button" className={secondary} onClick={() => onDuplicate(roll)}>Duplicate</button>}
          {onMove && <button type="button" className={secondary} onClick={() => onMove(roll)}>Move to group</button>}
          <button type="button" className={secondary} onClick={() => onDelete(roll)} aria-label="Delete roll">Delete roll</button>
        </div>
      </details>
    </div>
  </article>
}
