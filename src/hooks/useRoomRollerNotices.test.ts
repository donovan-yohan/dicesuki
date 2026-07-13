import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { PlayerInfo, RoomSettings } from '../lib/multiplayerMessages'
import { useMultiplayerStore } from '../store/useMultiplayerStore'
import {
  ROLLER_NOTICE_DURATION_MS,
  useRoomRollerNotices,
} from './useRoomRollerNotices'

function player(id: string, name: string): PlayerInfo {
  return { id, displayName: name, color: '#8B5CF6' }
}

function setRoller(rollerId: string | null, localPlayerId = 'a') {
  const settings: RoomSettings = rollerId === null
    ? { version: 1 }
    : { version: 1, roller: rollerId }
  const players = new Map<string, PlayerInfo>([
    ['a', player('a', 'Alice')],
    ['b', player('b', 'Bob')],
  ])
  useMultiplayerStore.setState({ roomSettings: settings, players, localPlayerId })
}

describe('useRoomRollerNotices', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    useMultiplayerStore.getState().reset()
  })

  afterEach(() => {
    vi.useRealTimers()
    useMultiplayerStore.getState().reset()
  })

  it('does not announce the initial roller', () => {
    setRoller('b')
    const { result } = renderHook(() => useRoomRollerNotices())
    expect(result.current.notices).toHaveLength(0)
  })

  it('announces another player taking the dice by name', () => {
    setRoller(null, 'a')
    const { result } = renderHook(() => useRoomRollerNotices())

    act(() => {
      setRoller('b', 'a')
    })

    expect(result.current.notices).toHaveLength(1)
    expect(result.current.notices[0].message).toContain('Bob')
  })

  it('announces in the first person when the local player becomes the roller', () => {
    setRoller(null, 'b')
    const { result } = renderHook(() => useRoomRollerNotices())

    act(() => {
      setRoller('b', 'b')
    })

    expect(result.current.notices[0].message).toMatch(/you are now rolling/i)
  })

  it('announces when control returns to owners', () => {
    setRoller('b', 'a')
    const { result } = renderHook(() => useRoomRollerNotices())

    act(() => {
      setRoller(null, 'a')
    })

    expect(result.current.notices[0].message).toMatch(/own dice again/i)
  })

  it('auto-dismisses a notice after the duration', () => {
    setRoller(null, 'a')
    const { result } = renderHook(() => useRoomRollerNotices())

    act(() => {
      setRoller('b', 'a')
    })
    expect(result.current.notices).toHaveLength(1)

    act(() => {
      vi.advanceTimersByTime(ROLLER_NOTICE_DURATION_MS + 10)
    })
    expect(result.current.notices).toHaveLength(0)
  })
})
