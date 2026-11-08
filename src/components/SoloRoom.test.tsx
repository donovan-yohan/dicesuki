import { StrictMode } from 'react'
import { act, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { EngineConfig } from '../lib/multiplayerMessages'
import { useMultiplayerStore } from '../store/useMultiplayerStore'
import { SoloRoom } from './SoloRoom'
import { useSettingsStore } from '../store/useSettingsStore'
import { useAuthStore } from '../store/useAuthStore'
import { useInventoryStore } from '../store/useInventoryStore'
import { SOLO_WORKER_SERVER_URL } from '../store/useMultiplayerStore'

vi.mock('./Scene', () => ({
  // `onReady` stands in for the renderer's first-frame signal, so a test can
  // drive the splash handover without a WebGL context.
  default: ({ onReady }: { onReady?: () => void }) => (
    <div data-testid="mock-scene">
      <button type="button" data-testid="mock-scene-ready" onClick={() => onReady?.()} />
    </div>
  ),
}))

describe('SoloRoom startup', () => {
  beforeEach(() => {
    localStorage.clear()
    useAuthStore.setState({ status: 'guest', user: null })
    useInventoryStore.getState().reset()
    useSettingsStore.getState().setThemeId('default')
    useMultiplayerStore.getState().reset()
    useMultiplayerStore.setState({ connectionStatus: 'connecting' })
  })

  afterEach(() => {
    act(() => useMultiplayerStore.getState().reset())
    vi.restoreAllMocks()
  })

  it('seeds the remembered monster theme D20 through native spawn, not an owned/default die', () => {
    useSettingsStore.getState().setThemeId('monster-dungeon')
    const send = vi.fn()
    const { unmount } = render(<SoloRoom />)
    act(() => useMultiplayerStore.setState({
      connectionStatus: 'connected', localPlayerId: 'p1', roomId: 'solo',
      serverUrl: SOLO_WORKER_SERVER_URL,
      socket: { send, close: vi.fn() } as unknown as WebSocket,
      engineConfig: { arenaHalfX: 4.5, arenaHalfZ: 8 } as unknown as EngineConfig,
    }))
    expect(JSON.parse(send.mock.calls[0][0]).dice[0].presentation).toMatchObject({
      customAssetId: 'monster-dungeon-set/d20',
    })
    expect(useMultiplayerStore.getState().dice.size).toBe(0)
    unmount()
  })

  it('restores a saved mixed loadout through spawn without seeding or applying results', () => {
    localStorage.setItem('dicesuki-solo-table:v1:guest', JSON.stringify({ version: 1, dice: [
      { shape: 'd6', presentation: { basic: true } },
      { shape: 'd8', presentation: { basic: true } },
    ] }))
    const send = vi.fn()
    const { unmount } = render(<SoloRoom />)
    act(() => useMultiplayerStore.setState({
      connectionStatus: 'connected', localPlayerId: 'p1', roomId: 'solo',
      serverUrl: SOLO_WORKER_SERVER_URL,
      socket: { send, close: vi.fn() } as unknown as WebSocket,
      engineConfig: { arenaHalfX: 4.5, arenaHalfZ: 8 } as unknown as EngineConfig,
    }))
    const entries = send.mock.calls.map(([raw]) => JSON.parse(raw)).filter(m => m.type === 'spawn_dice').flatMap(m => m.dice)
    expect(entries.map(d => d.diceType)).toEqual(['d6', 'd8'])
    expect(entries.every(d => !('position' in d) && !('rotation' in d) && !('faceValue' in d))).toBe(true)
    expect(useMultiplayerStore.getState().dice.size).toBe(0)
    unmount()
  })

  it('persists only acknowledged local dice and keeps deliberate clear across teardown', () => {
    const key = 'dicesuki-solo-table:v1:guest'
    const send = vi.fn()
    const { unmount } = render(<SoloRoom />)
    act(() => useMultiplayerStore.setState({
      connectionStatus: 'connected', localPlayerId: 'p1', roomId: 'solo',
      serverUrl: SOLO_WORKER_SERVER_URL,
      socket: { send, close: vi.fn() } as unknown as WebSocket,
      engineConfig: { arenaHalfX: 4.5, arenaHalfZ: 8 } as unknown as EngineConfig,
    }))
    expect(localStorage.getItem(key)).toBeNull()
    const request = JSON.parse(send.mock.calls[0][0]).dice[0]
    act(() => useMultiplayerStore.getState().handleServerMessage({
      type: 'dice_spawned', ownerId: 'p1', dice: [{ ...request, ownerId: 'p1', position: [0, 3, 0], rotation: [0, 0, 0, 1] }],
    }))
    expect(JSON.parse(localStorage.getItem(key)!).dice).toEqual([{ shape: 'd20', presentation: request.presentation }])
    const raw = localStorage.getItem(key)
    act(() => useMultiplayerStore.getState().handleServerMessage({
      type: 'physics_snapshot', tick: 1, dice: [{ id: request.id, p: [1, 1, 1], r: [0, 1, 0, 0] }],
    }))
    expect(localStorage.getItem(key)).toBe(raw)
    act(() => useMultiplayerStore.getState().handleServerMessage({ type: 'dice_removed', diceIds: [request.id] }))
    expect(JSON.parse(localStorage.getItem(key)!).dice).toEqual([])
    unmount()
    expect(JSON.parse(localStorage.getItem(key)!).dice).toEqual([])
  })

  it('reconnects the StrictMode worker before one accepted restoration and preserves the record on unmount', () => {
    const key = 'dicesuki-solo-table:v1:guest'
    const raw = JSON.stringify({ version: 1, dice: [{ shape: 'd6', presentation: { basic: true } }] })
    localStorage.setItem(key, raw)
    const originalConnect = useMultiplayerStore.getState().connect
    const send = vi.fn()
    const connect = vi.fn(() => useMultiplayerStore.setState({
      connectionStatus: 'connecting', roomId: 'solo', serverUrl: SOLO_WORKER_SERVER_URL,
      socket: { send, close: vi.fn() } as unknown as WebSocket,
    }))
    useMultiplayerStore.setState({ connectionStatus: 'disconnected', connect })
    try {
      const { unmount } = render(<StrictMode><SoloRoom /></StrictMode>)
      // Worker room_state arrives asynchronously, after StrictMode's retired setup.
      act(() => useMultiplayerStore.setState({ connectionStatus: 'connected', localPlayerId: 'p1', engineConfig: {} as EngineConfig }))
      const requests = send.mock.calls.map(([value]) => JSON.parse(value)).filter(m => m.type === 'spawn_dice').flatMap(m => m.dice)
      expect(connect).toHaveBeenCalledTimes(2)
      expect(requests.map(d => d.diceType)).toEqual(['d6'])
      act(() => useMultiplayerStore.getState().handleServerMessage({ type: 'dice_spawned', ownerId: 'p1', dice: requests.map(d => ({ ...d, ownerId: 'p1', position: [0, 2, 0], rotation: [0, 0, 0, 1] })) }))
      expect(localStorage.getItem(key)).toBe(raw)
      unmount()
      expect(localStorage.getItem(key)).toBe(raw)
    } finally {
      useMultiplayerStore.setState({ connect: originalConnect })
    }
  })

  it('uses the branded engine splash while the local room connects', () => {
    const { unmount } = render(<SoloRoom />)

    expect(screen.getByTestId('startup-splash')).toHaveAttribute('data-phase', 'engine')
    expect(screen.getByRole('img', { name: 'Dicesuki' })).toHaveAttribute(
      'src',
      '/brand/dicesuki-wordmark.svg',
    )

    act(() => unmount())
  })

  it('publishes the splash handover as data-table-revealed', () => {
    vi.useFakeTimers()
    try {
      const { unmount } = render(<SoloRoom />)

      expect(screen.getByTestId('solo-room-loading')).toHaveAttribute(
        'data-table-revealed',
        'false',
      )

      act(() => {
        useMultiplayerStore.setState({
          connectionStatus: 'connected',
          localPlayerId: 'player-1',
          engineConfig: { arenaHalfX: 4.5, arenaHalfZ: 8 } as unknown as EngineConfig,
        })
      })

      // The room is up but the renderer has not signalled its first frame, so
      // the splash is still covering the table.
      const room = screen.getByTestId('solo-room')
      expect(room).toHaveAttribute('data-table-revealed', 'false')
      expect(screen.getByTestId('startup-splash')).toBeInTheDocument()

      act(() => {
        screen.getByTestId('mock-scene-ready').click()
      })
      act(() => {
        vi.advanceTimersByTime(220)
      })

      expect(room).toHaveAttribute('data-table-revealed', 'true')
      expect(screen.queryByTestId('startup-splash')).not.toBeInTheDocument()

      act(() => unmount())
    } finally {
      vi.useRealTimers()
    }
  })

  it('replaces the splash with an actionable error if startup fails', () => {
    const { unmount } = render(<SoloRoom />)

    act(() => {
      useMultiplayerStore.setState({
        connectionStatus: 'disconnected',
        connectionError: 'The worker could not start.',
      })
    })

    expect(screen.getByRole('alert')).toHaveTextContent('Couldn’t start your table')
    expect(screen.getByRole('alert')).toHaveTextContent('The worker could not start.')
    expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument()
    expect(screen.queryByTestId('startup-splash')).not.toBeInTheDocument()

    act(() => unmount())
  })
})
