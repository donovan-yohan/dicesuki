import { act, renderHook } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { useSnapshotInterpolation } from './useSnapshotInterpolation'
import { useMultiplayerStore } from '../store/useMultiplayerStore'

const { callbacks } = vi.hoisted(() => ({ callbacks: [] as { callback: () => void; priority: number }[] }))
vi.mock('@react-three/fiber', () => ({ useFrame: (callback: () => void, priority = 0) => callbacks.push({ callback, priority }) }))

describe('shared snapshot interpolation clock', () => {
  it('updates before visual consumers so dice and grass read the same current interpolation', () => {
    callbacks.length = 0
    const now = vi.spyOn(performance, 'now').mockReturnValue(1050)
    useMultiplayerStore.setState({ lastSnapshotTime: 1000, snapshotInterval: 100 })
    const { result, unmount } = renderHook(() => useSnapshotInterpolation())
    expect(callbacks[0].priority).toBeLessThan(0)
    act(() => callbacks[0].callback())
    expect(result.current.current).toBe(0.5)
    now.mockReturnValue(1500)
    act(() => callbacks[0].callback())
    expect(result.current.current).toBe(1)
    unmount()
    now.mockRestore()
  })
})
