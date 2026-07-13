import { fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { ThemeContext } from '../../contexts/ThemeContext'
import type { PlayerInfo } from '../../lib/multiplayerMessages'
import { useMultiplayerStore } from '../../store/useMultiplayerStore'
import { defaultTheme } from '../../themes/tokens'
import { PlayerPanel } from './PlayerPanel'
import { connectionIndicator } from './connectionIndicator'

const player = (id: string, name: string, color = '#8B5CF6'): PlayerInfo => ({
  id,
  displayName: name,
  color,
})

function setRoster(players: PlayerInfo[], opts: {
  localPlayerId: string | null
  hostId: string | null
}) {
  const map = new Map<string, PlayerInfo>()
  for (const p of players) map.set(p.id, p)
  useMultiplayerStore.setState({
    players: map,
    localPlayerId: opts.localPlayerId,
    hostId: opts.hostId,
    roomId: 'ROOM42',
    connectionStatus: 'connected',
  })
}

function renderPanel() {
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
      <PlayerPanel isOpen />
    </ThemeContext.Provider>,
  )
}

describe('connectionIndicator', () => {
  it('maps each status to a distinct label', () => {
    expect(connectionIndicator('connected').label).toBe('Connected')
    expect(connectionIndicator('connecting').label).toBe('Connecting')
    expect(connectionIndicator('error').label).toBe('Connection error')
    expect(connectionIndicator('disconnected').label).toBe('Disconnected')
  })
})

describe('PlayerPanel roster', () => {
  beforeEach(() => {
    useMultiplayerStore.getState().reset()
  })

  afterEach(() => {
    useMultiplayerStore.getState().reset()
  })

  it('lists every player with name, host badge, and a You tag for the local player', () => {
    // Arrange
    setRoster([player('a', 'Alice'), player('b', 'Bob')], {
      localPlayerId: 'b',
      hostId: 'a',
    })

    // Act
    renderPanel()

    // Assert
    expect(screen.getByText('Alice')).toBeInTheDocument()
    expect(screen.getByText('Bob')).toBeInTheDocument()
    expect(screen.getByText('(You)')).toBeInTheDocument()
    // Host badge is announced on Alice's row via aria-label
    expect(
      screen.getByRole('button', { name: /filter by alice, host/i }),
    ).toBeInTheDocument()
    // Host label appears exactly once
    expect(screen.getAllByLabelText('Host')).toHaveLength(1)
  })

  it('renders a connection indicator for each player', () => {
    // Arrange
    setRoster([player('a', 'Alice'), player('b', 'Bob')], {
      localPlayerId: 'b',
      hostId: 'a',
    })

    // Act
    renderPanel()

    // Assert: both players show a Connected dot
    expect(screen.getAllByLabelText('Connected')).toHaveLength(2)
  })

  it('toggles the player filter when a roster row is clicked', () => {
    // Arrange
    setRoster([player('a', 'Alice')], { localPlayerId: 'a', hostId: 'a' })
    renderPanel()

    // Act
    fireEvent.click(screen.getByRole('button', { name: /filter by alice/i }))

    // Assert
    expect(useMultiplayerStore.getState().selectedPlayerId).toBe('a')

    // Act again: clicking the same row clears the filter
    fireEvent.click(screen.getByRole('button', { name: /filter by alice/i }))
    expect(useMultiplayerStore.getState().selectedPlayerId).toBeNull()
  })
})

describe('PlayerPanel motion control', () => {
  beforeEach(() => {
    useMultiplayerStore.getState().reset()
  })

  afterEach(() => {
    useMultiplayerStore.getState().reset()
  })

  it('lets the host pick a motion mode and sends it to the server', () => {
    // Arrange: local player is the host with a connected socket.
    const send = vi.fn()
    setRoster([player('a', 'Alice')], { localPlayerId: 'a', hostId: 'a' })
    useMultiplayerStore.setState({
      isHost: true,
      roomSettings: { version: 1 },
      socket: { send } as unknown as WebSocket,
    })
    renderPanel()

    // Act: choose the whole-room policy.
    fireEvent.click(screen.getByRole('radio', { name: /whole room/i }))

    // Assert
    expect(send).toHaveBeenCalledTimes(1)
    const payload = JSON.parse(send.mock.calls[0][0])
    expect(payload).toEqual({
      type: 'update_settings',
      settings: { version: 1, motionControl: 'room' },
    })
  })

  it('shows the current mode read-only for non-hosts', () => {
    // Arrange: local player is not the host.
    setRoster([player('a', 'Alice'), player('b', 'Bob')], {
      localPlayerId: 'b',
      hostId: 'a',
    })
    useMultiplayerStore.setState({
      isHost: false,
      roomSettings: { version: 1, motionControl: 'off' },
    })
    renderPanel()

    // Assert: the active option reflects the current mode and controls are disabled.
    const off = screen.getByRole('radio', { name: /^off$/i })
    expect(off).toHaveAttribute('aria-checked', 'true')
    expect(off).toBeDisabled()
    expect(screen.getByRole('radio', { name: /whole room/i })).toBeDisabled()
  })
})

describe('PlayerPanel delegated roller', () => {
  beforeEach(() => {
    useMultiplayerStore.getState().reset()
  })

  afterEach(() => {
    useMultiplayerStore.getState().reset()
  })

  it('lets the host hand the dice to a player and sends it to the server', () => {
    // Arrange
    const send = vi.fn()
    setRoster([player('a', 'Alice'), player('b', 'Bob')], {
      localPlayerId: 'a',
      hostId: 'a',
    })
    useMultiplayerStore.setState({
      isHost: true,
      roomSettings: { version: 1 },
      socket: { send } as unknown as WebSocket,
    })
    renderPanel()

    // Act: give Bob the dice.
    fireEvent.click(screen.getByRole('button', { name: /make bob the roller/i }))

    // Assert
    expect(send).toHaveBeenCalledTimes(1)
    const payload = JSON.parse(send.mock.calls[0][0])
    expect(payload).toEqual({
      type: 'update_settings',
      settings: { version: 1, roller: 'b' },
    })
  })

  it('shows who holds the dice and lets the host revoke', () => {
    // Arrange: Bob is already the roller.
    const send = vi.fn()
    setRoster([player('a', 'Alice'), player('b', 'Bob')], {
      localPlayerId: 'a',
      hostId: 'a',
    })
    useMultiplayerStore.setState({
      isHost: true,
      roomSettings: { version: 1, roller: 'b' },
      socket: { send } as unknown as WebSocket,
    })
    renderPanel()

    // Assert: everyone sees a single "rolling" badge (on Bob's row).
    expect(screen.getByLabelText('Rolling for the table')).toBeInTheDocument()

    // Act: host revokes via Bob's now-active toggle.
    fireEvent.click(screen.getByRole('button', { name: /revoke roller from bob/i }))

    // Assert: revocation clears the roller field.
    const payload = JSON.parse(send.mock.calls[0][0])
    expect(payload).toEqual({ type: 'update_settings', settings: { version: 1 } })
  })

  it('shows the roller badge to non-hosts but no assignment controls', () => {
    // Arrange: local player is not the host; Alice holds the dice.
    setRoster([player('a', 'Alice'), player('b', 'Bob')], {
      localPlayerId: 'b',
      hostId: 'a',
    })
    useMultiplayerStore.setState({
      isHost: false,
      roomSettings: { version: 1, roller: 'a' },
    })
    renderPanel()

    // Assert: the badge is visible, but non-hosts get no assign/revoke buttons.
    expect(screen.getByLabelText('Rolling for the table')).toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: /make .* the roller/i }),
    ).not.toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: /revoke roller/i }),
    ).not.toBeInTheDocument()
  })
})

describe('PlayerPanel room theme', () => {
  beforeEach(() => {
    useMultiplayerStore.getState().reset()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('lets the host pick a shared room theme and sends it to the server', () => {
    // Arrange
    const send = vi.fn()
    setRoster([player('a', 'Alice')], { localPlayerId: 'a', hostId: 'a' })
    useMultiplayerStore.setState({
      isHost: true,
      roomSettings: { version: 1 },
      socket: { send } as unknown as WebSocket,
    })
    renderPanel()

    // Act: host selects the neon theme.
    fireEvent.change(screen.getByTestId('room-theme-select'), {
      target: { value: 'neon-cyber-city' },
    })

    // Assert: the choice goes out as a host settings mutation.
    expect(send).toHaveBeenCalledTimes(1)
    const payload = JSON.parse(send.mock.calls[0][0])
    expect(payload).toEqual({
      type: 'update_settings',
      settings: { version: 1, themeId: 'neon-cyber-city' },
    })
  })

  it('reflects the active room theme and clears back to per-player', () => {
    const send = vi.fn()
    setRoster([player('a', 'Alice')], { localPlayerId: 'a', hostId: 'a' })
    useMultiplayerStore.setState({
      isHost: true,
      roomSettings: { version: 1, themeId: 'fantasy-earth' },
      socket: { send } as unknown as WebSocket,
    })
    renderPanel()

    const select = screen.getByTestId('room-theme-select') as HTMLSelectElement
    expect(select.value).toBe('fantasy-earth')

    // Act: clear back to "each player's own".
    fireEvent.change(select, { target: { value: '' } })
    const payload = JSON.parse(send.mock.calls[0][0])
    expect(payload).toEqual({ type: 'update_settings', settings: { version: 1 } })
  })

  it('disables the theme selector for non-hosts', () => {
    setRoster([player('a', 'Alice'), player('b', 'Bob')], {
      localPlayerId: 'b',
      hostId: 'a',
    })
    useMultiplayerStore.setState({
      isHost: false,
      roomSettings: { version: 1, themeId: 'neon-cyber-city' },
    })
    renderPanel()

    const select = screen.getByTestId('room-theme-select') as HTMLSelectElement
    expect(select.disabled).toBe(true)
    // Non-hosts still see the room's current theme reflected.
    expect(select.value).toBe('neon-cyber-city')
  })
})
