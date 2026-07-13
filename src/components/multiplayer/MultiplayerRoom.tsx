import { useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { useEffect, useRef, useState } from 'react'
import { useMultiplayerStore } from '../../store/useMultiplayerStore'
import { useMultiplayerDiceBackend } from '../../hooks/useMultiplayerDiceBackend'
import { DiceBackendProvider } from '../../contexts/DiceBackendProvider'
import { useDiceManagerStore } from '../../store/useDiceManagerStore'
import { useDiceStore } from '../../store/useDiceStore'
import { usePlayerIdentityStore } from '../../store/usePlayerIdentityStore'
import { getRoomServerConfig, type RoomServerMode } from '../../lib/multiplayerServer'
import Scene from '../Scene'

/**
 * Preflight a room link before opening a WebSocket (issue #78). A `404` means the
 * room is gone (expired/cleaned up); a network failure means the server is
 * unreachable. Catching these here gives a fast, kind message instead of waiting
 * out the WS reconnect backoff. `'ok'` means the room exists and we may connect.
 */
type PreflightResult = 'ok' | 'room-gone' | 'server-down'

async function preflightRoom(httpUrl: string, roomId: string): Promise<PreflightResult> {
  try {
    const response = await fetch(`${httpUrl}/api/rooms/${encodeURIComponent(roomId)}`)
    if (response.status === 404) return 'room-gone'
    if (!response.ok) return 'server-down'
    return 'ok'
  } catch {
    return 'server-down'
  }
}

export function MultiplayerRoom() {
  const { roomId } = useParams<{ roomId: string }>()
  const [searchParams] = useSearchParams()
  const connectionStatus = useMultiplayerStore((s) => s.connectionStatus)
  const connectionError = useMultiplayerStore((s) => s.connectionError)
  const roomClosedNotice = useMultiplayerStore((s) => s.roomClosedNotice)
  const playerCount = useMultiplayerStore((s) => s.players.size)
  const localPlayerId = useMultiplayerStore((s) => s.localPlayerId)
  const diceCount = useMultiplayerStore((s) => s.dice.size)
  const connect = useMultiplayerStore((s) => s.connect)
  const disconnect = useMultiplayerStore((s) => s.disconnect)

  const navigate = useNavigate()
  const rememberedName = usePlayerIdentityStore((s) => s.displayName)
  const rememberedColor = usePlayerIdentityStore((s) => s.color)
  const setIdentity = usePlayerIdentityStore((s) => s.setIdentity)

  const serverMode: RoomServerMode = searchParams.get('server') === 'local' ? 'local-loopback' : 'public'
  const serverConfig = getRoomServerConfig(serverMode)
  const isSoloRoom = searchParams.get('solo') === '1'
  // Pre-fill from (in priority order) an explicit `?name=`, the solo default,
  // then the player's last-used identity (issue #78).
  const initialDisplayName =
    searchParams.get('name') || (isSoloRoom ? 'Solo Player' : rememberedName)

  const [displayName, setDisplayName] = useState(initialDisplayName)
  const [color, setColor] = useState(rememberedColor)
  const [hasJoined, setHasJoined] = useState(false)
  // Deep-link preflight state: the room may be gone or the server unreachable.
  const [preflightNotice, setPreflightNotice] = useState<PreflightResult | null>(null)
  const [isChecking, setIsChecking] = useState(false)
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

  const handleJoin = async () => {
    if (!roomId || !displayName.trim() || isChecking) return
    const trimmedName = displayName.trim()

    // Remember the identity for next time before we do anything else (issue #78).
    setIdentity({ displayName: trimmedName, color })
    setPreflightNotice(null)

    // Preflight the room so a dead link fails fast and kindly.
    setIsChecking(true)
    const result = await preflightRoom(serverConfig.httpUrl, roomId)
    setIsChecking(false)
    if (result !== 'ok') {
      setPreflightNotice(result)
      return
    }

    connect(roomId, trimmedName, color, serverConfig.wsUrl)
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
        {roomClosedNotice && (
          <div
            role="alert"
            style={{
              maxWidth: '28rem',
              padding: '0.875rem 1rem',
              borderRadius: '10px',
              border: '1px solid rgba(250, 204, 21, 0.45)',
              background: 'rgba(113, 63, 18, 0.45)',
              color: '#fde68a',
              fontSize: '0.9rem',
              lineHeight: 1.4,
            }}
          >
            <strong>Room unavailable.</strong> {roomClosedNotice}
          </div>
        )}
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
        {preflightNotice && (
          <div
            role="alert"
            data-testid="join-preflight-notice"
            style={{
              maxWidth: '28rem',
              padding: '0.875rem 1rem',
              borderRadius: '10px',
              border: '1px solid rgba(250, 204, 21, 0.45)',
              background: 'rgba(113, 63, 18, 0.45)',
              color: '#fde68a',
              fontSize: '0.9rem',
              lineHeight: 1.4,
            }}
          >
            {preflightNotice === 'room-gone' ? (
              <>
                <strong>This room is no longer available.</strong> It may have been
                closed after everyone left or a period of inactivity. Head back to
                start a fresh room.
              </>
            ) : (
              <>
                <strong>Can&apos;t reach the room server.</strong> Check your
                connection and try again in a moment.
                {serverConfig.startCommand && (
                  <div style={{ marginTop: '0.5rem' }}>
                    If you&apos;re running locally, start it with{' '}
                    <code>{serverConfig.startCommand}</code>.
                  </div>
                )}
              </>
            )}
            <div style={{ marginTop: '0.75rem' }}>
              <button
                type="button"
                onClick={() => navigate('/')}
                style={{
                  padding: '0.4rem 0.9rem',
                  borderRadius: '8px',
                  border: '1px solid rgba(253, 230, 138, 0.5)',
                  background: 'transparent',
                  color: '#fde68a',
                  fontSize: '0.85rem',
                  cursor: 'pointer',
                }}
              >
                Back to start
              </button>
            </div>
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
          disabled={!displayName.trim() || isChecking}
          style={{
            padding: '0.75rem 2rem',
            borderRadius: '8px',
            border: 'none',
            background: displayName.trim() && !isChecking ? '#8B5CF6' : '#444',
            color: 'white',
            fontSize: '1rem',
            cursor: displayName.trim() && !isChecking ? 'pointer' : 'not-allowed',
          }}
        >
          {isChecking ? 'Checking…' : showConnectionError || preflightNotice ? 'Try Again' : 'Join'}
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
