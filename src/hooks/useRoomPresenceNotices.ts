import { useCallback, useEffect, useRef, useState } from 'react'
import type { PlayerInfo } from '../lib/multiplayerMessages'
import { useMultiplayerStore } from '../store/useMultiplayerStore'

export type PresenceNoticeKind = 'join' | 'leave' | 'disconnect' | 'reconnect'

export interface PresenceNotice {
  /** Unique per emitted notice (a player may join/leave repeatedly). */
  id: string
  kind: PresenceNoticeKind
  playerId: string
  displayName: string
  color: string
}

export interface PresenceChange {
  kind: PresenceNoticeKind
  player: PlayerInfo
}

/** How long a join/leave notice stays on screen before auto-dismissing. */
export const PRESENCE_NOTICE_DURATION_MS = 3500

/**
 * Diffs two roster snapshots into join/leave changes.
 *
 * Joins read from `next` (fresh info); leaves read from `prev` (the player is
 * gone from `next`, so their name/color must come from the last known state).
 * The local player is never announced — you don't need a toast about yourself.
 */
export function computePresenceChanges(
  prev: Map<string, PlayerInfo>,
  next: Map<string, PlayerInfo>,
  localPlayerId: string | null,
): PresenceChange[] {
  const changes: PresenceChange[] = []

  for (const [id, player] of next) {
    if (id === localPlayerId) continue
    if (!prev.has(id)) {
      changes.push({ kind: 'join', player })
      continue
    }
    const previous = prev.get(id)
    if (previous?.connected !== false && player.connected === false) {
      changes.push({ kind: 'disconnect', player })
    } else if (previous?.connected === false && player.connected !== false) {
      changes.push({ kind: 'reconnect', player })
    }
  }

  for (const [id, player] of prev) {
    if (id === localPlayerId) continue
    if (!next.has(id)) {
      changes.push({ kind: 'leave', player })
    }
  }

  return changes
}

function createNoticeId(kind: PresenceNoticeKind, playerId: string): string {
  return `${kind}-${playerId}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`
}

/**
 * Watches the multiplayer roster and produces transient join/leave notices.
 *
 * The initial roster population (from `room_state`) is treated as the baseline
 * and never announced; only subsequent changes emit notices. Each notice
 * auto-dismisses after {@link PRESENCE_NOTICE_DURATION_MS}.
 */
export function useRoomPresenceNotices(): {
  notices: PresenceNotice[]
  dismiss: (id: string) => void
} {
  const players = useMultiplayerStore((s) => s.players)
  const localPlayerId = useMultiplayerStore((s) => s.localPlayerId)

  const [notices, setNotices] = useState<PresenceNotice[]>([])
  const prevPlayersRef = useRef<Map<string, PlayerInfo> | null>(null)
  const timersRef = useRef<ReturnType<typeof setTimeout>[]>([])

  const dismiss = useCallback((id: string) => {
    setNotices((current) => current.filter((n) => n.id !== id))
  }, [])

  useEffect(() => {
    const prev = prevPlayersRef.current
    prevPlayersRef.current = players

    // Skip the initial population: existing players are the baseline, not joins.
    if (prev === null) return

    const changes = computePresenceChanges(prev, players, localPlayerId)
    if (changes.length === 0) return

    const added: PresenceNotice[] = changes.map((change) => ({
      id: createNoticeId(change.kind, change.player.id),
      kind: change.kind,
      playerId: change.player.id,
      displayName: change.player.displayName,
      color: change.player.color,
    }))

    setNotices((current) => [...current, ...added])

    for (const notice of added) {
      const timer = setTimeout(() => {
        setNotices((current) => current.filter((n) => n.id !== notice.id))
      }, PRESENCE_NOTICE_DURATION_MS)
      timersRef.current.push(timer)
    }
  }, [players, localPlayerId])

  // Clear any outstanding dismissal timers on unmount.
  useEffect(() => {
    const timers = timersRef.current
    return () => {
      for (const timer of timers) clearTimeout(timer)
    }
  }, [])

  return { notices, dismiss }
}
