import type { PlayerInfo } from '../../lib/multiplayerMessages'
import { useMultiplayerStore } from '../../store/useMultiplayerStore'

interface PlayerListProps {
  players: PlayerInfo[]
}

export function PlayerList({ players }: PlayerListProps) {
  const localPlayerId = useMultiplayerStore((s) => s.localPlayerId)

  return (
    <div style={{
      display: 'flex',
      gap: '0.5rem',
      alignItems: 'center',
    }}>
      {players.map((player) => (
        <div
          key={player.id}
          title={player.displayName}
          style={{
            width: '32px',
            height: '32px',
            borderRadius: '50%',
            background: player.color,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: '0.75rem',
            fontWeight: 'bold',
            color: 'white',
            textShadow: '0 1px 2px rgba(0,0,0,0.5)',
            border: player.id === localPlayerId
              ? '2px solid white'
              : '2px solid transparent',
          }}
        >
          {player.displayName.charAt(0).toUpperCase()}
        </div>
      ))}
    </div>
  )
}
