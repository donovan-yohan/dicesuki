import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  checkRoomServerReadiness,
  getRoomServerConfig,
  type RoomServerMode,
  type RoomServerReadinessState,
} from '../lib/multiplayerServer'

type CreateRoomPhase = 'idle' | 'checking' | 'creating'

export interface CreateRoomError {
  kind: Exclude<RoomServerReadinessState, 'ready'> | 'create-failed'
  title: string
  message: string
  command: string | null
}

interface UseCreateRoomOptions {
  mode?: RoomServerMode
  solo?: boolean
  displayName?: string
}

interface UseCreateRoomResult {
  phase: CreateRoomPhase
  isCreating: boolean
  error: CreateRoomError | null
  createRoom: () => Promise<void>
  clearError: () => void
}

/**
 * Hook that handles creating a multiplayer room via the server REST API
 * and navigating to the room page on success.
 */
export function useCreateRoom(options: UseCreateRoomOptions = {}): UseCreateRoomResult {
  const navigate = useNavigate()
  const [phase, setPhase] = useState<CreateRoomPhase>('idle')
  const [error, setError] = useState<CreateRoomError | null>(null)
  const mode = options.mode || 'public'
  const config = getRoomServerConfig(mode)
  const isCreating = phase !== 'idle'

  async function createRoom(): Promise<void> {
    setPhase('checking')
    setError(null)
    try {
      const readiness = await checkRoomServerReadiness(config)
      if (!readiness.ok) {
        const kind = readiness.state === 'ready' ? 'unavailable' : readiness.state
        setError({
          kind,
          title: kind === 'port-conflict' ? 'Room server port conflict' : 'Room server unavailable',
          message: readiness.message,
          command: readiness.command,
        })
        return
      }

      setPhase('creating')
      const response = await fetch(`${config.httpUrl}/api/rooms`, { method: 'POST' })
      if (!response.ok) {
        throw new Error('Failed to create room')
      }
      const data = await response.json() as { roomId?: unknown }
      if (typeof data.roomId !== 'string') {
        throw new Error('Room server response did not include a roomId')
      }

      const params = new URLSearchParams()
      if (mode === 'local-loopback') {
        params.set('server', 'local')
      }
      if (options.solo) {
        params.set('solo', '1')
        params.set('name', options.displayName || 'Solo Player')
      }
      const query = params.toString()
      navigate(`/room/${data.roomId}${query ? `?${query}` : ''}`)
    } catch (err) {
      console.error('Failed to create room:', err)
      setError({
        kind: 'create-failed',
        title: 'Could not create room',
        message: `The ${config.label.toLowerCase()} is reachable, but room creation failed. Try again or restart the room server.`,
        command: config.startCommand,
      })
    } finally {
      setPhase('idle')
    }
  }

  function clearError() {
    setError(null)
  }

  return { phase, isCreating, error, createRoom, clearError }
}
