import { useParams, useSearchParams } from 'react-router-dom'
import { useEffect, useRef, useState } from 'react'
import { useMultiplayerStore } from '../../store/useMultiplayerStore'
import { useMultiplayerDiceBackend } from '../../hooks/useMultiplayerDiceBackend'
import { DiceBackendProvider } from '../../contexts/DiceBackendProvider'
import { useDiceManagerStore } from '../../store/useDiceManagerStore'
import { useDiceStore } from '../../store/useDiceStore'
import { getRoomServerConfig, type RoomServerMode } from '../../lib/multiplayerServer'
import Scene from '../Scene'

export function MultiplayerRoom() {
  const { roomId } = useParams<{ roomId: string }>()
  const [searchParams] = useSearchParams()
  const connectionStatus = useMultiplayerStore((s) => s.connectionStatus)
  const connectionError = useMultiplayerStore((s) => s.connectionError)
  const playerCount = useMultiplayerStore((s) => s.players.size)
  const localPlayerId = useMultiplayerStore((s) => s.localPlayerId)
  const diceCount = useMultiplayerStore((s) => s.dice.size)
  const connect = useMultiplayerStore((s) => s.connect)
  const disconnect = useMultiplayerStore((s) => s.disconnect)

  const serverMode: RoomServerMode = searchParams.get('server') === 'local' ? 'local-loopback' : 'public'
  const serverConfig = getRoomServerConfig(serverMode)
  const isSoloRoom = searchParams.get('solo') === '1'
  const initialDisplayName = searchParams.get('name') || (isSoloRoom ? 'Solo Player' : '')

  const [displayName, setDisplayName] = useState(initialDisplayName)
  const [color, setColor] = useState('#8B5CF6')
  const [hasJoined, setHasJoined] = useState(false)
  const autoJoinAttemptsRef = useRef(0)

  const multiplayerBackend = useMultiplayerDiceBackend()

  // Clear local dice state on mount; disconnect and reset on unmount
  useEffect(() => {
    useDiceStore.getState().reset()
    useDiceManagerStore.getState().removeAllDice()
    return () => {
      disconnect()
      useDiceStore.getState().reset()
      useDiceManagerStore.getState().removeAllDice()
    }
  }, [disconnect])

  useEffect(() => {
    if (!isSoloRoom || !roomId || connectionStatus !== 'disconnected') return
    if (autoJoinAttemptsRef.current >= 2) return
    autoJoinAttemptsRef.current += 1
    connect(roomId, initialDisplayName || 'Solo Player', color, serverConfig.wsUrl)
    setHasJoined(true)
  }, [color, connect, connectionStatus, initialDisplayName, isSoloRoom, roomId, serverConfig.wsUrl])

  const handleJoin = () => {
    if (!roomId || !displayName.trim()) return
    connect(roomId, displayName.trim(), color, serverConfig.wsUrl)
    setHasJoined(true)
  }

  // Show join form if not connected
  if (!hasJoined || connectionStatus === 'disconnected') {
    const showConnectionError = hasJoined && connectionError
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
        <h1>{isSoloRoom ? 'Local Solo Room' : 'Join Room'}</h1>
        <p style={{ opacity: 0.7 }}>Room: {roomId}</p>
        <p style={{ opacity: 0.7, maxWidth: '28rem', textAlign: 'center' }}>
          {serverConfig.label}: {serverConfig.wsUrl}
        </p>
        {showConnectionError && (
          <div
            role="alert"
            style={{
              maxWidth: '28rem',
              padding: '0.875rem 1rem',
              borderRadius: '10px',
              border: '1px solid rgba(248, 113, 113, 0.45)',
              background: 'rgba(127, 29, 29, 0.45)',
              color: '#fecaca',
              fontSize: '0.9rem',
              lineHeight: 1.4,
            }}
          >
            <strong>Connection failed.</strong> {connectionError}
            {serverConfig.startCommand && (
              <div style={{ marginTop: '0.5rem' }}>
                Start the local server with <code>{serverConfig.startCommand}</code>, then try again.
              </div>
            )}
          </div>
        )}
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
          {showConnectionError ? 'Try Again' : 'Join'}
        </button>
      </div>
    )
  }

  // Show error state
  if (connectionStatus === 'error') {
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
        <p style={{ color: '#f87171', fontSize: '1.1rem' }}>Connection error. Please rejoin the room.</p>
        <button
          onClick={() => {
            disconnect()
          }}
          style={{
            padding: '0.75rem 2rem',
            borderRadius: '8px',
            border: 'none',
            background: '#8B5CF6',
            color: 'white',
            fontSize: '1rem',
            cursor: 'pointer',
          }}
        >
          Back to Join
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
        Connecting to {serverConfig.label.toLowerCase()} room {roomId}...
      </div>
    )
  }

  // Connected — render the unified Scene with multiplayer backend
  return (
    <div
      data-testid="multiplayer-room"
      data-connection-status={connectionStatus}
      data-server-mode={serverMode}
      data-player-count={playerCount}
      data-local-player-ready={localPlayerId ? 'true' : 'false'}
      data-dice-count={diceCount}
      style={{ width: '100vw', height: '100dvh', position: 'relative', overflow: 'hidden' }}
    >
      <DiceBackendProvider value={multiplayerBackend}>
        <Scene />
      </DiceBackendProvider>
    </div>
  )
}
