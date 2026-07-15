import { act, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { StartupGate, StartupSplash } from './StartupSplash'

describe('StartupSplash', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it('renders the stacked brand assets and stage-backed progress', () => {
    render(<StartupSplash phase="room" />)

    expect(screen.getByRole('img', { name: 'Dicesuki' })).toHaveAttribute(
      'src',
      '/brand/dicesuki-wordmark.svg',
    )
    expect(screen.getByRole('progressbar', { name: 'Preparing your table…' })).toHaveAttribute(
      'aria-valuenow',
      '84',
    )
    expect(screen.getByTestId('startup-splash')).toHaveAttribute('data-phase', 'room')
  })

  it('keeps the splash over mounted content until the renderer signals ready', () => {
    vi.useFakeTimers()

    const renderGate = (ready: boolean) => (
      <StartupGate ready={ready} phase="engine" revealDelayMs={220}>
        {(onContentReady) => (
          <button type="button" onClick={onContentReady}>
            Scene mounted
          </button>
        )}
      </StartupGate>
    )

    const { rerender } = render(renderGate(false))
    expect(screen.queryByRole('button', { name: 'Scene mounted' })).not.toBeInTheDocument()
    expect(screen.getByTestId('startup-splash')).toHaveAttribute('data-phase', 'engine')

    rerender(renderGate(true))
    expect(screen.getByRole('button', { name: 'Scene mounted' })).toBeInTheDocument()
    expect(screen.getByTestId('startup-splash')).toHaveAttribute('data-phase', 'rendering')

    fireEvent.click(screen.getByRole('button', { name: 'Scene mounted' }))
    expect(screen.getByTestId('startup-splash')).toHaveAttribute('data-phase', 'ready')

    act(() => vi.advanceTimersByTime(219))
    expect(screen.getByTestId('startup-splash')).toBeInTheDocument()

    act(() => vi.advanceTimersByTime(1))
    expect(screen.queryByTestId('startup-splash')).not.toBeInTheDocument()

    rerender(renderGate(false))
    expect(screen.getByTestId('startup-splash')).toHaveAttribute('data-phase', 'engine')
    expect(screen.queryByRole('button', { name: 'Scene mounted' })).not.toBeInTheDocument()
  })
})
