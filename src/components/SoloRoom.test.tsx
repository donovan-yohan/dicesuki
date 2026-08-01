import { act, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { EngineConfig } from '../lib/multiplayerMessages'
import { useMultiplayerStore } from '../store/useMultiplayerStore'
import { SoloRoom } from './SoloRoom'

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
    useMultiplayerStore.getState().reset()
    useMultiplayerStore.setState({ connectionStatus: 'connecting' })
  })

  afterEach(() => {
    useMultiplayerStore.getState().reset()
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
