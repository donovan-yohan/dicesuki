import { useMultiplayerStore } from '../../store/useMultiplayerStore'
import type { DiceShape } from '../../lib/geometries'

const DICE_TYPES: DiceShape[] = ['d4', 'd6', 'd8', 'd10', 'd12', 'd20']

export function MultiplayerToolbar() {
  const spawnDice = useMultiplayerStore((s) => s.spawnDice)
  const removeDice = useMultiplayerStore((s) => s.removeDice)
  const roll = useMultiplayerStore((s) => s.roll)
  const dice = useMultiplayerStore((s) => s.dice)
  const localPlayerId = useMultiplayerStore((s) => s.localPlayerId)

  // Compute local player's dice once
  const myDice = Array.from(dice.values()).filter((d) => d.ownerId === localPlayerId)
  const myDiceCount = myDice.length
  const isRolling = myDice.some((d) => d.isRolling)
  const totalDiceCount = dice.size

  function handleClearMyDice(): void {
    const myDiceIds = myDice.map((d) => d.id)
    if (myDiceIds.length > 0) {
      removeDice(myDiceIds)
    }
  }

  return (
    <div style={{
      position: 'absolute',
      bottom: 0,
      left: 0,
      right: 0,
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      gap: '0.75rem',
      padding: '1rem',
      background: 'rgba(0, 0, 0, 0.6)',
      backdropFilter: 'blur(8px)',
      zIndex: 10,
      fontFamily: 'system-ui, sans-serif',
    }}>
      {/* Dice type buttons */}
      <div style={{ display: 'flex', gap: '0.5rem' }}>
        {DICE_TYPES.map((type) => {
          const disabled = totalDiceCount >= 30
          return (
            <button
              key={type}
              onClick={() => spawnDice(type)}
              disabled={disabled}
              style={{
                padding: '0.5rem 0.75rem',
                borderRadius: '8px',
                border: '1px solid rgba(255,255,255,0.2)',
                background: disabled ? 'rgba(255,255,255,0.05)' : 'rgba(255,255,255,0.1)',
                color: disabled ? 'rgba(255,255,255,0.3)' : 'white',
                cursor: disabled ? 'not-allowed' : 'pointer',
                fontSize: '0.85rem',
                fontWeight: 'bold',
                textTransform: 'uppercase',
              }}
            >
              {type}
            </button>
          )
        })}
      </div>

      {/* Roll + Clear buttons */}
      <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'center' }}>
        <button
          onClick={handleClearMyDice}
          disabled={myDiceCount === 0}
          style={{
            padding: '0.5rem 1rem',
            borderRadius: '8px',
            border: '1px solid rgba(255,255,255,0.2)',
            background: 'rgba(255,255,255,0.1)',
            color: myDiceCount === 0 ? 'rgba(255,255,255,0.3)' : 'white',
            cursor: myDiceCount === 0 ? 'not-allowed' : 'pointer',
            fontSize: '0.85rem',
          }}
        >
          Clear ({myDiceCount})
        </button>

        <button
          onClick={roll}
          disabled={myDiceCount === 0 || isRolling}
          style={{
            padding: '0.75rem 2.5rem',
            borderRadius: '12px',
            border: 'none',
            background: myDiceCount === 0 || isRolling
              ? 'rgba(139, 92, 246, 0.3)'
              : '#8B5CF6',
            color: 'white',
            cursor: myDiceCount === 0 || isRolling ? 'not-allowed' : 'pointer',
            fontSize: '1.1rem',
            fontWeight: 'bold',
            letterSpacing: '0.1em',
          }}
        >
          {isRolling ? 'ROLLING...' : 'ROLL'}
        </button>

        <div style={{
          fontSize: '0.75rem',
          color: 'rgba(255,255,255,0.5)',
          minWidth: '80px',
          textAlign: 'center',
        }}>
          {totalDiceCount}/30 dice
        </div>
      </div>
    </div>
  )
}
