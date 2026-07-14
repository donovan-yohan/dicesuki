import { fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { ThemeContext } from '../../contexts/ThemeContext'
import { defaultTheme } from '../../themes/tokens'
import type { EngineConfig } from '../../lib/multiplayerMessages'
import { useMultiplayerStore } from '../../store/useMultiplayerStore'
import { RoomSizeControl } from './RoomSizeControl'

function bounds(arenaHalfX: number, arenaHalfZ: number): EngineConfig {
  return { arenaHalfX, arenaHalfZ } as unknown as EngineConfig
}

function renderControl(props: { disabled?: boolean; showAuto?: boolean } = {}) {
  return render(
    <ThemeContext.Provider
      value={{
        currentTheme: defaultTheme,
        setTheme: vi.fn(),
        availableThemes: [defaultTheme],
        ownedThemes: [defaultTheme.id],
        purchaseTheme: vi.fn(async () => true),
      }}
    >
      <RoomSizeControl {...props} />
    </ThemeContext.Provider>,
  )
}

describe('RoomSizeControl', () => {
  beforeEach(() => {
    useMultiplayerStore.getState().reset()
  })
  afterEach(() => {
    useMultiplayerStore.getState().reset()
  })

  it('highlights the active preset from the room bounds and resizes on click', () => {
    const send = vi.fn()
    useMultiplayerStore.setState({
      connectionStatus: 'connected',
      socket: { send } as unknown as WebSocket,
      isHost: true,
      engineConfig: bounds(4.5, 8),
    })

    renderControl()

    // 4.5 x 8 → the 9:16 portrait preset is active.
    expect(screen.getByTestId('arena-preset-9:16')).toHaveAttribute('aria-checked', 'true')
    expect(screen.getByTestId('arena-preset-16:9')).toHaveAttribute('aria-checked', 'false')

    fireEvent.click(screen.getByTestId('arena-preset-16:9'))
    expect(send).toHaveBeenCalledTimes(1)
    expect(JSON.parse(send.mock.calls[0][0])).toEqual({ type: 'set_arena', aspect: 16 / 9 })
  })

  it('is read-only (disabled) for non-hosts', () => {
    useMultiplayerStore.setState({ engineConfig: bounds(6, 6) })
    renderControl({ disabled: true })

    expect(screen.getByTestId('arena-preset-1:1')).toBeDisabled()
    expect(screen.getByTestId('arena-preset-9:16')).toBeDisabled()
    expect(screen.getByText(/host controls/i)).toBeInTheDocument()
  })

  it('offers a Fit-window action when showAuto is set', () => {
    useMultiplayerStore.setState({
      connectionStatus: 'connected',
      socket: { send: vi.fn() } as unknown as WebSocket,
      isHost: true,
      engineConfig: bounds(6, 6),
    })
    renderControl({ showAuto: true })
    expect(screen.getByTestId('arena-preset-fit')).toBeInTheDocument()
  })
})
