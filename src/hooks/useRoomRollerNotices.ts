import { useCallback, useEffect, useRef, useState } from 'react'
import { getRoller } from '../lib/multiplayerMessages'
import { useMultiplayerStore } from '../store/useMultiplayerStore'

export interface RollerNotice {
  /** Unique per emitted notice. */
  id: string
  message: string
}

/** How long a roller-change notice stays on screen before auto-dismissing. */
export const ROLLER_NOTICE_DURATION_MS = 3500

function createNoticeId(): string {
  return `roller-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`
}

/**
 * Watches the room's delegated-roller setting and produces a transient notice
 * whenever it changes — who now holds the dice, or that control has returned to
 * each owner — so every player understands the shift.
 *
 * The initial roller (from `room_state`) is the baseline and is never announced;
 * a persistent badge in the roster covers the standing state. Only subsequent
 * changes emit a notice, each auto-dismissing after
 * {@link ROLLER_NOTICE_DURATION_MS}. This is the RoomNotices (#69) seam for the
 * delegated-roller role (#73).
 */
export function useRoomRollerNotices(): {
  notices: RollerNotice[]
  dismiss: (id: string) => void
} {
  const roomSettings = useMultiplayerStore((s) => s.roomSettings)
  const players = useMultiplayerStore((s) => s.players)
  const localPlayerId = useMultiplayerStore((s) => s.localPlayerId)
  const rollerId = getRoller(roomSettings)

  const [notices, setNotices] = useState<RollerNotice[]>([])
  // `undefined` = not yet initialized (baseline); `null` = no roller assigned.
  const prevRollerRef = useRef<string | null | undefined>(undefined)
  const timersRef = useRef<ReturnType<typeof setTimeout>[]>([])

  const dismiss = useCallback((id: string) => {
    setNotices((current) => current.filter((n) => n.id !== id))
  }, [])

  useEffect(() => {
    const prev = prevRollerRef.current
    prevRollerRef.current = rollerId

    // Skip the initial roller: it's the baseline, not a change.
    if (prev === undefined || prev === rollerId) return

    let message: string
    if (!rollerId) {
      message = 'Everyone controls their own dice again'
    } else if (rollerId === localPlayerId) {
      message = 'You are now rolling for the table'
    } else {
      const name = players.get(rollerId)?.displayName ?? 'Someone'
      message = `${name} is now rolling for the table`
    }

    const notice: RollerNotice = { id: createNoticeId(), message }
    setNotices((current) => [...current, notice])

    const timer = setTimeout(() => {
      setNotices((current) => current.filter((n) => n.id !== notice.id))
    }, ROLLER_NOTICE_DURATION_MS)
    timersRef.current.push(timer)
  }, [rollerId, localPlayerId, players])

  // Clear any outstanding dismissal timers on unmount.
  useEffect(() => {
    const timers = timersRef.current
    return () => {
      for (const timer of timers) clearTimeout(timer)
    }
  }, [])

  return { notices, dismiss }
}
