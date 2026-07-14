import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  checkRoomServerReadiness,
  getRoomServerConfig,
  type RoomServerMode,
  type RoomServerReadinessState,
} from '../lib/multiplayerServer'

type CreateRoomPhase = 'idle' | 'checking' | 'waking' | 'creating'

export interface CreateRoomError {
  kind: Exclude<RoomServerReadinessState, 'ready'> | 'create-failed'
  title: string
  message: string
  command: string | null
}

export interface UseCreateRoomOptions {
  mode?: RoomServerMode
  /**
   * Optional shared room environment theme chosen at creation time (#76).
   * The room creator becomes the host, so we carry the choice to the room via a
   * `theme` query param and apply it host-side after join (see MultiplayerRoom);
   * `POST /api/rooms` stays theme-agnostic, keeping the server untouched.
   */
  themeId?: string | null
  /**
   * Called with the server-assigned room id after a room is successfully created
   * and before navigation. Lets the caller stash per-room hand-off state (e.g. a
   * carried-dice setup) keyed to the exact room, so it can never be applied to a
   * different room the user later joins.
   */
  onRoomCreated?: (roomId: string) => void
}

interface UseCreateRoomResult {
  phase: CreateRoomPhase
  isCreating: boolean
  /**
   * User-facing "server waking up, retrying…" message while readiness retries a
   * cold-starting public server (#109); null otherwise.
   */
  wakingMessage: string | null
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
  const [wakingMessage, setWakingMessage] = useState<string | null>(null)
  const [error, setError] = useState<CreateRoomError | null>(null)
  const mode = options.mode || 'public'
  const config = getRoomServerConfig(mode)
  const isCreating = phase !== 'idle'

  async function createRoom(): Promise<void> {
    setPhase('checking')
    setWakingMessage(null)
    setError(null)
    try {
      const readiness = await checkRoomServerReadiness(config, {
        // Surface the cold-start wait instead of a silent spinner (#109).
        onRetry: ({ attempt, maxRetries }) => {
          setPhase('waking')
          setWakingMessage(
            `${config.label} is waking up, retrying… (attempt ${attempt} of ${maxRetries})`,
          )
        },
      })
      setWakingMessage(null)
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

      // Room exists now: let the caller key any hand-off state to this exact id
      // before we navigate into it.
      options.onRoomCreated?.(data.roomId)

      const params = new URLSearchParams()
      if (options.themeId) {
        params.set('theme', options.themeId)
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
      setWakingMessage(null)
    }
  }

  function clearError() {
    setError(null)
  }

  return { phase, isCreating, wakingMessage, error, createRoom, clearError }
}
