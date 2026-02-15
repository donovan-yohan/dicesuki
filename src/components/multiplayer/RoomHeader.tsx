import { useMultiplayerStore } from '../../store/useMultiplayerStore'
import { PlayerList } from './PlayerList'

export function RoomHeader() {
  const roomId = useMultiplayerStore((s) => s.roomId)
  const players = useMultiplayerStore((s) => s.players)

  return (
    <div style={{
      position: 'absolute',
      top: 0,
      left: 0,
      right: 0,
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-between',
      padding: '0.75rem 1rem',
      background: 'rgba(0, 0, 0, 0.6)',
      backdropFilter: 'blur(8px)',
      zIndex: 10,
      fontFamily: 'system-ui, sans-serif',
      color: 'white',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
        <span style={{ opacity: 0.6, fontSize: '0.85rem' }}>Room</span>
        <code style={{
          background: 'rgba(255,255,255,0.1)',
          padding: '0.25rem 0.5rem',
          borderRadius: '4px',
          fontSize: '0.85rem',
          letterSpacing: '0.05em',
        }}>
          {roomId}
        </code>
      </div>

      <PlayerList players={Array.from(players.values())} />

      <div style={{ fontSize: '0.85rem', opacity: 0.6 }}>
        {players.size}/8
      </div>
    </div>
  )
}
