import { useParams } from 'react-router-dom'
import { useEffect, useState } from 'react'
import { useMultiplayerStore } from '../../store/useMultiplayerStore'
import { useMultiplayerDiceBackend } from '../../hooks/useMultiplayerDiceBackend'
import { DiceBackendProvider } from '../../contexts/DiceBackendContext'
import { useDiceStore } from '../../store/useDiceStore'
import Scene from '../Scene'

export function MultiplayerRoom() {
  const { roomId } = useParams<{ roomId: string }>()
  const connectionStatus = useMultiplayerStore((s) => s.connectionStatus)
  const connect = useMultiplayerStore((s) => s.connect)
  const disconnect = useMultiplayerStore((s) => s.disconnect)

  const [displayName, setDisplayName] = useState('')
  const [color, setColor] = useState('#8B5CF6')
  const [hasJoined, setHasJoined] = useState(false)

  const multiplayerBackend = useMultiplayerDiceBackend()

  // Clear local dice state on mount; disconnect and reset on unmount
  useEffect(() => {
    useDiceStore.getState().reset()
    return () => {
      disconnect()
      useDiceStore.getState().reset()
    }
  }, [disconnect])

  const handleJoin = () => {
    if (!roomId || !displayName.trim()) return
    connect(roomId, displayName.trim(), color)
    setHasJoined(true)
  }

  // Show join form if not connected
  if (!hasJoined || connectionStatus === 'disconnected') {
    return (
      <div style={{
        width: '100vw',
        height: '100dvh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        flexDirection: 'column',
        gap: '1rem',
        fontFamily: 'system-ui, sans-serif',
        color: 'white',
        background: '#1a1a2e',
      }}>
        <h1>Join Room</h1>
        <p style={{ opacity: 0.7 }}>Room: {roomId}</p>
        <input
          type="text"
          placeholder="Display name"
          value={displayName}
          onChange={(e) => setDisplayName(e.target.value)}
          maxLength={20}
          style={{
            padding: '0.75rem 1rem',
            borderRadius: '8px',
            border: '1px solid #444',
            background: '#2a2a3e',
            color: 'white',
            fontSize: '1rem',
            width: '250px',
          }}
          onKeyDown={(e) => e.key === 'Enter' && handleJoin()}
        />
        <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
          <label style={{ opacity: 0.7 }}>Color:</label>
          <input
            type="color"
            value={color}
            onChange={(e) => setColor(e.target.value)}
            style={{ width: '40px', height: '40px', border: 'none', borderRadius: '8px' }}
          />
        </div>
        <button
          onClick={handleJoin}
          disabled={!displayName.trim()}
          style={{
            padding: '0.75rem 2rem',
            borderRadius: '8px',
            border: 'none',
            background: displayName.trim() ? '#8B5CF6' : '#444',
            color: 'white',
            fontSize: '1rem',
            cursor: displayName.trim() ? 'pointer' : 'not-allowed',
          }}
        >
          Join
        </button>
      </div>
    )
  }

  // Show connecting state
  if (connectionStatus === 'connecting') {
    return (
      <div style={{
        width: '100vw',
        height: '100dvh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        color: 'white',
        background: '#1a1a2e',
        fontFamily: 'system-ui, sans-serif',
      }}>
        Connecting to room {roomId}...
      </div>
    )
  }

  // Connected — render the unified Scene with multiplayer backend
  return (
    <div style={{ width: '100vw', height: '100dvh', position: 'relative', overflow: 'hidden' }}>
      <DiceBackendProvider value={multiplayerBackend}>
        <Scene />
      </DiceBackendProvider>
    </div>
  )
}
