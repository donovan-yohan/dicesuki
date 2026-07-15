import { act, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { useMultiplayerStore } from '../store/useMultiplayerStore'
import { SoloRoom } from './SoloRoom'

vi.mock('./Scene', () => ({
  default: () => <div data-testid="mock-scene" />,
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

  it('replaces the splash with an actionable error if startup fails', () => {
    const { unmount } = render(<SoloRoom />)

    act(() => {
      useMultiplayerStore.setState({
        connectionStatus: 'error',
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
