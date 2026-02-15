import { useMultiplayerStore } from '../../store/useMultiplayerStore'

export function MultiplayerResultDisplay() {
  const dice = useMultiplayerStore((s) => s.dice)
  const localPlayerId = useMultiplayerStore((s) => s.localPlayerId)

  // Get local player's dice
  const myDice = Array.from(dice.values())
    .filter((d) => d.ownerId === localPlayerId)

  const mySettled = myDice.filter((d) => d.faceValue !== null)
  const myRolling = myDice.some((d) => d.isRolling)
  const myTotal = mySettled.reduce((sum, d) => sum + (d.faceValue ?? 0), 0)

  if (myDice.length === 0) return null

  return (
    <div style={{
      position: 'absolute',
      left: '1rem',
      top: '50%',
      transform: 'translateY(-50%)',
      zIndex: 10,
      fontFamily: 'system-ui, sans-serif',
      color: 'white',
    }}>
      <div style={{
        background: 'rgba(0, 0, 0, 0.6)',
        backdropFilter: 'blur(8px)',
        borderRadius: '12px',
        padding: '1rem',
        textAlign: 'center',
        minWidth: '80px',
      }}>
        <div style={{
          fontSize: '2.5rem',
          fontWeight: 'bold',
          lineHeight: 1,
        }}>
          {myRolling ? '?' : myTotal}
        </div>
        {!myRolling && mySettled.length > 1 && (
          <div style={{
            fontSize: '0.8rem',
            opacity: 0.6,
            marginTop: '0.25rem',
          }}>
            {mySettled.map((d) => d.faceValue).join(' + ')}
          </div>
        )}
        {myRolling && (
          <div style={{
            fontSize: '0.7rem',
            opacity: 0.5,
            marginTop: '0.25rem',
          }}>
            Rolling...
          </div>
        )}
      </div>
    </div>
  )
}
