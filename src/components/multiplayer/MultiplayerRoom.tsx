import { useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { useEffect, useRef, useState } from 'react'
import { useMultiplayerStore } from '../../store/useMultiplayerStore'
import { useMultiplayerDiceBackend } from '../../hooks/useMultiplayerDiceBackend'
import { DiceBackendProvider } from '../../contexts/DiceBackendProvider'
import { useDiceManagerStore } from '../../store/useDiceManagerStore'
import { useDiceStore } from '../../store/useDiceStore'
import { usePlayerIdentityStore } from '../../store/usePlayerIdentityStore'
import { getRoomServerConfig, READINESS_MAX_RETRIES } from '../../lib/multiplayerServer'
import { preflightRoom, type PreflightResult } from '../../lib/roomPreflight'
import { consumePendingRoomSetup, fitCarriedDice } from '../../lib/roomCarry'
import Scene from '../Scene'
import { StartupGate, StartupSplash } from '../brand/StartupSplash'

export function MultiplayerRoom() {
  const { roomId } = useParams<{ roomId: string }>()
  const [searchParams] = useSearchParams()
  const connectionStatus = useMultiplayerStore((s) => s.connectionStatus)
  const connectionError = useMultiplayerStore((s) => s.connectionError)
  const roomClosedNotice = useMultiplayerStore((s) => s.roomClosedNotice)
  const playerCount = useMultiplayerStore((s) => s.players.size)
  const localPlayerId = useMultiplayerStore((s) => s.localPlayerId)
  const engineConfig = useMultiplayerStore((s) => s.engineConfig)
  const diceCount = useMultiplayerStore((s) => s.dice.size)
  const isHost = useMultiplayerStore((s) => s.isHost)
  const connect = useMultiplayerStore((s) => s.connect)
  const disconnect = useMultiplayerStore((s) => s.disconnect)
  const setRoomTheme = useMultiplayerStore((s) => s.setRoomTheme)

  const navigate = useNavigate()
  const rememberedName = usePlayerIdentityStore((s) => s.displayName)
  const rememberedColor = usePlayerIdentityStore((s) => s.color)
  const setIdentity = usePlayerIdentityStore((s) => s.setIdentity)

  const serverConfig = getRoomServerConfig()
  // Pre-fill from an explicit `?name=`, else the player's last-used identity (#78).
  const initialDisplayName = searchParams.get('name') || rememberedName
  // Theme chosen in the creation flow (#76). We apply it once the room creator
  // has been confirmed as host by `room_state`; setRoomTheme is host-gated.
  const initialThemeId = searchParams.get('theme')

  const [displayName, setDisplayName] = useState(initialDisplayName)
  const [color, setColor] = useState(rememberedColor)
  const [hasJoined, setHasJoined] = useState(false)
  // Deep-link preflight state: the room may be gone or the server unreachable.
  const [preflightNotice, setPreflightNotice] = useState<PreflightResult | null>(null)
  const [isChecking, setIsChecking] = useState(false)
  // Interim "server waking up, retrying…" message while a cold-starting public
  // server is retried during preflight (#109); null when not retrying.
  const [wakingNotice, setWakingNotice] = useState<string | null>(null)

  const multiplayerBackend = useMultiplayerDiceBackend()
  const roomIsReady = connectionStatus === 'connected' && localPlayerId !== null

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

  // Apply the creation-time theme once, after the creator is confirmed host.
  const appliedThemeRef = useRef(false)
  useEffect(() => {
    if (appliedThemeRef.current) return
    if (!initialThemeId || !isHost || connectionStatus !== 'connected') return
    appliedThemeRef.current = true
    setRoomTheme(initialThemeId)
  }, [initialThemeId, isHost, connectionStatus, setRoomTheme])

  // Replay a carried solo room (Shared-ADR-005) into this fresh server room once
  // the creator is confirmed host: apply the chosen discovery/name, then recreate
  // the dice at their exact resting spots. Consumes the hand-off buffer once.
  const appliedCarryRef = useRef(false)
  useEffect(() => {
    if (appliedCarryRef.current) return
    if (!roomId || !isHost || connectionStatus !== 'connected') return
    const setup = consumePendingRoomSetup(roomId)
    if (!setup) return
    appliedCarryRef.current = true
    const store = useMultiplayerStore.getState()
    if (setup.visibility === 'public') {
      store.setVisibility('public')
      if (setup.roomName.trim()) store.setRoomName(setup.roomName)
    }
    // Scale the carried layout to this room's arena (solo is viewport-sized, a
    // server room is the fixed 9:16) so dice keep their relative arrangement
    // instead of being clamped onto the walls.
    const engine = store.engineConfig
    const destArena = engine ? { halfX: engine.arenaHalfX, halfZ: engine.arenaHalfZ } : null
    store.spawnCarriedDice(fitCarriedDice(setup.dice, setup.sourceArena, destArena))
  }, [roomId, isHost, connectionStatus])

  const handleJoin = async () => {
    if (!roomId || !displayName.trim() || isChecking) return
    const trimmedName = displayName.trim()

    // Remember the identity for next time before we do anything else (issue #78).
    setIdentity({ displayName: trimmedName, color })
    setPreflightNotice(null)
    setWakingNotice(null)

    // Preflight the room so a dead link fails fast and kindly. Public servers
    // retry through cold starts; local loopback fast-fails (#109).
    setIsChecking(true)
    const result = await preflightRoom(serverConfig.httpUrl, roomId, {
      maxRetries: READINESS_MAX_RETRIES,
      onRetry: ({ attempt, maxRetries }) => {
        setWakingNotice(`Server waking up, retrying… (attempt ${attempt} of ${maxRetries})`)
      },
    })
    setIsChecking(false)
    setWakingNotice(null)
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
        <img
          src="/brand/dicesuki-wordmark.svg"
          alt="Dicesuki"
          style={{ width: 'min(68vw, 240px)', height: 'auto', marginBottom: '0.75rem' }}
        />
        <h1>Join Room</h1>
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
          </div>
        )}
        {wakingNotice && (
          <div
            role="status"
            data-testid="join-waking-notice"
            style={{
              maxWidth: '28rem',
              padding: '0.875rem 1rem',
              borderRadius: '10px',
              border: '1px solid rgba(96, 165, 250, 0.45)',
              background: 'rgba(30, 58, 138, 0.45)',
              color: '#bfdbfe',
              fontSize: '0.9rem',
              lineHeight: 1.4,
            }}
          >
            <strong>Server waking up.</strong> {wakingNotice.replace(/^Server waking up, /, '')}
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
          {isChecking
            ? wakingNotice
              ? 'Waking server…'
              : 'Checking…'
            : showConnectionError || preflightNotice
              ? 'Try Again'
              : 'Join'}
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

  // Keep the branded loader up through the join round-trip. A live WebSocket is
  // not enough: `localPlayerId` arrives with room_state after the socket opens.
  if (connectionStatus === 'connecting' || !roomIsReady) {
    return <StartupSplash phase={connectionStatus === 'connecting' ? 'multiplayer' : 'room'} />
  }

  // Connected — render the unified Scene with multiplayer backend
  return (
    <div
      data-testid="multiplayer-room"
      data-connection-status={connectionStatus}
      data-player-count={playerCount}
      data-local-player-ready={localPlayerId ? 'true' : 'false'}
      data-engine-ready={engineConfig ? 'true' : 'false'}
      data-dice-count={diceCount}
      style={{ width: '100vw', height: '100dvh', position: 'relative', overflow: 'hidden' }}
    >
      <StartupGate ready={roomIsReady} phase="room">
        {(onContentReady) => (
          <DiceBackendProvider value={multiplayerBackend}>
            <Scene onReady={onContentReady} />
          </DiceBackendProvider>
        )}
      </StartupGate>
    </div>
  )
}
