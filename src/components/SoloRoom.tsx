import { useEffect, useRef } from 'react'
import Scene from './Scene'
import { DiceBackendProvider } from '../contexts/DiceBackendProvider'
import { useMultiplayerDiceBackend } from '../hooks/useMultiplayerDiceBackend'
import { useMultiplayerStore } from '../store/useMultiplayerStore'
import { useDiceStore } from '../store/useDiceStore'
import { useDiceManagerStore } from '../store/useDiceManagerStore'
import { usePlayerIdentityStore } from '../store/usePlayerIdentityStore'
import { StartupGate, type StartupPhase } from './brand/StartupSplash'

/**
 * SoloRoom — the default `/` experience (issue #114, epic #111).
 *
 * Solo play is a one-player room hosted by the in-browser WASM room worker: the
 * SAME `dicesuki-core` engine, constants, and settings that build the real
 * multiplayer server, reached over the worker transport instead of a network
 * socket. There is no native server, no health check, and no network — the room
 * opens on load and the player is the sole (trivially host) participant.
 *
 * This replaces the legacy client-side `@react-three/rapier` `<Physics>` path as
 * the default. `Scene` already renders positioned meshes (not local physics
 * bodies) whenever the active backend is `'multiplayer'`, so every solo feature —
 * inventory spawns, saved rolls, roll tray, hero die, device-motion shake,
 * haptics, theme — flows through the identical room code path.
 */

/**
 * Fixed room id for the solo worker room. The worker hosts exactly one room per
 * instance, so the id only needs to be stable within a session (it keys the
 * reconnect token in sessionStorage); its value is otherwise irrelevant.
 */
const SOLO_ROOM_ID = 'solo'

export function SoloRoom() {
  const connectionStatus = useMultiplayerStore((s) => s.connectionStatus)
  const connectionError = useMultiplayerStore((s) => s.connectionError)
  const localPlayerId = useMultiplayerStore((s) => s.localPlayerId)
  const engineConfig = useMultiplayerStore((s) => s.engineConfig)
  const connect = useMultiplayerStore((s) => s.connect)
  const disconnect = useMultiplayerStore((s) => s.disconnect)
  const rememberedName = usePlayerIdentityStore((s) => s.displayName)
  const rememberedColor = usePlayerIdentityStore((s) => s.color)

  const didSeedDefaultRef = useRef(false)
  const backend = useMultiplayerDiceBackend()
  const { addDie } = backend
  const roomIsReady =
    connectionStatus === 'connected' && localPlayerId !== null && engineConfig !== null
  const startupPhase: StartupPhase = connectionStatus === 'connected' ? 'room' : 'engine'

  // Seed a single d20 FROM THE INVENTORY in the center of an empty table when the
  // solo room opens, so the app never boots to an empty tray (center-out spawn
  // places the first die at the table center). `addDie` picks an available d20 from
  // the player's inventory and spawns it with its presentation metadata — every die
  // on the table is an inventory die, never an invented one. Guarded so it seeds
  // once per connected session and never stomps a table that already has dice.
  useEffect(() => {
    if (!roomIsReady) {
      didSeedDefaultRef.current = false
      return
    }
    if (didSeedDefaultRef.current) return
    didSeedDefaultRef.current = true
    if (useMultiplayerStore.getState().dice.size === 0) {
      addDie('d20')
    }
  }, [roomIsReady, addDie])

  // Open the solo worker room on mount; disconnect + reset on unmount. Reset and
  // connect are paired in ONE effect so React StrictMode's dev remount
  // (setup → cleanup → setup) reconnects cleanly: the cleanup's `disconnect()`
  // returns the store to `disconnected`, and the second setup re-opens the room
  // (guarded on the live status so we never stack two workers). The body reads
  // identity via `getState()` so it does not re-run when name/color change.
  useEffect(() => {
    useDiceStore.getState().reset()
    useDiceManagerStore.getState().removeAllDice()
    if (useMultiplayerStore.getState().connectionStatus === 'disconnected') {
      const { displayName, color } = usePlayerIdentityStore.getState()
      connect(SOLO_ROOM_ID, displayName || 'You', color, undefined, 'worker')
    }
    return () => {
      disconnect()
      useDiceStore.getState().reset()
      useDiceManagerStore.getState().removeAllDice()
    }
  }, [connect, disconnect])

  const startupFailed =
    connectionStatus === 'error' ||
    (connectionStatus === 'disconnected' && connectionError !== null)

  if (startupFailed) {
    const retry = () => {
      useDiceStore.getState().reset()
      useDiceManagerStore.getState().removeAllDice()
      const { displayName, color } = usePlayerIdentityStore.getState()
      connect(SOLO_ROOM_ID, displayName || 'You', color, undefined, 'worker')
    }

    return (
      <div
        role="alert"
        className="w-full h-full flex items-center justify-center"
        style={{
          backgroundColor: 'var(--startup-splash-bg)',
          color: 'var(--startup-splash-text)',
        }}
      >
        <div className="text-center max-w-md px-6">
          <img
            src="/brand/dicesuki-wordmark.svg"
            alt="Dicesuki"
            className="w-56 max-w-[70vw] mx-auto mb-8"
          />
          <h1 className="text-2xl font-bold mb-3">Couldn’t start your table</h1>
          <p className="mb-6 opacity-80">
            {connectionError ?? 'The local dice engine stopped before the room was ready.'}
          </p>
          <button
            type="button"
            onClick={retry}
            className="px-5 py-3 rounded-lg bg-[#f98797] text-[#3f1d3f] font-semibold"
          >
            Try again
          </button>
        </div>
      </div>
    )
  }

  return (
    <div
      data-testid={roomIsReady ? 'solo-room' : 'solo-room-loading'}
      data-connection-status={connectionStatus}
      data-local-player-ready={localPlayerId ? 'true' : 'false'}
      data-engine-ready={engineConfig ? 'true' : 'false'}
      data-player-color={rememberedColor}
      data-remembered-name={rememberedName}
      style={{ width: '100vw', height: '100dvh', position: 'relative', overflow: 'hidden' }}
    >
      <StartupGate ready={roomIsReady} phase={startupPhase}>
        {(onContentReady) => (
          <DiceBackendProvider value={backend}>
            <Scene onReady={onContentReady} />
          </DiceBackendProvider>
        )}
      </StartupGate>
    </div>
  )
}

export default SoloRoom
