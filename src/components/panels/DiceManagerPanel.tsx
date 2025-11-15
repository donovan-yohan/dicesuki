/**
 * Dice Manager Panel
 *
 * Replaces HamburgerMenu with themed flyout panel.
 * Manages adding and removing dice from the scene.
 */

import { FlyoutPanel } from './FlyoutPanel'

interface DiceInstance {
  id: string
  type: string
  color: string
}

interface DiceManagerPanelProps {
  isOpen: boolean
  onClose: () => void
  onAddDice?: (type: string) => void
  onRemoveDice?: (id: string) => void
  dice?: DiceInstance[]
}

const DICE_TYPES = [
  { type: 'd4', label: 'D4', emoji: '🔺' },
  { type: 'd6', label: 'D6', emoji: '🎲' },
  { type: 'd8', label: 'D8', emoji: '🔷' },
  { type: 'd10', label: 'D10', emoji: '🔟' },
  { type: 'd12', label: 'D12', emoji: '🌟' },
  { type: 'd20', label: 'D20', emoji: '⭐' },
]

export function DiceManagerPanel({
  isOpen,
  onClose,
  onAddDice,
  onRemoveDice,
  dice = [],
}: DiceManagerPanelProps) {
  const handleAddDice = (type: string) => {
    onAddDice?.(type)
  }

  const handleRemoveDice = (id: string) => {
    onRemoveDice?.(id)
  }

  return (
    <FlyoutPanel
      isOpen={isOpen}
      onClose={onClose}
      title="Dice Manager"
      position="left"
      width="360px"
    >
      {/* Active Dice Section */}
      <div className="mb-8">
        <h3
          className="text-sm font-semibold mb-3"
          style={{ color: 'var(--color-text-secondary)' }}
        >
          Active Dice ({dice.length})
        </h3>

        {dice.length === 0 ? (
          <div
            className="p-6 rounded-lg text-center text-sm"
            style={{
              backgroundColor: 'rgba(0, 0, 0, 0.2)',
              color: 'var(--color-text-muted)',
            }}
          >
            No dice added yet
            <div className="mt-2 text-xs">Add dice below to get started</div>
          </div>
        ) : (
          <div className="space-y-2 max-h-64 overflow-y-auto">
            {dice.map((die, index) => (
              <div
                key={die.id}
                className="flex items-center justify-between p-3 rounded-lg transition-all"
                style={{
                  backgroundColor: 'rgba(0, 0, 0, 0.2)',
                }}
              >
                <div className="flex items-center gap-3">
                  {/* Color indicator */}
                  <div
                    className="w-4 h-4 rounded-full border"
                    style={{
                      backgroundColor: die.color,
                      borderColor: 'rgba(255, 255, 255, 0.3)',
                    }}
                  />

                  {/* Die info */}
                  <div>
                    <div
                      className="font-semibold text-sm"
                      style={{ color: 'var(--color-text-primary)' }}
                    >
                      {die.type.toUpperCase()}
                    </div>
                    <div className="text-xs" style={{ color: 'var(--color-text-muted)' }}>
                      Die #{index + 1}
                    </div>
                  </div>
                </div>

                {/* Remove button */}
                <button
                  onClick={() => handleRemoveDice(die.id)}
                  className="w-7 h-7 flex items-center justify-center rounded-full transition-all"
                  style={{
                    backgroundColor: 'rgba(239, 68, 68, 0.2)',
                    color: '#ef4444',
                  }}
                  aria-label={`Remove ${die.type}`}
                  title="Remove die"
                >
                  ✕
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Add Dice Section */}
      <div>
        <h3
          className="text-sm font-semibold mb-3"
          style={{ color: 'var(--color-text-secondary)' }}
        >
          Add Dice
        </h3>

        <div className="grid grid-cols-2 gap-3">
          {DICE_TYPES.map(({ type, label }) => (
            <button
              key={type}
              onClick={() => handleAddDice(type)}
              className="flex flex-col items-center justify-center p-4 rounded-lg transition-all"
              style={{
                backgroundColor: 'rgba(251, 146, 60, 0.1)',
                border: '1px solid rgba(251, 146, 60, 0.3)',
                color: 'var(--color-text-primary)',
              }}
              aria-label={`Add ${label}`}
            >
              <span className="text-sm font-semibold">{label}</span>
            </button>
          ))}
        </div>
      </div>
    </FlyoutPanel>
  )
}
