import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { MotionControl, RoomSettings } from '../lib/multiplayerMessages'
import { useMultiplayerStore } from '../store/useMultiplayerStore'
import {
  MOTION_CONTROL_LABELS,
  MOTION_NOTICE_DURATION_MS,
  useRoomMotionNotices,
} from './useRoomMotionNotices'

function setMotionMode(mode: MotionControl | undefined) {
  const settings: RoomSettings = mode === undefined
    ? { version: 1 }
    : { version: 1, motionControl: mode }
  useMultiplayerStore.setState({ roomSettings: settings })
}

describe('useRoomMotionNotices', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    useMultiplayerStore.getState().reset()
  })

  afterEach(() => {
    vi.useRealTimers()
    useMultiplayerStore.getState().reset()
  })

  it('does not announce the initial motion mode', () => {
    setMotionMode('room')
    const { result } = renderHook(() => useRoomMotionNotices())
    expect(result.current.notices).toHaveLength(0)
  })

  it('emits a notice when the host changes the motion mode', () => {
    setMotionMode('own_dice')
    const { result } = renderHook(() => useRoomMotionNotices())

    act(() => {
      setMotionMode('room')
    })

    expect(result.current.notices).toHaveLength(1)
    expect(result.current.notices[0]).toMatchObject({ mode: 'room' })
    expect(result.current.notices[0].message).toContain(MOTION_CONTROL_LABELS.room)
  })

  it('treats an absent setting as the default and only notices real changes', () => {
    // Baseline unset === default 'own_dice'; switching to own_dice explicitly is a no-op.
    setMotionMode(undefined)
    const { result } = renderHook(() => useRoomMotionNotices())

    act(() => {
      setMotionMode('own_dice')
    })
    expect(result.current.notices).toHaveLength(0)

    act(() => {
      setMotionMode('off')
    })
    expect(result.current.notices).toHaveLength(1)
    expect(result.current.notices[0].mode).toBe('off')
  })

  it('auto-dismisses a notice after the duration', () => {
    setMotionMode('own_dice')
    const { result } = renderHook(() => useRoomMotionNotices())

    act(() => {
      setMotionMode('off')
    })
    expect(result.current.notices).toHaveLength(1)

    act(() => {
      vi.advanceTimersByTime(MOTION_NOTICE_DURATION_MS + 10)
    })
    expect(result.current.notices).toHaveLength(0)
  })

  it('dismisses a notice on demand', () => {
    setMotionMode('own_dice')
    const { result } = renderHook(() => useRoomMotionNotices())
    act(() => {
      setMotionMode('room')
    })
    const id = result.current.notices[0].id

    act(() => {
      result.current.dismiss(id)
    })
    expect(result.current.notices).toHaveLength(0)
  })
})
