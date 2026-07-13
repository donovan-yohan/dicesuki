import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { PlayerInfo } from '../lib/multiplayerMessages'
import { useMultiplayerStore } from '../store/useMultiplayerStore'
import {
  computePresenceChanges,
  PRESENCE_NOTICE_DURATION_MS,
  useRoomPresenceNotices,
} from './useRoomPresenceNotices'

const player = (id: string, name = id, color = '#8B5CF6'): PlayerInfo => ({
  id,
  displayName: name,
  color,
})

function setRoster(players: PlayerInfo[], localPlayerId: string | null) {
  const map = new Map<string, PlayerInfo>()
  for (const p of players) map.set(p.id, p)
  useMultiplayerStore.setState({ players: map, localPlayerId })
}

describe('computePresenceChanges', () => {
  it('reports a join when a new player appears', () => {
    // Arrange
    const prev = new Map([['a', player('a')]])
    const next = new Map([['a', player('a')], ['b', player('b', 'Bob')]])

    // Act
    const changes = computePresenceChanges(prev, next, 'a')

    // Assert
    expect(changes).toEqual([{ kind: 'join', player: player('b', 'Bob') }])
  })

  it('reports a leave using the previous roster info', () => {
    // Arrange
    const prev = new Map([['a', player('a')], ['b', player('b', 'Bob', '#ff0000')]])
    const next = new Map([['a', player('a')]])

    // Act
    const changes = computePresenceChanges(prev, next, 'a')

    // Assert
    expect(changes).toEqual([
      { kind: 'leave', player: player('b', 'Bob', '#ff0000') },
    ])
  })

  it('never announces the local player', () => {
    // Arrange
    const prev = new Map<string, PlayerInfo>()
    const next = new Map([['me', player('me')]])

    // Act
    const changes = computePresenceChanges(prev, next, 'me')

    // Assert
    expect(changes).toEqual([])
  })

  it('returns nothing when the roster is unchanged', () => {
    const roster = new Map([['a', player('a')]])
    expect(computePresenceChanges(roster, new Map(roster), 'a')).toEqual([])
  })
})

describe('useRoomPresenceNotices', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    useMultiplayerStore.getState().reset()
  })

  afterEach(() => {
    vi.useRealTimers()
    useMultiplayerStore.getState().reset()
  })

  it('does not announce the initial roster population', () => {
    // Arrange: roster already populated before the hook mounts
    setRoster([player('a'), player('b', 'Bob')], 'a')

    // Act
    const { result } = renderHook(() => useRoomPresenceNotices())

    // Assert
    expect(result.current.notices).toHaveLength(0)
  })

  it('emits a join notice when a remote player joins', () => {
    // Arrange
    setRoster([player('a')], 'a')
    const { result } = renderHook(() => useRoomPresenceNotices())

    // Act
    act(() => {
      setRoster([player('a'), player('b', 'Bob', '#00ff00')], 'a')
    })

    // Assert
    expect(result.current.notices).toHaveLength(1)
    expect(result.current.notices[0]).toMatchObject({
      kind: 'join',
      playerId: 'b',
      displayName: 'Bob',
      color: '#00ff00',
    })
  })

  it('emits a leave notice and auto-dismisses after the duration', () => {
    // Arrange
    setRoster([player('a'), player('b', 'Bob')], 'a')
    const { result } = renderHook(() => useRoomPresenceNotices())

    // Act: player b leaves
    act(() => {
      setRoster([player('a')], 'a')
    })
    expect(result.current.notices).toHaveLength(1)
    expect(result.current.notices[0].kind).toBe('leave')

    // Assert: auto-dismiss after the notice duration
    act(() => {
      vi.advanceTimersByTime(PRESENCE_NOTICE_DURATION_MS + 10)
    })
    expect(result.current.notices).toHaveLength(0)
  })

  it('dismisses a notice on demand', () => {
    // Arrange
    setRoster([player('a')], 'a')
    const { result } = renderHook(() => useRoomPresenceNotices())
    act(() => {
      setRoster([player('a'), player('b', 'Bob')], 'a')
    })
    const id = result.current.notices[0].id

    // Act
    act(() => {
      result.current.dismiss(id)
    })

    // Assert
    expect(result.current.notices).toHaveLength(0)
  })
})
