import { useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { useEffect, useRef, useState } from 'react'
import { isStaleSessionErrorCode, useMultiplayerStore } from '../../store/useMultiplayerStore'
import { useAuthStore } from '../../store/useAuthStore'
import { useMultiplayerDiceBackend } from '../../hooks/useMultiplayerDiceBackend'
import { DiceBackendProvider } from '../../contexts/DiceBackendProvider'
import { useDiceStore } from '../../store/useDiceStore'
import { usePlayerIdentityStore } from '../../store/usePlayerIdentityStore'
import { getRoomServerConfig } from '../../lib/multiplayerServer'
import { preflightRoom, type PreflightResult } from '../../lib/roomPreflight'
import {
  COLDSTART_WAKING_BODY,
  COLDSTART_WAKING_TITLE,
  formatColdStartElapsed,
  type ColdStartPhase,
} from '../../lib/coldStartWait'
import { consumePendingRoomSetup, fitCarriedDice } from '../../lib/roomCarry'
import Scene from '../Scene'
import { StartupGate, StartupSplash } from '../brand/StartupSplash'
import { loadRoomSession, saveRoomSession } from '../../lib/roomSession'

export function MultiplayerRoom() {
  const { roomId } = useParams<{ roomId: string }>()
  const [searchParams] = useSearchParams()
  const connectionStatus = useMultiplayerStore((s) => s.connectionStatus)
  const connectionError = useMultiplayerStore((s) => s.connectionError)
  const connectionErrorCode = useMultiplayerStore((s) => s.connectionErrorCode)
  const roomClosedNotice = useMultiplayerStore((s) => s.roomClosedNotice)
  const removedFromRoomNotice = useMultiplayerStore((s) => s.removedFromRoomNotice)
  const playerCount = useMultiplayerStore((s) => s.players.size)
  const localPlayerId = useMultiplayerStore((s) => s.localPlayerId)
  const engineConfig = useMultiplayerStore((s) => s.engineConfig)
  const diceCount = useMultiplayerStore((s) => s.dice.size)
  const isHost = useMultiplayerStore((s) => s.isHost)
  const connect = useMultiplayerStore((s) => s.connect)
  const disconnect = useMultiplayerStore((s) => s.disconnect)
  const detach = useMultiplayerStore((s) => s.detach)
  const reconnectNow = useMultiplayerStore((s) => s.reconnectNow)
  const setRoomTheme = useMultiplayerStore((s) => s.setRoomTheme)

  const navigate = useNavigate()
  const authStatus = useAuthStore((s) => s.status)
  const signOut = useAuthStore((s) => s.signOut)
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
  // Staged cold-start preflight state (see `lib/coldStartWait.ts`). Phase 1
  // (0–30s) keeps the ordinary "Checking…" affordance; phase 2 (30s–3min) says
  // plainly that the free-tier room server is asleep and shows elapsed time.
  const [waitPhase, setWaitPhase] = useState<ColdStartPhase>('connecting')
  const [waitElapsedSeconds, setWaitElapsedSeconds] = useState(0)
  const isWaking = isChecking && waitPhase === 'waking'

  const multiplayerBackend = useMultiplayerDiceBackend()
  const roomIsReady =
    connectionStatus === 'connected' && localPlayerId !== null && engineConfig !== null

  // Clear render state on mount. Route unmount is a transient detach: it must
  // not send Leave or erase the durable resume credential (mobile background
  // and browser page lifecycle commonly remount this route).
  useEffect(() => {
    useDiceStore.getState().reset()
    return () => {
      detach()
      useDiceStore.getState().reset()
    }
  }, [detach])

  // Same-route durable resume. We never redirect the root or place the bearer
  // credential in the URL; only /room/:id consults that room's local record.
  const autoResumeStartedRef = useRef(false)
  useEffect(() => {
    if (autoResumeStartedRef.current || !roomId) return
    const saved = loadRoomSession(roomId)
    if (!saved) return
    autoResumeStartedRef.current = true
    setDisplayName(saved.displayName)
    setColor(saved.color)
    setIsChecking(true)
    setWaitPhase('connecting')
    setWaitElapsedSeconds(0)
    let cancelled = false
    const controller = new AbortController()
    void preflightRoom(serverConfig.httpUrl, roomId, {
      signal: controller.signal,
      onProgress: ({ phase, elapsedMs }) => {
        if (cancelled) return
        setWaitPhase(phase)
        setWaitElapsedSeconds(Math.floor(elapsedMs / 1000))
      },
    }).then((result) => {
      // 'aborted' means we unmounted mid-wait: drop it, never render it.
      if (cancelled || result === 'aborted') return
      setIsChecking(false)
      setWaitPhase('connecting')
      if (result !== 'ok') {
        setPreflightNotice(result)
        return
      }
      // Ready — continue straight into the join the user already asked for.
      connect(roomId, saved.displayName, saved.color, serverConfig.wsUrl)
      setHasJoined(true)
    })
    return () => {
      cancelled = true
      controller.abort()
      autoResumeStartedRef.current = false
    }
  }, [connect, roomId, serverConfig.httpUrl, serverConfig.wsUrl])

  // Browser timers can be heavily throttled while a phone is backgrounded.
  // Foreground/restore/network signals bypass pending backoff and retry now.
  useEffect(() => {
    const resumeIfNeeded = () => {
      const state = useMultiplayerStore.getState()
      if (document.visibilityState === 'visible' && state.connectionStatus !== 'connected') {
        reconnectNow()
      }
    }
    const persistActiveSession = () => {
      const replay = useMultiplayerStore.getState().lastJoin
      if (replay?.transport === 'websocket') {
        saveRoomSession({
          roomId: replay.roomId,
          displayName: replay.displayName,
          color: replay.color,
          reconnectToken: replay.token,
        })
      }
    }
    const onVisibility = () => {
      if (document.visibilityState === 'hidden') persistActiveSession()
      else resumeIfNeeded()
    }
    document.addEventListener('visibilitychange', onVisibility)
    window.addEventListener('pageshow', resumeIfNeeded)
    window.addEventListener('pagehide', persistActiveSession)
    window.addEventListener('online', resumeIfNeeded)
    return () => {
      document.removeEventListener('visibilitychange', onVisibility)
      window.removeEventListener('pageshow', resumeIfNeeded)
      window.removeEventListener('pagehide', persistActiveSession)
      window.removeEventListener('online', resumeIfNeeded)
    }
  }, [reconnectNow])

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

  // A staged wait can run for ~3 minutes, far longer than this route may live.
  // Abort it on unmount and guard every post-await setState.
  const joinAbortRef = useRef<AbortController | null>(null)
  const mountedRef = useRef(true)
  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
      joinAbortRef.current?.abort()
    }
  }, [])

  const handleJoin = async () => {
    if (!roomId || !displayName.trim() || isChecking) return
    const trimmedName = displayName.trim()

    // Remember the identity for next time before we do anything else (issue #78).
    setIdentity({ displayName: trimmedName, color })
    setPreflightNotice(null)

    // Preflight the room on the staged cold-start schedule: a dead link still
    // fails fast (404 is authoritative), but a sleeping free-tier server is
    // woken rather than reported unreachable.
    const controller = new AbortController()
    joinAbortRef.current = controller
    setIsChecking(true)
    setWaitPhase('connecting')
    setWaitElapsedSeconds(0)
    const result = await preflightRoom(serverConfig.httpUrl, roomId, {
      signal: controller.signal,
      onProgress: ({ phase, elapsedMs }) => {
        if (!mountedRef.current) return
        setWaitPhase(phase)
        setWaitElapsedSeconds(Math.floor(elapsedMs / 1000))
      },
    })
    if (joinAbortRef.current === controller) joinAbortRef.current = null
    // 'aborted' means we unmounted mid-wait: drop it, never render it.
    if (!mountedRef.current || result === 'aborted') return
    setIsChecking(false)
    setWaitPhase('connecting')
    if (result !== 'ok') {
      setPreflightNotice(result)
      return
    }

    // Ready — continue straight into the join, no extra click.
    connect(roomId, trimmedName, color, serverConfig.wsUrl)
    setHasJoined(true)
  }

  // Show join form if not connected
  if (!hasJoined || connectionStatus === 'disconnected') {
    const showConnectionError = hasJoined && connectionError
    // An auth rejection is its own failure mode: unlike a gone room or a
    // sleeping server, retrying as-is cannot help until the session changes, so
    // it gets its own banner instead of the generic one (#264). The two codes
    // are different problems — AUTH_REQUIRED means there is no session to fix,
    // so it asks for a sign-in and offers no sign-out button.
    const showStaleSessionError =
      Boolean(showConnectionError) && isStaleSessionErrorCode(connectionErrorCode)
    const needsSignIn = connectionErrorCode === 'AUTH_REQUIRED'
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
        {removedFromRoomNotice && (
          <div
            role="alert"
            data-testid="removed-from-room-notice"
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
            <strong>Removed from room.</strong> {removedFromRoomNotice}
          </div>
        )}
        {showStaleSessionError ? (
          <div
            role="alert"
            data-testid="join-auth-notice"
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
            {needsSignIn ? (
              <>
                <strong>Sign in to join this room.</strong> The room server
                would not seat you without an account. Sign in, then use Try
                Again below.
              </>
            ) : (
              <>
                <strong>Your session has expired.</strong> The room server
                rejected your sign-in, so we couldn&apos;t get you a seat. Sign
                out and sign back in, then use Try Again below.
              </>
            )}
            {!needsSignIn && authStatus === 'authenticated' && (
              <div style={{ marginTop: '0.75rem' }}>
                <button
                  type="button"
                  data-testid="join-auth-sign-out"
                  onClick={() => void signOut()}
                  style={{
                    padding: '0.4rem 0.9rem',
                    borderRadius: '8px',
                    border: '1px solid rgba(254, 202, 202, 0.5)',
                    background: 'transparent',
                    color: '#fecaca',
                    fontSize: '0.85rem',
                    cursor: 'pointer',
                  }}
                >
                  Sign out
                </button>
              </div>
            )}
          </div>
        ) : showConnectionError ? (
          <div
            role="alert"
            data-testid="join-connection-notice"
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
        ) : null}
        {isWaking && (
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
            <strong>{COLDSTART_WAKING_TITLE}.</strong> {COLDSTART_WAKING_BODY}
            <div style={{ marginTop: '0.4rem', opacity: 0.75, fontSize: '0.8rem' }}>
              {formatColdStartElapsed(waitElapsedSeconds * 1000)}
            </div>
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
                <strong>Can&apos;t reach the room server.</strong> We waited a
                few minutes for it to wake up and it never answered. Check your
                connection and use Try Again below, or head back to start.
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
            ? isWaking
              ? `${COLDSTART_WAKING_TITLE}…`
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
  if (connectionStatus === 'connecting' || (connectionStatus === 'connected' && !roomIsReady)) {
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
