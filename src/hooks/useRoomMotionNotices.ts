import { useCallback, useEffect, useRef, useState } from 'react'
import type { MotionControl } from '../lib/multiplayerMessages'
import { getMotionControl } from '../lib/multiplayerMessages'
import { useMultiplayerStore } from '../store/useMultiplayerStore'

/** Human-readable labels for each motion-control policy, shared by the host
 *  settings control and the in-room change notices. */
export const MOTION_CONTROL_LABELS: Record<MotionControl, string> = {
  off: 'Off',
  own_dice: 'Own dice only',
  room: 'Whole room',
}

/** Short explanation of what each policy does, for the host settings UI. */
export const MOTION_CONTROL_DESCRIPTIONS: Record<MotionControl, string> = {
  off: 'Motion input is disabled for everyone.',
  own_dice: 'Your shake only affects your own dice.',
  room: 'Anyone’s shake affects every die on the table.',
}

/** Ordered options for a three-state control. */
export const MOTION_CONTROL_OPTIONS: MotionControl[] = ['off', 'own_dice', 'room']

export interface MotionNotice {
  /** Unique per emitted notice. */
  id: string
  mode: MotionControl
  message: string
}

/** How long a motion-mode notice stays on screen before auto-dismissing. */
export const MOTION_NOTICE_DURATION_MS = 3500

function createNoticeId(mode: MotionControl): string {
  return `motion-${mode}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`
}

/**
 * Watches the room's `motionControl` policy and produces a transient notice
 * whenever it changes, so every player understands a shift in behavior.
 *
 * The initial policy (from `room_state`) is the baseline and is never announced;
 * only subsequent changes emit a notice. Each notice auto-dismisses after
 * {@link MOTION_NOTICE_DURATION_MS}. This is the RoomNotices (#69) seam for
 * host-driven room setting changes.
 */
export function useRoomMotionNotices(): {
  notices: MotionNotice[]
  dismiss: (id: string) => void
} {
  const roomSettings = useMultiplayerStore((s) => s.roomSettings)
  const mode = getMotionControl(roomSettings)

  const [notices, setNotices] = useState<MotionNotice[]>([])
  const prevModeRef = useRef<MotionControl | null>(null)
  const timersRef = useRef<ReturnType<typeof setTimeout>[]>([])

  const dismiss = useCallback((id: string) => {
    setNotices((current) => current.filter((n) => n.id !== id))
  }, [])

  useEffect(() => {
    const prev = prevModeRef.current
    prevModeRef.current = mode

    // Skip the initial policy: it's the baseline, not a change.
    if (prev === null || prev === mode) return

    const notice: MotionNotice = {
      id: createNoticeId(mode),
      mode,
      message: `Motion mode: ${MOTION_CONTROL_LABELS[mode]}`,
    }
    setNotices((current) => [...current, notice])

    const timer = setTimeout(() => {
      setNotices((current) => current.filter((n) => n.id !== notice.id))
    }, MOTION_NOTICE_DURATION_MS)
    timersRef.current.push(timer)
  }, [mode])

  // Clear any outstanding dismissal timers on unmount.
  useEffect(() => {
    const timers = timersRef.current
    return () => {
      for (const timer of timers) clearTimeout(timer)
    }
  }, [])

  return { notices, dismiss }
}
