/**
 * History Panel
 *
 * Replaces HistoryDisplay with themed flyout panel.
 * Shows roll history with details and breakdown.
 */

import { FlyoutPanel } from './FlyoutPanel'
import { useDiceStore, RollSnapshot } from '../../store/useDiceStore'

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
              key={roll.timestamp}
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
                color: '#ef4444',
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
      className="p-4 rounded-lg"
      style={{
        backgroundColor: 'rgba(0, 0, 0, 0.2)',
        border: '1px solid rgba(251, 146, 60, 0.2)',
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
            backgroundColor: 'rgba(251, 146, 60, 0.2)',
            color: 'var(--color-accent)',
          }}
        >
          {roll.sum}
        </div>
      </div>

      {/* Dice breakdown */}
      <div className="space-y-1.5">
        {roll.dice.map((die, idx) => (
          <div
            key={`${die.diceId}-${idx}`}
            className="flex items-center justify-between p-2 rounded"
            style={{
              backgroundColor: 'rgba(255, 255, 255, 0.05)',
            }}
          >
            <span
              className="text-sm font-medium"
              style={{ color: 'var(--color-text-secondary)' }}
            >
              {die.type.toUpperCase()}
            </span>
            <span
              className="text-sm font-bold"
              style={{ color: 'var(--color-text-primary)' }}
            >
              {die.value}
            </span>
          </div>
        ))}
      </div>
    </div>
  )
}
