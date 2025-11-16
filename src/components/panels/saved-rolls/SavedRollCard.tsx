/**
 * SavedRollCard Component
 *
 * Displays a saved roll with actions (roll, edit, delete, favorite).
 * Shows formula, badges for special mechanics, and expected range.
 */

import { SavedRoll } from '../../../types/savedRolls'
import { formatSavedRoll, calculateSavedRollRange, getDiceEntryBadges } from '../../../lib/diceHelpers'

interface SavedRollCardProps {
  roll: SavedRoll
  onRoll: (roll: SavedRoll) => void
  onEdit: (roll: SavedRoll) => void
  onDelete: (roll: SavedRoll) => void
  onToggleFavorite: (roll: SavedRoll) => void
}

export function SavedRollCard({
  roll,
  onRoll,
  onEdit,
  onDelete,
  onToggleFavorite,
}: SavedRollCardProps) {
  const formula = formatSavedRoll(roll)
  const range = calculateSavedRollRange(roll)

  // Collect all badges from all dice entries
  const allBadges = roll.dice.flatMap(entry => getDiceEntryBadges(entry))

  return (
    <div
      className="rounded-lg p-4 mb-3"
      style={{
        backgroundColor: 'rgba(0, 0, 0, 0.2)',
        border: '1px solid rgba(251, 146, 60, 0.2)',
      }}
    >
      {/* Header with name and favorite */}
      <div className="flex items-start justify-between mb-2">
        <div className="flex-1">
          <h3
            className="font-semibold text-lg"
            style={{ color: 'var(--color-text-primary)' }}
          >
            {roll.name}
          </h3>
          {roll.description && (
            <p
              className="text-sm mt-1"
              style={{ color: 'var(--color-text-muted)' }}
            >
              {roll.description}
            </p>
          )}
        </div>
        <button
          onClick={() => onToggleFavorite(roll)}
          className="ml-2 text-xl"
          aria-label={roll.isFavorite ? 'Remove from favorites' : 'Add to favorites'}
        >
          {roll.isFavorite ? '⭐' : '☆'}
        </button>
      </div>

      {/* Formula */}
      <div
        className="text-base font-mono mb-2"
        style={{ color: 'var(--color-accent)' }}
      >
        {formula}
      </div>

      {/* Expected range */}
      <div
        className="text-sm mb-2"
        style={{ color: 'var(--color-text-secondary)' }}
      >
        Range: {range.min}-{range.max}
      </div>

      {/* Badges for special mechanics */}
      {allBadges.length > 0 && (
        <div className="flex flex-wrap gap-1 mb-3">
          {allBadges.map((badge, idx) => (
            <span
              key={idx}
              className="text-xs px-2 py-1 rounded"
              style={{
                backgroundColor: 'rgba(251, 146, 60, 0.2)',
                color: 'var(--color-accent)',
              }}
            >
              {badge}
            </span>
          ))}
        </div>
      )}

      {/* Tags */}
      {roll.tags && roll.tags.length > 0 && (
        <div className="flex flex-wrap gap-1 mb-3">
          {roll.tags.map((tag) => (
            <span
              key={tag}
              className="text-xs px-2 py-1 rounded"
              style={{
                backgroundColor: 'rgba(255, 255, 255, 0.1)',
                color: 'var(--color-text-secondary)',
              }}
            >
              {tag}
            </span>
          ))}
        </div>
      )}

      {/* Actions */}
      <div className="flex gap-2">
        {/* Roll button - primary action */}
        <button
          onClick={() => onRoll(roll)}
          className="flex-1 py-2 px-4 rounded-lg font-semibold transition-all"
          style={{
            backgroundColor: 'var(--color-accent)',
            color: '#ffffff',
          }}
        >
          🎲 Roll
        </button>

        {/* More actions button */}
        <div className="flex gap-1">
          <button
            onClick={() => onEdit(roll)}
            className="w-10 h-10 flex items-center justify-center rounded-lg transition-all"
            style={{
              backgroundColor: 'rgba(255, 255, 255, 0.1)',
              color: 'var(--color-text-secondary)',
            }}
            aria-label="Edit roll"
            title="Edit"
          >
            ✏️
          </button>
          <button
            onClick={() => onDelete(roll)}
            className="w-10 h-10 flex items-center justify-center rounded-lg transition-all"
            style={{
              backgroundColor: 'rgba(239, 68, 68, 0.1)',
              color: '#ef4444',
            }}
            aria-label="Delete roll"
            title="Delete"
          >
            🗑️
          </button>
        </div>
      </div>
    </div>
  )
}
