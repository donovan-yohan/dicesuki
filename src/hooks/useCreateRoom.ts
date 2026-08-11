import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  checkRoomServerReadiness,
  getRoomServerConfig,
  type RoomServerMode,
  type RoomServerReadinessState,
} from '../lib/multiplayerServer'
import { COLDSTART_WAKING_BODY } from '../lib/coldStartWait'

/**
 * `'waking'` is the phase-2 stage of the staged cold-start wait: we have been
 * polling for 30s+ and now say plainly that the free-tier server is asleep.
 */
type CreateRoomPhase = 'idle' | 'checking' | 'waking' | 'creating'

export interface CreateRoomError {
  kind: Exclude<RoomServerReadinessState, 'ready' | 'aborted'> | 'create-failed'
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
   * User-facing cold-start message while the staged wait rides out a sleeping
   * public server; null outside phase 2.
   */
  wakingMessage: string | null
  /** Seconds elapsed in the current staged wait, for a progress hint. */
  waitElapsedSeconds: number
  error: CreateRoomError | null
  createRoom: () => Promise<void>
  clearError: () => void
}

/**
 * Hook that handles creating a multiplayer room via the server REST API
 * and navigating to the room page on success.
 *
 * Readiness runs the staged cold-start wait (`coldStartWait.ts`) so a sleeping
 * Render free-tier server is woken rather than reported dead: ordinary
 * "checking" for 30s, honest cold-start copy up to ~3 minutes, and an automatic
 * hand-off into creation the moment /health answers.
 */
export function useCreateRoom(options: UseCreateRoomOptions = {}): UseCreateRoomResult {
  const navigate = useNavigate()
  const [phase, setPhase] = useState<CreateRoomPhase>('idle')
  const [wakingMessage, setWakingMessage] = useState<string | null>(null)
  const [waitElapsedSeconds, setWaitElapsedSeconds] = useState(0)
  const [error, setError] = useState<CreateRoomError | null>(null)
  const mode = options.mode || 'public'
  const config = getRoomServerConfig(mode)
  const isCreating = phase !== 'idle'

  // Guard every post-await setState: a 3-minute wait easily outlives the panel.
  const mountedRef = useRef(true)
  const abortRef = useRef<AbortController | null>(null)
  // Only the newest call may drive the UI. Without this, a second createRoom()
  // started while the first is still waiting has its phase clobbered back to
  // 'idle' by the first call's `finally` — the panel would look ready while a
  // wait was still running. The `fetch`-and-navigate tail has no abort signal
  // of its own, so a generation check is the guard that covers every await.
  const runIdRef = useRef(0)
  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
      abortRef.current?.abort()
    }
  }, [])

  async function createRoom(): Promise<void> {
    // Re-entry supersedes the in-flight attempt: stop its polling immediately
    // rather than leaving two waits hammering /health.
    abortRef.current?.abort()
    const runId = ++runIdRef.current
    const isCurrent = () => mountedRef.current && runIdRef.current === runId
    const controller = new AbortController()
    abortRef.current = controller
    setPhase('checking')
    setWakingMessage(null)
    setWaitElapsedSeconds(0)
    setError(null)
    try {
      const readiness = await checkRoomServerReadiness(config, {
        signal: controller.signal,
        // Drive the staged UI: phase 1 keeps the plain spinner, phase 2 admits
        // the server is asleep and shows elapsed time (#109 follow-up).
        onProgress: ({ phase: waitPhase, elapsedMs }) => {
          if (!isCurrent()) return
          setPhase(waitPhase === 'waking' ? 'waking' : 'checking')
          setWaitElapsedSeconds(Math.floor(elapsedMs / 1000))
          setWakingMessage(waitPhase === 'waking' ? COLDSTART_WAKING_BODY : null)
        },
      })
      if (!isCurrent() || readiness.state === 'aborted') return
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

      // Ready — continue automatically into creation, no extra click.
      setPhase('creating')
      const response = await fetch(`${config.httpUrl}/api/rooms`, { method: 'POST' })
      if (!response.ok) {
        throw new Error('Failed to create room')
      }
      const data = await response.json() as { roomId?: unknown }
      if (typeof data.roomId !== 'string') {
        throw new Error('Room server response did not include a roomId')
      }
      // A superseded attempt must not stash carry state or navigate — that
      // would hand the newer attempt's room off to the stale one's setup.
      if (!isCurrent()) return

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
      if (!isCurrent()) return
      console.error('Failed to create room:', err)
      setError({
        kind: 'create-failed',
        title: 'Could not create room',
        message: `The ${config.label.toLowerCase()} is reachable, but room creation failed. Try again or restart the room server.`,
        command: config.startCommand,
      })
    } finally {
      // Only the newest attempt may return the panel to idle; a superseded one
      // must leave the live attempt's phase alone.
      if (isCurrent()) {
        setPhase('idle')
        setWakingMessage(null)
        setWaitElapsedSeconds(0)
      }
      if (abortRef.current === controller) abortRef.current = null
    }
  }

  function clearError() {
    setError(null)
  }

  return { phase, isCreating, wakingMessage, waitElapsedSeconds, error, createRoom, clearError }
}
