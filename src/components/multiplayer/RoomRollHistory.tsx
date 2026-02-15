import { useRoomHistoryStore, type RoomRollEntry } from '../../store/useRoomHistoryStore'
import { useMultiplayerStore } from '../../store/useMultiplayerStore'

function RollEntry({ entry }: { entry: RoomRollEntry }) {
  const localPlayerId = useMultiplayerStore((s) => s.localPlayerId)
  const isLocal = entry.playerId === localPlayerId

  const diceStr = entry.results
    .map((r) => `${r.faceValue}`)
    .join(' + ')

  return (
    <div style={{
      display: 'flex',
      alignItems: 'center',
      gap: '0.5rem',
      padding: '0.4rem 0',
      fontSize: '0.8rem',
      opacity: isLocal ? 1 : 0.8,
    }}>
      {/* Player color dot */}
      <div style={{
        width: '8px',
        height: '8px',
        borderRadius: '50%',
        background: entry.color,
        flexShrink: 0,
      }} />

      {/* Player name */}
      <span style={{
        fontWeight: isLocal ? 'bold' : 'normal',
        color: entry.color,
        minWidth: '60px',
      }}>
        {entry.displayName}
      </span>

      {/* Dice results */}
      <span style={{ color: 'rgba(255,255,255,0.6)' }}>
        {diceStr}
      </span>

      {/* Total */}
      <span style={{
        fontWeight: 'bold',
        color: 'white',
        marginLeft: 'auto',
      }}>
        = {entry.total}
      </span>
    </div>
  )
}

export function RoomRollHistory() {
  const rolls = useRoomHistoryStore((s) => s.rolls)

  if (rolls.length === 0) return null

  return (
    <div style={{
      position: 'absolute',
      right: '1rem',
      top: '60px',
      bottom: '120px',
      width: '250px',
      overflowY: 'auto',
      background: 'rgba(0, 0, 0, 0.4)',
      backdropFilter: 'blur(4px)',
      borderRadius: '8px',
      padding: '0.75rem',
      zIndex: 10,
      fontFamily: 'system-ui, sans-serif',
      color: 'white',
    }}>
      <div style={{
        fontSize: '0.7rem',
        textTransform: 'uppercase',
        letterSpacing: '0.1em',
        opacity: 0.5,
        marginBottom: '0.5rem',
      }}>
        Roll History
      </div>
      {rolls.map((entry) => (
        <RollEntry key={entry.id} entry={entry} />
      ))}
    </div>
  )
}
