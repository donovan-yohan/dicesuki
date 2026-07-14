import { useEffect, useRef } from 'react'
import Scene from './Scene'
import { DiceBackendProvider } from '../contexts/DiceBackendProvider'
import { useMultiplayerDiceBackend } from '../hooks/useMultiplayerDiceBackend'
import { useMultiplayerStore } from '../store/useMultiplayerStore'
import { useDiceStore } from '../store/useDiceStore'
import { useDiceManagerStore } from '../store/useDiceManagerStore'
import { usePlayerIdentityStore } from '../store/usePlayerIdentityStore'

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
  const connect = useMultiplayerStore((s) => s.connect)
  const disconnect = useMultiplayerStore((s) => s.disconnect)
  const rememberedName = usePlayerIdentityStore((s) => s.displayName)
  const rememberedColor = usePlayerIdentityStore((s) => s.color)

  const didSeedDefaultRef = useRef(false)

  const backend = useMultiplayerDiceBackend()
  const { addDie } = backend

  // Seed a single d20 FROM THE INVENTORY in the center of an empty table when the
  // solo room opens, so the app never boots to an empty tray (center-out spawn
  // places the first die at the table center). `addDie` picks an available d20 from
  // the player's inventory and spawns it with its presentation metadata — every die
  // on the table is an inventory die, never an invented one. Guarded so it seeds
  // once per connected session and never stomps a table that already has dice.
  useEffect(() => {
    if (connectionStatus !== 'connected') {
      didSeedDefaultRef.current = false
      return
    }
    if (didSeedDefaultRef.current) return
    didSeedDefaultRef.current = true
    if (useMultiplayerStore.getState().dice.size === 0) {
      addDie('d20')
    }
  }, [connectionStatus, addDie])

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

  // The wasm room boots near-instantly, but wait for the join round-trip so the
  // scene never renders (or lets the player spawn) before a local player exists.
  if (connectionStatus !== 'connected') {
    return (
      <div
        data-testid="solo-room-loading"
        style={{
          width: '100vw',
          height: '100dvh',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          color: 'white',
          background: '#1a1a2e',
          fontFamily: 'system-ui, sans-serif',
        }}
      >
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-white mx-auto mb-4"></div>
          <p>Starting your table…</p>
        </div>
      </div>
    )
  }

  return (
    <div
      data-testid="solo-room"
      data-connection-status={connectionStatus}
      data-player-color={rememberedColor}
      data-remembered-name={rememberedName}
      style={{ width: '100vw', height: '100dvh', position: 'relative', overflow: 'hidden' }}
    >
      <DiceBackendProvider value={backend}>
        <Scene />
      </DiceBackendProvider>
    </div>
  )
}

export default SoloRoom
