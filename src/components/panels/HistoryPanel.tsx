/**
 * History Panel
 *
 * Replaces HistoryDisplay with themed flyout panel.
 * Shows roll history with details and breakdown.
 */

import { FlyoutPanel } from './FlyoutPanel'
import { useDiceStore, type RollSnapshot } from '../../store/useDiceStore'
import { groupPercentileResults } from '../../lib/percentileRolls'
import { dieChipLabel } from '../../lib/basicDice'

interface HistoryPanelProps {
  isOpen: boolean
  onClose: () => void
}

export function HistoryPanel({ isOpen, onClose }: HistoryPanelProps) {
  const rollHistory = useDiceStore((state) => state.rollHistory)

  return (
    <FlyoutPanel
      isOpen={isOpen}
      onClose={onClose}
      title="Roll History"
      position="right"
      width="380px"
    >
      {rollHistory.length === 0 ? (
        <div
          className="flex flex-col items-center justify-center p-8 text-center"
          style={{ color: 'var(--color-text-muted)' }}
        >
          <span className="text-5xl mb-4">📜</span>
          <h3
            className="text-lg font-semibold mb-2"
            style={{ color: 'var(--color-text-secondary)' }}
          >
            No Rolls Yet
          </h3>
          <p className="text-sm">
            Your roll history will appear here after you start rolling dice.
          </p>
        </div>
      ) : (
        <div className="space-y-4">
          {/* Rolls list - newest first */}
          {[...rollHistory].reverse().map((roll, idx) => (
            <RollHistoryItem
              key={roll.id}
              roll={roll}
              rollNumber={rollHistory.length - idx}
            />
          ))}

          {/* Clear history button */}
          {rollHistory.length > 0 && (
            <button
              onClick={() => useDiceStore.getState().clearHistory()}
              className="w-full p-3 rounded-lg text-sm font-semibold transition-all mt-6"
              style={{
                backgroundColor: 'rgba(239, 68, 68, 0.1)',
                color: 'var(--color-error)',
                border: '1px solid rgba(239, 68, 68, 0.3)',
              }}
            >
              Clear All History
            </button>
          )}
        </div>
      )}
    </FlyoutPanel>
  )
}

// ============================================================================
// Roll History Item Component
// ============================================================================

interface RollHistoryItemProps {
  roll: RollSnapshot
  rollNumber: number
}

function RollHistoryItem({ roll, rollNumber }: RollHistoryItemProps) {
  const formatTimestamp = (timestamp: number) => {
    const date = new Date(timestamp)
    const now = new Date()
    const diffMs = now.getTime() - date.getTime()
    const diffMins = Math.floor(diffMs / 60000)

    if (diffMins < 1) return 'Just now'
    if (diffMins < 60) return `${diffMins}m ago`
    const diffHours = Math.floor(diffMins / 60)
    if (diffHours < 24) return `${diffHours}h ago`
    return date.toLocaleDateString()
  }

  return (
    <div
      data-testid="history-roll"
      className="p-4 rounded-lg"
      style={{
        backgroundColor: 'rgba(0, 0, 0, 0.2)',
        border: '1px solid rgba(249, 135, 151, 0.2)',
      }}
    >
      {/* Header */}
      <div className="flex items-center justify-between mb-3">
        <div>
          {/* Show player name if multiplayer roll */}
          {roll.player ? (
            <div className="flex items-center gap-2">
              <div
                className="w-2 h-2 rounded-full"
                style={{ backgroundColor: roll.player.color }}
              />
              <h4
                className="font-semibold"
                style={{ color: roll.player.color }}
              >
                {roll.player.displayName}
              </h4>
            </div>
          ) : (
            <h4
              className="font-semibold"
              style={{ color: 'var(--color-text-primary)' }}
            >
              Roll #{rollNumber}
            </h4>
          )}
          <p
            className="text-xs"
            style={{ color: 'var(--color-text-muted)' }}
          >
            {formatTimestamp(roll.timestamp)}
          </p>
        </div>
        <div
          className="text-2xl font-bold px-3 py-1 rounded-lg"
          style={{
            backgroundColor: 'rgba(249, 135, 151, 0.2)',
            color: 'var(--color-accent)',
          }}
        >
          {roll.sum}
        </div>
      </div>

      {/* Dice breakdown — a percentile pair collapses into one D100 row */}
      <div className="space-y-1.5">
        {groupPercentileResults(roll.dice).map((group, idx) => {
          const isPercentile = group.kind === 'percentile'
          const key = isPercentile ? `d100-${group.tens.diceId}-${idx}` : `${group.die.diceId}-${idx}`
          const value = isPercentile ? group.value : group.die.value
          const label = isPercentile ? 'D100' : getHistoryDieLabel(group.die)
          const subLabel = isPercentile
            ? `${group.tens.value.toString().padStart(2, '0')} + ${group.ones.value}`
            : group.die.presentation?.inventoryDieId
              ? `${group.die.type.toUpperCase()}${group.die.presentation.rarity ? ` · ${group.die.presentation.rarity}` : ''}`
              : null

          return (
            <div
              key={key}
              className="flex items-center justify-between p-2 rounded"
              style={{
                backgroundColor: 'rgba(255, 255, 255, 0.05)',
              }}
            >
              <div className="min-w-0">
                <div
                  className="truncate text-sm font-medium"
                  style={{ color: 'var(--color-text-secondary)' }}
                >
                  {label}
                </div>
                {subLabel && (
                  <div
                    className="truncate text-xs"
                    style={{ color: 'var(--color-text-muted)' }}
                  >
                    {subLabel}
                  </div>
                )}
              </div>
              <span
                className="text-sm font-bold"
                style={{ color: 'var(--color-text-primary)' }}
              >
                {value}
              </span>
            </div>
          )
        })}
      </div>
    </div>
  )
}

function getHistoryDieLabel(die: RollSnapshot['dice'][number]) {
  // `dieChipLabel` reads a basic die as its bare shape and keeps a stray,
  // unpaired tens die from surfacing as the raw engine shape `d10tens`.
  return dieChipLabel(die.type, die.presentation)
}
