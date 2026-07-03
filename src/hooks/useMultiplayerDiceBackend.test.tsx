import { act, renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useInventoryStore } from '../store/useInventoryStore'
import { useMultiplayerStore } from '../store/useMultiplayerStore'
import { useMultiplayerDiceBackend } from './useMultiplayerDiceBackend'

function addOwnedD20(id = 'owned-d20') {
  return useInventoryStore.getState().addDie({
    id,
    type: 'd20',
    setId: 'starter',
    rarity: 'common',
    appearance: {
      baseColor: '#8b5cf6',
      accentColor: '#ffffff',
      material: 'plastic',
    },
    vfx: {},
    name: 'Owned D20',
    isFavorite: false,
    isLocked: false,
    source: 'starter',
  })
}

describe('useMultiplayerDiceBackend', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    useInventoryStore.getState().reset()
    useMultiplayerStore.getState().reset()
  })

  it('blocks a rapid repeated owned inventory spawn before server acknowledgement', () => {
    addOwnedD20()
    const send = vi.fn()
    useMultiplayerStore.setState({
      connectionStatus: 'connected',
      socket: { send } as unknown as WebSocket,
      localPlayerId: 'p1',
    })

    const { result } = renderHook(() => useMultiplayerDiceBackend())

    act(() => {
      result.current.addDie('d20')
      result.current.addDie('d20')
    })

    expect(send).toHaveBeenCalledTimes(1)
    const payload = JSON.parse(send.mock.calls[0][0])
    expect(payload.dice[0].presentation.inventoryDieId).toBe('owned-d20')
    expect(useMultiplayerStore.getState().pendingInventoryDieIds.has('owned-d20')).toBe(true)
  })

  it('blocks a rapid repeated explicit inventory die spawn before server acknowledgement', () => {
    addOwnedD20()
    const send = vi.fn()
    useMultiplayerStore.setState({
      connectionStatus: 'connected',
      socket: { send } as unknown as WebSocket,
      localPlayerId: 'p1',
    })

    const { result } = renderHook(() => useMultiplayerDiceBackend())

    act(() => {
      result.current.addDie('d20', 'owned-d20')
      result.current.addDie('d20', 'owned-d20')
    })

    expect(send).toHaveBeenCalledTimes(1)
  })
})
