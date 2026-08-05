import { useEffect, useRef, useState } from 'react'
import { DiceBackendProvider } from '../../contexts/DiceBackendContext'
import { useMultiplayerDiceBackend } from '../../hooks/useMultiplayerDiceBackend'
import { getHttpServerUrl } from '../../lib/multiplayerServer'
import { useDiceManagerStore } from '../../store/useDiceManagerStore'
import { useDiceStore } from '../../store/useDiceStore'
import { useMultiplayerStore } from '../../store/useMultiplayerStore'
import Scene from '../Scene'

const SOLO_PLAYER_NAME = 'You'
const SOLO_PLAYER_COLOR = '#fb923c'

export function SoloRoom() {
  const connectionStatus = useMultiplayerStore((s) => s.connectionStatus)
  const connect = useMultiplayerStore((s) => s.connect)
  const disconnect = useMultiplayerStore((s) => s.disconnect)
  const multiplayerBackend = useMultiplayerDiceBackend()

  const [roomId, setRoomId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const didStartRef = useRef(false)

  useEffect(() => {
    if (didStartRef.current) return
    didStartRef.current = true

    let cancelled = false

    async function startSoloRoom() {
      useDiceStore.getState().reset()
      useDiceManagerStore.getState().removeAllDice()

      try {
        const response = await fetch(`${getHttpServerUrl()}/api/rooms`, { method: 'POST' })
        if (!response.ok) {
          throw new Error(`room create failed: ${response.status}`)
        }

        const data: { roomId: string } = await response.json()
        if (cancelled) return

        setRoomId(data.roomId)
        connect(data.roomId, SOLO_PLAYER_NAME, SOLO_PLAYER_COLOR)
      } catch (err) {
        if (cancelled) return
        console.error('[SoloRoom] Failed to start local room:', err)
        setError('Could not start the local dice room. Run the local server with npm run dev or npm run dev:server, then reload.')
      }
    }

    startSoloRoom()

    return () => {
      cancelled = true
      disconnect()
      useDiceStore.getState().reset()
      useDiceManagerStore.getState().removeAllDice()
    }
  }, [connect, disconnect])

  useEffect(() => {
    if (!roomId || connectionStatus !== 'connecting') return

    const timeout = window.setTimeout(() => {
      setError(`Local room WebSocket did not connect. Check that ${getHttpServerUrl()} is reachable and VITE_MULTIPLAYER_SERVER_URL matches the server port.`)
    }, 5000)

    return () => window.clearTimeout(timeout)
  }, [roomId, connectionStatus])

  if (error) {
    return (
      <div className="w-full h-full flex items-center justify-center bg-gray-900 text-white px-6">
        <div className="max-w-md text-center">
          <h1 className="text-2xl font-bold mb-4">Local Room Offline</h1>
          <p className="text-gray-300 mb-4">{error}</p>
          <p className="text-xs text-gray-500">Server URL: {getHttpServerUrl()}</p>
        </div>
      </div>
    )
  }

  if (!roomId || connectionStatus !== 'connected') {
    return (
      <div className="w-full h-full flex items-center justify-center bg-gray-900 text-white">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-white mx-auto mb-4" />
          <p>Starting local dice room...</p>
        </div>
      </div>
    )
  }

  return (
    <div style={{ width: '100vw', height: '100dvh', position: 'relative', overflow: 'hidden' }}>
      <DiceBackendProvider value={multiplayerBackend}>
        <Scene />
      </DiceBackendProvider>
    </div>
  )
}
